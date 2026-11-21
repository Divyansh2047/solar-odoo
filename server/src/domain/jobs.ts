import { formatINR, PAYMENT_METHOD_LABEL, type PaymentMethod } from '@arka/shared';
import type { Db } from '../db/pool.js';
import { conflict } from '../lib/errors.js';
import { publish } from '../lib/events.js';
import { logActivity, nextRef, notifyRoles, type Ctx } from './context.js';
import { autoScheduleInstallation, cancelVisit } from './schedule.js';
import { createPickList, releasePickList } from './warehouse.js';
import { refreshInvoiceStatus } from './money.js';
import { many, maybe, one } from './util.js';

export interface JobRow {
  [k: string]: unknown;
  id: number;
  ref: string;
  quote_id: number;
  lead_id: number;
  customer_id: number;
  kind: string;
  capacity_kw: number;
  status: string;
  total_paise: number;
  revenue_ex_tax_paise: number;
  advance_required_paise: number;
  subsidy_applicable: boolean;
  confirmed_at: Date | null;
  installed_at: Date | null;
  delivered_on: string | null;
}

export async function createJobFromQuote(
  db: Db,
  ctx: Ctx,
  q: { id: number; lead_id: number; customer_id: number; kind: string; capacity_kw: number; total_paise: number; tax_paise: number; subsidy_paise: number; advance_percent: number },
): Promise<JobRow> {
  const ref = await nextRef(db, 'JOB');
  const advance = Math.round((q.total_paise * q.advance_percent) / 100);
  const job = await one<JobRow>(
    db,
    `INSERT INTO jobs (ref, quote_id, lead_id, customer_id, kind, capacity_kw, total_paise, revenue_ex_tax_paise, advance_required_paise, subsidy_applicable, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
    [ref, q.id, q.lead_id, q.customer_id, q.kind, q.capacity_kw, q.total_paise, q.total_paise - q.tax_paise, advance, q.subsidy_paise > 0, ctx.now],
  );
  await db.query(
    `INSERT INTO job_lines (job_id, product_id, description, qty, unit_price_paise, gst_rate_bp, amount_paise, sort)
     SELECT $2, product_id, description, qty, unit_price_paise, gst_rate_bp, amount_paise, sort FROM quote_lines WHERE quote_id = $1`,
    [q.id, job.id],
  );
  if (q.subsidy_paise > 0) {
    await db.query(`INSERT INTO subsidy_cases (job_id, expected_paise, stage_changed_at, created_at) VALUES ($1, $2, $3, $3)`, [job.id, q.subsidy_paise, ctx.now]);
  }
  if (advance === 0) await confirmJob(db, ctx, job.id);
  return job;
}

async function lockJob(db: Db, id: number): Promise<JobRow> {
  return one<JobRow>(db, `SELECT * FROM jobs WHERE id = $1 FOR UPDATE`, [id], 'That job');
}

export async function paidOnJob(db: Db, jobId: number): Promise<number> {
  const r = await one<{ s: number }>(db, `SELECT coalesce(sum(amount_paise), 0)::bigint AS s FROM payments WHERE job_id = $1`, [jobId]);
  return r.s;
}

/**
 * Advance or full payment. When the advance is reached the job confirms itself: the warehouse gets a
 * pick list and the crew gets the installation on their schedule, without a phone call.
 */
export async function recordJobPayment(
  db: Db,
  ctx: Ctx,
  jobId: number,
  p: { amountPaise: number; method: PaymentMethod; reference?: string | undefined; receivedOn: string; note?: string | undefined },
): Promise<{ ref: string; confirmed: boolean; balancePaise: number }> {
  const job = await lockJob(db, jobId);
  if (job.status === 'cancelled') throw conflict('wrong_stage', `${job.ref} is cancelled.`);
  const paid = await paidOnJob(db, jobId);
  const due = job.total_paise - paid;
  if (due <= 0) throw conflict('fully_paid', `${job.ref} is already paid in full.`);
  if (p.amountPaise > due) throw conflict('overpayment', `That’s more than the ${formatINR(due)} still due on ${job.ref}.`, { duePaise: due });
  const invoice = await maybe<{ id: number }>(db, `SELECT id FROM invoices WHERE job_id = $1 AND status <> 'void'`, [jobId]);
  const ref = await nextRef(db, 'RCPT');
  await db.query(
    `INSERT INTO payments (ref, customer_id, job_id, invoice_id, amount_paise, method, reference, received_on, note, recorded_by, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [ref, job.customer_id, jobId, invoice?.id ?? null, p.amountPaise, p.method, p.reference ?? null, p.receivedOn, p.note ?? null, ctx.userId, ctx.now],
  );
  const newPaid = paid + p.amountPaise;
  await logActivity(db, ctx, {
    customerId: job.customer_id,
    jobId,
    body: `${formatINR(p.amountPaise)} received by ${PAYMENT_METHOD_LABEL[p.method]} (${ref}). ${newPaid >= job.total_paise ? 'Paid in full.' : `${formatINR(job.total_paise - newPaid)} still due.`}`,
  });
  let confirmed = false;
  if (job.status === 'awaiting_advance' && newPaid >= job.advance_required_paise) {
    await confirmJob(db, ctx, jobId);
    confirmed = true;
  }
  if (invoice) await refreshInvoiceStatus(db, invoice.id);
  await publish(db, ['payments', 'jobs', 'invoices']);
  return { ref, confirmed, balancePaise: job.total_paise - newPaid };
}

export async function confirmJob(db: Db, ctx: Ctx, jobId: number): Promise<{ pickRef: string; pickStatus: string; install: { date: string; crew: string[] } | null }> {
  const job = await lockJob(db, jobId);
  if (job.status !== 'awaiting_advance') throw conflict('wrong_stage', `${job.ref} is already confirmed.`);
  await db.query(`UPDATE jobs SET status = 'confirmed', confirmed_at = $2 WHERE id = $1`, [jobId, ctx.now]);
  const pick = await createPickList(db, ctx, { id: job.id, ref: job.ref });
  const install = await autoScheduleInstallation(db, ctx, job);
  await logActivity(db, ctx, {
    customerId: job.customer_id,
    jobId,
    body: `Order confirmed. Pick list ${pick.ref} sent to the warehouse${pick.status === 'waiting_stock' ? ' (some parts short)' : ''}. ${
      install ? `Installation booked for ${install.date} with ${install.crew.join(', ')}.` : 'No crew free in the next 4 weeks: schedule it by hand.'
    }`,
  });
  await notifyRoles(db, ['warehouse'], {
    title: `Pack ${job.ref}`,
    body: pick.status === 'waiting_stock' ? `Pick list ${pick.ref} is short of some parts.` : `Pick list ${pick.ref} is ready to pack.`,
    link: `/app/warehouse/pick/${pick.id}`,
  });
  if (!install) await notifyRoles(db, ['sales'], { title: `Schedule ${job.ref} by hand`, body: 'No crew was free in the next 4 weeks.', link: `/app/jobs/${jobId}` });
  await publish(db, ['jobs', 'dispatch', 'schedule', 'notifications']);
  return { pickRef: pick.ref, pickStatus: pick.status, install };
}

export async function cancelJob(db: Db, ctx: Ctx, jobId: number, reason: string): Promise<void> {
  const job = await lockJob(db, jobId);
  if (!['awaiting_advance', 'confirmed', 'packed'].includes(job.status)) {
    throw conflict('wrong_stage', `${job.ref} has already left the warehouse. Raise a return instead.`);
  }
  await db.query(`UPDATE jobs SET status = 'cancelled', cancelled_reason = $2 WHERE id = $1`, [jobId, reason]);
  await releasePickList(db, ctx, jobId);
  const visits = await many<{ visit_id: number }>(db, `SELECT l.visit_id FROM visit_links l JOIN visits v ON v.id = l.visit_id WHERE l.job_id = $1 AND v.status = 'planned'`, [jobId]);
  for (const v of visits) await cancelVisit(db, v.visit_id);
  const paid = await paidOnJob(db, jobId);
  await logActivity(db, ctx, {
    customerId: job.customer_id,
    jobId,
    body: `Job cancelled: ${reason}.${paid ? ` ${formatINR(paid)} was paid and needs a refund.` : ''}`,
  });
  await publish(db, ['jobs', 'dispatch', 'schedule']);
}

/** A job closes when it's installed and fully paid. Subsidy paperwork can still finish later. */
export async function closeJob(db: Db, ctx: Ctx, jobId: number): Promise<void> {
  const job = await lockJob(db, jobId);
  if (job.status !== 'installed') throw conflict('wrong_stage', `${job.ref} isn’t installed yet.`);
  const paid = await paidOnJob(db, jobId);
  if (paid < job.total_paise) throw conflict('balance_due', `${formatINR(job.total_paise - paid)} is still due on ${job.ref}.`);
  await db.query(`UPDATE jobs SET status = 'closed', closed_at = $2 WHERE id = $1`, [jobId, ctx.now]);
  await logActivity(db, ctx, { customerId: job.customer_id, jobId, body: 'Job closed.' });
  await publish(db, ['jobs']);
}
