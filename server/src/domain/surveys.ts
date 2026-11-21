import { compass, type SurveySubmitInput } from '@arka/shared';
import type { Db } from '../db/pool.js';
import { conflict, invalid } from '../lib/errors.js';
import { publish } from '../lib/events.js';
import { logActivity, nextRef, notifyRoles, notifyUser, type Ctx } from './context.js';
import { cancelVisit, completeVisit, createVisit, rescheduleVisit } from './schedule.js';
import { maybe, one } from './util.js';

interface SurveyRow {
  [k: string]: unknown;
  id: number;
  ref: string;
  lead_id: number;
  customer_id: number;
  technician_id: number;
  visit_id: number | null;
  status: string;
}

export async function scheduleSurvey(
  db: Db,
  ctx: Ctx,
  input: { leadId: number; technicianId: number; startsAt: string; durationMinutes: number; notes?: string | undefined },
): Promise<SurveyRow> {
  const lead = await one<{ id: number; ref: string; status: string; customer_id: number }>(
    db,
    `SELECT id, ref, status, customer_id FROM leads WHERE id = $1 FOR UPDATE`,
    [input.leadId],
    'That enquiry',
  );
  if (!['qualified', 'survey'].includes(lead.status)) {
    throw conflict('not_qualified', `Qualify ${lead.ref} on a call first (roof space, bill, grid) before sending a technician.`);
  }
  const open = await maybe<{ ref: string }>(db, `SELECT ref FROM surveys WHERE lead_id = $1 AND status IN ('scheduled', 'submitted')`, [lead.id]);
  if (open) throw conflict('survey_open', `${open.ref} is already open for this enquiry.`);

  const startsAt = new Date(input.startsAt);
  const endsAt = new Date(startsAt.getTime() + input.durationMinutes * 60_000);
  const ref = await nextRef(db, 'SUR');
  const survey = await one<SurveyRow>(
    db,
    `INSERT INTO surveys (ref, lead_id, customer_id, technician_id, notes, created_at) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [ref, lead.id, lead.customer_id, input.technicianId, input.notes ?? null, ctx.now],
  );
  const visitId = await createVisit(db, ctx, {
    kind: 'survey',
    customerId: lead.customer_id,
    startsAt,
    endsAt,
    technicianIds: [input.technicianId],
    notes: `${ref}: measure roof direction, tilt and cable distance`,
    link: { surveyId: survey.id },
  });
  await db.query(`UPDATE surveys SET visit_id = $2 WHERE id = $1`, [survey.id, visitId]);
  await db.query(`UPDATE leads SET status = 'survey', updated_at = $2 WHERE id = $1`, [lead.id, ctx.now]);
  await logActivity(db, ctx, { customerId: lead.customer_id, leadId: lead.id, body: `Roof survey ${ref} booked.` });
  await notifyUser(db, input.technicianId, { title: `Roof survey ${ref}`, body: 'Measure roof direction, tilt and cable distance.', link: `/app/surveys/${survey.id}` });
  await publish(db, ['surveys', 'leads', 'notifications']);
  return { ...survey, visit_id: visitId };
}

export async function rescheduleSurvey(db: Db, ctx: Ctx, surveyId: number, input: { technicianId: number; startsAt: string; durationMinutes: number }): Promise<void> {
  const s = await one<SurveyRow>(db, `SELECT * FROM surveys WHERE id = $1 FOR UPDATE`, [surveyId], 'That survey');
  if (s.status !== 'scheduled') throw conflict('wrong_stage', `${s.ref} can’t be moved now.`);
  const startsAt = new Date(input.startsAt);
  const endsAt = new Date(startsAt.getTime() + input.durationMinutes * 60_000);
  if (s.visit_id) await rescheduleVisit(db, ctx, s.visit_id, { startsAt, endsAt, technicianIds: [input.technicianId] });
  await db.query(`UPDATE surveys SET technician_id = $2 WHERE id = $1`, [surveyId, input.technicianId]);
  await publish(db, ['surveys']);
}

/** The technician's measurements from the roof. */
export async function submitSurvey(db: Db, ctx: Ctx, surveyId: number, input: SurveySubmitInput): Promise<void> {
  const s = await one<SurveyRow>(db, `SELECT * FROM surveys WHERE id = $1 FOR UPDATE`, [surveyId], 'That survey');
  if (!['scheduled', 'rejected'].includes(s.status)) throw conflict('wrong_stage', `${s.ref} has already been submitted.`);
  if (ctx.role === 'technician' && ctx.userId !== s.technician_id) throw conflict('not_yours', `${s.ref} is assigned to another technician.`);
  const photos = await db.query(`SELECT id FROM files WHERE id = ANY($1::bigint[]) AND purpose = 'survey_photo'`, [input.photoIds]);
  if (photos.rowCount !== new Set(input.photoIds).size) throw invalid('Some photos didn’t upload. Add them again.', { photoIds: 'Upload the photos again' });

  await db.query(
    `UPDATE surveys SET status = 'submitted', azimuth_deg = $2, tilt_deg = $3, usable_area_sqft = $4, cable_distance_m = $5, structure_type = $6,
       roof_type = $7, shading = $8, earthing_possible = $9, recommended_kw = $10, shading_notes = $11, notes = coalesce($12, notes),
       submitted_at = $13, submitted_by = $14, reviewed_at = NULL, reviewed_by = NULL, review_note = NULL
     WHERE id = $1`,
    [
      surveyId,
      input.azimuthDeg,
      input.tiltDeg,
      input.usableAreaSqft,
      input.cableDistanceM,
      input.structureType,
      input.roofType,
      input.shading,
      input.earthingPossible,
      input.recommendedKw,
      input.shadingNotes ?? null,
      input.notes ?? null,
      ctx.now,
      ctx.userId,
    ],
  );
  await db.query(`DELETE FROM survey_photos WHERE survey_id = $1`, [surveyId]);
  for (const f of new Set(input.photoIds)) await db.query(`INSERT INTO survey_photos (survey_id, file_id) VALUES ($1, $2)`, [surveyId, f]);

  if (s.visit_id) {
    await completeVisit(db, s.visit_id);
    const v = await one<{ starts_at: Date; ends_at: Date }>(db, `SELECT starts_at, ends_at FROM visits WHERE id = $1`, [s.visit_id]);
    const hours = Math.round(((v.ends_at.getTime() - v.starts_at.getTime()) / 3600_000) * 100) / 100;
    await db.query(
      `INSERT INTO timesheets (technician_id, visit_id, work_date, hours, rate_paise, cost_paise, source, note, created_at)
       SELECT u.id, $2, ($3::timestamptz AT TIME ZONE $6)::date, $4::numeric, u.hourly_cost_paise, round(u.hourly_cost_paise * $4::numeric), 'survey', $5, $7 FROM users u WHERE u.id = $1`,
      [s.technician_id, s.visit_id, v.starts_at, hours, `Survey ${s.ref}`, ctx.tz, ctx.now],
    );
  }
  await logActivity(db, ctx, {
    customerId: s.customer_id,
    leadId: s.lead_id,
    body: `Survey ${s.ref} submitted: roof faces ${compass(input.azimuthDeg)} (${input.azimuthDeg}°), tilt ${input.tiltDeg}°, cable run ${input.cableDistanceM} m, suggests ${input.recommendedKw} kW.`,
  });
  await notifyRoles(db, ['sales'], { title: `Survey ${s.ref} needs approval`, link: `/app/surveys/${surveyId}` });
  await publish(db, ['surveys', 'leads', 'schedule', 'notifications']);
}

/** Approve (quote can now be made) or send back for a revisit. */
export async function reviewSurvey(db: Db, ctx: Ctx, surveyId: number, input: { decision: 'approve' | 'reject'; note?: string | undefined }): Promise<void> {
  const s = await one<SurveyRow & { recommended_kw: number }>(db, `SELECT * FROM surveys WHERE id = $1 FOR UPDATE`, [surveyId], 'That survey');
  if (s.status !== 'submitted') throw conflict('wrong_stage', `${s.ref} isn’t waiting for approval.`);
  const approve = input.decision === 'approve';
  await db.query(`UPDATE surveys SET status = $2, reviewed_at = $3, reviewed_by = $4, review_note = $5 WHERE id = $1`, [
    surveyId,
    approve ? 'approved' : 'rejected',
    ctx.now,
    ctx.userId,
    input.note ?? null,
  ]);
  if (approve) {
    await db.query(`UPDATE leads SET recommended_kw = $2, updated_at = $3 WHERE id = $1`, [s.lead_id, s.recommended_kw, ctx.now]);
  } else {
    await notifyUser(db, s.technician_id, { title: `${s.ref} needs a revisit`, body: input.note ?? '', link: `/app/surveys/${surveyId}` });
  }
  await logActivity(db, ctx, {
    customerId: s.customer_id,
    leadId: s.lead_id,
    body: approve ? `Survey ${s.ref} approved. A quote can now be made.` : `Survey ${s.ref} sent back: ${input.note}`,
  });
  await publish(db, ['surveys', 'leads', 'notifications']);
}

export async function cancelSurvey(db: Db, ctx: Ctx, surveyId: number): Promise<void> {
  const s = await one<SurveyRow>(db, `SELECT * FROM surveys WHERE id = $1 FOR UPDATE`, [surveyId], 'That survey');
  if (s.status !== 'scheduled') throw conflict('wrong_stage', `Only scheduled surveys can be cancelled.`);
  await db.query(`UPDATE surveys SET status = 'cancelled' WHERE id = $1`, [surveyId]);
  if (s.visit_id) await cancelVisit(db, s.visit_id);
  await db.query(`UPDATE leads SET status = 'qualified', updated_at = $2 WHERE id = $1 AND status = 'survey'`, [s.lead_id, ctx.now]);
  await logActivity(db, ctx, { customerId: s.customer_id, leadId: s.lead_id, body: `Survey ${s.ref} cancelled.` });
  await publish(db, ['surveys', 'leads']);
}
