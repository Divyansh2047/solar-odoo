import type { Db } from '../db/pool.js';
import { notFound } from '../lib/errors.js';

export async function one<T extends Record<string, unknown>>(db: Db, sql: string, params: unknown[] = [], what?: string): Promise<T> {
  const r = await db.query<T>(sql, params);
  if (!r.rows[0]) throw notFound(what);
  return r.rows[0];
}

export async function maybe<T extends Record<string, unknown>>(db: Db, sql: string, params: unknown[] = []): Promise<T | null> {
  const r = await db.query<T>(sql, params);
  return r.rows[0] ?? null;
}

export async function many<T extends Record<string, unknown>>(db: Db, sql: string, params: unknown[] = []): Promise<T[]> {
  const r = await db.query<T>(sql, params);
  return r.rows;
}

/** Quantities compared in thousandths so 0.1 + 0.2 never matters. */
export const q1000 = (n: number) => Math.round(n * 1000);
export const qtyEq = (a: number, b: number) => q1000(a) === q1000(b);
export const qtyGte = (a: number, b: number) => q1000(a) >= q1000(b);

export function addMonthsIso(isoDate: string, months: number): string {
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  t.setUTCDate(Math.min(d, last));
  return t.toISOString().slice(0, 10);
}
