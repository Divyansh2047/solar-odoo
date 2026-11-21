/* Where every part of a kit sits on the roof. Pure numbers (metres), no three.js, so the 3D viewer
   and the SVG fallback draw exactly the same system from the same counts.
   Axes: x = east, y = up, z = south (towards the viewer). The slab top is y = 0, centred on the origin. */

export type KitPart = 'panel' | 'inverter' | 'battery' | 'controller';
export type KitKind = 'on_grid' | 'off_grid' | 'panel_set' | 'service';

export interface KitCounts {
  kind: KitKind;
  panels: number;
  inverters: number;
  batteries: number;
  controllers: number;
}

export const PANEL_W = 1.134;
export const PANEL_L = 2.278;
export const TILT = (18 * Math.PI) / 180;
export const PANEL_DEPTH = PANEL_L * Math.cos(TILT);
export const PANEL_RISE = PANEL_L * Math.sin(TILT);
/** Height of a panel's lower edge above the slab: an elevated GI structure people can walk under. */
export const STAND_FRONT = 1.05;
export const PANEL_GAP = 0.03;
export const ROW_PITCH = 3.1;
export const PARAPET_T = 0.15;
export const PARAPET_H = 0.6;
export const WALL_H = 1.9;

/** A box: centre x/z, bottom y, size w (x) h (y) d (z). */
export interface Box {
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  d: number;
}
export interface PanelSpot {
  x: number;
  z: number;
  row: number;
}
export interface PanelRow {
  z: number;
  x0: number;
  x1: number;
  n: number;
}
export interface KitLayout {
  w: number;
  d: number;
  panels: PanelSpot[];
  rows: PanelRow[];
  wall: Box | null;
  inverters: Box[];
  dcdb: Box | null;
  acdb: Box | null;
  controllers: Box[];
  batteries: Box[];
  pits: { x: number; z: number }[];
  arrester: { x: number; z: number } | null;
  /** Tallest point, for camera framing. */
  top: number;
}

export function clampCount(n: number, max: number): number {
  return Math.max(0, Math.min(max, Math.round(Number.isFinite(n) ? n : 0)));
}

export function normaliseCounts(c: KitCounts): KitCounts {
  return {
    kind: c.kind,
    panels: clampCount(c.panels, 24),
    inverters: clampCount(c.inverters, 4),
    batteries: clampCount(c.batteries, 6),
    controllers: clampCount(c.controllers, 4),
  };
}

/** Height of the panel surface above the slab at a given z inside a row (front edge is lowest). */
export function panelHeightAt(rowZ: number, z: number): number {
  const front = rowZ + PANEL_DEPTH / 2;
  return STAND_FRONT + ((front - z) / PANEL_DEPTH) * PANEL_RISE;
}

/** Lay out a row of n panels centred on cx. */
export function panelRow(n: number, cx: number, z: number): PanelRow {
  const width = n * PANEL_W + Math.max(0, n - 1) * PANEL_GAP;
  return { z, x0: cx - width / 2, x1: cx + width / 2, n };
}

export function rowSpots(row: PanelRow, rowIndex: number): PanelSpot[] {
  return Array.from({ length: row.n }, (_, i) => ({ x: row.x0 + PANEL_W / 2 + i * (PANEL_W + PANEL_GAP), z: row.z, row: rowIndex }));
}

type WallItem = { kind: 'inverter' | 'dcdb' | 'acdb' | 'controller'; w: number; h: number; d: number };

export function layoutKit(input: KitCounts): KitLayout {
  const c = normaliseCounts(input);
  const grid = c.kind === 'on_grid' || c.kind === 'off_grid';
  const rowsN = c.panels === 0 ? 0 : Math.ceil(c.panels / 5);
  const per = rowsN ? Math.ceil(c.panels / rowsN) : 0;
  const rowW = per * PANEL_W + Math.max(0, per - 1) * PANEL_GAP;

  const items: WallItem[] = [];
  for (let i = 0; i < c.inverters; i++) items.push({ kind: 'inverter', w: 0.5, h: 0.64, d: 0.2 });
  if (c.inverters > 0 || grid) {
    items.push({ kind: 'dcdb', w: 0.34, h: 0.42, d: 0.14 });
    items.push({ kind: 'acdb', w: 0.34, h: 0.42, d: 0.14 });
  }
  for (let i = 0; i < c.controllers; i++) items.push({ kind: 'controller', w: 0.3, h: 0.36, d: 0.12 });
  const itemGap = 0.2;
  const itemsW = items.reduce((s, it) => s + it.w, 0) + Math.max(0, items.length - 1) * itemGap;
  const wallW = items.length ? itemsW + 0.6 : 0;
  const batW = c.batteries * 0.6 + Math.max(0, c.batteries - 1) * 0.14;

  // Equipment (wall with inverter and boxes, batteries in front of it) stands at the back-right, beside the
  // array rather than behind it, so the viewer's south-east camera sees it clearly.
  const hasEq = items.length > 0 || c.batteries > 0;
  const eqW = Math.max(wallW, batW);
  const backZone = 0.6;
  const arrayD = rowsN ? PANEL_DEPTH + (rowsN - 1) * ROW_PITCH : 0;
  const w = Math.max(4.8, rowW + (hasEq ? eqW + 0.7 : 0) + 2.2);
  const d = Math.max(4.4, backZone + arrayD + 1.7, hasEq ? (c.batteries ? 3.4 : 2.4) : 0);
  const back = -d / 2 + PARAPET_T;
  const arrayCx = hasEq && rowsN ? -(eqW + 0.7) / 2 : 0;

  const rows: PanelRow[] = [];
  const panels: PanelSpot[] = [];
  for (let r = 0; r < rowsN; r++) {
    const n = Math.min(per, c.panels - r * per);
    const row = panelRow(n, arrayCx, back + backZone + PANEL_DEPTH / 2 + r * ROW_PITCH);
    rows.push(row);
    panels.push(...rowSpots(row, r));
  }

  let wall: Box | null = null;
  const inverters: Box[] = [];
  const controllers: Box[] = [];
  let dcdb: Box | null = null;
  let acdb: Box | null = null;
  const eqX1 = w / 2 - PARAPET_T - 0.3;
  if (items.length) {
    const wallX0 = eqX1 - wallW;
    wall = { x: (wallX0 + eqX1) / 2, y: 0, z: back + 0.12, w: wallW, h: WALL_H, d: 0.2 };
    let x = wallX0 + 0.3;
    for (const it of items) {
      const box: Box = { x: x + it.w / 2, y: it.kind === 'inverter' ? 0.85 : 1.0, z: back + 0.22 + it.d / 2, w: it.w, h: it.h, d: it.d };
      if (it.kind === 'inverter') inverters.push(box);
      else if (it.kind === 'controller') controllers.push(box);
      else if (it.kind === 'dcdb') dcdb = box;
      else acdb = box;
      x += it.w + itemGap;
    }
  }
  const batteries: Box[] = [];
  for (let i = 0; i < c.batteries; i++) {
    batteries.push({ x: eqX1 - 0.3 - i * 0.74, y: 0, z: back + (items.length ? 1.05 : 0.4), w: 0.6, h: 1.1, d: 0.44 });
  }

  const pits = grid ? [0, 1, 2].map((i) => ({ x: -w / 2 + 0.6 + i * 0.62, z: d / 2 - 0.6 })) : [];
  const arrester = grid ? { x: -w / 2 + 0.4, z: back + 0.25 } : null;
  const top = Math.max(PARAPET_H, rowsN ? STAND_FRONT + PANEL_RISE + 0.05 : 0, wall ? WALL_H : 0, c.batteries ? 1.1 : 0, arrester ? 2.6 : 0);

  return { w, d, panels, rows, wall, inverters, dcdb, acdb, controllers, batteries, pits, arrester, top };
}

export function partsPresent(c: KitCounts): KitPart[] {
  const n = normaliseCounts(c);
  const out: KitPart[] = [];
  if (n.panels) out.push('panel');
  if (n.inverters) out.push('inverter');
  if (n.batteries) out.push('battery');
  if (n.controllers) out.push('controller');
  return out;
}

export function partCountLabel(part: KitPart, n: number): string {
  const one = { panel: 'panel', inverter: 'inverter', battery: 'battery', controller: 'charge controller' }[part];
  const many = { panel: 'panels', inverter: 'inverters', battery: 'batteries', controller: 'charge controllers' }[part];
  return `${n} ${n === 1 ? one : many}`;
}

export function kitSummary(c: KitCounts): string {
  const n = normaliseCounts(c);
  const kind = { on_grid: 'On-grid system', off_grid: 'Off-grid system', panel_set: 'Solar panel set', service: 'Service visit' }[n.kind];
  const parts = partsPresent(n).map((p) => partCountLabel(p, countOf(n, p)));
  return parts.length ? `${kind} on a flat roof: ${parts.join(', ')}.` : `${kind}: no parts on the roof.`;
}

/** Where a part's floating label is anchored (top of the first unit of that part). */
export function partAnchor(l: KitLayout, part: KitPart): [number, number, number] | null {
  if (part === 'panel') {
    const row = l.rows[0];
    return row ? [(row.x0 + row.x1) / 2, STAND_FRONT + PANEL_RISE + 0.12, row.z - PANEL_DEPTH / 2] : null;
  }
  const b = part === 'inverter' ? l.inverters[0] : part === 'battery' ? l.batteries[0] : l.controllers[0];
  return b ? [b.x, b.y + b.h + 0.06, b.z] : null;
}

export function countOf(c: KitCounts, part: KitPart): number {
  const n = normaliseCounts(c);
  return part === 'panel' ? n.panels : part === 'inverter' ? n.inverters : part === 'battery' ? n.batteries : n.controllers;
}
