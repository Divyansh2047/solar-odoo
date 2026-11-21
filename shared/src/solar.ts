/**
 * Solar maths used on the qualification call, in the survey, in the quote and on the customer page.
 * Deliberately simple and explainable: every number can be traced to an assumption shown in the UI.
 */

export const ASSUMPTIONS = {
  /** Average residential tariff used to turn a bill into units (₹ per kWh). */
  tariffRupeesPerUnit: 7.5,
  /** Units (kWh) one kW of panels makes per month in India, south-facing at a good tilt. */
  unitsPerKwPerMonth: 120,
  /** Shadow-free roof needed per kW, in square feet. */
  sqftPerKw: 100,
  /** Specific yield, kWh per kWp per year, baseline. */
  specificYield: 1440,
  /** Tilt that gives the best yearly output across most of India (≈ latitude). */
  bestTiltDeg: 20,
  /** Cable slack added on top of the measured run. */
  cableSlack: 0.1,
  /** Cable run assumed before a survey measures it. */
  defaultCableDistanceM: 15,
  /** Package range sold by the company (brief: 1 kW to 5 kW). */
  minPackageKw: 1,
  maxPackageKw: 5,
} as const;

export type Shading = 'none' | 'partial' | 'heavy';

const SHADING_LOSS: Record<Shading, number> = { none: 0, partial: 0.1, heavy: 0.25 };

export interface SizingInput {
  monthlyBillPaise?: number | null;
  roofAreaSqft?: number | null;
  shading?: Shading | null;
  gridConnection?: 'single_phase' | 'three_phase' | 'none' | null;
  systemType?: 'on_grid' | 'off_grid' | 'not_sure' | null;
}

export interface SizingResult {
  /** Recommended package size in whole kW within the sold range, or null if not suitable. */
  recommendedKw: number | null;
  byBillKw: number | null;
  byRoofKw: number | null;
  monthlyUnits: number | null;
  verdict: 'good' | 'check' | 'not_suitable';
  reasons: string[];
}

/** Recommend a package size from the bill, capped by shadow-free roof space. */
export function recommendSize(input: SizingInput): SizingResult {
  const reasons: string[] = [];
  const monthlyUnits = input.monthlyBillPaise ? Math.round(input.monthlyBillPaise / 100 / ASSUMPTIONS.tariffRupeesPerUnit) : null;
  const byBillKw = monthlyUnits ? monthlyUnits / ASSUMPTIONS.unitsPerKwPerMonth : null;
  const usable = input.roofAreaSqft ? input.roofAreaSqft * (1 - SHADING_LOSS[input.shading ?? 'none']) : null;
  const byRoofKw = usable ? usable / ASSUMPTIONS.sqftPerKw : null;
  let verdict: SizingResult['verdict'] = 'good';

  if (byRoofKw !== null && byRoofKw < ASSUMPTIONS.minPackageKw) {
    reasons.push(`Shadow-free roof fits only ${byRoofKw.toFixed(1)} kW; the smallest package is 1 kW.`);
    verdict = 'not_suitable';
  }
  if (input.shading === 'heavy') {
    reasons.push('Heavy shade cuts output by about a quarter.');
    if (verdict === 'good') verdict = 'check';
  }
  const wantsGrid = input.systemType !== 'off_grid';
  if (wantsGrid && input.gridConnection === 'none') {
    reasons.push('No grid connection, so an On-Grid system can’t export. Offer Off-Grid.');
    if (verdict === 'good') verdict = 'check';
  }
  if (monthlyUnits !== null && monthlyUnits < 60) {
    reasons.push(`A bill of about ${monthlyUnits} units a month is too small to pay back quickly.`);
    if (verdict === 'good') verdict = 'check';
  }

  let recommendedKw: number | null = null;
  if (verdict !== 'not_suitable') {
    const want = byBillKw ?? byRoofKw ?? null;
    if (want !== null) {
      let kw = Math.ceil(want - 0.15); // round up unless just over a whole kW
      if (byRoofKw !== null) kw = Math.min(kw, Math.floor(byRoofKw));
      kw = Math.max(ASSUMPTIONS.minPackageKw, Math.min(ASSUMPTIONS.maxPackageKw, kw));
      recommendedKw = kw;
      if (byBillKw !== null) reasons.unshift(`Bill of ~${monthlyUnits} units/month needs about ${byBillKw.toFixed(1)} kW.`);
      if (byRoofKw !== null) reasons.push(`Roof fits up to ${byRoofKw.toFixed(1)} kW.`);
      if (byBillKw !== null && byBillKw > ASSUMPTIONS.maxPackageKw) reasons.push('Needs more than 5 kW: quote the 5 kW package and discuss a custom design.');
    }
  }
  return { recommendedKw, byBillKw, byRoofKw, monthlyUnits, verdict, reasons };
}

export interface GenerationInput {
  capacityKw: number;
  azimuthDeg?: number | null; // direction panels face; 180 = due south
  tiltDeg?: number | null;
  shading?: Shading | null;
}

/** Orientation factor 0..1 relative to the best south-facing tilt. */
export function orientationFactor(azimuthDeg: number, tiltDeg: number): number {
  const d = Math.abs(((azimuthDeg - 180 + 540) % 360) - 180); // deviation from south, 0..180
  const azLoss = ((1 - Math.cos((d * Math.PI) / 180)) / 2) * Math.min(1, tiltDeg / 30) * 0.35;
  const tiltLoss = Math.min(0.3, 0.00025 * (tiltDeg - ASSUMPTIONS.bestTiltDeg) ** 2);
  return (1 - azLoss) * (1 - tiltLoss);
}

export interface GenerationResult {
  annualUnits: number;
  monthlyUnits: number;
  factor: number;
  monthlySavingsPaise: number;
}

export function estimateGeneration(input: GenerationInput): GenerationResult {
  const factor =
    orientationFactor(input.azimuthDeg ?? 180, input.tiltDeg ?? ASSUMPTIONS.bestTiltDeg) * (1 - SHADING_LOSS[input.shading ?? 'none']);
  const annualUnits = Math.round(input.capacityKw * ASSUMPTIONS.specificYield * factor);
  const monthlyUnits = Math.round(annualUnits / 12);
  return {
    annualUnits,
    monthlyUnits,
    factor: Math.round(factor * 1000) / 1000,
    monthlySavingsPaise: Math.round(monthlyUnits * ASSUMPTIONS.tariffRupeesPerUnit * 100),
  };
}

export interface SubsidyScheme {
  enabled: boolean;
  slab1Kw: number;
  slab1PerKwPaise: number;
  slab2Kw: number;
  slab2PerKwPaise: number;
  capPaise: number;
}

/** PM Surya Ghar defaults (residential, on-grid only). Kept as data; editable per workspace. */
export const PM_SURYA_GHAR: SubsidyScheme = {
  enabled: true,
  slab1Kw: 2,
  slab1PerKwPaise: 30_000_00,
  slab2Kw: 3,
  slab2PerKwPaise: 18_000_00,
  capPaise: 78_000_00,
};

export function subsidyFor(
  capacityKw: number,
  kind: 'on_grid' | 'off_grid' | 'panel_set' | 'service',
  customerKind: 'home' | 'business',
  scheme: SubsidyScheme = PM_SURYA_GHAR,
): number {
  if (!scheme.enabled || kind !== 'on_grid' || customerKind !== 'home' || capacityKw <= 0) return 0;
  const first = Math.min(capacityKw, scheme.slab1Kw) * scheme.slab1PerKwPaise;
  const second = Math.max(0, Math.min(capacityKw, scheme.slab2Kw) - scheme.slab1Kw) * scheme.slab2PerKwPaise;
  return Math.min(scheme.capPaise, Math.round(first + second));
}

/** Simple payback in years (net of subsidy). */
export function paybackYears(totalPaise: number, subsidyPaise: number, monthlySavingsPaise: number): number | null {
  if (monthlySavingsPaise <= 0) return null;
  return Math.round(((totalPaise - subsidyPaise) / (monthlySavingsPaise * 12)) * 10) / 10;
}

/** ---------- Parts list (bill of materials) ---------- */

export type QtyRule = 'fixed' | 'per_kw' | 'per_panel' | 'cable_run';

export interface KitLineRule {
  productId: number;
  category: string;
  qtyRule: QtyRule;
  qty: number;
}

export interface BomLine {
  productId: number;
  qty: number;
  rule: QtyRule;
  explain: string;
}

export interface BomContext {
  capacityKw: number;
  cableDistanceM?: number | null;
}

/**
 * Expand a kit template into the exact parts list.
 * - fixed: qty as written
 * - per_kw: qty × system kW
 * - per_panel: qty × number of panels in the kit
 * - cable_run: qty conductors × measured cable distance × (1 + slack), rounded up to the metre
 */
export function expandKit(lines: KitLineRule[], ctx: BomContext): BomLine[] {
  const panels = lines.filter((l) => l.category === 'panel' && l.qtyRule === 'fixed').reduce((s, l) => s + l.qty, 0);
  const distance = ctx.cableDistanceM && ctx.cableDistanceM > 0 ? ctx.cableDistanceM : ASSUMPTIONS.defaultCableDistanceM;
  const measured = !!(ctx.cableDistanceM && ctx.cableDistanceM > 0);
  return lines.map((l) => {
    switch (l.qtyRule) {
      case 'fixed':
        return { productId: l.productId, qty: l.qty, rule: l.qtyRule, explain: 'Fixed for this kit' };
      case 'per_kw':
        return { productId: l.productId, qty: round3(l.qty * ctx.capacityKw), rule: l.qtyRule, explain: `${l.qty} per kW × ${ctx.capacityKw} kW` };
      case 'per_panel':
        return { productId: l.productId, qty: round3(l.qty * panels), rule: l.qtyRule, explain: `${l.qty} per panel × ${panels} panels` };
      case 'cable_run': {
        const m = Math.ceil(l.qty * distance * (1 + ASSUMPTIONS.cableSlack));
        return {
          productId: l.productId,
          qty: m,
          rule: l.qtyRule,
          explain: `${l.qty} × ${distance} m ${measured ? 'measured' : 'assumed'} run + ${Math.round(ASSUMPTIONS.cableSlack * 100)}% slack`,
        };
      }
    }
  });
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** Compass words for an azimuth (0 = north, 90 = east, 180 = south). */
export function compass(azimuthDeg: number | null | undefined): string {
  if (azimuthDeg === null || azimuthDeg === undefined) return '—';
  const names = ['North', 'North-east', 'East', 'South-east', 'South', 'South-west', 'West', 'North-west'];
  return names[Math.round((((azimuthDeg % 360) + 360) % 360) / 45) % 8]!;
}
