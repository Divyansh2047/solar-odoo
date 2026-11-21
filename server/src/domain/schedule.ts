import { addDays, isoDateInTz, startOfDayUtc, type VisitKind } from '@arka/shared';
import type { Db } from '../db/pool.js';
import { conflict, invalid } from '../lib/errors.js';
import { publish } from '../lib/events.js';
import { notifyUser, type Ctx } from './context.js';
import { many, one } from './util.js';

export interface VisitLink {
  jobId?: number;
  surveyId?: number;
  ticketId?: number;
}

async function assertTechnicians(db: Db, ids: number[]): Promise<{ id: number; name: string }[]> {
  const rows = await many<{ id: number; name: string }>(db, `SELECT id, name FROM users WHERE id = ANY($1::bigint[]) AND status = 'active' AND role = 'technician'`, [ids]);
  if (rows.length !== new Set(ids).size) throw invalid('Only active technicians can be booked on visits.', { technicianIds: 'Choose active technicians' });
  return rows;
}

/** Which of these technicians are already booked in [startsAt, endsAt)? */
export async function clashes(db: Db, technicianIds: number[], startsAt: Date, endsAt: Date, exceptVisitId?: number): Promise<{ name: string; ref: string }[]> {
  return many(
    db,
    `SELECT u.name, v.kind || ' ' || to_char(v.starts_at AT TIME ZONE 'Asia/Kolkata', 'DD Mon HH24:MI') AS ref
       FROM visit_crew c JOIN users u ON u.id = c.technician_id JOIN visits v ON v.id = c.visit_id
      WHERE c.active AND c.technician_id = ANY($1::bigint[]) AND c.period && tstzrange($2, $3, '[)') AND c.visit_id IS DISTINCT FROM $4`,
    [technicianIds, startsAt, endsAt, exceptVisitId ?? null],
  );
}

export async function createVisit(
  db: Db,
  ctx: Ctx,
  v: { kind: VisitKind; customerId: number; startsAt: Date; endsAt: Date; technicianIds: number[]; notes?: string | null; link: VisitLink },
): Promise<number> {
  const techs = await assertTechnicians(db, v.technicianIds);
  const busy = await clashes(db, v.technicianIds, v.startsAt, v.endsAt);
  if (busy.length) {
    throw conflict('double_booked', `${busy.map((b) => b.name).join(', ')} ${busy.length === 1 ? 'is' : 'are'} already booked then (${busy[0]!.ref}).`, { clashes: busy });
  }
  const visit = await one<{ id: number }>(
    db,
    `INSERT INTO visits (kind, customer_id, starts_at, ends_at, notes, created_at) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [v.kind, v.customerId, v.startsAt, v.endsAt, v.notes ?? null, ctx.now],
  );
  for (const t of techs) {
    await db.query(`INSERT INTO visit_crew (visit_id, technician_id, period) VALUES ($1, $2, tstzrange($3, $4, '[)'))`, [visit.id, t.id, v.startsAt, v.endsAt]);
  }
  await db.query(`INSERT INTO visit_links (visit_id, job_id, survey_id, ticket_id) VALUES ($1, $2, $3, $4)`, [
    visit.id,
    v.link.jobId ?? null,
    v.link.surveyId ?? null,
    v.link.ticketId ?? null,
  ]);
  await publish(db, ['schedule']);
  return visit.id;
}

export async function rescheduleVisit(db: Db, ctx: Ctx, visitId: number, v: { startsAt: Date; endsAt: Date; technicianIds: number[]; notes?: string | null }): Promise<void> {
  const visit = await one<{ id: number; status: string; kind: string }>(db, `SELECT id, status, kind FROM visits WHERE id = $1 FOR UPDATE`, [visitId], 'That visit');
  if (visit.status === 'done' || visit.status === 'cancelled') throw conflict('wrong_stage', 'Finished or cancelled visits can’t be moved.');
  const techs = await assertTechnicians(db, v.technicianIds);
  const busy = await clashes(db, v.technicianIds, v.startsAt, v.endsAt, visitId);
  if (busy.length) throw conflict('double_booked', `${busy.map((b) => b.name).join(', ')} ${busy.length === 1 ? 'is' : 'are'} already booked then.`, { clashes: busy });
  const before = await many<{ technician_id: number }>(db, `SELECT technician_id FROM visit_crew WHERE visit_id = $1`, [visitId]);
  await db.query(`DELETE FROM visit_crew WHERE visit_id = $1`, [visitId]);
  await db.query(`UPDATE visits SET starts_at = $2, ends_at = $3, notes = coalesce($4, notes) WHERE id = $1`, [visitId, v.startsAt, v.endsAt, v.notes ?? null]);
  for (const t of techs) {
    await db.query(`INSERT INTO visit_crew (visit_id, technician_id, period) VALUES ($1, $2, tstzrange($3, $4, '[)'))`, [visitId, t.id, v.startsAt, v.endsAt]);
  }
  const added = techs.filter((t) => !before.some((b) => b.technician_id === t.id));
  for (const t of added) await notifyUser(db, t.id, { title: 'New visit on your schedule', link: '/app/schedule' });
  await publish(db, ['schedule', 'notifications']);
}

export async function cancelVisit(db: Db, visitId: number): Promise<void> {
  await db.query(`UPDATE visits SET status = 'cancelled' WHERE id = $1 AND status IN ('planned', 'in_progress')`, [visitId]);
  await db.query(`UPDATE visit_crew SET active = false WHERE visit_id = $1`, [visitId]);
  await publish(db, ['schedule']);
}

export async function completeVisit(db: Db, visitId: number): Promise<void> {
  await db.query(`UPDATE visits SET status = 'done' WHERE id = $1 AND status <> 'cancelled'`, [visitId]);
}

/** Technicians free for the whole window, least busy over the next fortnight first. */
export async function freeTechnicians(db: Db, startsAt: Date, endsAt: Date): Promise<{ id: number; name: string }[]> {
  return many(
    db,
    `SELECT u.id, u.name
       FROM users u
      WHERE u.status = 'active' AND u.role = 'technician'
        AND NOT EXISTS (SELECT 1 FROM visit_crew c WHERE c.technician_id = u.id AND c.active AND c.period && tstzrange($1, $2, '[)'))
      ORDER BY (SELECT count(*) FROM visit_crew c WHERE c.technician_id = u.id AND c.active
                  AND c.period && tstzrange($1, $1 + interval '14 days', '[)')), u.id`,
    [startsAt, endsAt],
  );
}

/**
 * Put a confirmed job on the crew's schedule without anyone phoning: the first working day (Mon–Sat)
 * from two days out where enough technicians are free 09:00–17:00 local time.
 */
export async function autoScheduleInstallation(db: Db, ctx: Ctx, job: { id: number; ref: string; customer_id: number; capacity_kw: number }): Promise<{ visitId: number; date: string; crew: string[] } | null> {
  const crewSize = job.capacity_kw >= 4 ? 3 : 2;
  const today = isoDateInTz(ctx.now, ctx.tz);
  for (let d = 2; d <= 28; d++) {
    const day = addDays(today, d);
    if (new Date(`${day}T12:00:00Z`).getUTCDay() === 0) continue; // Sundays off
    const start = new Date(startOfDayUtc(day, ctx.tz).getTime() + 9 * 3600_000);
    const end = new Date(start.getTime() + 8 * 3600_000);
    const free = await freeTechnicians(db, start, end);
    if (free.length < crewSize) continue;
    const crew = free.slice(0, crewSize);
    const visitId = await createVisit(db, ctx, {
      kind: 'installation',
      customerId: job.customer_id,
      startsAt: start,
      endsAt: end,
      technicianIds: crew.map((c) => c.id),
      notes: `${job.ref}: ${job.capacity_kw} kW installation`,
      link: { jobId: job.id },
    });
    for (const c of crew) {
      await notifyUser(db, c.id, { title: `Installation ${job.ref} on your schedule`, body: `${day}, 09:00. ${job.capacity_kw} kW.`, link: `/app/jobs/${job.id}` });
    }
    return { visitId, date: day, crew: crew.map((c) => c.name) };
  }
  return null;
}
