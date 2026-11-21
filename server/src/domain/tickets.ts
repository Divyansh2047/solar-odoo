import { COVERAGE_LABEL, addDays, formatDate, formatINR, lineAmount, taxOn, type Coverage, type TicketResolveInput } from '@arka/shared';
import type { Db } from '../db/pool.js';
import { config } from '../config.js';
import { token } from '../lib/crypto.js';
import { conflict, forbidden, invalid, notFound } from '../lib/errors.js';
import { publish } from '../lib/events.js';
import { sendMail } from '../lib/mailer.js';
import { afterCommit, logActivity, nextRef, notifyRoles, notifyUser, today, type Ctx } from './context.js';
import { invoiceNumber } from './money.js';
import { many, maybe, one, q1000 } from './util.js';

/** Workmanship warranty on the installation itself (wiring, mounting), separate from each part's warranty. */
export const WORKMANSHIP_MONTHS = 12;

export interface TicketRow {
  [k: string]: unknown;
  id: number;
  ref: string;
  customer_id: number;
  job_id: number | null;
  serial_unit_id: number | null;
  status: string;
  coverage: Coverage;
  assigned_to: number | null;
}

/**
 * Decide coverage the moment the complaint comes in: if the unit's warranty runs past today, the
 * repair is free. Without a serial, the installation's workmanship warranty applies.
 */
export async function coverageFor(db: Db, ctx: Ctx, customerId: number, serialUnitId: number | null): Promise<{ coverage: Coverage; warrantyEnd: string | null; jobId: number | null }> {
  const t = today(ctx);
  if (serialUnitId) {
    const u = await one<{ warranty_end: string | null; job_id: number | null; customer_id: number | null }>(
      db,
      `SELECT warranty_end, job_id, customer_id FROM serial_units WHERE id = $1`,
      [serialUnitId],
      'That serial number',
    );
    if (u.customer_id !== customerId) throw invalid('That serial number belongs to a different customer.', { serialUnitId: 'Choose one of this customer’s units' });
    return { coverage: u.warranty_end && u.warranty_end >= t ? 'warranty' : 'paid', warrantyEnd: u.warranty_end, jobId: u.job_id };
  }
  const job = await maybe<{ id: number; end: string | null }>(
    db,
    `SELECT id, ((installed_at AT TIME ZONE $3)::date + make_interval(months => $2))::date::text AS end FROM jobs
      WHERE customer_id = $1 AND installed_at IS NOT NULL ORDER BY installed_at DESC LIMIT 1`,
    [customerId, WORKMANSHIP_MONTHS, ctx.tz],
  );
  return { coverage: job?.end && job.end >= t ? 'warranty' : 'paid', warrantyEnd: job?.end ?? null, jobId: job?.id ?? null };
}

export async function createTicket(
  db: Db,
  ctx: Ctx,
  input: { customerId: number; serialUnitId?: number | undefined; channel: string; faultCode?: string | undefined; description: string; priority: string },
): Promise<TicketRow> {
  const customer = await one<{ id: number; name: string }>(db, `SELECT id, name FROM customers WHERE id = $1`, [input.customerId], 'That customer');
  const cov = await coverageFor(db, ctx, customer.id, input.serialUnitId ?? null);
  const ref = await nextRef(db, 'TKT');
  const ticket = await one<TicketRow>(
    db,
    `INSERT INTO tickets (ref, customer_id, job_id, serial_unit_id, channel, fault_code, description, priority, coverage, warranty_end_at_open, created_by, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12) RETURNING *`,
    [ref, customer.id, cov.jobId, input.serialUnitId ?? null, input.channel, input.faultCode ?? null, input.description, input.priority, cov.coverage, cov.warrantyEnd, ctx.userId, ctx.now],
  );
  await logActivity(db, ctx, {
    customerId: customer.id,
    jobId: cov.jobId,
    ticketId: ticket.id,
    body: `Complaint ${ref}${input.faultCode ? ` (fault ${input.faultCode})` : ''}: ${input.description.slice(0, 140).trim().replace(/[.!?\s]+$/, '')}. ${COVERAGE_LABEL[cov.coverage]}${cov.warrantyEnd ? `, warranty ${cov.coverage === 'warranty' ? 'until' : 'ended'} ${formatDate(cov.warrantyEnd)}` : ''}.`,
  });
  await notifyRoles(db, ['support'], { title: `${input.priority === 'urgent' ? 'Urgent: ' : ''}${ref} from ${customer.name}`, body: input.description.slice(0, 120), link: `/app/service/${ticket.id}` }, ctx.userId);
  await publish(db, ['tickets', 'notifications']);
  return ticket;
}

async function lockTicket(db: Db, id: number): Promise<TicketRow> {
  return one<TicketRow>(db, `SELECT * FROM tickets WHERE id = $1 FOR UPDATE`, [id], 'That ticket');
}

export async function assignTicket(db: Db, ctx: Ctx, id: number, technicianId: number): Promise<void> {
  const t = await lockTicket(db, id);
  if (t.status === 'closed') throw conflict('wrong_stage', `${t.ref} is closed.`);
  const tech = await one<{ name: string }>(db, `SELECT name FROM users WHERE id = $1 AND role = 'technician' AND status = 'active'`, [technicianId], 'That technician');
  await db.query(`UPDATE tickets SET assigned_to = $2, status = CASE WHEN status = 'open' THEN 'assigned' ELSE status END, updated_at = $3 WHERE id = $1`, [id, technicianId, ctx.now]);
  await notifyUser(db, technicianId, { title: `${t.ref} assigned to you`, link: `/app/service/${id}` });
  await logActivity(db, ctx, { customerId: t.customer_id, ticketId: id, body: `Assigned to ${tech.name}.` });
  await publish(db, ['tickets', 'notifications']);
}

export async function startTicket(db: Db, ctx: Ctx, id: number): Promise<void> {
  const t = await lockTicket(db, id);
  if (!['open', 'assigned'].includes(t.status)) throw conflict('wrong_stage', `${t.ref} is already ${t.status.replace('_', ' ')}.`);
  if (ctx.role === 'technician' && t.assigned_to !== ctx.userId) throw forbidden(`${t.ref} is assigned to someone else.`);
  await db.query(`UPDATE tickets SET status = 'in_progress', assigned_to = coalesce(assigned_to, $3), updated_at = $2 WHERE id = $1`, [id, ctx.now, ctx.role === 'technician' ? ctx.userId : null]);
  await logActivity(db, ctx, { customerId: t.customer_id, ticketId: id, body: 'Work started.' });
  await publish(db, ['tickets']);
}

/**
 * Fixed. Parts come out of stock at cost; swapped serials keep the original warranty. Under warranty the
 * customer pays nothing and the cost is charged to the original job; otherwise parts and labour are
 * invoiced automatically.
 */
export async function resolveTicket(db: Db, ctx: Ctx, id: number, input: TicketResolveInput): Promise<{ coverage: Coverage; billedPaise: number; invoiceNumber: string | null; costPaise: number }> {
  const t = await lockTicket(db, id);
  if (!['open', 'assigned', 'in_progress'].includes(t.status)) throw conflict('wrong_stage', `${t.ref} is already ${t.status === 'resolved' ? 'resolved and waiting for the customer' : 'closed'}.`);
  if (ctx.role === 'technician' && t.assigned_to !== ctx.userId) throw forbidden(`${t.ref} is assigned to someone else.`);
  let coverage = t.coverage;
  if (input.coverage && input.coverage !== t.coverage) {
    if (ctx.role !== 'owner') throw forbidden('Only the director can change who pays for a repair.');
    coverage = input.coverage;
  }
  const settings = await one<{ labour_rate_paise: number }>(db, `SELECT labour_rate_paise FROM companies WHERE id = app_company()`);
  const tech = t.assigned_to ? await maybe<{ id: number; hourly_cost_paise: number }>(db, `SELECT id, hourly_cost_paise FROM users WHERE id = $1`, [t.assigned_to]) : null;

  let partsCost = 0;
  const invoiceLines: { description: string; hsn: string | null; qty: number; unit: number; gst: number }[] = [];
  const products = await many<{ id: number; name: string; tracking: string; unit_cost_paise: number; sale_price_paise: number; gst_rate_bp: number; hsn: string | null; on_hand: number; warranty_months: number | null }>(
    db,
    `SELECT id, name, tracking, unit_cost_paise, sale_price_paise, gst_rate_bp, hsn, on_hand, warranty_months FROM products WHERE id = ANY($1::bigint[]) ORDER BY id FOR UPDATE`,
    [input.parts.map((p) => p.productId)],
  );
  for (const [i, part] of input.parts.entries()) {
    const p = products.find((x) => x.id === part.productId);
    if (!p || p.tracking === 'none') throw invalid('Choose a stocked part.', { [`parts.${i}.productId`]: 'Choose a stocked part' });
    let unitCost = p.unit_cost_paise;
    let newUnitId: number | null = null;
    if (p.tracking === 'serial') {
      if (part.qty !== 1) throw invalid('Serial-numbered parts are fitted one per line.', { [`parts.${i}.qty`]: 'Use 1' });
      if (!part.newSerial) throw invalid(`Scan the serial of the new ${p.name}.`, { [`parts.${i}.newSerial`]: 'Scan the new unit' });
      const nu = await maybe<{ id: number; status: string; unit_cost_paise: number }>(
        db,
        `SELECT id, status, unit_cost_paise FROM serial_units WHERE product_id = $1 AND serial = $2 FOR UPDATE`,
        [p.id, part.newSerial],
      );
      if (!nu) throw invalid(`${part.newSerial} isn’t a ${p.name} we have.`, { [`parts.${i}.newSerial`]: 'Unknown serial for this product' });
      if (nu.status !== 'in_stock') throw conflict('not_in_stock', `${part.newSerial} isn’t in stock.`);
      unitCost = nu.unit_cost_paise;
      newUnitId = nu.id;
      // warranty: a replacement under warranty keeps the original end date; otherwise a fresh warranty
      let start = today(ctx);
      let end: string | null = null;
      if (part.replacesSerialUnitId) {
        const old = await one<{ customer_id: number | null; warranty_start: string | null; warranty_end: string | null; product_id: number }>(
          db,
          `SELECT customer_id, warranty_start, warranty_end, product_id FROM serial_units WHERE id = $1 FOR UPDATE`,
          [part.replacesSerialUnitId],
          'The replaced unit',
        );
        if (old.customer_id !== t.customer_id) throw invalid('The replaced unit belongs to another customer.', { [`parts.${i}.replacesSerialUnitId`]: 'Choose this customer’s unit' });
        if (coverage === 'warranty' && old.warranty_start && old.warranty_end && old.warranty_end >= today(ctx)) {
          start = old.warranty_start;
          end = old.warranty_end;
        }
        await db.query(`UPDATE serial_units SET status = 'replaced', replaced_by_id = $2, ticket_id = $3 WHERE id = $1`, [part.replacesSerialUnitId, newUnitId, id]);
      }
      if (!end) {
        const d = new Date(`${start}T00:00:00Z`);
        d.setUTCMonth(d.getUTCMonth() + (p.warranty_months ?? 12));
        end = d.toISOString().slice(0, 10);
      }
      await db.query(
        `UPDATE serial_units SET status = 'installed', customer_id = $2, job_id = $3, ticket_id = $4, warranty_start = $5, warranty_end = $6 WHERE id = $1`,
        [newUnitId, t.customer_id, t.job_id, id, start, end],
      );
      await db.query(`UPDATE products SET on_hand = on_hand - 1 WHERE id = $1`, [p.id]);
    } else {
      if (q1000(p.on_hand) < q1000(part.qty)) throw conflict('insufficient_stock', `Only ${p.on_hand} × ${p.name} in stock.`);
      await db.query(`UPDATE products SET on_hand = on_hand - $2 WHERE id = $1`, [p.id, part.qty]);
    }
    await db.query(
      `INSERT INTO stock_moves (product_id, direction, qty, unit_cost_paise, reason, ticket_id, job_id, serial_unit_id, created_by, created_at) VALUES ($1, 'out', $2, $3, 'service_part', $4, $5, $6, $7, $8)`,
      [p.id, part.qty, unitCost, id, t.job_id, newUnitId, ctx.userId, ctx.now],
    );
    await db.query(
      `INSERT INTO ticket_parts (ticket_id, product_id, qty, unit_cost_paise, unit_price_paise, new_serial_unit_id, replaced_serial_unit_id) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, p.id, part.qty, unitCost, p.sale_price_paise, newUnitId, part.replacesSerialUnitId ?? null],
    );
    partsCost += Math.round((q1000(part.qty) * unitCost) / 1000);
    invoiceLines.push({ description: p.name + (part.newSerial ? ` (serial ${part.newSerial})` : ''), hsn: p.hsn, qty: part.qty, unit: p.sale_price_paise, gst: p.gst_rate_bp });
  }
  const labourCost = tech ? Math.round(tech.hourly_cost_paise * input.labourHours) : 0;
  if (tech && input.labourHours > 0) {
    await db.query(
      `INSERT INTO timesheets (technician_id, ticket_id, job_id, work_date, hours, rate_paise, cost_paise, source, note, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, 'service', $8, $9)`,
      [tech.id, id, t.job_id, today(ctx), input.labourHours, tech.hourly_cost_paise, labourCost, `Service ${t.ref}`, ctx.now],
    );
  }

  let billed = 0;
  let number: string | null = null;
  if (coverage === 'paid' && (invoiceLines.length || input.labourHours > 0)) {
    if (input.labourHours > 0) invoiceLines.push({ description: `Service labour (${input.labourHours} h)`, hsn: '998729', qty: input.labourHours, unit: settings.labour_rate_paise, gst: 1800 });
    const amounts = invoiceLines.map((l) => ({ ...l, amount: lineAmount(l.qty, l.unit) }));
    const subtotal = amounts.reduce((s, l) => s + l.amount, 0);
    const tax = amounts.reduce((s, l) => s + taxOn(l.amount, l.gst), 0);
    billed = subtotal + tax;
    number = await invoiceNumber(db, ctx);
    const inv = await one<{ id: number; public_token: string }>(
      db,
      `INSERT INTO invoices (number, customer_id, ticket_id, kind, status, issued_on, due_on, subtotal_paise, tax_paise, total_paise, public_token, sent_at, created_by, created_at)
       VALUES ($1, $2, $3, 'service', 'sent', $4, $5, $6, $7, $8, $9, $10, $11, $10) RETURNING id, public_token`,
      [number, t.customer_id, id, today(ctx), addDays(today(ctx), 7), subtotal, tax, billed, token(24), ctx.now, ctx.userId],
    );
    let sort = 0;
    for (const l of amounts) {
      await db.query(`INSERT INTO invoice_lines (invoice_id, description, hsn, qty, unit_price_paise, gst_rate_bp, amount_paise, sort) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, [
        inv.id,
        l.description,
        l.hsn,
        l.qty,
        l.unit,
        l.gst,
        l.amount,
        sort++,
      ]);
    }
  }
  await db.query(
    `UPDATE tickets SET status = 'resolved', coverage = $2, resolution = $3, labour_hours = $4, parts_cost_paise = $5, labour_cost_paise = $6, billed_paise = $7, resolved_at = $8, updated_at = $8 WHERE id = $1`,
    [id, coverage, input.resolution, input.labourHours, partsCost, labourCost, billed, ctx.now],
  );
  const c = await one<{ name: string; email: string | null; portal_token: string }>(db, `SELECT name, email, portal_token FROM customers WHERE id = $1`, [t.customer_id]);
  if (c.email) {
    afterCommit(ctx, () => sendMail(
      {
        to: c.email!,
        subject: `${t.ref}: is everything working now?`,
        lines: [
          `Hello ${c.name.split(' ')[0]},`,
          `Our technician has fixed your complaint ${t.ref}: ${input.resolution}`,
          coverage === 'paid' ? `The repair was billed ${formatINR(billed)} (invoice ${number}).` : 'The repair was covered, so there is nothing to pay.',
          'Please confirm everything works so we can close the ticket.',
        ],
        action: { label: 'Confirm it works', url: `${config().APP_URL}/my/${c.portal_token}` },
      },
      { demo: ctx.isDemo },
    ));
  }
  await logActivity(db, ctx, {
    customerId: t.customer_id,
    jobId: t.job_id,
    ticketId: id,
    body: `Resolved: ${input.resolution}. ${coverage === 'paid' ? `Billed ${formatINR(billed)} on ${number}.` : `${COVERAGE_LABEL[coverage]}: customer pays ₹0; cost ${formatINR(partsCost + labourCost)} charged to the job.`} Waiting for the customer to confirm.`,
  });
  await publish(db, ['tickets', 'stock', 'invoices', 'jobs']);
  return { coverage, billedPaise: billed, invoiceNumber: number, costPaise: partsCost + labourCost };
}

/** Closing needs the customer's confirmation that everything works. */
export async function confirmTicket(db: Db, ctx: Ctx, id: number, method: 'portal' | 'phone' | 'on_site', note?: string): Promise<void> {
  const t = await lockTicket(db, id);
  if (t.status !== 'resolved') throw conflict('wrong_stage', t.status === 'closed' ? `${t.ref} is already closed.` : `${t.ref} isn’t fixed yet.`);
  await db.query(`UPDATE tickets SET status = 'closed', customer_confirmed_at = $2, confirm_method = $3, closed_at = $2, updated_at = $2 WHERE id = $1`, [id, ctx.now, method]);
  await logActivity(db, ctx, { customerId: t.customer_id, ticketId: id, body: `Customer confirmed it works (${method.replace('_', ' ')})${note ? `: ${note}` : ''}. Ticket closed.` });
  await publish(db, ['tickets']);
}

export async function reopenTicket(db: Db, ctx: Ctx, id: number, reason: string): Promise<void> {
  const t = await lockTicket(db, id);
  if (t.status !== 'resolved') throw conflict('wrong_stage', `Only a resolved ticket can be reopened.`);
  await db.query(`UPDATE tickets SET status = 'in_progress', reopen_count = reopen_count + 1, resolved_at = NULL, updated_at = $2 WHERE id = $1`, [id, ctx.now]);
  await logActivity(db, ctx, { customerId: t.customer_id, ticketId: id, body: `Reopened: ${reason}` });
  if (t.assigned_to) await notifyUser(db, t.assigned_to, { title: `${t.ref} reopened`, body: reason, link: `/app/service/${id}` });
  await notifyRoles(db, ['support'], { title: `${t.ref} reopened by the customer`, body: reason, link: `/app/service/${id}` });
  await publish(db, ['tickets', 'notifications']);
}

/** Find a customer, a serial or a document from a fragment, in one query per kind. */
export async function supportSearch(db: Db, ctx: Ctx, q: string) {
  const term = q.trim();
  if (term.length < 2) return { customers: [], serials: [], documents: [] };
  const digits = term.replace(/\D/g, '');
  const like = `%${term.replace(/[%_\\]/g, (m) => '\\' + m)}%`;
  const t = today(ctx);
  // one client, so one query at a time (pg queues concurrent queries on a client and will stop allowing it)
  const customers = await many(
    db,
    `SELECT c.id, c.name, c.phone, c.city,
            (SELECT count(*) FROM jobs j WHERE j.customer_id = c.id AND j.status <> 'cancelled')::int AS jobs,
            (SELECT count(*) FROM tickets k WHERE k.customer_id = c.id AND k.status <> 'closed')::int AS open_tickets
       FROM customers c
      WHERE c.name ILIKE $1 OR ($2 <> '' AND length($2) >= 3 AND c.phone LIKE '%' || $2 || '%')
      ORDER BY similarity(c.name, $3) DESC, c.created_at DESC LIMIT 8`,
    [like, digits, term],
  );
  const serials = await many(
    db,
    `SELECT su.id, su.serial, su.status, su.warranty_start, su.warranty_end, (su.warranty_end >= $3::date) AS covered,
            p.name AS product, p.category, c.id AS customer_id, c.name AS customer, c.phone, j.id AS job_id, j.ref AS job_ref
       FROM serial_units su JOIN products p ON p.id = su.product_id
       LEFT JOIN customers c ON c.id = su.customer_id LEFT JOIN jobs j ON j.id = su.job_id
      WHERE su.serial ILIKE $1 ORDER BY (su.serial = upper($2)) DESC, su.status = 'installed' DESC, su.serial LIMIT 8`,
    [like.toUpperCase(), term, t],
  );
  const documents = await many(
    db,
    `SELECT 'job' AS kind, id, ref, status FROM jobs WHERE ref ILIKE $1
     UNION ALL SELECT 'ticket', id, ref, status FROM tickets WHERE ref ILIKE $1
     UNION ALL SELECT 'enquiry', id, ref, status FROM leads WHERE ref ILIKE $1
     UNION ALL SELECT 'quote', id, ref || ' v' || version, status FROM quotes WHERE ref ILIKE $1 AND status <> 'superseded'
     UNION ALL SELECT 'invoice', id, number, status FROM invoices WHERE number ILIKE $1
     LIMIT 8`,
    [like],
  );
  return { customers, serials, documents };
}

export function assertPortalTicket(t: TicketRow | null, customerId: number): TicketRow {
  if (!t || t.customer_id !== customerId) throw notFound('That ticket');
  return t;
}
