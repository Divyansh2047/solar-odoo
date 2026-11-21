import { Router, type Request } from 'express';
import rateLimit from 'express-rate-limit';
import { portalTicketSchema, publicEnquirySchema, quoteAcceptSchema, quoteDeclineSchema, ticketReopenSchema, type Period } from '@arka/shared';
import { asCompany, asSystem, checkout, query, tx } from '../../db/pool.js';
import type { Ctx } from '../../domain/context.js';
import { createEnquiry } from '../../domain/leads.js';
import { acceptQuote, declineQuote } from '../../domain/quotes.js';
import { confirmTicket, createTicket, reopenTicket } from '../../domain/tickets.js';
import { dashboard } from '../../domain/reports.js';
import { sha256 } from '../../lib/crypto.js';
import { AppError, notFound } from '../../lib/errors.js';
import { zParse } from '../context.js';
import { quoteDetail } from './sales.js';
import { invoiceDetail } from './money.js';
import { sendImage } from './admin.js';

const limiter = (windowMin: number, max: number) =>
  rateLimit({ windowMs: windowMin * 60_000, limit: max, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: { code: 'rate_limited', message: 'Too many requests. Try again in a little while.' } } });

const tokenOk = (t: string) => /^[A-Za-z0-9_-]{20,100}$/.test(t);

const pick = (o: Record<string, unknown>, keys: string[]) => Object.fromEntries(keys.filter((k) => k in o).map((k) => [k, o[k]]));

/** What a customer may see of a quote: nothing internal (no ids of people, no margins, no tokens). */
const PUBLIC_QUOTE_FIELDS = [
  'ref', 'version', 'status', 'kind', 'capacity_kw', 'valid_until', 'subtotal_paise', 'discount_paise', 'tax_paise', 'total_paise', 'subsidy_paise',
  'advance_percent', 'notes', 'created_at', 'sent_at', 'customer', 'phone', 'address', 'city', 'pincode', 'customer_kind', 'template_name', 'survey_ref',
  'azimuth_deg', 'tilt_deg', 'cable_distance_m', 'company_name', 'company_phone', 'company_email', 'company_address', 'company_gstin', 'accepted_name', 'job_ref',
];

async function companyFor(sql: string, value: string): Promise<{ companyId: number; tz: string; kind: string; rowId: number }> {
  const r = await asSystem(() => query<{ company_id: number; timezone: string; kind: string; id: number }>(sql, [value]));
  const row = r.rows[0];
  if (!row) throw notFound('That link');
  return { companyId: row.company_id, tz: row.timezone, kind: row.kind, rowId: row.id };
}

const customerCtx = (c: { companyId: number; tz: string; kind: string }): Ctx => ({ companyId: c.companyId, userId: null, role: 'customer', tz: c.tz, now: new Date(), isDemo: c.kind === 'demo' });

export function publicRoutes(): Router {
  const r = Router();
  const reads = limiter(5, 300);
  const writes = limiter(60, 20);

  /* ---------------- website enquiry form ---------------- */
  r.get('/enquiry/:key', reads, async (req, res) => {
    const key = String(req.params.key);
    if (!/^[a-f0-9]{32}$/.test(key)) throw notFound('That form');
    const c = await asSystem(() => query<{ name: string; phone: string | null }>(`SELECT name, phone FROM companies WHERE public_key = $1 AND kind <> 'template'`, [key]));
    if (!c.rows[0]) throw notFound('That form');
    res.json({ company: c.rows[0].name, phone: c.rows[0].phone });
  });

  r.post('/enquiry/:key', writes, async (req, res) => {
    const key = String(req.params.key);
    if (!/^[a-f0-9]{32}$/.test(key)) throw notFound('That form');
    const input = zParse(publicEnquirySchema, req.body);
    const co = await asSystem(() => query<{ id: number; timezone: string; kind: string }>(`SELECT id, timezone, kind FROM companies WHERE public_key = $1 AND kind <> 'template'`, [key]));
    const company = co.rows[0];
    if (!company) throw notFound('That form');
    if (input.website) {
      // honeypot filled: pretend success, store nothing
      res.status(201).json({ ref: 'ENQ-RECEIVED' });
      return;
    }
    const out = await asCompany(company.id, () =>
      tx((db) => createEnquiry(db, { companyId: company.id, userId: null, role: 'system', tz: company.timezone, now: new Date(), isDemo: company.kind === 'demo' }, { ...input, source: 'web_form' })),
    );
    res.status(201).json({ ref: out.lead.ref });
  });

  /* ---------------- quote page ---------------- */
  r.get('/quotes/:token', reads, async (req, res) => {
    const t = String(req.params.token);
    if (!tokenOk(t)) throw notFound('That quote');
    // resolve the workspace from the link, then read inside it (row-level security applies)
    const c = await companyFor(`SELECT q.company_id, co.timezone, co.kind, q.id FROM quotes q JOIN companies co ON co.id = q.company_id WHERE q.public_token = $1`, t);
    const out = await asCompany(c.companyId, () => quoteDetail(c.rowId));
    const { quote } = out;
    if (quote.status === 'draft' || quote.status === 'superseded') throw notFound('That quote');
    res.json({
      quote: pick(quote, PUBLIC_QUOTE_FIELDS),
      lines: out.lines.map((l: Record<string, unknown>) => pick(l, ['id', 'description', 'qty', 'unit_price_paise', 'gst_rate_bp', 'amount_paise', 'sku', 'category', 'uom'])),
      generation: out.generation,
      paybackYears: out.paybackYears,
      versions: [],
    });
  });

  r.post('/quotes/:token/accept', writes, async (req, res) => {
    const t = String(req.params.token);
    if (!tokenOk(t)) throw notFound('That quote');
    const input = zParse(quoteAcceptSchema, req.body);
    const c = await companyFor(`SELECT q.company_id, co.timezone, co.kind, q.id FROM quotes q JOIN companies co ON co.id = q.company_id WHERE q.public_token = $1`, t);
    const out = await asCompany(c.companyId, () => tx((db) => acceptQuote(db, customerCtx(c), c.rowId, input.name)));
    res.json({ jobRef: out.jobRef });
  });

  r.post('/quotes/:token/decline', writes, async (req, res) => {
    const t = String(req.params.token);
    if (!tokenOk(t)) throw notFound('That quote');
    const input = zParse(quoteDeclineSchema, req.body);
    const c = await companyFor(`SELECT q.company_id, co.timezone, co.kind, q.id FROM quotes q JOIN companies co ON co.id = q.company_id WHERE q.public_token = $1`, t);
    await asCompany(c.companyId, () => tx((db) => declineQuote(db, customerCtx(c), c.rowId, input.reason)));
    res.json({ ok: true });
  });

  /* ---------------- invoice page ---------------- */
  r.get('/invoices/:token', reads, async (req, res) => {
    const t = String(req.params.token);
    if (!tokenOk(t)) throw notFound('That invoice');
    const c = await companyFor(`SELECT i.company_id, co.timezone, co.kind, i.id FROM invoices i JOIN companies co ON co.id = i.company_id WHERE i.public_token = $1`, t);
    const out = await asCompany(c.companyId, () => invoiceDetail(c.rowId));
    if (out.invoice.status === 'draft' || out.invoice.status === 'void') throw notFound('That invoice');
    const { company_id, customer_id, job_id, ticket_id, created_by, ...invoice } = out.invoice as Record<string, unknown>;
    void [company_id, customer_id, job_id, ticket_id, created_by];
    res.json({ ...out, invoice });
  });

  /* ---------------- customer page ("My solar") ---------------- */
  const portalCustomer = async (req: Request) => {
    const t = String(req.params.token);
    if (!tokenOk(t)) throw notFound('That page');
    return companyFor(`SELECT c.company_id, co.timezone, co.kind, c.id FROM customers c JOIN companies co ON co.id = c.company_id WHERE c.portal_token = $1`, t);
  };

  r.get('/portal/:token', reads, async (req, res) => {
    const c = await portalCustomer(req);
    const data = await asCompany(c.companyId, async () => {
      const [customer, company, jobs, serials, reports, tickets, quotes, invoices] = await Promise.all([
        query(`SELECT id, name, city, phone FROM customers WHERE id = $1`, [c.rowId]),
        query(`SELECT name, phone, email, address FROM companies WHERE id = app_company()`),
        query(
          `SELECT j.id, j.ref, j.status, j.kind, j.capacity_kw, j.delivered_on, j.installed_at, j.total_paise,
                  (SELECT coalesce(sum(jl.qty), 0) FROM job_lines jl JOIN products p ON p.id = jl.product_id WHERE jl.job_id = j.id AND p.category = 'panel')::int AS panels,
                  (SELECT coalesce(sum(jl.qty), 0) FROM job_lines jl JOIN products p ON p.id = jl.product_id WHERE jl.job_id = j.id AND p.category = 'battery')::int AS batteries,
                  (SELECT coalesce(sum(jl.qty * coalesce(p.capacity_w, 0)), 0) FROM job_lines jl JOIN products p ON p.id = jl.product_id WHERE jl.job_id = j.id AND p.category = 'battery')::numeric / 1000 AS battery_kwh,
                  (SELECT s.status FROM subsidy_cases s WHERE s.job_id = j.id) AS subsidy_status,
                  (SELECT s.expected_paise FROM subsidy_cases s WHERE s.job_id = j.id) AS subsidy_paise
             FROM jobs j WHERE j.customer_id = $1 AND j.status <> 'cancelled' ORDER BY j.created_at DESC`,
          [c.rowId],
        ),
        query(
          `SELECT su.id, su.serial, su.status, su.warranty_start, su.warranty_end, su.job_id, p.name AS product, p.category, p.warranty_months
             FROM serial_units su JOIN products p ON p.id = su.product_id WHERE su.customer_id = $1 AND su.status IN ('installed', 'dispatched', 'replaced')
            ORDER BY array_position(ARRAY['inverter','battery','charge_controller','panel'], p.category), su.serial`,
          [c.rowId],
        ),
        query(
          `SELECT r.job_id, r.started_at, r.finished_at, r.confirmed_kw, r.generation_kw, r.signed_by_name, r.signature_file_id, r.submitted_at,
                  (SELECT coalesce(json_agg(file_id), '[]') FROM install_photos p WHERE p.report_id = r.id) AS photo_ids,
                  (SELECT coalesce(json_agg(DISTINCT u.name), '[]') FROM timesheets t JOIN users u ON u.id = t.technician_id WHERE t.job_id = r.job_id AND t.source = 'installation') AS crew
             FROM install_reports r JOIN jobs j ON j.id = r.job_id WHERE j.customer_id = $1`,
          [c.rowId],
        ),
        query(
          `SELECT t.id, t.ref, t.status, t.coverage, t.description, t.resolution, t.created_at, t.resolved_at, t.closed_at, t.billed_paise, su.serial, p.name AS product
             FROM tickets t LEFT JOIN serial_units su ON su.id = t.serial_unit_id LEFT JOIN products p ON p.id = su.product_id WHERE t.customer_id = $1 ORDER BY t.created_at DESC`,
          [c.rowId],
        ),
        query(`SELECT ref, version, status, total_paise, capacity_kw, kind, public_token, valid_until FROM quotes WHERE customer_id = $1 AND status IN ('sent', 'accepted') ORDER BY created_at DESC`, [
          c.rowId,
        ]),
        query(`SELECT number, status, total_paise, issued_on, public_token FROM invoices WHERE customer_id = $1 AND status NOT IN ('draft', 'void') ORDER BY issued_on DESC`, [c.rowId]),
      ]);
      return {
        customer: customer.rows[0],
        company: company.rows[0],
        jobs: jobs.rows,
        serials: serials.rows,
        reports: reports.rows,
        tickets: tickets.rows,
        quotes: quotes.rows,
        invoices: invoices.rows,
      };
    });
    res.json(data);
  });

  r.get('/portal/:token/files/:id', reads, async (req, res) => {
    const c = await portalCustomer(req);
    const fileId = Number(req.params.id);
    if (!Number.isInteger(fileId) || fileId <= 0) throw notFound('That file');
    const f = await asCompany(c.companyId, () =>
      query<{ mime: string; bytes: Buffer; sha256: string }>(
        `SELECT f.mime, f.bytes, f.sha256 FROM files f WHERE f.id = $1 AND (
           EXISTS (SELECT 1 FROM install_photos p JOIN install_reports r ON r.id = p.report_id JOIN jobs j ON j.id = r.job_id WHERE p.file_id = f.id AND j.customer_id = $2)
           OR EXISTS (SELECT 1 FROM install_reports r JOIN jobs j ON j.id = r.job_id WHERE r.signature_file_id = f.id AND j.customer_id = $2))`,
        [fileId, c.rowId],
      ),
    );
    if (!f.rows[0]) throw notFound('That file');
    sendImage(res, f.rows[0]);
  });

  r.post('/portal/:token/tickets', writes, async (req, res) => {
    const c = await portalCustomer(req);
    const input = zParse(portalTicketSchema, req.body);
    const out = await asCompany(c.companyId, () =>
      tx(async (db) => {
        const cust = await db.query<{ phone: string }>(`SELECT phone FROM customers WHERE id = $1`, [c.rowId]);
        if (cust.rows[0]?.phone !== input.phone) throw new AppError(400, 'phone_mismatch', 'Use the mobile number we have on file for you.', { phone: 'Not the number on file' });
        const open = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM tickets WHERE customer_id = $1 AND channel = 'portal' AND status <> 'closed'`, [c.rowId]);
        if (open.rows[0]!.n >= 3) throw new AppError(429, 'too_many_open', 'You already have open complaints with us. Our team will call you; you can follow them on this page.');
        return createTicket(db, customerCtx(c), { customerId: c.rowId, serialUnitId: input.serialUnitId, channel: 'portal', description: input.description, priority: 'normal' });
      }),
    );
    res.status(201).json({ ref: out.ref, coverage: out.coverage });
  });

  const portalTicket = async (req: Request) => {
    const c = await portalCustomer(req);
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw notFound('That ticket');
    const t = await asCompany(c.companyId, () => query<{ id: number }>(`SELECT id FROM tickets WHERE id = $1 AND customer_id = $2`, [id, c.rowId]));
    if (!t.rows[0]) throw notFound('That ticket');
    return { c, id };
  };

  r.post('/portal/:token/tickets/:id/confirm', writes, async (req, res) => {
    const { c, id } = await portalTicket(req);
    await asCompany(c.companyId, () => tx((db) => confirmTicket(db, customerCtx(c), id, 'portal')));
    res.json({ ok: true });
  });

  r.post('/portal/:token/tickets/:id/reopen', writes, async (req, res) => {
    const { c, id } = await portalTicket(req);
    const input = zParse(ticketReopenSchema, req.body);
    await asCompany(c.companyId, () => tx((db) => reopenTicket(db, customerCtx(c), id, input.reason)));
    res.json({ ok: true });
  });

  /* ---------------- shared report ---------------- */
  r.get('/report/:token', reads, async (req, res) => {
    const t = String(req.params.token);
    if (!tokenOk(t)) throw notFound('That report');
    const link = await asSystem(() =>
      query<{ company_id: number; period: Period; expires_at: Date; revoked_at: Date | null; timezone: string; name: string; kind: string }>(
        `SELECT s.company_id, s.period, s.expires_at, s.revoked_at, co.timezone, co.name, co.kind FROM share_links s JOIN companies co ON co.id = s.company_id WHERE s.token_hash = $1`,
        [sha256(t)],
      ),
    );
    const l = link.rows[0];
    if (!l || l.revoked_at || l.expires_at < new Date()) throw new AppError(404, 'link_expired', 'This report link has expired or was turned off.');
    const data = await asCompany(l.company_id, async () => {
      const db = await checkout();
      try {
        return await dashboard(db, { companyId: l.company_id, userId: null, role: 'system', tz: l.timezone, now: new Date(), isDemo: l.kind === 'demo' }, l.period);
      } finally {
        db.release();
      }
    });
    // numbers only: a shared link never carries customer names or locations
    const jobs = data.profit.jobs.map((j) => ({
      id: j.id,
      ref: j.ref,
      customer: `Job ${j.ref}`,
      capacity_kw: j.capacity_kw,
      revenue_paise: j.revenue_paise,
      parts_paise: j.parts_paise,
      labour_paise: j.labour_paise,
      expenses_paise: j.expenses_paise,
      warranty_paise: j.warranty_paise,
      profit_paise: j.profit_paise,
    }));
    res.json({ company: l.name, expiresAt: l.expires_at, ...data, profit: { ...data.profit, jobs } });
  });

  return r;
}
