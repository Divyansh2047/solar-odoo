import { Router } from 'express';
import { invoiceVoidSchema, paymentSchema, payrunSchema, subsidyUpdateSchema, timesheetSchema } from '@arka/shared';
import { addTimesheet, createPayrun, markPayrunPaid, payrunLines, recordInvoicePayment, sendInvoice, updateSubsidy, voidInvoice } from '../../domain/money.js';
import { notFound } from '../../lib/errors.js';
import { act, idParam, query, read, withDb } from '../context.js';

export async function invoiceDetail(id: number, byToken?: string) {
  const i = await query(
    `SELECT i.*, c.name AS customer, c.phone, c.email, c.address, c.city, c.pincode, j.ref AS job_ref, t.ref AS ticket_ref,
            co.name AS company_name, co.phone AS company_phone, co.email AS company_email, co.address AS company_address, co.gstin AS company_gstin,
            coalesce((SELECT sum(amount_paise) FROM payments p WHERE (i.kind = 'system' AND p.job_id = i.job_id) OR (i.kind = 'service' AND p.invoice_id = i.id)), 0)::bigint AS paid_paise
       FROM invoices i JOIN customers c ON c.id = i.customer_id JOIN companies co ON co.id = i.company_id LEFT JOIN jobs j ON j.id = i.job_id LEFT JOIN tickets t ON t.id = i.ticket_id
      WHERE ${byToken ? 'i.public_token = $1' : 'i.id = $1'}`,
    [byToken ?? id],
  );
  const inv = i.rows[0];
  if (!inv) throw notFound('That invoice');
  const [lines, payments] = await Promise.all([
    query(`SELECT * FROM invoice_lines WHERE invoice_id = $1 ORDER BY sort`, [inv.id]),
    query(
      `SELECT ref, amount_paise, method, received_on, reference FROM payments WHERE (($2 = 'system' AND job_id = $3) OR ($2 = 'service' AND invoice_id = $1)) ORDER BY received_on`,
      [inv.id, inv.kind, inv.job_id],
    ),
  ]);
  return { invoice: inv, lines: lines.rows, payments: payments.rows };
}

export function moneyRoutes(): Router {
  const r = Router();

  r.get(
    '/invoices',
    read('invoices.read', async (req) => {
      const status = typeof req.query.status === 'string' && req.query.status !== 'all' ? req.query.status : null;
      const rows = await query(
        `SELECT i.id, i.number, i.kind, i.status, i.issued_on, i.due_on, i.total_paise, i.sent_at, c.name AS customer, c.city, j.ref AS job_ref, j.id AS job_id, t.ref AS ticket_ref, t.id AS ticket_id,
                coalesce((SELECT sum(amount_paise) FROM payments p WHERE (i.kind = 'system' AND p.job_id = i.job_id) OR (i.kind = 'service' AND p.invoice_id = i.id)), 0)::bigint AS paid_paise
           FROM invoices i JOIN customers c ON c.id = i.customer_id LEFT JOIN jobs j ON j.id = i.job_id LEFT JOIN tickets t ON t.id = i.ticket_id
          WHERE ($1::text IS NULL OR i.status = $1)
          ORDER BY CASE i.status WHEN 'draft' THEN 0 WHEN 'sent' THEN 1 WHEN 'partially_paid' THEN 2 ELSE 3 END, i.issued_on DESC, i.id DESC LIMIT 400`,
        [status],
      );
      const totals = await query(
        `SELECT status, count(*)::int AS n, coalesce(sum(total_paise), 0)::bigint AS v FROM invoices GROUP BY status`,
      );
      return { invoices: rows.rows, totals: totals.rows };
    }),
  );
  r.get('/invoices/:id', read('invoices.read', async (req) => invoiceDetail(idParam(req))));
  r.post('/invoices/:id/send', act('invoices.write', null, async (_i, db, ctx, req) => sendInvoice(db, ctx, idParam(req))));
  r.post('/invoices/:id/void', act('invoices.write', invoiceVoidSchema, async (input, db, ctx, req) => voidInvoice(db, ctx, idParam(req), input.reason)));
  r.post('/invoices/:id/payments', act('payments.write', paymentSchema, async (input, db, ctx, req) => recordInvoicePayment(db, ctx, idParam(req), input)));

  r.get(
    '/payments',
    read('invoices.read', async () => {
      const rows = await query(
        `SELECT p.id, p.ref, p.amount_paise, p.method, p.reference, p.received_on, c.name AS customer, j.ref AS job_ref, j.id AS job_id, i.number AS invoice_number
           FROM payments p JOIN customers c ON c.id = p.customer_id LEFT JOIN jobs j ON j.id = p.job_id LEFT JOIN invoices i ON i.id = p.invoice_id
          ORDER BY p.received_on DESC, p.id DESC LIMIT 300`,
      );
      return { payments: rows.rows };
    }),
  );

  r.get(
    '/subsidy',
    read('jobs.read', async () => {
      const rows = await query(
        `SELECT s.*, j.ref AS job_ref, j.id AS job_id, j.capacity_kw, j.installed_at, c.name AS customer, c.city,
                extract(day FROM now() - s.stage_changed_at)::int AS days_in_stage
           FROM subsidy_cases s JOIN jobs j ON j.id = s.job_id JOIN customers c ON c.id = j.customer_id
          WHERE j.status <> 'cancelled' ORDER BY array_position(ARRAY['not_started','documents','applied','inspection','approved','rejected','disbursed'], s.status), s.stage_changed_at`,
      );
      return { cases: rows.rows };
    }),
  );
  r.put('/jobs/:id/subsidy', act('subsidy.write', subsidyUpdateSchema, async (input, db, ctx, req) => updateSubsidy(db, ctx, idParam(req), input)));

  r.get(
    '/payroll',
    read('payroll.read', async () => {
      const [unpaid, runs] = await Promise.all([
        query(
          `SELECT u.id, u.name, u.hourly_cost_paise, coalesce(sum(t.hours), 0)::numeric AS hours, coalesce(sum(t.cost_paise), 0)::bigint AS amount_paise,
                  count(t.id)::int AS entries, min(t.work_date) AS first_day, max(t.work_date) AS last_day
             FROM users u LEFT JOIN timesheets t ON t.technician_id = u.id AND t.payrun_id IS NULL
            WHERE u.role = 'technician' AND u.status = 'active' GROUP BY u.id ORDER BY amount_paise DESC, u.name`,
        ),
        query(`SELECT r.*, (SELECT count(DISTINCT technician_id) FROM timesheets t WHERE t.payrun_id = r.id)::int AS people FROM payruns r ORDER BY r.period_end DESC LIMIT 24`),
      ]);
      return { unpaid: unpaid.rows, runs: runs.rows };
    }),
  );
  r.get(
    '/payroll/technicians/:id',
    read('payroll.read', async (req) => {
      const rows = await query(
        `SELECT t.id, t.work_date, t.hours, t.rate_paise, t.cost_paise, t.source, t.note, t.payrun_id, j.ref AS job_ref, k.ref AS ticket_ref
           FROM timesheets t LEFT JOIN jobs j ON j.id = t.job_id LEFT JOIN tickets k ON k.id = t.ticket_id WHERE t.technician_id = $1 ORDER BY t.work_date DESC LIMIT 200`,
        [idParam(req)],
      );
      return { entries: rows.rows };
    }),
  );
  r.get('/payroll/runs/:id', read('payroll.read', async (req) => ({ lines: await withDb((db) => payrunLines(db, idParam(req))) })));
  r.post('/timesheets', act('payroll.write', timesheetSchema, async (input, db, ctx) => addTimesheet(db, ctx, input)));
  r.post('/payroll/runs', act('payroll.write', payrunSchema, async (input, db, ctx) => createPayrun(db, ctx, input.periodStart, input.periodEnd)));
  r.post('/payroll/runs/:id/paid', act('payroll.write', null, async (_i, db, ctx, req) => markPayrunPaid(db, ctx, idParam(req))));

  return r;
}
