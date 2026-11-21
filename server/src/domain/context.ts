import { isoDateInTz, type Role } from '@arka/shared';
import type { Db } from '../db/pool.js';

/** Who is acting, in which workspace, and what "today" means for them. */
export interface Ctx {
  companyId: number;
  userId: number | null;
  role: Role | 'system' | 'customer';
  tz: string;
  now: Date;
  isDemo: boolean;
  /** Side effects (emails) to run only after the transaction commits. */
  outbox?: (() => Promise<unknown>)[];
}

/**
 * Run a side effect after COMMIT: never email about something that rolled back, and never hold a
 * database connection while a mail server answers. Without an outbox it runs in the background now.
 */
export function afterCommit(ctx: Ctx, fn: () => Promise<unknown>): void {
  if (ctx.outbox) ctx.outbox.push(fn);
  else void fn().catch(() => {});
}

export const today = (ctx: Ctx) => isoDateInTz(ctx.now, ctx.tz);

/** Next human reference: ENQ-0001, JOB-0042, INV/26-27/0007. Atomic under concurrency. */
export async function nextRef(db: Db, key: string, pad = 4): Promise<string> {
  const r = await db.query<{ v: number }>(
    `INSERT INTO sequences (company_id, key, last_value) VALUES (app_company(), $1, 1)
     ON CONFLICT (company_id, key) DO UPDATE SET last_value = sequences.last_value + 1
     RETURNING last_value AS v`,
    [key],
  );
  const n = String(r.rows[0]!.v).padStart(pad, '0');
  return key.includes('/') ? `${key}/${n}` : `${key}-${n}`;
}

export async function logActivity(
  db: Db,
  ctx: Ctx,
  a: { customerId: number; leadId?: number | null; jobId?: number | null; ticketId?: number | null; kind?: 'note' | 'call' | 'whatsapp' | 'system'; body: string },
): Promise<void> {
  await db.query(
    `INSERT INTO activities (customer_id, lead_id, job_id, ticket_id, kind, body, actor_id) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [a.customerId, a.leadId ?? null, a.jobId ?? null, a.ticketId ?? null, a.kind ?? 'system', a.body, ctx.userId],
  );
}

/** Notify everyone active in the given roles (directors always included). */
export async function notifyRoles(db: Db, roles: Role[], n: { title: string; body?: string; link?: string }, exceptUserId?: number | null): Promise<void> {
  await db.query(
    `INSERT INTO notifications (user_id, title, body, link)
     SELECT id, $2, $3, $4 FROM users WHERE status = 'active' AND (role = ANY($1::text[]) OR role = 'owner') AND id IS DISTINCT FROM $5`,
    [roles, n.title, n.body ?? null, n.link ?? null, exceptUserId ?? null],
  );
}

export async function notifyUser(db: Db, userId: number, n: { title: string; body?: string; link?: string }): Promise<void> {
  await db.query(`INSERT INTO notifications (user_id, title, body, link) VALUES ($1, $2, $3, $4)`, [userId, n.title, n.body ?? null, n.link ?? null]);
}

export async function audit(db: Db, ctx: Ctx, action: string, entity: string, entityId: number | null, detail?: unknown): Promise<void> {
  await db.query(`INSERT INTO audit_log (actor_id, action, entity, entity_id, detail) VALUES ($1, $2, $3, $4, $5)`, [
    ctx.userId,
    action,
    entity,
    entityId,
    detail === undefined ? null : JSON.stringify(detail),
  ]);
}
