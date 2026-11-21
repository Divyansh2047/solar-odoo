import { Router } from 'express';
import { z } from 'zod';
import { ticketAssignSchema, ticketConfirmSchema, ticketCreateSchema, ticketReopenSchema, ticketResolveSchema, visitSchema } from '@arka/shared';
import { assignTicket, confirmTicket, coverageFor, createTicket, reopenTicket, resolveTicket, startTicket, supportSearch } from '../../domain/tickets.js';
import { createVisit } from '../../domain/schedule.js';
import { forbidden, notFound } from '../../lib/errors.js';
import { act, canShareLinks, idParam, query, read, seesCosts, withDb, zParse } from '../context.js';
import { one } from '../../domain/util.js';

export function serviceRoutes(): Router {
  const r = Router();

  /** One box for everything: customer name or phone, a serial fragment, a document reference. */
  r.get(
    '/search',
    read('customers.read', async (req, ctx) => {
      const q = zParse(z.string().trim().max(60).default(''), req.query.q);
      const t0 = performance.now();
      const out = await withDb((db) => supportSearch(db, ctx, q));
      return { ...out, ms: Math.round(performance.now() - t0) };
    }),
  );

  r.get(
    '/tickets',
    read('tickets.read', async (req, ctx) => {
      const status = typeof req.query.status === 'string' && req.query.status !== 'all' ? req.query.status : null;
      const open = req.query.open === '1';
      const mine = ctx.role === 'technician' ? ctx.userId : null;
      const rows = await query(
        `SELECT t.id, t.ref, t.status, t.priority, t.coverage, t.channel, t.fault_code, t.description, t.created_at, t.resolved_at, t.closed_at, t.billed_paise,
                t.parts_cost_paise + t.labour_cost_paise AS cost_paise, t.reopen_count, c.id AS customer_id, c.name AS customer, c.city, c.phone,
                su.serial, p.name AS product, u.name AS assigned_name, j.ref AS job_ref
           FROM tickets t JOIN customers c ON c.id = t.customer_id LEFT JOIN serial_units su ON su.id = t.serial_unit_id LEFT JOIN products p ON p.id = su.product_id
           LEFT JOIN users u ON u.id = t.assigned_to LEFT JOIN jobs j ON j.id = t.job_id
          WHERE ($1::text IS NULL OR t.status = $1) AND (NOT $2 OR t.status <> 'closed') AND ($3::bigint IS NULL OR t.assigned_to = $3)
          ORDER BY (t.status = 'closed'), CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, t.created_at DESC LIMIT 300`,
        [status, open, mine],
      );
      const counts = await query(`SELECT status, count(*)::int AS n FROM tickets GROUP BY status`);
      return { tickets: rows.rows, counts: Object.fromEntries(counts.rows.map((c) => [c.status, c.n])) };
    }),
  );

  r.get(
    '/tickets/:id',
    read('tickets.read', async (req, ctx) => {
      const id = idParam(req);
      const t = await query(
        `SELECT t.*, c.name AS customer, c.phone, c.email, c.address, c.city, c.portal_token, su.serial, su.warranty_start, su.warranty_end, su.status AS serial_status,
                p.name AS product, p.category, p.id AS product_id, u.name AS assigned_name, j.ref AS job_ref, j.installed_at, j.capacity_kw, j.kind AS job_kind,
                cb.name AS created_by_name, (SELECT id FROM invoices i WHERE i.ticket_id = t.id AND i.status <> 'void' LIMIT 1) AS invoice_id,
                (SELECT number FROM invoices i WHERE i.ticket_id = t.id AND i.status <> 'void' LIMIT 1) AS invoice_number,
                (SELECT status FROM invoices i WHERE i.ticket_id = t.id AND i.status <> 'void' LIMIT 1) AS invoice_status
           FROM tickets t JOIN customers c ON c.id = t.customer_id LEFT JOIN serial_units su ON su.id = t.serial_unit_id LEFT JOIN products p ON p.id = su.product_id
           LEFT JOIN users u ON u.id = t.assigned_to LEFT JOIN jobs j ON j.id = t.job_id LEFT JOIN users cb ON cb.id = t.created_by WHERE t.id = $1`,
        [id],
      );
      const ticket = t.rows[0];
      if (!ticket) throw notFound('That ticket');
      const [parts, activities, customerSerials, visits] = await Promise.all([
        query(
          `SELECT tp.*, p.name, p.sku, ns.serial AS new_serial, os.serial AS old_serial FROM ticket_parts tp JOIN products p ON p.id = tp.product_id
             LEFT JOIN serial_units ns ON ns.id = tp.new_serial_unit_id LEFT JOIN serial_units os ON os.id = tp.replaced_serial_unit_id WHERE tp.ticket_id = $1`,
          [id],
        ),
        query(`SELECT a.id, a.kind, a.body, a.created_at, u.name AS actor FROM activities a LEFT JOIN users u ON u.id = a.actor_id WHERE a.ticket_id = $1 ORDER BY a.created_at DESC, a.id DESC`, [id]),
        query(
          `SELECT su.id, su.serial, su.status, su.warranty_end, p.name AS product, p.category, p.id AS product_id FROM serial_units su JOIN products p ON p.id = su.product_id
            WHERE su.customer_id = $1 AND su.status = 'installed' ORDER BY array_position(ARRAY['inverter','battery','charge_controller','panel'], p.category), su.serial`,
          [ticket.customer_id],
        ),
        query(
          `SELECT v.id, v.starts_at, v.ends_at, v.status, coalesce(json_agg(json_build_object('id', u.id, 'name', u.name)) FILTER (WHERE u.id IS NOT NULL), '[]') AS crew
             FROM visits v JOIN visit_links l ON l.visit_id = v.id LEFT JOIN visit_crew vc ON vc.visit_id = v.id AND vc.active LEFT JOIN users u ON u.id = vc.technician_id
            WHERE l.ticket_id = $1 GROUP BY v.id ORDER BY v.starts_at`,
          [id],
        ),
      ]);
      if (!canShareLinks(ctx.role)) delete ticket.portal_token;
      if (!seesCosts(ctx.role)) for (const p of parts.rows) p.unit_cost_paise = null;
      return { ticket, parts: parts.rows, activities: activities.rows, customerSerials: customerSerials.rows, visits: visits.rows };
    }),
  );

  /** What would this complaint cost the customer? Shown live while support types. */
  r.get(
    '/coverage',
    read('tickets.read', async (req, ctx) => {
      const customerId = Number(req.query.customerId);
      const serialUnitId = req.query.serialUnitId ? Number(req.query.serialUnitId) : null;
      if (!Number.isInteger(customerId) || customerId <= 0) throw notFound('That customer');
      return withDb((db) => coverageFor(db, ctx, customerId, serialUnitId && serialUnitId > 0 ? serialUnitId : null));
    }),
  );

  r.post('/tickets', act('tickets.write', ticketCreateSchema, async (input, db, ctx) => createTicket(db, ctx, input).then((t) => ({ id: t.id, ref: t.ref, coverage: t.coverage }))));
  // Technicians fix tickets; support and the director assign them and record the customer's answer.
  const notTechnician = (ctx: { role: string }) => {
    if (ctx.role === 'technician') throw forbidden('Support records this. Technicians fix the problem and mark it fixed.');
  };
  r.post(
    '/tickets/:id/assign',
    act('tickets.write', ticketAssignSchema, async (input, db, ctx, req) => (notTechnician(ctx), assignTicket(db, ctx, idParam(req), input.technicianId))),
  );
  r.post('/tickets/:id/start', act('tickets.write', null, async (_i, db, ctx, req) => startTicket(db, ctx, idParam(req))));
  r.post('/tickets/:id/resolve', act('tickets.write', ticketResolveSchema, async (input, db, ctx, req) => resolveTicket(db, ctx, idParam(req), input)));
  r.post(
    '/tickets/:id/confirm',
    act('tickets.write', ticketConfirmSchema, async (input, db, ctx, req) => (notTechnician(ctx), confirmTicket(db, ctx, idParam(req), input.method, input.note))),
  );
  r.post('/tickets/:id/reopen', act('tickets.write', ticketReopenSchema, async (input, db, ctx, req) => (notTechnician(ctx), reopenTicket(db, ctx, idParam(req), input.reason))));
  r.post(
    '/tickets/:id/visits',
    act('schedule.write', visitSchema, async (input, db, ctx, req) => {
      const t = await one<{ id: number; customer_id: number; ref: string }>(db, `SELECT id, customer_id, ref FROM tickets WHERE id = $1`, [idParam(req)], 'That ticket');
      const id = await createVisit(db, ctx, {
        kind: 'service',
        customerId: t.customer_id,
        startsAt: new Date(input.startsAt),
        endsAt: new Date(input.endsAt),
        technicianIds: input.technicianIds,
        notes: input.notes ?? `Service visit for ${t.ref}`,
        link: { ticketId: t.id },
      });
      return { id };
    }),
  );

  return r;
}
