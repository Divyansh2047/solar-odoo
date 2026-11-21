import { formatINR, formatQty, type PurchaseInput } from '@arka/shared';
import type { Db } from '../db/pool.js';
import { conflict, invalid, notFound } from '../lib/errors.js';
import { publish } from '../lib/events.js';
import { logActivity, nextRef, notifyRoles, type Ctx } from './context.js';
import { addMonthsIso, many, maybe, one, q1000 } from './util.js';

interface PickRow {
  [k: string]: unknown;
  id: number;
  ref: string;
  job_id: number;
  status: string;
}

/** Stock already promised to pick lists that are ready or packed (they get served first). */
async function earmarked(db: Db, exceptPickId?: number): Promise<Map<number, number>> {
  const rows = await many<{ product_id: number; q: number }>(
    db,
    `SELECT pl.product_id, sum(pl.qty)::numeric AS q FROM pick_lines pl JOIN pick_lists p ON p.id = pl.pick_list_id
      WHERE p.status IN ('ready', 'packed') AND p.id IS DISTINCT FROM $1 GROUP BY pl.product_id`,
    [exceptPickId ?? null],
  );
  return new Map(rows.map((r) => [r.product_id, r.q]));
}

async function onHand(db: Db, productIds: number[]): Promise<Map<number, number>> {
  const rows = await many<{ id: number; on_hand: number }>(db, `SELECT id, on_hand FROM products WHERE id = ANY($1::bigint[])`, [productIds]);
  return new Map(rows.map((r) => [r.id, r.on_hand]));
}

export async function shortages(db: Db, pickId: number): Promise<{ productId: number; name: string; need: number; available: number }[]> {
  const lines = await many<{ product_id: number; qty: number; name: string }>(
    db,
    `SELECT pl.product_id, pl.qty, p.name FROM pick_lines pl JOIN products p ON p.id = pl.product_id WHERE pl.pick_list_id = $1`,
    [pickId],
  );
  const held = await earmarked(db, pickId);
  const stock = await onHand(db, lines.map((l) => l.product_id));
  return lines
    .map((l) => ({ productId: l.product_id, name: l.name, need: l.qty, available: Math.max(0, (stock.get(l.product_id) ?? 0) - (held.get(l.product_id) ?? 0)) }))
    .filter((l) => q1000(l.available) < q1000(l.need));
}

/** The warehouse's packing list for a confirmed job: every stocked part from the job's lines. */
export async function createPickList(db: Db, ctx: Ctx, job: { id: number; ref: string }): Promise<{ id: number; ref: string; status: string }> {
  const ref = await nextRef(db, 'PICK');
  const pick = await one<PickRow>(db, `INSERT INTO pick_lists (ref, job_id, status, created_at) VALUES ($1, $2, 'waiting_stock', $3) RETURNING *`, [ref, job.id, ctx.now]);
  await db.query(
    `INSERT INTO pick_lines (pick_list_id, product_id, qty)
     SELECT $2, jl.product_id, sum(jl.qty) FROM job_lines jl JOIN products p ON p.id = jl.product_id
      WHERE jl.job_id = $1 AND p.tracking <> 'none' GROUP BY jl.product_id`,
    [job.id, pick.id],
  );
  const short = await shortages(db, pick.id);
  const status = short.length ? 'waiting_stock' : 'ready';
  await db.query(`UPDATE pick_lists SET status = $2 WHERE id = $1`, [pick.id, status]);
  return { id: pick.id, ref, status };
}

/** When stock arrives, short pick lists become ready by themselves, oldest first. */
export async function recheckPickLists(db: Db, ctx: Ctx): Promise<string[]> {
  const waiting = await many<PickRow & { job_ref: string }>(
    db,
    `SELECT p.*, j.ref AS job_ref FROM pick_lists p JOIN jobs j ON j.id = p.job_id WHERE p.status = 'waiting_stock' ORDER BY p.created_at, p.id FOR UPDATE OF p`,
  );
  const readied: string[] = [];
  for (const p of waiting) {
    if ((await shortages(db, p.id)).length === 0) {
      await db.query(`UPDATE pick_lists SET status = 'ready' WHERE id = $1`, [p.id]);
      readied.push(`${p.ref} (${p.job_ref})`);
    }
  }
  if (readied.length) {
    await notifyRoles(db, ['warehouse'], { title: `${readied.length} pick list${readied.length === 1 ? '' : 's'} can be packed now`, body: readied.join(', '), link: '/app/warehouse' });
    await publish(db, ['dispatch', 'notifications']);
  }
  return readied;
}

export async function releasePickList(db: Db, ctx: Ctx, jobId: number): Promise<void> {
  const pick = await maybe<PickRow>(db, `SELECT * FROM pick_lists WHERE job_id = $1 FOR UPDATE`, [jobId]);
  if (!pick) return;
  await db.query(
    `UPDATE serial_units SET status = 'in_stock', pick_list_id = NULL, job_id = NULL, customer_id = NULL, scanned_at = NULL, scanned_by = NULL
      WHERE pick_list_id = $1 AND status = 'allocated'`,
    [pick.id],
  );
  await db.query(`UPDATE pick_lists SET status = 'cancelled' WHERE id = $1`, [pick.id]);
  await recheckPickLists(db, ctx);
}

/** Goods received from a supplier. Serial numbers are captured here; costs update the moving average. */
export async function receivePurchase(db: Db, ctx: Ctx, input: PurchaseInput): Promise<{ id: number; ref: string; readied: string[] }> {
  const supplier = await one<{ id: number }>(
    db,
    `WITH s AS (INSERT INTO suppliers (name, created_at) VALUES ($1, $2) ON CONFLICT (company_id, lower(name)) DO NOTHING RETURNING id)
     SELECT id FROM s UNION ALL SELECT id FROM suppliers WHERE lower(name) = lower($1) LIMIT 1`,
    [input.supplierName, ctx.now],
  );
  const ids = input.lines.map((l) => l.productId);
  const prods = await many<{ id: number; name: string; tracking: string; on_hand: number; unit_cost_paise: number; status: string }>(
    db,
    `SELECT id, name, tracking, on_hand, unit_cost_paise, status FROM products WHERE id = ANY($1::bigint[]) ORDER BY id FOR UPDATE`,
    [ids],
  );
  for (const [i, l] of input.lines.entries()) {
    const p = prods.find((x) => x.id === l.productId);
    if (!p) throw invalid('A line points to a product that doesn’t exist.', { [`lines.${i}.productId`]: 'Choose a product' });
    if (p.tracking === 'none') throw invalid(`${p.name} is a service and isn’t stocked.`, { [`lines.${i}.productId`]: 'Services aren’t stocked' });
    if (p.tracking === 'serial') {
      if (!Number.isInteger(l.qty)) throw invalid(`${p.name} is counted in whole units.`, { [`lines.${i}.qty`]: 'Whole units only' });
      const n = l.serials?.length ?? 0;
      if (n !== l.qty) throw invalid(`${p.name}: ${l.qty} received but ${n} serial number${n === 1 ? '' : 's'} entered. Every unit needs its serial.`, { [`lines.${i}.serials`]: `Enter ${l.qty} serials` });
    } else if (l.serials?.length) {
      throw invalid(`${p.name} isn’t serial-tracked.`, { [`lines.${i}.serials`]: 'Not needed for this item' });
    }
  }
  const allSerials = input.lines.flatMap((l) => l.serials ?? []);
  if (allSerials.length) {
    const dup = await many<{ serial: string }>(
      db,
      `SELECT su.serial FROM serial_units su JOIN unnest($1::bigint[], $2::text[]) AS x(pid, s) ON su.product_id = x.pid AND su.serial = x.s`,
      [input.lines.flatMap((l) => (l.serials ?? []).map(() => l.productId)), allSerials],
    );
    if (dup.length) throw conflict('serial_taken', `Already in the system: ${dup.map((d) => d.serial).slice(0, 5).join(', ')}${dup.length > 5 ? '…' : ''}.`);
  }
  const total = input.lines.reduce((s, l) => s + Math.round((q1000(l.qty) * l.unitCostPaise) / 1000), 0);
  const ref = await nextRef(db, 'GRN');
  const purchase = await one<{ id: number }>(
    db,
    `INSERT INTO purchases (ref, supplier_id, supplier_invoice, received_on, total_paise, notes, created_by, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [ref, supplier.id, input.supplierInvoice ?? null, input.receivedOn, total, input.notes ?? null, ctx.userId, ctx.now],
  );
  for (const l of input.lines) {
    const p = prods.find((x) => x.id === l.productId)!;
    await db.query(`INSERT INTO purchase_lines (purchase_id, product_id, qty, unit_cost_paise) VALUES ($1, $2, $3, $4)`, [purchase.id, l.productId, l.qty, l.unitCostPaise]);
    // moving average cost
    const newQty = p.on_hand + l.qty;
    const avg = newQty > 0 ? Math.round((p.on_hand * p.unit_cost_paise + l.qty * l.unitCostPaise) / newQty) : l.unitCostPaise;
    await db.query(`UPDATE products SET on_hand = on_hand + $2, unit_cost_paise = $3 WHERE id = $1`, [l.productId, l.qty, avg]);
    p.on_hand = newQty;
    p.unit_cost_paise = avg;
    if (l.serials?.length) {
      const r = await db.query<{ id: number }>(
        `INSERT INTO serial_units (product_id, serial, unit_cost_paise, purchase_id, created_at)
         SELECT $1, s, $2, $3, $4 FROM unnest($5::text[]) AS s RETURNING id`,
        [l.productId, l.unitCostPaise, purchase.id, ctx.now, l.serials],
      );
      await db.query(
        `INSERT INTO stock_moves (product_id, direction, qty, unit_cost_paise, reason, purchase_id, serial_unit_id, created_by, created_at)
         SELECT $1, 'in', 1, $2, 'purchase', $3, id, $4, $5 FROM unnest($6::bigint[]) AS id`,
        [l.productId, l.unitCostPaise, purchase.id, ctx.userId, ctx.now, r.rows.map((x) => x.id)],
      );
    } else {
      await db.query(
        `INSERT INTO stock_moves (product_id, direction, qty, unit_cost_paise, reason, purchase_id, created_by, created_at) VALUES ($1, 'in', $2, $3, 'purchase', $4, $5, $6)`,
        [l.productId, l.qty, l.unitCostPaise, purchase.id, ctx.userId, ctx.now],
      );
    }
  }
  const readied = await recheckPickLists(db, ctx);
  await publish(db, ['stock']);
  return { id: purchase.id, ref, readied };
}

/** Physical count of a quantity-tracked item; the difference is posted to the ledger. */
export async function adjustStock(db: Db, ctx: Ctx, input: { productId: number; countedQty: number; reason: string }): Promise<{ delta: number }> {
  const p = await one<{ id: number; name: string; tracking: string; on_hand: number; unit_cost_paise: number }>(
    db,
    `SELECT id, name, tracking, on_hand, unit_cost_paise FROM products WHERE id = $1 FOR UPDATE`,
    [input.productId],
    'That product',
  );
  if (p.tracking !== 'quantity') throw conflict('serial_tracked', `${p.name} is counted by serial number; scan or scrap units instead.`);
  const delta = Math.round((input.countedQty - p.on_hand) * 1000) / 1000;
  if (delta === 0) return { delta };
  await db.query(`UPDATE products SET on_hand = $2 WHERE id = $1`, [p.id, input.countedQty]);
  await db.query(
    `INSERT INTO stock_moves (product_id, direction, qty, unit_cost_paise, reason, note, created_by, created_at) VALUES ($1, $2, $3, $4, 'adjustment', $5, $6, $7)`,
    [p.id, delta > 0 ? 'in' : 'out', Math.abs(delta), p.unit_cost_paise, input.reason, ctx.userId, ctx.now],
  );
  if (delta > 0) await recheckPickLists(db, ctx);
  await publish(db, ['stock']);
  return { delta };
}

async function lockPick(db: Db, id: number): Promise<PickRow & { customer_id: number; job_ref: string; job_status: string }> {
  return one(
    db,
    `SELECT p.*, j.customer_id, j.ref AS job_ref, j.status AS job_status FROM pick_lists p JOIN jobs j ON j.id = p.job_id WHERE p.id = $1 FOR UPDATE OF p`,
    [id],
    'That pick list',
  );
}

export interface ScanProgress {
  productId: number;
  name: string;
  need: number;
  scanned: number;
}

export async function scanProgress(db: Db, pickId: number): Promise<ScanProgress[]> {
  return many<ScanProgress & Record<string, unknown>>(
    db,
    `SELECT pl.product_id AS "productId", p.name, pl.qty::numeric AS need,
            (SELECT count(*) FROM serial_units su WHERE su.pick_list_id = pl.pick_list_id AND su.product_id = pl.product_id AND su.status IN ('allocated', 'dispatched', 'installed'))::int AS scanned
       FROM pick_lines pl JOIN products p ON p.id = pl.product_id WHERE pl.pick_list_id = $1 AND p.tracking = 'serial' ORDER BY p.category, p.name`,
    [pickId],
  );
}

/**
 * Scan one serial onto a pick list. Explains exactly why a scan is refused: unknown serial, wrong
 * product, already promised to another customer, or that line is already complete.
 */
export async function scanSerial(db: Db, ctx: Ctx, pickId: number, serialText: string): Promise<{ serial: string; product: string; progress: ScanProgress[] }> {
  const pick = await lockPick(db, pickId);
  if (!['ready', 'packed', 'waiting_stock'].includes(pick.status)) throw conflict('wrong_stage', `${pick.ref} is ${pick.status}; scanning is closed.`);
  const unit = await maybe<{ id: number; serial: string; status: string; product_id: number; name: string; tracking: string; job_ref: string | null; customer: string | null }>(
    db,
    `SELECT su.id, su.serial, su.status, su.product_id, p.name, p.tracking, j.ref AS job_ref, c.name AS customer
       FROM serial_units su JOIN products p ON p.id = su.product_id LEFT JOIN jobs j ON j.id = su.job_id LEFT JOIN customers c ON c.id = su.customer_id
      WHERE su.serial = $1 ORDER BY (su.status = 'in_stock') DESC LIMIT 1 FOR UPDATE OF su`,
    [serialText],
  );
  if (!unit) throw notFound(`Serial ${serialText}`);
  if (unit.status !== 'in_stock') {
    if (unit.status === 'allocated' && unit.job_ref === pick.job_ref) throw conflict('already_scanned', `${unit.serial} is already scanned on this list.`);
    throw conflict('not_in_stock', `${unit.serial} isn’t in stock: it’s ${unit.status.replace('_', ' ')}${unit.job_ref ? ` on ${unit.job_ref}${unit.customer ? ` for ${unit.customer}` : ''}` : ''}.`);
  }
  const line = await maybe<{ qty: number }>(db, `SELECT qty FROM pick_lines WHERE pick_list_id = $1 AND product_id = $2`, [pickId, unit.product_id]);
  if (!line) throw conflict('wrong_product', `${unit.name} (${unit.serial}) isn’t on ${pick.ref}. Check you picked the right box.`);
  const done = await one<{ n: number }>(
    db,
    `SELECT count(*)::int AS n FROM serial_units WHERE pick_list_id = $1 AND product_id = $2 AND status = 'allocated'`,
    [pickId, unit.product_id],
  );
  if (done.n >= line.qty) throw conflict('line_complete', `All ${formatQty(line.qty)} × ${unit.name} are already scanned.`);
  await db.query(
    `UPDATE serial_units SET status = 'allocated', pick_list_id = $2, job_id = $3, customer_id = $4, scanned_at = $5, scanned_by = $6 WHERE id = $1`,
    [unit.id, pickId, pick.job_id, pick.customer_id, ctx.now, ctx.userId],
  );
  await publish(db, ['dispatch']);
  return { serial: unit.serial, product: unit.name, progress: await scanProgress(db, pickId) };
}

export async function unscanSerial(db: Db, ctx: Ctx, pickId: number, serialUnitId: number): Promise<void> {
  const pick = await lockPick(db, pickId);
  if (!['ready', 'packed', 'waiting_stock'].includes(pick.status)) throw conflict('wrong_stage', `${pick.ref} has left the warehouse.`);
  const r = await db.query(
    `UPDATE serial_units SET status = 'in_stock', pick_list_id = NULL, job_id = NULL, customer_id = NULL, scanned_at = NULL, scanned_by = NULL
      WHERE id = $1 AND pick_list_id = $2 AND status = 'allocated'`,
    [serialUnitId, pickId],
  );
  if (!r.rowCount) throw notFound('That scan');
  if (pick.status === 'packed') {
    await db.query(`UPDATE pick_lists SET status = 'ready', packed_at = NULL WHERE id = $1`, [pickId]);
    await db.query(`UPDATE jobs SET status = 'confirmed', packed_at = NULL WHERE id = $1 AND status = 'packed'`, [pick.job_id]);
  }
  await publish(db, ['dispatch', 'jobs']);
}

async function assertComplete(db: Db, pickId: number): Promise<void> {
  const progress = await scanProgress(db, pickId);
  const missing = progress.filter((p) => p.scanned < p.need);
  if (missing.length) {
    throw conflict(
      'scan_incomplete',
      `Scan every serial before it leaves: ${missing.map((m) => `${m.need - m.scanned} × ${m.name}`).join(', ')} still to scan.`,
      { missing },
    );
  }
  const short = await shortages(db, pickId);
  if (short.length) throw conflict('short_stock', `Not enough stock: ${short.map((s) => `${s.name} (need ${formatQty(s.need)}, have ${formatQty(s.available)})`).join(', ')}.`, { short });
}

export async function packPickList(db: Db, ctx: Ctx, pickId: number): Promise<void> {
  const pick = await lockPick(db, pickId);
  if (pick.status !== 'ready') throw conflict('wrong_stage', pick.status === 'waiting_stock' ? `${pick.ref} is still short of stock.` : `${pick.ref} is already ${pick.status}.`);
  await assertComplete(db, pickId);
  await db.query(`UPDATE pick_lists SET status = 'packed', packed_at = $2 WHERE id = $1`, [pickId, ctx.now]);
  await db.query(`UPDATE jobs SET status = 'packed', packed_at = $2 WHERE id = $1 AND status = 'confirmed'`, [pick.job_id, ctx.now]);
  await logActivity(db, ctx, { customerId: pick.customer_id, jobId: pick.job_id, body: `Kit packed (${pick.ref}); every serial scanned.` });
  await publish(db, ['dispatch', 'jobs']);
}

/** The truck leaves. Stock comes off the books at cost; every serial is now tied to the customer. */
export async function dispatchPickList(
  db: Db,
  ctx: Ctx,
  pickId: number,
  input: { vehicleNo: string; driverName: string; driverPhone?: string | undefined },
): Promise<{ goodsValuePaise: number; serials: number }> {
  const pick = await lockPick(db, pickId);
  if (!['ready', 'packed'].includes(pick.status)) throw conflict('wrong_stage', pick.status === 'waiting_stock' ? `${pick.ref} is still short of stock.` : `${pick.ref} has already left.`);
  await assertComplete(db, pickId);
  const lines = await many<{ product_id: number; qty: number; tracking: string; unit_cost_paise: number; name: string }>(
    db,
    `SELECT pl.product_id, pl.qty, p.tracking, p.unit_cost_paise, p.name FROM pick_lines pl JOIN products p ON p.id = pl.product_id
      WHERE pl.pick_list_id = $1 ORDER BY pl.product_id FOR UPDATE OF p`,
    [pickId],
  );
  let value = 0;
  let serials = 0;
  for (const l of lines) {
    if (l.tracking === 'serial') {
      const units = await many<{ id: number; unit_cost_paise: number }>(
        db,
        `UPDATE serial_units SET status = 'dispatched' WHERE pick_list_id = $1 AND product_id = $2 AND status = 'allocated' RETURNING id, unit_cost_paise`,
        [pickId, l.product_id],
      );
      serials += units.length;
      for (const u of units) {
        value += u.unit_cost_paise;
        await db.query(
          `INSERT INTO stock_moves (product_id, direction, qty, unit_cost_paise, reason, job_id, serial_unit_id, created_by, created_at) VALUES ($1, 'out', 1, $2, 'dispatch', $3, $4, $5, $6)`,
          [l.product_id, u.unit_cost_paise, pick.job_id, u.id, ctx.userId, ctx.now],
        );
      }
      await db.query(`UPDATE products SET on_hand = on_hand - $2 WHERE id = $1`, [l.product_id, units.length]);
    } else {
      value += Math.round((q1000(l.qty) * l.unit_cost_paise) / 1000);
      await db.query(`UPDATE products SET on_hand = on_hand - $2 WHERE id = $1`, [l.product_id, l.qty]);
      await db.query(
        `INSERT INTO stock_moves (product_id, direction, qty, unit_cost_paise, reason, job_id, created_by, created_at) VALUES ($1, 'out', $2, $3, 'dispatch', $4, $5, $6)`,
        [l.product_id, l.qty, l.unit_cost_paise, pick.job_id, ctx.userId, ctx.now],
      );
    }
  }
  await db.query(
    `UPDATE pick_lists SET status = 'dispatched', dispatched_at = $2, dispatched_by = $3, vehicle_no = $4, driver_name = $5, driver_phone = $6, goods_value_paise = $7,
       packed_at = coalesce(packed_at, $2) WHERE id = $1`,
    [pickId, ctx.now, ctx.userId, input.vehicleNo, input.driverName, input.driverPhone ?? null, value],
  );
  await db.query(`UPDATE jobs SET status = 'dispatched', dispatched_at = $2, packed_at = coalesce(packed_at, $2) WHERE id = $1`, [pick.job_id, ctx.now]);
  await logActivity(db, ctx, {
    customerId: pick.customer_id,
    jobId: pick.job_id,
    body: `Dispatched on ${input.vehicleNo} with ${input.driverName}: ${serials} serial-numbered units, ${formatINR(value)} of stock at cost.`,
  });
  await publish(db, ['dispatch', 'jobs', 'stock']);
  return { goodsValuePaise: value, serials };
}

/**
 * Delivery done. The warranty clock starts by itself for every serial on the truck: start = delivery
 * date, end = start + that product's warranty (e.g. 24 months for an inverter, 240 for a panel).
 */
export async function deliverPickList(
  db: Db,
  ctx: Ctx,
  pickId: number,
  input: { deliveredOn: string; receivedBy: string },
): Promise<{ warranties: { serial: string; product: string; end: string }[] }> {
  const pick = await lockPick(db, pickId);
  if (pick.status !== 'dispatched') throw conflict('wrong_stage', pick.status === 'delivered' ? `${pick.ref} is already delivered.` : `${pick.ref} hasn’t left the warehouse yet.`);
  const dispatchedOn = await one<{ d: string }>(db, `SELECT (dispatched_at AT TIME ZONE $2)::date::text AS d FROM pick_lists WHERE id = $1`, [pickId, ctx.tz]);
  if (input.deliveredOn < dispatchedOn.d) throw invalid('Delivery can’t be before dispatch.', { deliveredOn: `On or after ${dispatchedOn.d}` });
  const units = await many<{ id: number; serial: string; name: string; warranty_months: number }>(
    db,
    `SELECT su.id, su.serial, p.name, p.warranty_months FROM serial_units su JOIN products p ON p.id = su.product_id
      WHERE su.pick_list_id = $1 AND su.status = 'dispatched' FOR UPDATE OF su`,
    [pickId],
  );
  const warranties: { serial: string; product: string; end: string }[] = [];
  for (const u of units) {
    const end = addMonthsIso(input.deliveredOn, u.warranty_months);
    await db.query(`UPDATE serial_units SET status = 'installed', warranty_start = $2, warranty_end = $3 WHERE id = $1`, [u.id, input.deliveredOn, end]);
    warranties.push({ serial: u.serial, product: u.name, end });
  }
  await db.query(`UPDATE pick_lists SET status = 'delivered', delivered_on = $2, received_by = $3 WHERE id = $1`, [pickId, input.deliveredOn, input.receivedBy]);
  await db.query(`UPDATE jobs SET status = 'delivered', delivered_on = $2 WHERE id = $1`, [pick.job_id, input.deliveredOn]);
  const byProduct = new Map<string, { n: number; end: string }>();
  for (const w of warranties) byProduct.set(w.product, { n: (byProduct.get(w.product)?.n ?? 0) + 1, end: w.end });
  await logActivity(db, ctx, {
    customerId: pick.customer_id,
    jobId: pick.job_id,
    body: `Delivered, received by ${input.receivedBy}. Warranty started for ${warranties.length} serials: ${[...byProduct].map(([p, v]) => `${v.n} × ${p} until ${v.end}`).join('; ')}.`,
  });
  await publish(db, ['dispatch', 'jobs']);
  return { warranties };
}
