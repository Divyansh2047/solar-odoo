/* The landing story's facts and timeline. Pure numbers and strings, no three.js: the 3D stage, the SVG
   fallback and the text panels all read from here, so a number on screen can never disagree with the scene. */

import { PANEL_DEPTH, PARAPET_T, panelRow, rowSpots, type Box, type PanelRow } from '../../three/kit-layout';

export const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export function smooth(a: number, b: number, x: number): number {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}

/* ---------- timeline: t runs 0 (hero) .. 7 (month-end); scene k is centred on t = k ---------- */

export const LAST = 7;
/** Scene k holds its exact state for |t - k| <= 0.3 and blends to the next in between. */
export function keyed(values: readonly number[], t: number): number {
  const tt = Math.min(LAST, Math.max(0, t));
  const k = Math.min(LAST - 1, Math.floor(tt));
  const e = smooth(0.3, 0.7, tt - k);
  return lerp(values[k]!, values[k + 1]!, e);
}
/** Progress through scene k's own build-up: 0 before, 1 once its card is centred. */
export const local = (t: number, k: number, from = -0.4, to = 0.05) => clamp01((t - (k + from)) / (to - from));
/** How present scene k's props are (fade in before, out after). */
export const presence = (t: number, k: number) => smooth(k - 0.7, k - 0.4, t) * (1 - smooth(k + 0.4, k + 0.7, t));

/* ---------- the sun: one day stretched across the week ---------- */

const LAT = (18.5 * Math.PI) / 180; // Pune
export const HOURS = [9.5, 10.25, 11.5, 12.5, 13.5, 15.5, 16.25, 17.25] as const;
export const OVERCAST = [0, 0, 0, 0, 0, 0, 1, 0] as const;
export const sunHour = (t: number) => keyed(HOURS, t);
export const overcast = (t: number) => keyed(OVERCAST, t);

/** Sun elevation in radians at the equinox. */
export function sunElevation(hour: number): number {
  const H = ((hour - 12) * 15 * Math.PI) / 180;
  return Math.asin(Math.cos(LAT) * Math.cos(H));
}

export const PANEL_WATTS = 540;
export const PANEL_COUNT = 6;
export const KWP = (PANEL_COUNT * PANEL_WATTS) / 1000;
const DERATE = 0.8;

/** Output of the 3.24 kWp roof under a clear sky at this hour. */
export function generationKw(hour: number, cloud = 0): number {
  const s = Math.sin(sunElevation(hour));
  return s <= 0 ? 0 : KWP * DERATE * Math.pow(s, 1.2) * (1 - 0.8 * cloud);
}
export function energyTodayKwh(hour: number): number {
  let e = 0;
  const step = 1 / 60;
  for (let h = 6; h < hour; h += step) e += generationKw(h + step / 2) * Math.min(step, hour - h);
  return e;
}
export function clock(hour: number): string {
  const m = Math.round(hour * 60);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

const inr = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
export function rupees(n: number, signed = false): string {
  const s = `₹${inr.format(Math.abs(Math.round(n)))}`;
  return n < 0 ? `−${s}` : signed && n > 0 ? `+${s}` : s;
}

/* ---------- the house (metres; x east, z south, ground y = 0) ---------- */

export const HOUSE = { w: 10, d: 12, roof: 6.6, parapet: 1.0 };
export const MUMTY = { x0: -4.75, x1: -1.75, z0: -5.75, z1: -2.55, h: 2.5 };
export const TANK = { x: -3.25, z: -4.15, r: 0.62, h: 1.1 };
const R = HOUSE.roof;
export const ROOF_ROWS: PanelRow[] = [panelRow(3, 2.15, -1.45), panelRow(3, 2.15, -1.45 + 3.1)];
export const ROOF_PANELS = ROOF_ROWS.flatMap((r, i) => rowSpots(r, i));
export const INVERTER: Box = { x: -4.05, y: R + 0.95, z: MUMTY.z1 + 0.1, w: 0.5, h: 0.64, d: 0.2 };
export const DCDB: Box = { x: -3.3, y: R + 1.05, z: MUMTY.z1 + 0.07, w: 0.34, h: 0.42, d: 0.14 };
export const ACDB: Box = { x: -2.75, y: R + 1.05, z: MUMTY.z1 + 0.07, w: 0.34, h: 0.42, d: 0.14 };
export const METER: Box = { x: -3.3, y: 1.3, z: HOUSE.d / 2 + 0.08, w: 0.36, h: 0.46, d: 0.16 };
export const PITS = [2.6, 3.35, 4.1].map((x) => ({ x, z: HOUSE.d / 2 + 1.3 }));
export const ARRESTER = { x: HOUSE.w / 2 - 0.45, z: -HOUSE.d / 2 + 0.45 };
export const PIN = { x: 1.2, z: 0.6 };
export const COMPASS = { x: 1.7, z: 4.4, r: 0.95 };
export const TILT_GAUGE = { x: 3.6, z: ROOF_ROWS[1]!.z - 0.4 };
export const CREW = { x: -0.4, z: 4.4 };
/** Survey cable run: DC box, down to the slab, along the roof, over the parapet, down the front to the meter. */
export const CABLE_PATH: [number, number, number][] = [
  [DCDB.x, DCDB.y, DCDB.z + 0.08],
  [DCDB.x, R + 0.06, DCDB.z + 0.08],
  [DCDB.x, R + 0.06, HOUSE.d / 2 - PARAPET_T - 0.05],
  [DCDB.x, R + HOUSE.parapet + 0.06, HOUSE.d / 2 - PARAPET_T - 0.05],
  [DCDB.x, R + HOUSE.parapet + 0.06, HOUSE.d / 2 + 0.08],
  [DCDB.x, METER.y + METER.h, HOUSE.d / 2 + 0.08],
];
function pathLength(p: [number, number, number][]): number {
  let s = 0;
  for (let i = 1; i < p.length; i++) s += Math.hypot(p[i]![0] - p[i - 1]![0], p[i]![1] - p[i - 1]![1], p[i]![2] - p[i - 1]![2]);
  return s;
}
export const CABLE_RUN_M = Math.round(pathLength(CABLE_PATH));
export const CABLE_ORDER_M = Math.ceil(CABLE_RUN_M * 1.1);
export const PANEL_DEPTH_M = PANEL_DEPTH;

/* ---------- the customer's week ---------- */

export const CUSTOMER = 'Anita Kulkarni';
export const ENQUIRY = { ref: 'ENQ-0142', need: '3 kW under the subsidy', at: '10:04', firstCallMin: 11 };
export const SURVEY = { facing: 182, tilt: 18, shadowFree: 38, by: 'Ravi' };
export function subsidyFor(kw: number): number {
  return 30000 * Math.min(kw, 2) + 18000 * Math.min(Math.max(kw - 2, 0), 1);
}
export const QUOTE = { template: '3 kW on-grid', price: 189000, subsidy: subsidyFor(3), monthlySaving: 2900 };
export const QUOTE_NET = QUOTE.price - QUOTE.subsidy;
export const PAYBACK_YEARS = Math.round((QUOTE_NET / (QUOTE.monthlySaving * 12)) * 10) / 10;
export const SERIALS = { inverter: 'SPI3K2503-08812', panelFirst: 'PNL54-25-11407', panelLast: 'PNL54-25-11412' };
export const SCANS_TOTAL = 1 + PANEL_COUNT;
export const DATES = {
  mon: '10 Mar 2025',
  tue: '11 Mar 2025',
  wed: '12 Mar 2025',
  thu: '13 Mar 2025',
  fri: '14 Mar 2025',
  rain: 'Sep 2026',
  inverterUntil: '13 Mar 2027',
  panelsUntil: '13 Mar 2045',
};
export const TICKET = { ref: 'TKT-0388', code: 'E-031', fault: 'insulation fault' };
export const TEST_HOUR = HOURS[5];
export const TEST_KW = generationKw(TEST_HOUR);
export const SIGNED_AT = '15:42';

/* ---------- month-end: the colony, one lot per job ---------- */

export type LotStatus = 'profit' | 'loss' | 'unfinished';
export interface Lot {
  id: number;
  x: number;
  z: number;
  floors: number;
  color: string;
  tank: boolean;
  status: LotStatus;
  profit: number;
  ref: string;
  note?: string;
}
export const LOT_X = 15;
export const LOT_Z = 22;
const WALLS = ['#efe4d2', '#e8dccb', '#dfe5e3', '#ece0c2', '#e4ddd0', '#dbe2d2', '#f0e6dc', '#e6d8c6'];
const SPECIAL: Record<string, { status: LotStatus; profit: number; note?: string }> = {
  '1,-1': { status: 'loss', profit: -6120, note: 'Extra structure work, not quoted' },
  '-2,-2': { status: 'loss', profit: -2380, note: 'Second crew visit for a leak' },
  '-1,-2': { status: 'unfinished', profit: 0, note: 'Waiting on subsidy papers' },
  '2,0': { status: 'unfinished', profit: 0, note: 'Installed, not yet signed' },
  '-3,-1': { status: 'unfinished', profit: 0, note: 'Kit packed, crew on Monday' },
  '1,-3': { status: 'unfinished', profit: 0, note: 'Advance not yet paid' },
};
function rnd(seed: number) {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}
export const LOTS: Lot[] = (() => {
  const out: Lot[] = [];
  let n = 0;
  for (let j = -4; j <= 0; j++)
    for (let i = -4; i <= 3; i++) {
      const s = SPECIAL[`${i},${j}`];
      const r = rnd(n + 1);
      const home = i === 0 && j === 0;
      out.push({
        id: n,
        x: i * LOT_X,
        z: j * LOT_Z,
        floors: home ? 2 : 1 + Math.floor(rnd(n + 7) * 3),
        color: WALLS[Math.floor(rnd(n + 3) * WALLS.length)]!,
        tank: rnd(n + 5) > 0.35,
        status: s?.status ?? 'profit',
        profit: s ? s.profit : home ? 21600 : Math.round((9000 + r * 23000) / 10) * 10,
        ref: `JOB-${String(401 + n).padStart(4, '0')}`,
        note: s?.note,
      });
      n++;
    }
  return out;
})();
export const HOME_LOT = LOTS.find((l) => l.x === 0 && l.z === 0)!;
export const COUNTS = {
  total: LOTS.length,
  profit: LOTS.filter((l) => l.status === 'profit').length,
  loss: LOTS.filter((l) => l.status === 'loss').length,
  unfinished: LOTS.filter((l) => l.status === 'unfinished').length,
  net: LOTS.filter((l) => l.status !== 'unfinished').reduce((s, l) => s + l.profit, 0),
};
export const LABELLED_LOTS = {
  lossA: LOTS.find((l) => l.note === SPECIAL['1,-1']!.note)!,
  lossB: LOTS.find((l) => l.note === SPECIAL['-2,-2']!.note)!,
  open: LOTS.find((l) => l.note === SPECIAL['-1,-2']!.note)!,
};
