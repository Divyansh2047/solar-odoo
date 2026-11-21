import { addDays, financialYear, formatINR, SUBSIDY_STATUS_LABEL, type SubsidyStatus } from '@arka/shared';
import type { Db } from '../db/pool.js';
import { config } from '../config.js';
import { token } from '../lib/crypto.js';
import { conflict, invalid } from '../lib/errors.js';
import { publish } from '../lib/events.js';
import { sendMail } from '../lib/mailer.js';
import { afterCommit, audit, logActivity, nextRef, today, type Ctx } from './context.js';
import { many, maybe, one } from './util.js';

interface InvoiceRow {
  [k: string]: unknown;
  id: number;
  number: string;
  customer_id: number;
  job_id: number | null;
  ticket_id: number | null;
  kind: 'system' | 'service';
  status: string;
  total_paise: number;
  public_token: string;
  due_on: string;
}

export async function invoiceNumber(db: Db, ctx: Ctx): Promise<string> {
  return nextRef(db, `INV/${financialYear(today(ctx))}`);
}

/** Final tax invoice for an installed system, drafted automatically ("invoices to send"). */
export async function createSystemInvoice(db: Db, ctx: Ctx, jobId: number): Promise<{ id: number; number: string }> {
  const existing = await maybe<{ id: number; number: string }>(db, `SELECT id, number FROM invoices WHERE job_id = $1 AND status <> 'void'`, [jobId]);
  if (existing) return existing;
  const job = await one<{ customer_id: number; quote_id: number; ref: string }>(db, `SELECT customer_id, quote_id, ref FROM jobs WHERE id = $1`, [jobId]);
  const q = await one<{ subtotal_paise: number; discount_paise: number; tax_paise: number; total_paise: number }>(
    db,
    `SELECT subtotal_paise, discount_paise, tax_paise, total_paise FROM quotes WHERE id = $1`,
    [job.quote_id],
  );
  const number = await invoiceNumber(db, ctx);
  const issued = today(ctx);
  const inv = await one<{ id: number }>(
    db,
    `INSERT INTO invoices (number, customer_id, job_id, kind, issued_on, due_on, subtotal_paise, discount_paise, tax_paise, total_paise, public_token, created_by, created_at)
     VALUES ($1, $2, $3, 'system', $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
    [number, job.customer_id, jobId, issued, addDays(issued, 7), q.subtotal_paise, q.discount_paise, q.tax_paise, q.total_paise, token(24), ctx.userId, ctx.now],
  );
  await db.query(
    `INSERT INTO invoice_lines (invoice_id, description, hsn, qty, unit_price_paise, gst_rate_bp, amount_paise, sort)
     SELECT $2, jl.description, p.hsn, jl.qty, jl.unit_price_paise, jl.gst_rate_bp, jl.amount_paise, jl.sort FROM job_lines jl JOIN products p ON p.id = jl.product_id WHERE jl.job_id = $1`,
    [jobId, inv.id],
  );
  await db.query(`UPDATE payments SET invoice_id = $2 WHERE job_id = $1 AND invoice_id IS NULL`, [jobId, inv.id]);
  await logActivity(db, ctx, { customerId: job.customer_id, jobId, body: `Invoice ${number} drafted for ${job.ref} (${formatINR(q.total_paise)}). Review and send it.` });
  await publish(db, ['invoices']);
  return { id: inv.id, number };
}

async function paidOnInvoice(db: Db, inv: InvoiceRow): Promise<number> {
  const r = await one<{ s: number }>(
    db,
    inv.kind === 'system'
      ? `SELECT coalesce(sum(amount_paise), 0)::bigint AS s FROM payments WHERE job_id = $1`
      : `SELECT coalesce(sum(amount_paise), 0)::bigint AS s FROM payments WHERE invoice_id = $1`,
    [inv.kind === 'system' ? inv.job_id : inv.id],
  );
  return r.s;
}

export async function refreshInvoiceStatus(db: Db, invoiceId: number): Promise<string> {
  const inv = await one<InvoiceRow>(db, `SELECT * FROM invoices WHERE id = $1 FOR UPDATE`, [invoiceId]);
  if (inv.status === 'draft' || inv.status === 'void') return inv.status;
  const paid = await paidOnInvoice(db, inv);
  const status = paid >= inv.total_paise ? 'paid' : paid > 0 ? 'partially_paid' : 'sent';
  if (status !== inv.status) await db.query(`UPDATE invoices SET status = $2 WHERE id = $1`, [invoiceId, status]);
  return status;
}

export async function sendInvoice(db: Db, ctx: Ctx, invoiceId: number): Promise<{ status: string; emailed: boolean; link: string }> {
  const inv = await one<InvoiceRow>(db, `SELECT * FROM invoices WHERE id = $1 FOR UPDATE`, [invoiceId], 'That invoice');
  if (inv.status !== 'draft') throw conflict('wrong_stage', `${inv.number} was already sent.`);
  await db.query(`UPDATE invoices SET status = 'sent', sent_at = $2 WHERE id = $1`, [invoiceId, ctx.now]);
  const status = await refreshInvoiceStatus(db, invoiceId);
  const c = await one<{ name: string; email: string | null }>(db, `SELECT name, email FROM customers WHERE id = $1`, [inv.customer_id]);
  const link = `${config().APP_URL}/i/${inv.public_token}`;
  let emailed = false;
  if (c.email) {
    afterCommit(ctx, () => sendMail(
      {
        to: c.email!,
        subject: `Invoice ${inv.number}`,
        lines: [`Hello ${c.name.split(' ')[0]},`, `Your invoice ${inv.number} for ${formatINR(inv.total_paise)} is ready.`, status === 'paid' ? 'It is already paid in full. Thank you.' : `Please pay by ${inv.due_on}.`],
        action: { label: 'View invoice', url: link },
      },
      { demo: ctx.isDemo },
    ));
    emailed = true;
  }
  await logActivity(db, ctx, { customerId: inv.customer_id, jobId: inv.job_id, ticketId: inv.ticket_id, body: `Invoice ${inv.number} sent${emailed ? ` to ${c.email}` : ''}.` });
  await publish(db, ['invoices', 'jobs']);
  return { status, emailed, link };
}

export async function voidInvoice(db: Db, ctx: Ctx, invoiceId: number, reason: string): Promise<void> {
  const inv = await one<InvoiceRow>(db, `SELECT * FROM invoices WHERE id = $1 FOR UPDATE`, [invoiceId], 'That invoice');
  if (inv.status === 'void') throw conflict('wrong_stage', `${inv.number} is already void.`);
  if (inv.kind === 'service' && (await paidOnInvoice(db, inv)) > 0) throw conflict('has_payments', `${inv.number} has payments against it.`);
  await db.query(`UPDATE invoices SET status = 'void', void_reason = $2 WHERE id = $1`, [invoiceId, reason]);
  await audit(db, ctx, 'invoice.void', 'invoice', invoiceId, { reason });
  await logActivity(db, ctx, { customerId: inv.customer_id, jobId: inv.job_id, ticketId: inv.ticket_id, body: `Invoice ${inv.number} voided: ${reason}` });
  await publish(db, ['invoices']);
}

/** Payment against a service invoice (system invoices are paid through their job). */
export async function recordInvoicePayment(
  db: Db,
  ctx: Ctx,
  invoiceId: number,
  p: { amountPaise: number; method: string; reference?: string | undefined; receivedOn: string; note?: string | undefined },
): Promise<{ ref: string; status: string }> {
  const inv = await one<InvoiceRow>(db, `SELECT * FROM invoices WHERE id = $1 FOR UPDATE`, [invoiceId], 'That invoice');
  if (inv.kind === 'system') throw conflict('use_job', 'Record system payments on the job.');
  if (inv.status === 'void' || inv.status === 'draft') throw conflict('wrong_stage', `Send ${inv.number} before recording payments.`);
  const due = inv.total_paise - (await paidOnInvoice(db, inv));
  if (due <= 0) throw conflict('fully_paid', `${inv.number} is already paid.`);
  if (p.amountPaise > due) throw conflict('overpayment', `That’s more than the ${formatINR(due)} due on ${inv.number}.`);
  const ref = await nextRef(db, 'RCPT');
  await db.query(
    `INSERT INTO payments (ref, customer_id, invoice_id, amount_paise, method, reference, received_on, note, recorded_by, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [ref, inv.customer_id, invoiceId, p.amountPaise, p.method, p.reference ?? null, p.receivedOn, p.note ?? null, ctx.userId, ctx.now],
  );
  const status = await refreshInvoiceStatus(db, invoiceId);
  await logActivity(db, ctx, { customerId: inv.customer_id, ticketId: inv.ticket_id, body: `${formatINR(p.amountPaise)} received against ${inv.number} (${ref}).` });
  await publish(db, ['invoices', 'payments']);
  return { ref, status };
}

const SUBSIDY_ORDER: SubsidyStatus[] = ['not_started', 'documents', 'applied', 'inspection', 'approved', 'disbursed'];

export async function updateSubsidy(
  db: Db,
  ctx: Ctx,
  jobId: number,
  input: { status: SubsidyStatus; applicationNo?: string | undefined; docsBill: boolean; docsId: boolean; docsBank: boolean; docsPhoto: boolean; disbursedPaise?: number | undefined; note?: string | undefined },
): Promise<void> {
  const s = await one<{ id: number; status: SubsidyStatus; application_no: string | null; applied_on: string | null; expected_paise: number }>(
    db,
    `SELECT id, status, application_no, applied_on, expected_paise FROM subsidy_cases WHERE job_id = $1 FOR UPDATE`,
    [jobId],
    'The subsidy case',
  );
  const job = await one<{ customer_id: number; status: string }>(db, `SELECT customer_id, status FROM jobs WHERE id = $1`, [jobId]);
  const from = SUBSIDY_ORDER.indexOf(s.status);
  const to = SUBSIDY_ORDER.indexOf(input.status);
  if (input.status !== 'rejected' && from >= 0 && to >= 0 && to < from) throw conflict('backwards', `The subsidy is already at “${SUBSIDY_STATUS_LABEL[s.status]}”.`);
  const docsComplete = input.docsBill && input.docsId && input.docsBank && input.docsPhoto;
  if (to >= SUBSIDY_ORDER.indexOf('applied') && !docsComplete) throw invalid('Collect all four documents before applying.', { status: 'Documents missing' });
  if (to >= SUBSIDY_ORDER.indexOf('applied') && !input.applicationNo && !s.application_no) throw invalid('Add the portal application number.', { applicationNo: 'Required once applied' });
  if (to >= SUBSIDY_ORDER.indexOf('inspection') && !['installed', 'closed'].includes(job.status)) throw conflict('not_installed', 'The inspection comes after installation.');
  if (input.status === 'disbursed' && input.disbursedPaise === undefined) throw invalid('Enter the amount received.', { disbursedPaise: 'Required' });
  const appliedOn = to >= SUBSIDY_ORDER.indexOf('applied') ? (s.applied_on ?? today(ctx)) : null;
  await db.query(
    `UPDATE subsidy_cases SET status = $2, application_no = coalesce($3, application_no), docs_bill = $4, docs_id = $5, docs_bank = $6, docs_photo = $7,
       applied_on = $8, disbursed_on = CASE WHEN $2 = 'disbursed' THEN $9::date ELSE NULL END, disbursed_paise = CASE WHEN $2 = 'disbursed' THEN $10::bigint ELSE NULL END,
       note = coalesce($11, note), stage_changed_at = CASE WHEN status <> $2 THEN $12 ELSE stage_changed_at END WHERE id = $1`,
    [s.id, input.status, input.applicationNo ?? null, input.docsBill, input.docsId, input.docsBank, input.docsPhoto, appliedOn, today(ctx), input.disbursedPaise ?? null, input.note ?? null, ctx.now],
  );
  if (s.status !== input.status) {
    await logActivity(db, ctx, {
      customerId: job.customer_id,
      jobId,
      body: `Subsidy: ${SUBSIDY_STATUS_LABEL[input.status]}${input.status === 'disbursed' && input.disbursedPaise !== undefined ? ` (${formatINR(input.disbursedPaise)})` : ''}.`,
    });
  }
  await publish(db, ['subsidy', 'jobs']);
}

export async function addExpense(db: Db, ctx: Ctx, e: { jobId: number; category: string; amountPaise: number; spentOn: string; note?: string | undefined }): Promise<void> {
  const job = await one<{ customer_id: number; ref: string }>(db, `SELECT customer_id, ref FROM jobs WHERE id = $1`, [e.jobId], 'That job');
  if (e.spentOn > today(ctx)) throw invalid('Expenses can’t be in the future.', { spentOn: 'Today or earlier' });
  await db.query(`INSERT INTO expenses (job_id, category, amount_paise, spent_on, note, recorded_by, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)`, [
    e.jobId,
    e.category,
    e.amountPaise,
    e.spentOn,
    e.note ?? null,
    ctx.userId,
    ctx.now,
  ]);
  await logActivity(db, ctx, { customerId: job.customer_id, jobId: e.jobId, body: `Expense ${formatINR(e.amountPaise)} (${e.category}) on ${job.ref}.` });
  await publish(db, ['jobs']);
}

export async function addTimesheet(
  db: Db,
  ctx: Ctx,
  t: { technicianId: number; jobId?: number | undefined; ticketId?: number | undefined; workDate: string; hours: number; note?: string | undefined },
): Promise<void> {
  if (t.workDate > today(ctx)) throw invalid('Hours can’t be logged for the future.', { workDate: 'Today or earlier' });
  const tech = await one<{ hourly_cost_paise: number; role: string }>(db, `SELECT hourly_cost_paise, role FROM users WHERE id = $1`, [t.technicianId], 'That technician');
  if (tech.role !== 'technician') throw invalid('Hours are logged for technicians.', { technicianId: 'Choose a technician' });
  const day = await one<{ h: number }>(db, `SELECT coalesce(sum(hours), 0)::numeric AS h FROM timesheets WHERE technician_id = $1 AND work_date = $2`, [t.technicianId, t.workDate]);
  if (day.h + t.hours > 16) throw invalid(`That makes ${day.h + t.hours} hours on one day.`, { hours: `At most ${Math.max(0, 16 - day.h)} more hours that day` });
  await db.query(
    `INSERT INTO timesheets (technician_id, job_id, ticket_id, work_date, hours, rate_paise, cost_paise, source, note, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, 'manual', $8, $9)`,
    [t.technicianId, t.jobId ?? null, t.ticketId ?? null, t.workDate, t.hours, tech.hourly_cost_paise, Math.round(tech.hourly_cost_paise * t.hours), t.note ?? null, ctx.now],
  );
  await publish(db, ['payroll']);
}

/** Collect every unpaid hour in the period into one pay run. */
export async function createPayrun(db: Db, ctx: Ctx, periodStart: string, periodEnd: string): Promise<{ id: number; ref: string; totalPaise: number; people: number }> {
  const r = await one<{ n: number; total: number; people: number }>(
    db,
    `SELECT count(*)::int AS n, coalesce(sum(cost_paise), 0)::bigint AS total, count(DISTINCT technician_id)::int AS people
       FROM timesheets WHERE payrun_id IS NULL AND work_date BETWEEN $1 AND $2`,
    [periodStart, periodEnd],
  );
  if (!r.n) throw conflict('nothing_to_pay', 'No unpaid hours in that period.');
  const ref = await nextRef(db, `PAY`);
  const run = await one<{ id: number }>(
    db,
    `INSERT INTO payruns (ref, period_start, period_end, total_paise, created_by, created_at) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [ref, periodStart, periodEnd, r.total, ctx.userId, ctx.now],
  );
  await db.query(`UPDATE timesheets SET payrun_id = $1 WHERE payrun_id IS NULL AND work_date BETWEEN $2 AND $3`, [run.id, periodStart, periodEnd]);
  await audit(db, ctx, 'payrun.create', 'payrun', run.id, { total: r.total });
  await publish(db, ['payroll']);
  return { id: run.id, ref, totalPaise: r.total, people: r.people };
}

export async function markPayrunPaid(db: Db, ctx: Ctx, payrunId: number): Promise<void> {
  const run = await one<{ status: string }>(db, `SELECT status FROM payruns WHERE id = $1 FOR UPDATE`, [payrunId], 'That pay run');
  if (run.status === 'paid') throw conflict('wrong_stage', 'Already paid.');
  await db.query(`UPDATE payruns SET status = 'paid', paid_at = $2 WHERE id = $1`, [payrunId, ctx.now]);
  await audit(db, ctx, 'payrun.paid', 'payrun', payrunId);
  await publish(db, ['payroll']);
}

export async function payrunLines(db: Db, payrunId: number) {
  return many(
    db,
    `SELECT u.id, u.name, sum(t.hours)::numeric AS hours, sum(t.cost_paise)::bigint AS amount_paise, count(*)::int AS entries
       FROM timesheets t JOIN users u ON u.id = t.technician_id WHERE t.payrun_id = $1 GROUP BY u.id, u.name ORDER BY u.name`,
    [payrunId],
  );
}
