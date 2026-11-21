import { expandKit, type BomLine, type QtyRule } from '@arka/shared';
import type { z } from 'zod';
import type { kitTemplateSchema, productSchema } from '@arka/shared';
import type { Db } from '../db/pool.js';
import { conflict, invalid } from '../lib/errors.js';
import { publish } from '../lib/events.js';
import { audit, type Ctx } from './context.js';
import { many, one } from './util.js';

type ProductInput = z.infer<typeof productSchema>;
type KitInput = z.infer<typeof kitTemplateSchema>;

export interface ProductRow {
  [k: string]: unknown;
  id: number;
  sku: string;
  name: string;
  category: string;
  tracking: 'serial' | 'quantity' | 'none';
  uom: string;
  unit_cost_paise: number;
  sale_price_paise: number;
  gst_rate_bp: number;
  warranty_months: number | null;
  capacity_w: number | null;
  hsn: string | null;
  on_hand: number;
  reorder_level: number;
  status: string;
}

export async function createProduct(db: Db, ctx: Ctx, p: ProductInput): Promise<ProductRow> {
  const row = await one<ProductRow>(
    db,
    `INSERT INTO products (sku, name, category, tracking, uom, unit_cost_paise, sale_price_paise, gst_rate_bp, warranty_months, capacity_w, hsn, reorder_level, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *`,
    [p.sku, p.name, p.category, p.tracking, p.uom, p.unitCostPaise, p.salePricePaise, p.gstRateBp, p.warrantyMonths ?? null, p.capacityW ?? null, p.hsn ?? null, p.reorderLevel ?? 0, ctx.now],
  );
  await audit(db, ctx, 'product.create', 'product', row.id, { sku: p.sku });
  await publish(db, ['catalog']);
  return row;
}

export async function updateProduct(db: Db, ctx: Ctx, id: number, p: ProductInput): Promise<ProductRow> {
  const before = await one<ProductRow>(db, `SELECT * FROM products WHERE id = $1 FOR UPDATE`, [id], 'That product');
  if (before.tracking !== p.tracking) {
    const used = await db.query(`SELECT 1 FROM stock_moves WHERE product_id = $1 LIMIT 1`, [id]);
    if (used.rowCount) throw conflict('tracking_locked', 'This product already has stock history, so how it’s tracked can’t change.');
  }
  const row = await one<ProductRow>(
    db,
    `UPDATE products SET sku = $2, name = $3, category = $4, tracking = $5, uom = $6, unit_cost_paise = $7, sale_price_paise = $8, gst_rate_bp = $9,
       warranty_months = $10, capacity_w = $11, hsn = $12, reorder_level = $13 WHERE id = $1 RETURNING *`,
    [id, p.sku, p.name, p.category, p.tracking, p.uom, p.unitCostPaise, p.salePricePaise, p.gstRateBp, p.warrantyMonths ?? null, p.capacityW ?? null, p.hsn ?? null, p.reorderLevel ?? 0],
  );
  const changed: Record<string, [unknown, unknown]> = {};
  for (const k of ['sale_price_paise', 'unit_cost_paise', 'gst_rate_bp', 'warranty_months'] as const) if (before[k] !== row[k]) changed[k] = [before[k], row[k]];
  await audit(db, ctx, 'product.update', 'product', id, changed);
  await publish(db, ['catalog']);
  return row;
}

export async function setProductStatus(db: Db, ctx: Ctx, id: number, status: 'active' | 'archived'): Promise<void> {
  if (status === 'archived') {
    const inKit = await db.query(
      `SELECT t.code FROM kit_template_lines l JOIN kit_templates t ON t.id = l.template_id WHERE l.product_id = $1 AND t.status = 'active' LIMIT 3`,
      [id],
    );
    if (inKit.rowCount) throw conflict('in_use', `Remove it from kit ${inKit.rows.map((r) => r.code).join(', ')} first.`);
  }
  await db.query(`UPDATE products SET status = $2 WHERE id = $1`, [id, status]);
  await audit(db, ctx, `product.${status}`, 'product', id);
  await publish(db, ['catalog']);
}

async function writeKitLines(db: Db, templateId: number, lines: KitInput['lines']): Promise<void> {
  const ids = lines.map((l) => l.productId);
  const prods = await many<{ id: number; category: string; tracking: string; status: string }>(
    db,
    `SELECT id, category, tracking, status FROM products WHERE id = ANY($1::bigint[])`,
    [ids],
  );
  for (const l of lines) {
    const p = prods.find((x) => x.id === l.productId);
    if (!p || p.status !== 'active') throw invalid('A kit line points to a product that doesn’t exist or is archived.', { lines: 'Check the products' });
    if (l.qtyRule === 'cable_run' && p.category !== 'cable') throw invalid('Only cables can use the cable-run rule.', { lines: 'Cable run is for cables' });
  }
  await db.query(`DELETE FROM kit_template_lines WHERE template_id = $1`, [templateId]);
  let sort = 0;
  for (const l of lines) {
    await db.query(`INSERT INTO kit_template_lines (template_id, product_id, qty_rule, qty, sort) VALUES ($1, $2, $3, $4, $5)`, [templateId, l.productId, l.qtyRule, l.qty, sort++]);
  }
}

export async function createKit(db: Db, ctx: Ctx, k: KitInput): Promise<number> {
  const t = await one<{ id: number }>(
    db,
    `INSERT INTO kit_templates (code, name, kind, capacity_kw, description, created_at) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [k.code, k.name, k.kind, k.capacityKw ?? null, k.description ?? null, ctx.now],
  );
  await writeKitLines(db, t.id, k.lines);
  await audit(db, ctx, 'kit.create', 'kit_template', t.id, { code: k.code });
  await publish(db, ['catalog']);
  return t.id;
}

export async function updateKit(db: Db, ctx: Ctx, id: number, k: KitInput): Promise<void> {
  await one(db, `SELECT id FROM kit_templates WHERE id = $1 FOR UPDATE`, [id], 'That kit');
  await db.query(`UPDATE kit_templates SET code = $2, name = $3, kind = $4, capacity_kw = $5, description = $6 WHERE id = $1`, [
    id,
    k.code,
    k.name,
    k.kind,
    k.capacityKw ?? null,
    k.description ?? null,
  ]);
  await writeKitLines(db, id, k.lines);
  await audit(db, ctx, 'kit.update', 'kit_template', id, { code: k.code });
  await publish(db, ['catalog']);
}

export interface KitTemplate {
  [k: string]: unknown;
  id: number;
  code: string;
  name: string;
  kind: 'on_grid' | 'off_grid' | 'panel_set' | 'service';
  capacity_kw: number | null;
  status: string;
}

export interface ExpandedLine extends BomLine {
  sku: string;
  name: string;
  category: string;
  tracking: string;
  uom: string;
  unitPricePaise: number;
  unitCostPaise: number;
  gstRateBp: number;
  capacityW: number | null;
}

/** The template's lines turned into the exact parts list for one roof. */
export async function expandTemplate(
  db: Db,
  templateId: number,
  cableDistanceM: number | null,
  capacityOverrideKw: number | null = null,
): Promise<{ template: KitTemplate; lines: ExpandedLine[] }> {
  const template = await one<KitTemplate>(db, `SELECT * FROM kit_templates WHERE id = $1`, [templateId], 'That kit');
  if (template.capacity_kw === null) template.capacity_kw = capacityOverrideKw ?? 1;
  const rows = await many<{
    product_id: number;
    qty_rule: QtyRule;
    qty: number;
    sku: string;
    name: string;
    category: string;
    tracking: string;
    uom: string;
    sale_price_paise: number;
    unit_cost_paise: number;
    gst_rate_bp: number;
    capacity_w: number | null;
  }>(
    db,
    `SELECT l.product_id, l.qty_rule, l.qty, p.sku, p.name, p.category, p.tracking, p.uom, p.sale_price_paise, p.unit_cost_paise, p.gst_rate_bp, p.capacity_w
       FROM kit_template_lines l JOIN products p ON p.id = l.product_id WHERE l.template_id = $1 ORDER BY l.sort, l.id`,
    [templateId],
  );
  const bom = expandKit(
    rows.map((r) => ({ productId: r.product_id, category: r.category, qtyRule: r.qty_rule, qty: r.qty })),
    { capacityKw: template.capacity_kw ?? 1, cableDistanceM },
  );
  const lines = bom.map((b, i) => {
    const r = rows[i]!;
    return {
      ...b,
      sku: r.sku,
      name: r.name,
      category: r.category,
      tracking: r.tracking,
      uom: r.uom,
      unitPricePaise: r.sale_price_paise,
      unitCostPaise: r.unit_cost_paise,
      gstRateBp: r.gst_rate_bp,
      capacityW: r.capacity_w,
    };
  });
  return { template, lines };
}
