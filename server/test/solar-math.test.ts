import { describe, expect, it } from 'vitest';
import {
  expandKit,
  estimateGeneration,
  formatINR,
  formatINRShort,
  orientationFactor,
  periodRange,
  phone,
  recommendSize,
  rupeesToPaise,
  subsidyFor,
  financialYear,
  vehicleNo,
} from '@arka/shared';

describe('money', () => {
  it('formats Indian rupees with lakh grouping', () => {
    expect(formatINR(1_50_000_00)).toBe('₹1,50,000');
    expect(formatINR(-2_500_00)).toBe('−₹2,500');
    expect(formatINRShort(2_34_00_000_00)).toBe('₹2.34 Cr');
    expect(formatINRShort(1_50_000_00)).toBe('₹1.5 L');
  });
  it('parses typed rupees without float errors', () => {
    expect(rupeesToPaise('1,50,000.50')).toBe(15_000_050);
    expect(rupeesToPaise('0.10')).toBe(10);
    expect(rupeesToPaise('12.345')).toBeNull();
    expect(rupeesToPaise('abc')).toBeNull();
  });
});

describe('sizing, generation and subsidy', () => {
  it('sizes from the bill, capped by shadow-free roof', () => {
    expect(recommendSize({ monthlyBillPaise: 3200_00, roofAreaSqft: 450 }).recommendedKw).toBe(4);
    expect(recommendSize({ monthlyBillPaise: 6000_00, roofAreaSqft: 250 }).recommendedKw).toBe(2);
    expect(recommendSize({ monthlyBillPaise: 3000_00, roofAreaSqft: 60 }).verdict).toBe('not_suitable');
  });
  it('south at the best tilt is the best orientation', () => {
    expect(orientationFactor(180, 20)).toBeCloseTo(1, 5);
    expect(orientationFactor(90, 20)).toBeLessThan(orientationFactor(180, 20));
    expect(orientationFactor(0, 30)).toBeLessThan(orientationFactor(90, 30));
    const g = estimateGeneration({ capacityKw: 3, azimuthDeg: 180, tiltDeg: 20 });
    expect(g.monthlyUnits).toBe(360);
  });
  it('PM Surya Ghar: 30k/kW up to 2 kW, 18k for the 3rd, capped at 78k; on-grid homes only', () => {
    expect(subsidyFor(1, 'on_grid', 'home')).toBe(30_000_00);
    expect(subsidyFor(2, 'on_grid', 'home')).toBe(60_000_00);
    expect(subsidyFor(3, 'on_grid', 'home')).toBe(78_000_00);
    expect(subsidyFor(5, 'on_grid', 'home')).toBe(78_000_00);
    expect(subsidyFor(3, 'off_grid', 'home')).toBe(0);
    expect(subsidyFor(3, 'on_grid', 'business')).toBe(0);
  });
});

describe('the parts list follows on its own', () => {
  const lines = [
    { productId: 1, category: 'panel', qtyRule: 'fixed' as const, qty: 6 },
    { productId: 2, category: 'structure', qtyRule: 'per_panel' as const, qty: 1 },
    { productId: 3, category: 'cable', qtyRule: 'cable_run' as const, qty: 2 },
    { productId: 4, category: 'service', qtyRule: 'per_kw' as const, qty: 1 },
  ];
  it('uses panel count, kW and the measured cable run', () => {
    const bom = expandKit(lines, { capacityKw: 3, cableDistanceM: 20 });
    expect(bom.map((b) => b.qty)).toEqual([6, 6, 44, 3]);
    expect(bom[2]!.explain).toContain('measured');
  });
  it('assumes 15 m before a survey measures it', () => {
    expect(expandKit(lines, { capacityKw: 3 })[2]!.qty).toBe(33);
  });
});

describe('dates in the company time zone', () => {
  it('“today” in India starts at 00:00 IST', () => {
    const r = periodRange('today', new Date('2026-11-20T19:00:00Z'), 'Asia/Kolkata'); // 00:30 IST on the 21st
    expect(r.from).toBe('2026-11-21');
    expect(r.fromUtc.toISOString()).toBe('2026-11-20T18:30:00.000Z');
  });
  it('weeks start on Monday, months on the 1st', () => {
    expect(periodRange('week', new Date('2026-11-21T06:00:00Z'), 'Asia/Kolkata').from).toBe('2026-11-16');
    expect(periodRange('month', new Date('2026-11-21T06:00:00Z'), 'Asia/Kolkata').from).toBe('2026-11-01');
  });
  it('financial year labels for invoice numbers', () => {
    expect(financialYear('2026-11-21')).toBe('26-27');
    expect(financialYear('2027-03-31')).toBe('26-27');
    expect(financialYear('2027-04-01')).toBe('27-28');
  });
});

describe('input rules', () => {
  it('normalises Indian mobile numbers', () => {
    expect(phone.parse('98250 12345')).toBe('+919825012345');
    expect(phone.parse('+91-98250-12345')).toBe('+919825012345');
    expect(phone.parse('09825012345')).toBe('+919825012345');
    expect(phone.safeParse('5825012345').success).toBe(false);
    expect(phone.safeParse('98250').success).toBe(false);
  });
  it('normalises vehicle numbers', () => {
    expect(vehicleNo.parse('gj 01 ab 1234')).toBe('GJ01AB1234');
    expect(vehicleNo.parse('22BH1234AA')).toBe('22BH1234AA');
    expect(vehicleNo.safeParse('HELLO').success).toBe(false);
  });
});
