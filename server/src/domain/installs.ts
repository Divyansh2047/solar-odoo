import { formatKw, type InstallReportInput } from '@arka/shared';
import type { Db } from '../db/pool.js';
import { conflict, invalid } from '../lib/errors.js';
import { publish } from '../lib/events.js';
import { logActivity, notifyRoles, type Ctx } from './context.js';
import { createSystemInvoice } from './money.js';
import { completeVisit } from './schedule.js';
import { many, maybe, one } from './util.js';

/**
 * The crew's report from the roof: start and finish, confirmed size, test reading, photos and the
 * homeowner's on-screen signature. Gives the company proof of the job, books the crew's hours to the
 * job, and drafts the final invoice.
 */
export async function submitInstallReport(db: Db, ctx: Ctx, jobId: number, input: InstallReportInput): Promise<{ reportId: number; invoiceNumber: string }> {
  const job = await one<{ id: number; ref: string; status: string; customer_id: number; capacity_kw: number; delivered_on: string | null }>(
    db,
    `SELECT id, ref, status, customer_id, capacity_kw, delivered_on FROM jobs WHERE id = $1 FOR UPDATE`,
    [jobId],
    'That job',
  );
  if (job.status === 'installed' || job.status === 'closed') throw conflict('already_installed', `${job.ref} already has an installation report.`);
  if (job.status !== 'delivered') throw conflict('not_delivered', `Mark the kit as delivered before the installation report (${job.ref} is “${job.status}”).`);
  const started = new Date(input.startedAt);
  if (job.delivered_on && started.toISOString().slice(0, 10) < job.delivered_on) {
    // compare on the calendar: work can't start before the kit arrived
    const startLocal = new Intl.DateTimeFormat('en-CA', { timeZone: ctx.tz }).format(started);
    if (startLocal < job.delivered_on) throw invalid('Work can’t start before the kit was delivered.', { startedAt: `On or after ${job.delivered_on}` });
  }
  if (Math.round(input.confirmedKw * 10) !== Math.round(job.capacity_kw * 10) && !(input.sizeMismatchReason && input.sizeMismatchReason.length >= 5)) {
    throw invalid(`The order is ${formatKw(job.capacity_kw)} but you confirmed ${formatKw(input.confirmedKw)}. Say why.`, { sizeMismatchReason: 'Explain the difference' });
  }
  if (input.generationKw > input.confirmedKw * 1.25) {
    throw invalid(`A ${formatKw(input.confirmedKw)} system can’t produce ${input.generationKw} kW. Check the reading.`, { generationKw: 'Check the reading' });
  }
  const files = await many<{ id: number; purpose: string }>(db, `SELECT id, purpose FROM files WHERE id = ANY($1::bigint[])`, [[...input.photoIds, input.signatureFileId]]);
  const photos = files.filter((f) => f.purpose === 'install_photo' && input.photoIds.includes(f.id));
  if (photos.length !== new Set(input.photoIds).size) throw invalid('Some photos didn’t upload. Add them again.', { photoIds: 'Upload the photos again' });
  if (!files.some((f) => f.id === input.signatureFileId && f.purpose === 'signature')) throw invalid('The signature didn’t save. Ask the homeowner to sign again.', { signatureFileId: 'Sign again' });
  const crew = await many<{ id: number; hourly_cost_paise: number }>(
    db,
    `SELECT id, hourly_cost_paise FROM users WHERE id = ANY($1::bigint[]) AND role = 'technician' AND status = 'active'`,
    [input.crewIds],
  );
  if (crew.length !== new Set(input.crewIds).size) throw invalid('Choose the technicians who were on the roof.', { crewIds: 'Only active technicians' });

  const visit = await maybe<{ id: number }>(
    db,
    `SELECT v.id FROM visits v JOIN visit_links l ON l.visit_id = v.id WHERE l.job_id = $1 AND v.kind = 'installation' AND v.status <> 'cancelled' ORDER BY v.starts_at LIMIT 1`,
    [jobId],
  );
  const report = await one<{ id: number }>(
    db,
    `INSERT INTO install_reports (job_id, visit_id, started_at, finished_at, confirmed_kw, size_mismatch_reason, generation_kw, chk_structure, chk_panels, chk_wiring,
       chk_earthing, chk_generation, signature_file_id, signed_by_name, notes, submitted_by, submitted_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, true, true, true, true, true, $8, $9, $10, $11, $12) RETURNING id`,
    [jobId, visit?.id ?? null, input.startedAt, input.finishedAt, input.confirmedKw, input.sizeMismatchReason ?? null, input.generationKw, input.signatureFileId, input.signedByName, input.notes ?? null, ctx.userId, ctx.now],
  );
  for (const f of new Set(input.photoIds)) await db.query(`INSERT INTO install_photos (report_id, file_id) VALUES ($1, $2)`, [report.id, f]);
  if (visit) await completeVisit(db, visit.id);

  const hours = Math.round(((new Date(input.finishedAt).getTime() - started.getTime()) / 3600_000) * 100) / 100;
  for (const c of crew) {
    await db.query(
      `INSERT INTO timesheets (technician_id, job_id, visit_id, work_date, hours, rate_paise, cost_paise, source, note, created_at)
       VALUES ($1, $2, $3, ($4::timestamptz AT TIME ZONE $8)::date, $5, $6, $7, 'installation', $9, $10)`,
      [c.id, jobId, visit?.id ?? null, input.startedAt, hours, c.hourly_cost_paise, Math.round(c.hourly_cost_paise * hours), ctx.tz, `Installation ${job.ref}`, ctx.now],
    );
  }
  await db.query(`UPDATE jobs SET status = 'installed', installed_at = $2 WHERE id = $1`, [jobId, input.finishedAt]);
  const invoice = await createSystemInvoice(db, ctx, jobId);
  await logActivity(db, ctx, {
    customerId: job.customer_id,
    jobId,
    body: `Installed and tested: ${formatKw(input.confirmedKw)}, generating ${input.generationKw} kW at handover. ${input.signedByName} signed on screen. ${crew.length} technicians × ${hours} h.`,
  });
  await notifyRoles(db, ['accounts'], { title: `Invoice ${invoice.number} ready to send`, body: `${job.ref} was installed and signed off.`, link: `/app/money/invoices` });
  await publish(db, ['installs', 'jobs', 'schedule', 'invoices', 'payroll', 'notifications']);
  return { reportId: report.id, invoiceNumber: invoice.number };
}
