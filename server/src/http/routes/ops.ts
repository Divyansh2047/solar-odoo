import { Router } from 'express';
import {
  deliverSchema,
  dispatchSchema,
  expenseSchema,
  installReportSchema,
  isoDate,
  jobCancelSchema,
  jobStageState,
  paymentSchema,
  purchaseSchema,
  scanSchema,
  stockAdjustSchema,
  unscanSchema,
  visitSchema,
  addDays,
  startOfDayUtc,
  isoDateInTz,
} from '@arka/shared';
import { cancelJob, closeJob, recordJobPayment } from '../../domain/jobs.js';
import { adjustStock, deliverPickList, dispatchPickList, packPickList, receivePurchase, scanProgress, scanSerial, shortages, unscanSerial } from '../../domain/warehouse.js';
import { cancelVisit, createVisit, freeTechnicians, rescheduleVisit } from '../../domain/schedule.js';
import { submitInstallReport } from '../../domain/installs.js';
import { addExpense } from '../../domain/money.js';
import { jobProfit } from '../../domain/reports.js';
import { conflict, notFound } from '../../lib/errors.js';
import { act, canShareLinks, idParam, query, read, seesCosts, withDb, zParse } from '../context.js';
import { can, type Role } from '@arka/shared';
import { one } from '../../domain/util.js';

const qs = (v: unknown) => (typeof v === 'string' && v && v !== 'all' ? v : null);

export function opsRoutes(): Router {
  const r = Router();

  /* ---------------- jobs ---------------- */
  r.get(
    '/jobs',
    read('jobs.read', async (req) => {
      const rows = await query(
        `SELECT j.id, j.ref, j.status, j.kind, j.capacity_kw, j.total_paise, j.advance_required_paise, j.created_at, j.confirmed_at, j.packed_at, j.dispatched_at,
                j.delivered_on, j.installed_at, j.closed_at, c.name AS customer, c.city, c.phone,
                coalesce((SELECT sum(amount_paise) FROM payments p WHERE p.job_id = j.id), 0)::bigint AS paid_paise,
                (SELECT status FROM invoices i WHERE i.job_id = j.id AND i.status <> 'void' LIMIT 1) AS invoice_status,
                (SELECT status FROM subsidy_cases s WHERE s.job_id = j.id) AS subsidy_status,
                (SELECT status FROM pick_lists pl WHERE pl.job_id = j.id) AS pick_status,
                (SELECT min(v.starts_at) FROM visits v JOIN visit_links l ON l.visit_id = v.id WHERE l.job_id = j.id AND v.kind = 'installation' AND v.status <> 'cancelled') AS install_at
           FROM jobs j JOIN customers c ON c.id = j.customer_id
          WHERE ($1::text IS NULL OR j.status = $1) AND ($2::text IS NULL OR c.name ILIKE $2 OR j.ref ILIKE $2 OR c.city ILIKE $2)
            AND ($3::boolean IS NULL OR (j.status NOT IN ('closed', 'cancelled')) = $3)
          ORDER BY CASE WHEN j.status IN ('closed', 'cancelled') THEN 1 ELSE 0 END, j.created_at DESC LIMIT 400`,
        [qs(req.query.status), qs(req.query.q) ? `%${String(req.query.q).replace(/[%_\\]/g, '')}%` : null, req.query.open === '1' ? true : req.query.open === '0' ? false : null],
      );
      return {
        jobs: rows.rows.map((j) => ({ ...j, stages: jobStageState({ ...j, invoice_sent: !!j.invoice_status && j.invoice_status !== 'draft' }) })),
      };
    }),
  );

  r.get(
    '/jobs/:id',
    read('jobs.read', async (req, ctx) => {
      const id = idParam(req);
      const j = await query(
        `SELECT j.*, c.name AS customer, c.phone, c.email, c.address, c.city, c.pincode, c.kind AS customer_kind, c.portal_token, q.ref AS quote_ref, q.version AS quote_version,
                q.discount_paise, q.subtotal_paise, q.tax_paise, q.subsidy_paise, q.est_monthly_units, q.accepted_name, q.decided_at AS accepted_at
           FROM jobs j JOIN customers c ON c.id = j.customer_id JOIN quotes q ON q.id = j.quote_id WHERE j.id = $1`,
        [id],
      );
      const job = j.rows[0];
      if (!job) throw notFound('That job');
      const [lines, payments, pick, visits, report, invoices, subsidy, expenses, serials, tickets, activities, profit] = await Promise.all([
        query(`SELECT jl.*, p.sku, p.category, p.tracking, p.uom, p.capacity_w FROM job_lines jl JOIN products p ON p.id = jl.product_id WHERE jl.job_id = $1 ORDER BY jl.sort`, [id]),
        query(`SELECT p.*, u.name AS recorded_by_name FROM payments p LEFT JOIN users u ON u.id = p.recorded_by WHERE p.job_id = $1 ORDER BY p.received_on, p.id`, [id]),
        query(`SELECT * FROM pick_lists WHERE job_id = $1`, [id]),
        query(
          `SELECT v.id, v.kind, v.starts_at, v.ends_at, v.status, v.notes,
                  coalesce(json_agg(json_build_object('id', u.id, 'name', u.name)) FILTER (WHERE u.id IS NOT NULL), '[]') AS crew
             FROM visits v JOIN visit_links l ON l.visit_id = v.id LEFT JOIN visit_crew c ON c.visit_id = v.id AND c.active LEFT JOIN users u ON u.id = c.technician_id
            WHERE l.job_id = $1 GROUP BY v.id ORDER BY v.starts_at`,
          [id],
        ),
        query(
          `SELECT r.*, u.name AS submitted_by_name, (SELECT coalesce(json_agg(file_id), '[]') FROM install_photos p WHERE p.report_id = r.id) AS photo_ids
             FROM install_reports r LEFT JOIN users u ON u.id = r.submitted_by WHERE r.job_id = $1`,
          [id],
        ),
        query(`SELECT id, number, status, total_paise, issued_on, due_on, sent_at, public_token FROM invoices WHERE job_id = $1 ORDER BY id DESC`, [id]),
        query(`SELECT * FROM subsidy_cases WHERE job_id = $1`, [id]),
        query(`SELECT e.*, u.name AS recorded_by_name FROM expenses e LEFT JOIN users u ON u.id = e.recorded_by WHERE e.job_id = $1 ORDER BY e.spent_on`, [id]),
        query(
          `SELECT su.id, su.serial, su.status, su.warranty_start, su.warranty_end, p.name AS product, p.category, p.capacity_w, p.warranty_months
             FROM serial_units su JOIN products p ON p.id = su.product_id WHERE su.job_id = $1 ORDER BY array_position(ARRAY['inverter','battery','charge_controller','panel'], p.category), su.serial`,
          [id],
        ),
        query(`SELECT id, ref, status, coverage, priority, created_at, parts_cost_paise + labour_cost_paise AS cost_paise, billed_paise FROM tickets WHERE job_id = $1 ORDER BY created_at DESC`, [id]),
        query(`SELECT a.id, a.kind, a.body, a.created_at, u.name AS actor FROM activities a LEFT JOIN users u ON u.id = a.actor_id WHERE a.job_id = $1 ORDER BY a.created_at DESC, a.id DESC LIMIT 100`, [id]),
        withDb((db) => jobProfit(db, ctx, { jobId: id })),
      ]);
      const paid = payments.rows.reduce((s, p) => s + p.amount_paise, 0);
      const inv = invoices.rows.find((i) => i.status !== 'void');
      const sub = subsidy.rows[0] ?? null;
      const panelLines = lines.rows.filter((l) => l.category === 'panel');
      const kit = {
        kind: job.kind,
        capacityKw: job.capacity_kw,
        panels: panelLines.reduce((s, l) => s + l.qty, 0),
        panelW: panelLines[0]?.capacity_w ?? 550,
        inverters: lines.rows.filter((l) => l.category === 'inverter').reduce((s, l) => s + l.qty, 0),
        batteries: lines.rows.filter((l) => l.category === 'battery').reduce((s, l) => s + l.qty, 0),
        batteryKwh: lines.rows.filter((l) => l.category === 'battery').reduce((s, l) => s + (l.qty * (l.capacity_w ?? 0)) / 1000, 0),
        controllers: lines.rows.filter((l) => l.category === 'charge_controller').reduce((s, l) => s + l.qty, 0),
      };
      let pickInfo = null;
      const pk = pick.rows[0];
      if (pk) {
        pickInfo = { ...pk, progress: await withDb((db) => scanProgress(db, pk.id)), shortages: await withDb((db) => shortages(db, pk.id)) };
      }
      // money, margins and customer links only for the roles that work with them
      const money = can(ctx.role as Role, 'invoices.read') || can(ctx.role as Role, 'payments.write');
      const share = canShareLinks(ctx.role);
      if (!share) delete job.portal_token;
      return {
        job,
        lines: lines.rows,
        payments: money ? payments.rows : [],
        paidPaise: paid,
        balancePaise: job.total_paise - paid,
        pick: pickInfo && !seesCosts(ctx.role) ? { ...pickInfo, goods_value_paise: null } : pickInfo,
        visits: visits.rows,
        report: report.rows[0] ?? null,
        invoices: money ? invoices.rows.map((i) => (share ? i : { ...i, public_token: undefined })) : [],
        subsidy: sub,
        expenses: money ? expenses.rows : [],
        serials: serials.rows,
        tickets: tickets.rows,
        activities: activities.rows,
        profit: can(ctx.role as Role, 'reports.read') ? (profit[0] ?? null) : null,
        kit,
        stages: jobStageState({ ...job, invoice_sent: !!inv && inv.status !== 'draft', subsidy_status: sub?.status ?? null }),
      };
    }),
  );

  r.post('/jobs/:id/payments', act('payments.write', paymentSchema, async (input, db, ctx, req) => recordJobPayment(db, ctx, idParam(req), input)));
  r.post('/jobs/:id/cancel', act('jobs.write', jobCancelSchema, async (input, db, ctx, req) => cancelJob(db, ctx, idParam(req), input.reason)));
  r.post('/jobs/:id/close', act('jobs.write', null, async (_i, db, ctx, req) => closeJob(db, ctx, idParam(req))));
  r.post('/expenses', act('expenses.write', expenseSchema, async (input, db, ctx) => addExpense(db, ctx, input)));
  r.post(
    '/jobs/:id/deliver',
    act('delivery.write', deliverSchema, async (input, db, ctx, req) => {
      const pick = await one<{ id: number }>(db, `SELECT id FROM pick_lists WHERE job_id = $1`, [idParam(req)], 'The pick list');
      return deliverPickList(db, ctx, pick.id, input);
    }),
  );
  r.post('/jobs/:id/install-report', act('install.write', installReportSchema, async (input, db, ctx, req) => submitInstallReport(db, ctx, idParam(req), input)));

  /* ---------------- warehouse ---------------- */
  r.get(
    '/warehouse',
    read('stock.read', async (_req, ctx) => {
      const [picks, low, purchases, onTruck] = await Promise.all([
        query(
          `SELECT k.id, k.ref, k.status, k.created_at, k.packed_at, k.dispatched_at, k.vehicle_no, k.goods_value_paise, j.id AS job_id, j.ref AS job_ref, j.kind, j.capacity_kw,
                  c.name AS customer, c.city,
                  (SELECT min(v.starts_at) FROM visits v JOIN visit_links l ON l.visit_id = v.id WHERE l.job_id = j.id AND v.kind = 'installation' AND v.status <> 'cancelled') AS install_at,
                  (SELECT coalesce(sum(pl.qty), 0) FROM pick_lines pl JOIN products p ON p.id = pl.product_id WHERE pl.pick_list_id = k.id AND p.tracking = 'serial')::int AS serials_needed,
                  (SELECT count(*) FROM serial_units su WHERE su.pick_list_id = k.id AND su.status = 'allocated')::int AS serials_scanned,
                  (SELECT coalesce(sum(round(pl.qty * p.unit_cost_paise)), 0) FROM pick_lines pl JOIN products p ON p.id = pl.product_id WHERE pl.pick_list_id = k.id)::bigint AS est_value_paise
             FROM pick_lists k JOIN jobs j ON j.id = k.job_id JOIN customers c ON c.id = j.customer_id
            WHERE k.status IN ('waiting_stock', 'ready', 'packed', 'dispatched') OR (k.status = 'delivered' AND k.delivered_on >= current_date - 7)
            ORDER BY CASE k.status WHEN 'packed' THEN 0 WHEN 'ready' THEN 1 WHEN 'waiting_stock' THEN 2 WHEN 'dispatched' THEN 3 ELSE 4 END, install_at NULLS LAST`,
        ),
        query(`SELECT id, sku, name, on_hand, reorder_level, uom FROM products WHERE status = 'active' AND tracking <> 'none' AND on_hand <= reorder_level ORDER BY on_hand - reorder_level`),
        query(
          `SELECT p.id, p.ref, p.received_on, p.total_paise, s.name AS supplier, (SELECT count(*) FROM purchase_lines l WHERE l.purchase_id = p.id)::int AS lines
             FROM purchases p JOIN suppliers s ON s.id = p.supplier_id ORDER BY p.received_on DESC, p.id DESC LIMIT 12`,
        ),
        query(`SELECT coalesce(sum(goods_value_paise), 0)::bigint AS v, count(*)::int AS n FROM pick_lists WHERE status = 'dispatched'`),
      ]);
      if (!seesCosts(ctx.role)) {
        return {
          picks: picks.rows.map((p) => ({ ...p, est_value_paise: null, goods_value_paise: null })),
          lowStock: low.rows,
          purchases: purchases.rows.map((p) => ({ ...p, total_paise: null })),
          onTruck: { v: null, n: onTruck.rows[0]!.n },
        };
      }
      return { picks: picks.rows, lowStock: low.rows, purchases: purchases.rows, onTruck: onTruck.rows[0] };
    }),
  );

  r.get(
    '/warehouse/pick/:id',
    read('stock.read', async (req, ctx) => {
      const id = idParam(req);
      const k = await query(
        `SELECT k.*, j.ref AS job_ref, j.kind, j.capacity_kw, j.status AS job_status, c.name AS customer, c.address, c.city, c.phone, u.name AS dispatched_by_name,
                (SELECT min(v.starts_at) FROM visits v JOIN visit_links l ON l.visit_id = v.id WHERE l.job_id = j.id AND v.kind = 'installation' AND v.status <> 'cancelled') AS install_at
           FROM pick_lists k JOIN jobs j ON j.id = k.job_id JOIN customers c ON c.id = j.customer_id LEFT JOIN users u ON u.id = k.dispatched_by WHERE k.id = $1`,
        [id],
      );
      if (!k.rows[0]) throw notFound('That pick list');
      const lines = await query(
        `SELECT pl.id, pl.product_id, pl.qty, p.sku, p.name, p.category, p.tracking, p.uom, p.on_hand, p.unit_cost_paise,
                coalesce(json_agg(json_build_object('id', su.id, 'serial', su.serial, 'status', su.status, 'scanned_at', su.scanned_at) ORDER BY su.scanned_at)
                         FILTER (WHERE su.id IS NOT NULL), '[]') AS serials
           FROM pick_lines pl JOIN products p ON p.id = pl.product_id
           LEFT JOIN serial_units su ON su.pick_list_id = pl.pick_list_id AND su.product_id = pl.product_id AND su.status IN ('allocated', 'dispatched', 'installed')
          WHERE pl.pick_list_id = $1 GROUP BY pl.id, p.id
          ORDER BY array_position(ARRAY['panel','inverter','battery','charge_controller','wiring_box','structure','cable','connector','switchgear','earthing','accessory'], p.category), p.sku`,
        [id],
      );
      const short = await withDb((db) => shortages(db, id));
      if (!seesCosts(ctx.role)) return { pick: { ...k.rows[0], goods_value_paise: null }, lines: lines.rows.map((l) => ({ ...l, unit_cost_paise: null })), shortages: short };
      return { pick: k.rows[0], lines: lines.rows, shortages: short };
    }),
  );
  r.post('/warehouse/pick/:id/scan', act('dispatch.write', scanSchema, async (input, db, ctx, req) => scanSerial(db, ctx, idParam(req), input.serial)));
  r.post('/warehouse/pick/:id/unscan', act('dispatch.write', unscanSchema, async (input, db, ctx, req) => unscanSerial(db, ctx, idParam(req), input.serialUnitId)));
  r.post('/warehouse/pick/:id/pack', act('dispatch.write', null, async (_i, db, ctx, req) => packPickList(db, ctx, idParam(req))));
  r.post('/warehouse/pick/:id/dispatch', act('dispatch.write', dispatchSchema, async (input, db, ctx, req) => dispatchPickList(db, ctx, idParam(req), input)));
  r.post('/warehouse/pick/:id/deliver', act('delivery.write', deliverSchema, async (input, db, ctx, req) => deliverPickList(db, ctx, idParam(req), input)));

  r.get(
    '/stock/:id',
    read('stock.read', async (req, ctx) => {
      const id = idParam(req);
      const p = await query(`SELECT * FROM products WHERE id = $1`, [id]);
      if (!p.rows[0]) throw notFound('That product');
      const [moves, serials] = await Promise.all([
        query(
          `SELECT m.id, m.direction, m.qty, m.unit_cost_paise, m.reason, m.created_at, m.note, j.ref AS job_ref, j.id AS job_id, t.ref AS ticket_ref, pu.ref AS purchase_ref, su.serial
             FROM stock_moves m LEFT JOIN jobs j ON j.id = m.job_id LEFT JOIN tickets t ON t.id = m.ticket_id LEFT JOIN purchases pu ON pu.id = m.purchase_id
             LEFT JOIN serial_units su ON su.id = m.serial_unit_id WHERE m.product_id = $1 ORDER BY m.created_at DESC, m.id DESC LIMIT 200`,
          [id],
        ),
        query(
          `SELECT su.id, su.serial, su.status, su.warranty_end, c.name AS customer, j.ref AS job_ref FROM serial_units su LEFT JOIN customers c ON c.id = su.customer_id
             LEFT JOIN jobs j ON j.id = su.job_id WHERE su.product_id = $1 ORDER BY (su.status = 'in_stock') DESC, su.id DESC LIMIT 300`,
          [id],
        ),
      ]);
      if (!seesCosts(ctx.role)) return { product: { ...p.rows[0], unit_cost_paise: null }, moves: moves.rows.map((m) => ({ ...m, unit_cost_paise: null })), serials: serials.rows };
      return { product: p.rows[0], moves: moves.rows, serials: serials.rows };
    }),
  );
  r.post('/stock/adjust', act('stock.write', stockAdjustSchema, async (input, db, ctx) => adjustStock(db, ctx, input)));
  r.get(
    '/purchases/:id',
    read('stock.read', async (req) => {
      const id = idParam(req);
      const p = await query(`SELECT p.*, s.name AS supplier, u.name AS created_by_name FROM purchases p JOIN suppliers s ON s.id = p.supplier_id LEFT JOIN users u ON u.id = p.created_by WHERE p.id = $1`, [id]);
      if (!p.rows[0]) throw notFound('That purchase');
      const lines = await query(
        `SELECT l.*, pr.sku, pr.name, pr.tracking, pr.uom,
                (SELECT coalesce(json_agg(su.serial ORDER BY su.serial), '[]') FROM serial_units su WHERE su.purchase_id = l.purchase_id AND su.product_id = l.product_id) AS serials
           FROM purchase_lines l JOIN products pr ON pr.id = l.product_id WHERE l.purchase_id = $1`,
        [id],
      );
      return { purchase: p.rows[0], lines: lines.rows };
    }),
  );
  r.post('/purchases', act('stock.write', purchaseSchema, async (input, db, ctx) => receivePurchase(db, ctx, input)));

  /* ---------------- schedule ---------------- */
  r.get(
    '/schedule',
    read('schedule.read', async (req, ctx) => {
      const from = zParse(isoDate.optional(), req.query.from) ?? isoDateInTz(ctx.now, ctx.tz);
      const days = Math.max(1, Math.min(31, Number(req.query.days) || 7));
      const start = startOfDayUtc(from, ctx.tz);
      const end = startOfDayUtc(addDays(from, days), ctx.tz);
      const mine = ctx.role === 'technician' ? ctx.userId : null;
      const [visits, techs] = await Promise.all([
        query(
          `SELECT v.id, v.kind, v.starts_at, v.ends_at, v.status, v.notes, c.name AS customer, c.city, c.address, c.phone,
                  l.job_id, l.survey_id, l.ticket_id, j.ref AS job_ref, j.capacity_kw, j.status AS job_status, s.ref AS survey_ref, t.ref AS ticket_ref,
                  coalesce(json_agg(json_build_object('id', u.id, 'name', u.name)) FILTER (WHERE u.id IS NOT NULL), '[]') AS crew
             FROM visits v JOIN customers c ON c.id = v.customer_id LEFT JOIN visit_links l ON l.visit_id = v.id
             LEFT JOIN jobs j ON j.id = l.job_id LEFT JOIN surveys s ON s.id = l.survey_id LEFT JOIN tickets t ON t.id = l.ticket_id
             LEFT JOIN visit_crew vc ON vc.visit_id = v.id AND vc.active LEFT JOIN users u ON u.id = vc.technician_id
            WHERE v.starts_at < $2 AND v.ends_at > $1 AND v.status <> 'cancelled'
              AND ($3::bigint IS NULL OR EXISTS (SELECT 1 FROM visit_crew x WHERE x.visit_id = v.id AND x.technician_id = $3 AND x.active))
            GROUP BY v.id, c.id, l.visit_id, j.id, s.id, t.id ORDER BY v.starts_at`,
          [start, end, mine],
        ),
        query(`SELECT id, name, phone FROM users WHERE role = 'technician' AND status = 'active' ORDER BY name`),
      ]);
      return { from, days, visits: visits.rows, technicians: techs.rows };
    }),
  );
  r.get(
    '/schedule/free',
    read('schedule.read', async (req) => {
      const s = new Date(String(req.query.startsAt));
      const e = new Date(String(req.query.endsAt));
      if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime()) || e <= s) return { technicians: [] };
      return { technicians: await withDb((db) => freeTechnicians(db, s, e)) };
    }),
  );
  r.post(
    '/jobs/:id/visits',
    act('schedule.write', visitSchema, async (input, db, ctx, req) => {
      const job = await one<{ id: number; customer_id: number; ref: string; status: string; capacity_kw: number }>(db, `SELECT id, customer_id, ref, status, capacity_kw FROM jobs WHERE id = $1`, [idParam(req)], 'That job');
      if (['installed', 'closed', 'cancelled'].includes(job.status)) throw conflict('wrong_stage', `${job.ref} doesn’t need an installation visit.`);
      const id = await createVisit(db, ctx, {
        kind: 'installation',
        customerId: job.customer_id,
        startsAt: new Date(input.startsAt),
        endsAt: new Date(input.endsAt),
        technicianIds: input.technicianIds,
        notes: input.notes ?? `${job.ref}: ${job.capacity_kw} kW installation`,
        link: { jobId: job.id },
      });
      return { id };
    }),
  );
  r.put(
    '/visits/:id',
    act('schedule.write', visitSchema, async (input, db, ctx, req) =>
      rescheduleVisit(db, ctx, idParam(req), { startsAt: new Date(input.startsAt), endsAt: new Date(input.endsAt), technicianIds: input.technicianIds, notes: input.notes ?? null }),
    ),
  );
  r.post('/visits/:id/cancel', act('schedule.write', null, async (_i, db, _ctx, req) => cancelVisit(db, idParam(req))));

  /** A technician's day: visits with what to do at each. */
  r.get(
    '/me/day',
    read(null, async (req, ctx) => {
      const day = zParse(isoDate.optional(), req.query.date) ?? isoDateInTz(ctx.now, ctx.tz);
      const visits = await query(
        `SELECT v.id, v.kind, v.starts_at, v.ends_at, v.status, c.name AS customer, c.address, c.city, c.phone,
                l.job_id, l.survey_id, l.ticket_id, j.ref AS job_ref, j.status AS job_status, j.capacity_kw, j.kind AS job_kind,
                s.ref AS survey_ref, s.status AS survey_status, t.ref AS ticket_ref, t.status AS ticket_status, t.description AS ticket_description, t.coverage
           FROM visits v JOIN visit_crew vc ON vc.visit_id = v.id AND vc.active AND vc.technician_id = $1 JOIN customers c ON c.id = v.customer_id
           LEFT JOIN visit_links l ON l.visit_id = v.id LEFT JOIN jobs j ON j.id = l.job_id LEFT JOIN surveys s ON s.id = l.survey_id LEFT JOIN tickets t ON t.id = l.ticket_id
          WHERE v.starts_at >= $2 AND v.starts_at < $3 AND v.status <> 'cancelled' ORDER BY v.starts_at`,
        [ctx.userId, startOfDayUtc(day, ctx.tz), startOfDayUtc(addDays(day, 1), ctx.tz)],
      );
      const tickets = await query(
        `SELECT t.id, t.ref, t.status, t.priority, t.coverage, t.description, c.name AS customer, c.city FROM tickets t JOIN customers c ON c.id = t.customer_id
          WHERE t.assigned_to = $1 AND t.status IN ('assigned', 'in_progress') ORDER BY t.priority = 'urgent' DESC, t.created_at`,
        [ctx.userId],
      );
      return { date: day, visits: visits.rows, tickets: tickets.rows };
    }),
  );

  r.get(
    '/serials/:id',
    read('stock.read', async (req) => {
      const id = idParam(req);
      const s = await query(
        `SELECT su.*, p.name AS product, p.sku, p.category, p.warranty_months, c.name AS customer, c.phone, c.id AS customer_id, c.address, c.city, j.ref AS job_ref,
                pu.ref AS purchase_ref, pu.received_on, sup.name AS supplier, rb.serial AS replaced_by_serial
           FROM serial_units su JOIN products p ON p.id = su.product_id LEFT JOIN customers c ON c.id = su.customer_id LEFT JOIN jobs j ON j.id = su.job_id
           LEFT JOIN purchases pu ON pu.id = su.purchase_id LEFT JOIN suppliers sup ON sup.id = pu.supplier_id LEFT JOIN serial_units rb ON rb.id = su.replaced_by_id
          WHERE su.id = $1`,
        [id],
      );
      if (!s.rows[0]) throw notFound('That serial number');
      const [moves, tickets] = await Promise.all([
        query(`SELECT m.direction, m.reason, m.created_at, j.ref AS job_ref, t.ref AS ticket_ref, pu.ref AS purchase_ref FROM stock_moves m LEFT JOIN jobs j ON j.id = m.job_id LEFT JOIN tickets t ON t.id = m.ticket_id LEFT JOIN purchases pu ON pu.id = m.purchase_id WHERE m.serial_unit_id = $1 ORDER BY m.created_at`, [id]),
        query(`SELECT id, ref, status, coverage, created_at, description FROM tickets WHERE serial_unit_id = $1 ORDER BY created_at DESC`, [id]),
      ]);
      return { serial: s.rows[0], moves: moves.rows, tickets: tickets.rows };
    }),
  );

  r.get(
    '/technicians',
    read(null, async () => {
      const rows = await query(`SELECT id, name, phone FROM users WHERE role = 'technician' AND status = 'active' ORDER BY name`);
      return { technicians: rows.rows };
    }),
  );
  r.get(
    '/sales-team',
    read(null, async () => {
      const rows = await query(`SELECT id, name, role FROM users WHERE role IN ('sales', 'owner') AND status = 'active' ORDER BY role DESC, name`);
      return { people: rows.rows };
    }),
  );

  return r;
}
