import type { Db } from './pool.js';

/**
 * The starting catalogue every new workspace gets: the brief's packages (Solar Panel Set, On-Grid and
 * Off-Grid 1–5 kW, Installation) with realistic Indian 2026 prices. Everything is editable afterwards.
 * Prices in rupees here; stored as paise.
 */
type P = [sku: string, name: string, category: string, tracking: 'serial' | 'quantity' | 'none', uom: string, cost: number, price: number, gstBp: number, warrantyMonths: number | null, capacityW: number | null, hsn: string, reorder: number];

export const PRODUCTS: P[] = [
  ['PNL-550', 'Mono PERC solar panel 550 Wp', 'panel', 'serial', 'unit', 12200, 13500, 500, 240, 550, '85414300', 40],
  ['INV-OG-1', 'Grid-tie inverter 1 kW', 'inverter', 'serial', 'unit', 14200, 17500, 500, 24, 1000, '85044090', 2],
  ['INV-OG-2', 'Grid-tie inverter 2 kW', 'inverter', 'serial', 'unit', 18800, 22500, 500, 24, 2000, '85044090', 3],
  ['INV-OG-3', 'Grid-tie inverter 3 kW', 'inverter', 'serial', 'unit', 24500, 28500, 500, 24, 3000, '85044090', 5],
  ['INV-OG-4', 'Grid-tie inverter 4 kW', 'inverter', 'serial', 'unit', 30500, 35500, 500, 24, 4000, '85044090', 2],
  ['INV-OG-5', 'Grid-tie inverter 5 kW', 'inverter', 'serial', 'unit', 35500, 41000, 500, 24, 5000, '85044090', 3],
  ['INV-HY-1', 'Off-grid hybrid inverter 1 kVA', 'inverter', 'serial', 'unit', 16000, 19500, 500, 24, 1000, '85044090', 1],
  ['INV-HY-2', 'Off-grid hybrid inverter 2 kVA', 'inverter', 'serial', 'unit', 20500, 25000, 500, 24, 2000, '85044090', 1],
  ['INV-HY-3', 'Off-grid hybrid inverter 3 kVA', 'inverter', 'serial', 'unit', 27500, 33500, 500, 24, 3000, '85044090', 2],
  ['INV-HY-5', 'Off-grid hybrid inverter 5 kVA', 'inverter', 'serial', 'unit', 38000, 46000, 500, 24, 5000, '85044090', 1],
  ['BAT-LFP-25', 'Lithium battery 25.6 V 100 Ah (2.5 kWh)', 'battery', 'serial', 'unit', 43500, 52000, 1800, 24, 2560, '85076000', 2],
  ['BAT-LFP-51', 'Lithium battery 51.2 V 100 Ah (5.1 kWh)', 'battery', 'serial', 'unit', 78500, 93000, 1800, 24, 5120, '85076000', 2],
  ['CC-MPPT-40', 'MPPT battery charge controller 40 A', 'charge_controller', 'serial', 'unit', 4700, 6200, 500, 24, null, '85044090', 5],
  ['CC-MPPT-60', 'MPPT battery charge controller 60 A', 'charge_controller', 'serial', 'unit', 6700, 8500, 500, 24, null, '85044090', 3],
  ['ACDB-1P', 'AC distribution box, single phase', 'wiring_box', 'quantity', 'unit', 2700, 3600, 500, null, null, '85371000', 10],
  ['DCDB-1', 'DC distribution box with surge protection', 'wiring_box', 'quantity', 'unit', 3300, 4400, 500, null, null, '85371000', 10],
  ['STR-GI', 'Elevated GI mounting structure (per panel)', 'structure', 'quantity', 'set', 2350, 3100, 500, null, null, '73089090', 60],
  ['CBL-DC4', 'DC solar cable 4 sq mm', 'cable', 'quantity', 'm', 44, 62, 500, null, null, '85444999', 600],
  ['CBL-AC4', 'AC cable 4 sq mm, 2-core', 'cable', 'quantity', 'm', 60, 82, 500, null, null, '85444999', 300],
  ['CBL-EW10', 'Earthing wire 10 sq mm', 'cable', 'quantity', 'm', 34, 48, 500, null, null, '85444999', 300],
  ['MC4-PAIR', 'MC4 connector pair', 'connector', 'quantity', 'unit', 115, 180, 500, null, null, '85369090', 80],
  ['SW-DCISO', 'DC isolator switch 32 A', 'switchgear', 'quantity', 'unit', 1500, 2100, 500, null, null, '85365090', 10],
  ['SW-MCB32', 'AC MCB 32 A, double pole', 'switchgear', 'quantity', 'unit', 400, 620, 500, null, null, '85362090', 15],
  ['EARTH-KIT', 'Chemical earthing kit (rod and compound)', 'earthing', 'quantity', 'kit', 2450, 3400, 500, null, null, '85469090', 30],
  ['LA-ESE', 'Lightning arrester', 'earthing', 'quantity', 'unit', 1950, 2800, 500, null, null, '85354010', 10],
  ['ACC-CONDUIT', 'PVC conduit, glands and fittings', 'accessory', 'quantity', 'set', 950, 1400, 500, null, null, '39173990', 15],
  ['SVC-INSTALL', 'Installation, testing and commissioning (per kW)', 'service', 'none', 'unit', 0, 5500, 1800, null, null, '995461', 0],
  ['SVC-NETMETER', 'Net-meter application and DISCOM liaison', 'service', 'none', 'job', 0, 3500, 1800, null, null, '998399', 0],
];

type L = [sku: string, rule: 'fixed' | 'per_kw' | 'per_panel' | 'cable_run', qty: number];

function onGrid(kw: number): L[] {
  return [
    ['PNL-550', 'fixed', kw * 2],
    [`INV-OG-${kw}`, 'fixed', 1],
    [kw <= 3 ? 'CC-MPPT-40' : 'CC-MPPT-60', 'fixed', 1],
    ['ACDB-1P', 'fixed', 1],
    ['DCDB-1', 'fixed', 1],
    ['STR-GI', 'per_panel', 1],
    ['CBL-DC4', 'cable_run', 2],
    ['CBL-AC4', 'fixed', 10],
    ['CBL-EW10', 'cable_run', 1],
    ['MC4-PAIR', 'per_panel', 1],
    ['SW-DCISO', 'fixed', 1],
    ['SW-MCB32', 'fixed', 1],
    ['EARTH-KIT', 'fixed', 3],
    ['LA-ESE', 'fixed', 1],
    ['ACC-CONDUIT', 'fixed', 1],
    ['SVC-INSTALL', 'per_kw', 1],
    ['SVC-NETMETER', 'fixed', 1],
  ];
}

function offGrid(kw: number): L[] {
  const inverter = kw >= 4 ? 'INV-HY-5' : `INV-HY-${kw}`;
  const batteries: L[] = kw <= 2 ? [['BAT-LFP-25', 'fixed', 1]] : kw === 3 ? [['BAT-LFP-51', 'fixed', 1]] : kw === 4 ? [['BAT-LFP-51', 'fixed', 1], ['BAT-LFP-25', 'fixed', 1]] : [['BAT-LFP-51', 'fixed', 2]];
  return onGrid(kw)
    .filter(([sku]) => !sku.startsWith('INV-OG') && sku !== 'SVC-NETMETER')
    .map((l): L => l)
    .concat([[inverter, 'fixed', 1], ...batteries])
    .sort((a, b) => order(a[0]) - order(b[0]));
}

const ORDER = ['PNL', 'INV', 'BAT', 'CC', 'ACDB', 'DCDB', 'STR', 'CBL', 'MC4', 'SW', 'EARTH', 'LA', 'ACC', 'SVC'];
const order = (sku: string) => ORDER.findIndex((p) => sku.startsWith(p));

export const KITS: { code: string; name: string; kind: 'on_grid' | 'off_grid' | 'panel_set' | 'service'; kw: number | null; description: string; lines: L[] }[] = [
  ...[1, 2, 3, 4, 5].map((kw) => ({
    code: `ONG-${kw}`,
    name: `On-Grid ${kw} kW`,
    kind: 'on_grid' as const,
    kw,
    description: 'Connected to the grid. Inverter, wiring boxes, charge controller, panels, safety earthing and metal stands.',
    lines: onGrid(kw),
  })),
  ...[1, 2, 3, 4, 5].map((kw) => ({
    code: `OFG-${kw}`,
    name: `Off-Grid ${kw} kW`,
    kind: 'off_grid' as const,
    kw,
    description: 'Everything in On-Grid, plus a large battery that stores power.',
    lines: offGrid(kw),
  })),
  {
    code: 'PANEL-SET',
    name: 'Solar panel set',
    kind: 'panel_set',
    kw: null,
    description: 'Hardware only: solar panels, connectors and wires.',
    lines: [
      ['PNL-550', 'per_kw', 2],
      ['MC4-PAIR', 'per_kw', 2],
      ['CBL-DC4', 'cable_run', 2],
    ],
  },
  {
    code: 'INSTALL',
    name: 'Installation service',
    kind: 'service',
    kw: null,
    description: 'Fitting and testing by our crew at the customer’s site.',
    lines: [
      ['SVC-INSTALL', 'per_kw', 1],
      ['ACC-CONDUIT', 'fixed', 1],
    ],
  },
];

export async function seedCatalog(db: Db, now: Date): Promise<Map<string, number>> {
  const ids = new Map<string, number>();
  for (const p of PRODUCTS) {
    const r = await db.query<{ id: number }>(
      `INSERT INTO products (sku, name, category, tracking, uom, unit_cost_paise, sale_price_paise, gst_rate_bp, warranty_months, capacity_w, hsn, reorder_level, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id`,
      [p[0], p[1], p[2], p[3], p[4], p[5] * 100, p[6] * 100, p[7], p[8], p[9], p[10], p[11], now],
    );
    ids.set(p[0], r.rows[0]!.id);
  }
  for (const k of KITS) {
    const t = await db.query<{ id: number }>(
      `INSERT INTO kit_templates (code, name, kind, capacity_kw, description, created_at) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [k.code, k.name, k.kind, k.kw, k.description, now],
    );
    let sort = 0;
    for (const [sku, rule, qty] of k.lines) {
      await db.query(`INSERT INTO kit_template_lines (template_id, product_id, qty_rule, qty, sort) VALUES ($1, $2, $3, $4, $5)`, [t.rows[0]!.id, ids.get(sku), rule, qty, sort++]);
    }
  }
  return ids;
}
