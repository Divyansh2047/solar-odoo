/** Money is always integer paise. Never floats in storage or arithmetic. */

const inr = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const inr2 = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** ₹1,50,000 (rounded to rupees). */
export function formatINR(paise: number, opts: { paise?: boolean; sign?: boolean } = {}): string {
  const neg = paise < 0;
  const abs = Math.abs(paise);
  const body = opts.paise ? inr2.format(abs / 100) : inr.format(Math.round(abs / 100));
  const sign = neg ? '−' : opts.sign && paise > 0 ? '+' : '';
  return `${sign}₹${body}`;
}

/** Short Indian form: ₹1.5 L, ₹2.3 Cr, ₹45 K. */
export function formatINRShort(paise: number): string {
  const neg = paise < 0;
  const r = Math.abs(paise) / 100;
  let s: string;
  if (r >= 1e7) s = `${trim(r / 1e7)} Cr`;
  else if (r >= 1e5) s = `${trim(r / 1e5)} L`;
  else if (r >= 1e3) s = `${trim(r / 1e3)} K`;
  else s = inr.format(Math.round(r));
  return `${neg ? '−' : ''}₹${s}`;
}

function trim(n: number): string {
  return n >= 100 ? String(Math.round(n)) : n.toFixed(n >= 10 ? 1 : 2).replace(/\.?0+$/, '');
}

/**
 * Parse a rupee amount typed by a person ("1,50,000", "1500.5", "₹ 99.99") into paise.
 * String based, so 0.1 + 0.2 problems can't happen. Returns null when not a valid amount.
 */
export function rupeesToPaise(input: string | number): number | null {
  const s = String(input).replace(/[₹,\s]/g, '');
  if (!/^\d{1,11}(\.\d{1,2})?$/.test(s)) return null;
  const [whole, frac = ''] = s.split('.');
  return Number(whole) * 100 + Number((frac + '00').slice(0, 2));
}

export function paiseToRupeesString(paise: number): string {
  const neg = paise < 0;
  const abs = Math.abs(paise);
  const r = Math.floor(abs / 100);
  const p = abs % 100;
  return `${neg ? '-' : ''}${r}${p ? '.' + String(p).padStart(2, '0') : ''}`;
}

/** GST in basis points (500 = 5%). Rounded half-up to the paisa. */
export function taxOn(amountPaise: number, rateBp: number): number {
  return Math.round((amountPaise * rateBp) / 10_000);
}

/** qty can have up to 3 decimals (cable metres). Line total in paise, rounded to the paisa. */
export function lineAmount(qty: number, unitPaise: number): number {
  return Math.round((Math.round(qty * 1000) * unitPaise) / 1000);
}

export function percent(part: number, whole: number): number {
  if (!whole) return 0;
  return Math.round((part / whole) * 1000) / 10;
}
