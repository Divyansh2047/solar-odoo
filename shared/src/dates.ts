/**
 * Calendar maths in the company's time zone. "Today" for an Indian installer starts at
 * 00:00 IST, not 00:00 UTC. All functions return plain ISO dates (YYYY-MM-DD) or UTC instants.
 */

export type Period = 'today' | 'week' | 'month';

/** YYYY-MM-DD of an instant in a time zone. */
export function isoDateInTz(instant: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(instant);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Offset of tz from UTC at an instant, in minutes (IST = +330). */
export function tzOffsetMinutes(instant: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return Math.round((asUtc - instant.getTime()) / 60_000);
}

/** The UTC instant of local midnight at the start of an ISO date in tz. */
export function startOfDayUtc(isoDate: string, tz: string): Date {
  const guess = new Date(`${isoDate}T00:00:00Z`);
  const off = tzOffsetMinutes(guess, tz);
  const first = new Date(guess.getTime() - off * 60_000);
  // Re-check once around DST transitions (not relevant for IST, kept for correctness elsewhere).
  const off2 = tzOffsetMinutes(first, tz);
  return off2 === off ? first : new Date(guess.getTime() - off2 * 60_000);
}

export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function addMonths(isoDate: string, months: number): string {
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number];
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

/** Monday of the ISO week containing isoDate. */
export function startOfWeek(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
  return addDays(isoDate, -dow);
}

export function startOfMonth(isoDate: string): string {
  return `${isoDate.slice(0, 7)}-01`;
}

export interface PeriodRange {
  period: Period;
  /** inclusive local start date */
  from: string;
  /** exclusive local end date */
  to: string;
  fromUtc: Date;
  toUtc: Date;
  label: string;
}

export function periodRange(period: Period, now: Date, tz: string): PeriodRange {
  const today = isoDateInTz(now, tz);
  let from: string, to: string, label: string;
  if (period === 'today') {
    from = today;
    to = addDays(today, 1);
    label = 'Today';
  } else if (period === 'week') {
    from = startOfWeek(today);
    to = addDays(from, 7);
    label = 'This week';
  } else {
    from = startOfMonth(today);
    to = addMonths(from, 1);
    label = 'This month';
  }
  return { period, from, to, fromUtc: startOfDayUtc(from, tz), toUtc: startOfDayUtc(to, tz), label };
}

/** Indian financial year label for a date: 2026-11-21 → "26-27"; 2027-02-01 → "26-27". */
export function financialYear(isoDate: string): string {
  const y = Number(isoDate.slice(0, 4));
  const m = Number(isoDate.slice(5, 7));
  const start = m >= 4 ? y : y - 1;
  return `${String(start).slice(2)}-${String(start + 1).slice(2)}`;
}

export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((new Date(`${toIso}T00:00:00Z`).getTime() - new Date(`${fromIso}T00:00:00Z`).getTime()) / 86_400_000);
}
