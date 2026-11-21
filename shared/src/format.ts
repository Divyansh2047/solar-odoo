/** Display helpers shared by the app, the customer page and printed documents. */

export const DEFAULT_TZ = 'Asia/Kolkata';

const dateFmt = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string, opts: Intl.DateTimeFormatOptions, key: string) {
  const k = `${tz}|${key}`;
  let f = dateFmt.get(k);
  if (!f) {
    f = new Intl.DateTimeFormat('en-IN', { timeZone: tz, ...opts });
    dateFmt.set(k, f);
  }
  return f;
}

/** 12 Mar 2028 */
export function formatDate(value: string | Date | null | undefined, tz = DEFAULT_TZ): string {
  if (!value) return '—';
  const d = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00Z`) : new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return fmt(tz, { day: 'numeric', month: 'short', year: 'numeric' }, 'd').format(d);
}

/** 12 Mar, 14:30 */
export function formatDateTime(value: string | Date | null | undefined, tz = DEFAULT_TZ): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return fmt(tz, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }, 'dt').format(d);
}

export function formatTime(value: string | Date | null | undefined, tz = DEFAULT_TZ): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return fmt(tz, { hour: '2-digit', minute: '2-digit', hour12: false }, 't').format(d);
}

/** "3 h ago", "in 2 days" */
export function relativeTime(value: string | Date | null | undefined, now = new Date()): string {
  if (!value) return '—';
  const d = new Date(value).getTime();
  const diff = d - now.getTime();
  const abs = Math.abs(diff);
  const min = 60_000, hour = 60 * min, day = 24 * hour;
  let s: string;
  if (abs < min) return 'just now';
  if (abs < hour) s = `${Math.round(abs / min)} min`;
  else if (abs < day) s = `${Math.round(abs / hour)} h`;
  else if (abs < 30 * day) s = `${Math.round(abs / day)} day${Math.round(abs / day) === 1 ? '' : 's'}`;
  else if (abs < 365 * day) s = `${Math.round(abs / (30 * day))} mo`;
  else s = `${(abs / (365 * day)).toFixed(1).replace(/\.0$/, '')} yr`;
  return diff < 0 ? `${s} ago` : `in ${s}`;
}

export function formatKw(kw: number | string | null | undefined): string {
  if (kw === null || kw === undefined || kw === '') return '—';
  const n = Number(kw);
  return `${Number.isInteger(n) ? n : n.toFixed(1)} kW`;
}

export function formatQty(qty: number | string, uom?: string): string {
  const n = Number(qty);
  const s = Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/\.?0+$/, '');
  if (!uom || uom === 'unit') return s;
  return `${s} ${uom}`;
}

/** +91 98250 12345 */
export function formatPhone(phone: string | null | undefined): string {
  if (!phone) return '—';
  const m = /^\+91(\d{5})(\d{5})$/.exec(phone);
  return m ? `+91 ${m[1]} ${m[2]}` : phone;
}

/** Remaining warranty in words: "1 yr 4 mo left", "Expired 3 mo ago". */
export function warrantyLeft(endIso: string | null | undefined, todayIso: string): string {
  if (!endIso) return 'Not started';
  const end = new Date(`${endIso}T00:00:00Z`).getTime();
  const today = new Date(`${todayIso}T00:00:00Z`).getTime();
  const days = Math.round((end - today) / 86_400_000);
  const words = (d: number) => {
    const y = Math.floor(d / 365);
    const m = Math.floor((d % 365) / 30);
    if (y && m) return `${y} yr ${m} mo`;
    if (y) return `${y} yr`;
    if (m) return `${m} mo`;
    return `${d} day${d === 1 ? '' : 's'}`;
  };
  if (days >= 0) return `${words(days)} left`;
  return `Expired ${words(-days)} ago`;
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** A share of revenue, one decimal, with a true minus sign (−1.2%) to match the money columns. */
export function formatPercent(part: number, whole: number): string {
  if (!whole) return '0%';
  const v = Math.round((part / whole) * 1000) / 10;
  return `${v < 0 ? '−' : ''}${Math.abs(v)}%`;
}
