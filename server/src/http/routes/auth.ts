import { Router, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import {
  acceptInviteSchema,
  can,
  CAPABILITIES,
  changePasswordSchema,
  forgotSchema,
  loginSchema,
  profileSchema,
  resendSchema,
  resetSchema,
  signupSchema,
  verifyEmailSchema,
  type Capability,
  type Role,
} from '@arka/shared';
import { z } from 'zod';
import { config } from '../../config.js';
import { asSystem, checkout } from '../../db/pool.js';
import { createWorkspace } from '../../db/workspace.js';
import { createDemoWorkspace } from '../../db/demo.js';
import {
  codeError,
  createSession,
  destroySession,
  hashPassword,
  issueCode,
  maskEmail,
  peekLink,
  sendResetEmail,
  sendVerificationEmail,
  useCode,
  useLink,
  verifyPassword,
} from '../../domain/auth.js';
import { AppError, conflict, unauthorized } from '../../lib/errors.js';
import { cookieOptions, requireAuth, SESSION_COOKIE, zParse } from '../context.js';
import type pg from 'pg';

const limiter = (windowMin: number, max: number) =>
  rateLimit({ windowMs: windowMin * 60_000, limit: max, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: { code: 'rate_limited', message: 'Too many attempts. Wait a few minutes and try again.' } } });

/** Run fn in one system-scope transaction (auth flows look across workspaces). */
async function sys<T>(fn: (db: pg.PoolClient) => Promise<T>): Promise<T> {
  return asSystem(async () => {
    const db = await checkout();
    try {
      await db.query('BEGIN');
      const out = await fn(db);
      await db.query('COMMIT');
      return out;
    } catch (err) {
      await db.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      db.release();
    }
  });
}

function capabilities(role: Role): Capability[] {
  return (Object.keys(CAPABILITIES) as Capability[]).filter((c) => can(role, c));
}

async function startSession(req: Request, res: Response, user: { id: number; companyId: number }) {
  const previous = req.cookies?.[SESSION_COOKIE] as string | undefined;
  const t = await sys(async (db) => {
    // a new sign-in replaces whatever session this browser held
    if (previous) await destroySession(db, previous);
    return createSession(db, user, { ua: req.get('user-agent'), ip: req.ip }, new Date());
  });
  res.cookie(SESSION_COOKIE, t, cookieOptions());
}

const echo = (code?: string) => (config().OTP_DEV_ECHO && code ? { devCode: code } : {});

export function authRoutes(): Router {
  const r = Router();
  const authLimit = limiter(15, 40);
  const codeLimit = limiter(15, 15);

  r.get('/session', (req, res) => {
    const u = req.user;
    res.json({ user: u ? { ...u, capabilities: capabilities(u.role) } : null });
  });

  r.post('/signup', authLimit, async (req, res) => {
    const input = zParse(signupSchema, req.body);
    const now = new Date();
    const out = await sys(async (db) => {
      const taken = await db.query(`SELECT 1 FROM users WHERE email = $1`, [input.email]);
      if (taken.rowCount) throw new AppError(409, 'email_taken', 'An account with this email already exists. Sign in instead.', { email: 'Already registered' });
      const ws = await createWorkspace(db, { name: input.companyName, kind: 'real', now, owner: { name: input.name, email: input.email, phone: input.phone ?? null, password: input.password, verified: false } });
      await db.query(`UPDATE companies SET email = $2, phone = $3 WHERE id = $1`, [ws.companyId, input.email, input.phone ?? null]);
      const code = await issueCode(db, { id: ws.ownerId, companyId: ws.companyId }, 'verify_email', { now });
      return code;
    });
    await sendVerificationEmail(input.email, input.name, out.code!);
    res.status(201).json({ email: maskEmail(input.email), resendIn: out.resendIn, ...echo(out.code) });
  });

  r.post('/verify-email', codeLimit, async (req, res) => {
    const input = zParse(verifyEmailSchema, req.body);
    const now = new Date();
    // the attempt is committed first, then failure is reported, so wrong guesses always count
    const out = await sys(async (db) => {
      const u = await db.query<{ id: number; company_id: number; email_verified_at: Date | null }>(`SELECT id, company_id, email_verified_at FROM users WHERE email = $1`, [input.email]);
      const row = u.rows[0];
      if (!row) return { result: 'bad' as const };
      const result = await useCode(db, row.id, 'verify_email', input.code, now);
      if (result !== 'ok') return { result };
      await db.query(`UPDATE users SET email_verified_at = $2 WHERE id = $1`, [row.id, now]);
      return { result, user: { id: row.id, companyId: row.company_id } };
    });
    if (out.result !== 'ok') throw codeError(out.result);
    await startSession(req, res, out.user!);
    res.json({ ok: true });
  });

  r.post('/resend', codeLimit, async (req, res) => {
    const input = zParse(resendSchema, req.body);
    const out = await sys(async (db) => {
      const u = await db.query<{ id: number; company_id: number; name: string; email_verified_at: Date | null }>(`SELECT id, company_id, name, email_verified_at FROM users WHERE email = $1 AND status = 'active'`, [input.email]);
      const row = u.rows[0];
      if (!row || row.email_verified_at) return null;
      return { ...(await issueCode(db, { id: row.id, companyId: row.company_id }, 'verify_email', { now: new Date() })), name: row.name };
    });
    if (out?.code) await sendVerificationEmail(input.email, out.name, out.code);
    res.json({ email: maskEmail(input.email), resendIn: 60, ...echo(out?.code) });
  });

  // per account as well as per address: slows guessing spread across many IPs
  const perAccount = rateLimit({
    windowMs: 15 * 60_000,
    limit: 10,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req) => `login:${String((req.body as { email?: unknown })?.email ?? '').trim().toLowerCase().slice(0, 254)}`,
    skipSuccessfulRequests: true,
    message: { error: { code: 'rate_limited', message: 'Too many attempts for this account. Wait 15 minutes, or reset your password.' } },
  });
  r.post('/login', authLimit, perAccount, async (req, res) => {
    const input = zParse(loginSchema, req.body);
    const now = new Date();
    const found = await sys(async (db) => {
      const u = await db.query<{ id: number; company_id: number; name: string; password_hash: string | null; status: string; email_verified_at: Date | null }>(
        `SELECT id, company_id, name, password_hash, status, email_verified_at FROM users WHERE email = $1`,
        [input.email],
      );
      return u.rows[0] ?? null;
    });
    const ok = await verifyPassword(input.password, found?.password_hash);
    if (!found || !ok || found.status === 'invited') throw new AppError(401, 'bad_credentials', 'Incorrect email or password.');
    if (found.status === 'disabled') throw new AppError(403, 'disabled', 'This account is switched off. Ask your director to turn it back on.');
    if (!found.email_verified_at) {
      const issued = await sys((db) => issueCode(db, { id: found.id, companyId: found.company_id }, 'verify_email', { now }).catch((e: AppError) => (e.code === 'too_soon' ? null : Promise.reject(e))));
      if (issued?.code) await sendVerificationEmail(input.email, found.name, issued.code);
      throw new AppError(403, 'email_unverified', 'Confirm your email first. We sent a new code.', undefined, { email: maskEmail(input.email), resendIn: 60, ...echo(issued?.code) });
    }
    await startSession(req, res, { id: found.id, companyId: found.company_id });
    res.json({ ok: true });
  });

  r.post('/logout', async (req, res) => {
    const raw = req.cookies?.[SESSION_COOKIE] as string | undefined;
    if (raw) await sys((db) => destroySession(db, raw));
    res.clearCookie(SESSION_COOKIE, { ...cookieOptions(), maxAge: undefined });
    res.json({ ok: true });
  });

  r.post('/logout-all', requireAuth, async (req, res) => {
    await sys((db) => db.query(`DELETE FROM sessions WHERE user_id = $1`, [req.user!.id]));
    res.clearCookie(SESSION_COOKIE, { ...cookieOptions(), maxAge: undefined });
    res.json({ ok: true });
  });

  r.post('/forgot', codeLimit, async (req, res) => {
    const input = zParse(forgotSchema, req.body);
    const out = await sys(async (db) => {
      const u = await db.query<{ id: number; company_id: number; name: string }>(`SELECT id, company_id, name FROM users WHERE email = $1 AND status = 'active'`, [input.email]);
      const row = u.rows[0];
      if (!row) return null;
      const issued = await issueCode(db, { id: row.id, companyId: row.company_id }, 'reset_password', { now: new Date() }).catch((e: AppError) => (e.code === 'too_soon' ? null : Promise.reject(e)));
      return issued ? { ...issued, name: row.name } : null;
    });
    if (out?.code) await sendResetEmail(input.email, out.name, out.code);
    // same answer whether or not the account exists
    res.json({ email: maskEmail(input.email), resendIn: 60, ...echo(out?.code) });
  });

  r.post('/reset', codeLimit, async (req, res) => {
    const input = zParse(resetSchema, req.body);
    const now = new Date();
    const out = await sys(async (db) => {
      const u = await db.query<{ id: number; company_id: number }>(`SELECT id, company_id FROM users WHERE email = $1 AND status = 'active'`, [input.email]);
      const row = u.rows[0];
      if (!row) return { result: 'bad' as const };
      const result = await useCode(db, row.id, 'reset_password', input.code, now);
      if (result !== 'ok') return { result };
      await db.query(`UPDATE users SET password_hash = $2, email_verified_at = coalesce(email_verified_at, $3) WHERE id = $1`, [row.id, await hashPassword(input.password), now]);
      await db.query(`DELETE FROM sessions WHERE user_id = $1`, [row.id]);
      return { result, user: { id: row.id, companyId: row.company_id } };
    });
    if (out.result !== 'ok') throw codeError(out.result);
    await startSession(req, res, out.user!);
    res.json({ ok: true });
  });

  r.get('/invite/:token', async (req, res) => {
    const info = await sys((db) => peekLink(db, 'invite', String(req.params.token), new Date()));
    if (!info) throw new AppError(404, 'link_expired', 'This invitation has expired or was already used. Ask for a new one.');
    res.json({ name: info.name, email: maskEmail(info.email), company: info.company });
  });

  r.post('/invite/accept', authLimit, async (req, res) => {
    const input = zParse(acceptInviteSchema, req.body);
    const now = new Date();
    const user = await sys(async (db) => {
      const link = await useLink(db, 'invite', input.token, now);
      if (!link) throw new AppError(404, 'link_expired', 'This invitation has expired or was already used. Ask for a new one.');
      await db.query(`UPDATE users SET password_hash = $2, status = 'active', email_verified_at = $3 WHERE id = $1 AND status = 'invited'`, [link.userId, await hashPassword(input.password), now]);
      return { id: link.userId, companyId: link.companyId };
    });
    await startSession(req, res, user);
    res.json({ ok: true });
  });

  // One click: a private, fully populated SunPower workspace for 24 hours.
  r.post('/demo', limiter(60, 20), async (req, res) => {
    const ws = await createDemoWorkspace();
    await startSession(req, res, { id: ws.ownerId, companyId: ws.companyId });
    res.status(201).json({ ok: true });
  });

  /** In a demo, see the product as each role sees it. */
  r.get('/demo/people', requireAuth, async (req, res) => {
    if (req.user!.companyKind !== 'demo') throw conflict('not_demo', 'Only demo workspaces can switch people.');
    const rows = await sys((db) =>
      db.query(
        `SELECT DISTINCT ON (role) id, name, role FROM users WHERE company_id = $1 AND status = 'active' ORDER BY role, id`,
        [req.user!.companyId],
      ),
    );
    res.json({ people: rows.rows });
  });

  r.post('/demo/switch', requireAuth, async (req, res) => {
    if (req.user!.companyKind !== 'demo') throw conflict('not_demo', 'Only demo workspaces can switch people.');
    const { userId } = zParse(z.object({ userId: z.number().int().positive() }), req.body);
    const target = await sys((db) => db.query<{ id: number }>(`SELECT id FROM users WHERE id = $1 AND company_id = $2 AND status = 'active'`, [userId, req.user!.companyId]));
    if (!target.rows[0]) throw unauthorized('That person isn’t in this demo.');
    const raw = req.cookies?.[SESSION_COOKIE] as string | undefined;
    if (raw) await sys((db) => destroySession(db, raw));
    await startSession(req, res, { id: userId, companyId: req.user!.companyId });
    res.json({ ok: true });
  });

  r.patch('/me', requireAuth, async (req, res) => {
    const input = zParse(profileSchema, req.body);
    await sys((db) => db.query(`UPDATE users SET name = $2, phone = $3 WHERE id = $1`, [req.user!.id, input.name, input.phone ?? null]));
    res.json({ ok: true });
  });

  r.post('/password', requireAuth, authLimit, async (req, res) => {
    const input = zParse(changePasswordSchema, req.body);
    await sys(async (db) => {
      const u = await db.query<{ password_hash: string }>(`SELECT password_hash FROM users WHERE id = $1`, [req.user!.id]);
      if (!(await verifyPassword(input.currentPassword, u.rows[0]?.password_hash))) throw new AppError(400, 'bad_password', 'Your current password isn’t right.', { currentPassword: 'Check it' });
      await db.query(`UPDATE users SET password_hash = $2 WHERE id = $1`, [req.user!.id, await hashPassword(input.password)]);
      // sign out every other device
      const raw = req.cookies?.[SESSION_COOKIE] as string | undefined;
      await db.query(`DELETE FROM sessions WHERE user_id = $1 AND token_hash <> sha256(convert_to($2, 'UTF8'))`, [req.user!.id, raw ?? '']);
    });
    res.json({ ok: true });
  });

  return r;
}
