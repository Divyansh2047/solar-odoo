import type { NextFunction, Request, Response } from 'express';
import { can, type Capability, type Role } from '@arka/shared';
import type { z } from 'zod';
import type pg from 'pg';
import { config } from '../config.js';
import { asCompany, asSystem, checkout, query, tx } from '../db/pool.js';
import type { Ctx } from '../domain/context.js';
import { sessionUser, type SessionUser } from '../domain/auth.js';
import { AppError, forbidden, fromPg, unauthorized } from '../lib/errors.js';
import { log } from '../lib/log.js';

export const SESSION_COOKIE = 'arka_session';

declare module 'express-serve-static-core' {
  interface Request {
    user?: SessionUser;
  }
}

export function cookieOptions() {
  return { httpOnly: true, sameSite: 'lax' as const, secure: config().cookieSecure, path: '/', maxAge: 14 * 86_400_000 };
}

/** Attach the signed-in person (if any). Never fails the request. */
export async function loadSession(req: Request, _res: Response, next: NextFunction) {
  const raw = req.cookies?.[SESSION_COOKIE] as string | undefined;
  if (raw && raw.length >= 20 && raw.length <= 100) {
    try {
      const user = await asSystem(async () => {
        const c = await checkout();
        try {
          return await sessionUser(c, raw);
        } finally {
          c.release();
        }
      });
      if (user) req.user = user;
    } catch (err) {
      log.warn({ err }, 'session lookup failed');
    }
  }
  next();
}

/** Everything after this runs inside the person's workspace: RLS sees only its rows. */
export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(unauthorized());
  asCompany(req.user.companyId, () => next());
}

export function ctxFor(req: Request): Ctx {
  const u = req.user!;
  return { companyId: u.companyId, userId: u.id, role: u.role, tz: u.timezone, now: new Date(), isDemo: u.companyKind === 'demo' };
}

export function zParse<T extends z.ZodType>(schema: T, data: unknown): z.output<T> {
  const r = schema.safeParse(data);
  if (r.success) return r.data;
  const fields: Record<string, string> = {};
  for (const i of r.error.issues) {
    const key = i.path.join('.') || '_';
    if (!fields[key]) fields[key] = i.message;
  }
  const first = Object.values(fields)[0] ?? 'Check the highlighted fields.';
  throw new AppError(400, 'invalid', Object.keys(fields).length > 1 ? 'Some fields need attention.' : first, fields);
}

type Handler<I> = (input: I, db: pg.PoolClient, ctx: Ctx, req: Request, res: Response) => Promise<unknown>;

/** A write: capability check → validation → one transaction → JSON. */
export function act<T extends z.ZodType>(cap: Capability | null, schema: T | null, fn: Handler<z.output<T>>) {
  return async (req: Request, res: Response) => {
    if (cap && !can(req.user?.role as Role, cap)) throw forbidden();
    const input = schema ? zParse(schema, req.body) : (undefined as z.output<T>);
    const ctx: Ctx = { ...ctxFor(req), outbox: [] };
    const out = await tx((db) => fn(input, db, ctx, req, res));
    // committed: now send emails and other side effects, without holding a connection
    for (const job of ctx.outbox!) void job().catch((err) => log.warn({ err }, 'after-commit task failed'));
    if (!res.headersSent) res.json(out ?? { ok: true });
  };
}

/** A read: capability check → scoped queries → JSON. */
export function read(cap: Capability | null, fn: (req: Request, ctx: Ctx, res: Response) => Promise<unknown>) {
  return async (req: Request, res: Response) => {
    if (cap && !can(req.user?.role as Role, cap)) throw forbidden();
    const out = await fn(req, ctxFor(req), res);
    if (!res.headersSent) res.json(out);
  };
}

/** Who may hold customer-facing links (customer page, quote and invoice links). */
export const canShareLinks = (role: string) => ['owner', 'sales', 'support', 'accounts'].includes(role);
/** Who may see purchase costs and margins. */
export const seesCosts = (role: string) => ['owner', 'warehouse', 'accounts'].includes(role);

export const idParam = (req: Request, name = 'id'): number => {
  const v = Number(req.params[name]);
  if (!Number.isInteger(v) || v <= 0 || v > 9_007_199_254_740_991) throw new AppError(404, 'not_found', 'That record doesn’t exist.');
  return v;
};

export { query };

/** A scoped client for reads that call domain helpers taking a Db. */
export async function withDb<T>(fn: (db: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await checkout();
  try {
    return await fn(c);
  } finally {
    c.release();
  }
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  let e: AppError | null = err instanceof AppError ? err : fromPg(err);
  const body = err as { type?: string; status?: number };
  if (!e && body?.type === 'entity.parse.failed') e = new AppError(400, 'bad_json', 'The request body isn’t valid JSON.');
  if (!e && body?.type === 'entity.too.large') e = new AppError(413, 'too_large', 'That request is too large.');
  if (!e) {
    log.error({ err, path: req.path }, 'unhandled error');
    e = new AppError(500, 'server_error', 'Something went wrong on our side. Try again; if it keeps happening, tell us what you were doing.');
  }
  if (e.status >= 500 && !(err instanceof AppError)) log.error({ err }, 'server error');
  res.status(e.status).json({ error: { code: e.code, message: e.message, fields: e.fields, ...e.data } });
}
