import { Router } from 'express';
import { z } from 'zod';
import {
  kitTemplateSchema,
  productSchema,
  quoteAcceptSchema,
  quoteCreateSchema,
  quoteDeclineSchema,
  quoteUpdateSchema,
  estimateGeneration,
  paybackYears,
  type Shading,
} from '@arka/shared';
import { createKit, createProduct, expandTemplate, setProductStatus, updateKit, updateProduct } from '../../domain/catalog.js';
import { acceptQuote, createQuote, declineQuote, reviseQuote, sendQuote, updateQuote } from '../../domain/quotes.js';
import { notFound } from '../../lib/errors.js';
import { act, idParam, query, read, seesCosts, withDb } from '../context.js';

export async function quoteDetail(id: number, byToken?: string) {
  const q = await query(
    `SELECT q.*, c.name AS customer, c.phone, c.email, c.address, c.city, c.pincode, c.kind AS customer_kind, l.ref AS lead_ref,
            t.name AS template_name, t.code AS template_code, s.ref AS survey_ref, s.azimuth_deg, s.tilt_deg, s.cable_distance_m, s.shading, s.usable_area_sqft,
            u.name AS created_by_name, co.name AS company_name, co.phone AS company_phone, co.email AS company_email, co.address AS company_address, co.gstin AS company_gstin,
            (SELECT id FROM jobs j WHERE j.quote_id = q.id) AS job_id, (SELECT ref FROM jobs j WHERE j.quote_id = q.id) AS job_ref
       FROM quotes q JOIN customers c ON c.id = q.customer_id JOIN leads l ON l.id = q.lead_id JOIN kit_templates t ON t.id = q.template_id
       JOIN surveys s ON s.id = q.survey_id JOIN companies co ON co.id = q.company_id LEFT JOIN users u ON u.id = q.created_by
      WHERE ${byToken ? 'q.public_token = $1' : 'q.id = $1'}`,
    [byToken ?? id],
  );
  const quote = q.rows[0];
  if (!quote) throw notFound('That quote');
  const lines = await query(
    `SELECT ql.*, p.sku, p.category, p.tracking, p.uom, p.capacity_w FROM quote_lines ql JOIN products p ON p.id = ql.product_id WHERE ql.quote_id = $1 ORDER BY ql.sort`,
    [quote.id],
  );
  const gen = estimateGeneration({ capacityKw: quote.capacity_kw, azimuthDeg: quote.azimuth_deg, tiltDeg: quote.tilt_deg, shading: quote.shading as Shading });
  const versions = await query(`SELECT id, version, status, total_paise, created_at FROM quotes WHERE ref = $1 AND company_id = $2 ORDER BY version DESC`, [quote.ref, quote.company_id]);
  return {
    quote,
    lines: lines.rows,
    generation: gen,
    paybackYears: paybackYears(quote.total_paise, quote.subsidy_paise, gen.monthlySavingsPaise),
    versions: versions.rows,
  };
}

export function salesRoutes(): Router {
  const r = Router();

  /* ---------------- catalogue ---------------- */
  r.get(
    '/products',
    read('stock.read', async (req, ctx) => {
      const rows = await query(
        `SELECT p.*,
                (SELECT count(*) FROM serial_units su WHERE su.product_id = p.id AND su.status = 'in_stock')::int AS serials_in_stock,
                coalesce((SELECT sum(pl.qty) FROM pick_lines pl JOIN pick_lists k ON k.id = pl.pick_list_id WHERE pl.product_id = p.id AND k.status IN ('ready', 'packed', 'waiting_stock')), 0)::numeric AS promised
           FROM products p WHERE ($1::text IS NULL OR p.status = $1) ORDER BY array_position(ARRAY['panel','inverter','battery','charge_controller','wiring_box','structure','cable','connector','switchgear','earthing','accessory','service'], p.category), p.sku`,
        [req.query.all === '1' ? null : 'active'],
      );
      return { products: seesCosts(ctx.role) ? rows.rows : rows.rows.map((p) => ({ ...p, unit_cost_paise: null })) };
    }),
  );
  r.post('/products', act('catalog.write', productSchema, async (input, db, ctx) => createProduct(db, ctx, input)));
  r.put('/products/:id', act('catalog.write', productSchema, async (input, db, ctx, req) => updateProduct(db, ctx, idParam(req), input)));
  r.post(
    '/products/:id/status',
    act('catalog.write', z.object({ status: z.enum(['active', 'archived']) }), async (input, db, ctx, req) => setProductStatus(db, ctx, idParam(req), input.status)),
  );

  r.get(
    '/kits',
    read('quotes.read', async () => {
      const kits = await query(`SELECT * FROM kit_templates ORDER BY kind, capacity_kw NULLS LAST, code`);
      const lines = await query(
        `SELECT l.template_id, l.product_id, l.qty_rule, l.qty, l.sort, p.sku, p.name, p.category, p.uom, p.sale_price_paise FROM kit_template_lines l JOIN products p ON p.id = l.product_id ORDER BY l.template_id, l.sort`,
      );
      return { kits: kits.rows.map((k) => ({ ...k, lines: lines.rows.filter((l) => l.template_id === k.id) })) };
    }),
  );
  r.get(
    '/kits/:id/preview',
    read('quotes.read', async (req) => {
      const cable = Number(req.query.cable);
      const kw = Number(req.query.kw);
      // a scoped client: row-level security applies, so only this workspace's kits are visible
      return withDb((db) =>
        expandTemplate(db, idParam(req), Number.isFinite(cable) && cable > 0 && cable <= 200 ? cable : null, Number.isFinite(kw) && kw >= 1 && kw <= 5 ? kw : null),
      );
    }),
  );
  r.post('/kits', act('catalog.write', kitTemplateSchema, async (input, db, ctx) => ({ id: await createKit(db, ctx, input) })));
  r.put('/kits/:id', act('catalog.write', kitTemplateSchema, async (input, db, ctx, req) => updateKit(db, ctx, idParam(req), input)));

  /* ---------------- quotes ---------------- */
  r.get(
    '/quotes',
    read('quotes.read', async (req) => {
      const status = typeof req.query.status === 'string' && req.query.status !== 'all' ? req.query.status : null;
      const rows = await query(
        `SELECT q.id, q.ref, q.version, q.status, q.kind, q.capacity_kw, q.total_paise, q.subsidy_paise, q.valid_until, q.sent_at, q.created_at, q.decided_at,
                c.name AS customer, c.city, l.id AS lead_id, (SELECT j.id FROM jobs j WHERE j.quote_id = q.id) AS job_id
           FROM quotes q JOIN customers c ON c.id = q.customer_id JOIN leads l ON l.id = q.lead_id
          WHERE q.status <> 'superseded' AND ($1::text IS NULL OR q.status = $1)
          ORDER BY CASE q.status WHEN 'draft' THEN 0 WHEN 'sent' THEN 1 ELSE 2 END, q.created_at DESC LIMIT 300`,
        [status],
      );
      return { quotes: rows.rows };
    }),
  );
  r.get('/quotes/:id', read('quotes.read', async (req) => quoteDetail(idParam(req))));
  r.post('/quotes', act('quotes.write', quoteCreateSchema, async (input, db, ctx) => createQuote(db, ctx, input).then((q) => ({ id: q.id, ref: q.ref }))));
  r.put('/quotes/:id', act('quotes.write', quoteUpdateSchema, async (input, db, ctx, req) => updateQuote(db, ctx, idParam(req), input).then(() => ({ ok: true }))));
  r.post('/quotes/:id/send', act('quotes.write', null, async (_i, db, ctx, req) => sendQuote(db, ctx, idParam(req))));
  r.post('/quotes/:id/revise', act('quotes.write', null, async (_i, db, ctx, req) => reviseQuote(db, ctx, idParam(req)).then((q) => ({ id: q.id, version: q.version }))));
  r.post('/quotes/:id/accept', act('quotes.write', quoteAcceptSchema, async (input, db, ctx, req) => acceptQuote(db, ctx, idParam(req), input.name)));
  r.post('/quotes/:id/decline', act('quotes.write', quoteDeclineSchema, async (input, db, ctx, req) => declineQuote(db, ctx, idParam(req), input.reason)));

  return r;
}
