import type { Role } from '@arka/shared';
import { config } from '../config.js';
import type { Db } from '../db/pool.js';
import { hashPassword, hmac, safeEqualHex, sha256, sixDigitCode, token, verifyPassword } from '../lib/crypto.js';
import { AppError, conflict } from '../lib/errors.js';
import { sendMail } from '../lib/mailer.js';
import { maybe, one } from './util.js';

export const SESSION_DAYS = 14;
const CODE_MINUTES = 10;
const CODE_ATTEMPTS = 5;
const RESEND_SECONDS = 60;
const INVITE_HOURS = 72;

export interface SessionUser {
  id: number;
  companyId: number;
  name: string;
  email: string;
  role: Role;
  companyName: string;
  companyKind: 'real' | 'demo';
  timezone: string;
  verified: boolean;
}

export function maskEmail(email: string): string {
  const [user = '', domain = ''] = email.split('@');
  return `${user[0] ?? ''}${'•'.repeat(Math.max(1, Math.min(6, user.length - 2)))}${user.length > 1 ? user[user.length - 1] : ''}@${domain}`;
}

export async function createSession(db: Db, user: { id: number; companyId: number }, meta: { ua?: string | undefined; ip?: string | undefined }, now: Date): Promise<string> {
  const t = token(32);
  await db.query(
    `INSERT INTO sessions (company_id, user_id, token_hash, created_at, last_seen_at, expires_at, user_agent, ip) VALUES ($1, $2, $3, $4, $4, $5, $6, $7)`,
    [user.companyId, user.id, sha256(t), now, new Date(now.getTime() + SESSION_DAYS * 86_400_000), meta.ua?.slice(0, 200) ?? null, meta.ip ?? null],
  );
  return t;
}

/** Look up a session token (system scope). Slides the expiry at most once an hour. */
export async function sessionUser(db: Db, rawToken: string): Promise<SessionUser | null> {
  const r = await maybe<{
    sid: number;
    last_seen_at: Date;
    id: number;
    company_id: number;
    name: string;
    email: string;
    role: Role;
    status: string;
    email_verified_at: Date | null;
    company_name: string;
    kind: 'real' | 'demo';
    timezone: string;
  }>(
    db,
    `SELECT s.id AS sid, s.last_seen_at, u.id, u.company_id, u.name, u.email, u.role, u.status, u.email_verified_at, c.name AS company_name, c.kind, c.timezone
       FROM sessions s JOIN users u ON u.id = s.user_id JOIN companies c ON c.id = s.company_id
      WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [sha256(rawToken)],
  );
  if (!r || r.status !== 'active' || !r.email_verified_at) return null;
  if (Date.now() - r.last_seen_at.getTime() > 3600_000) {
    await db.query(`UPDATE sessions SET last_seen_at = now(), expires_at = now() + make_interval(days => $2) WHERE id = $1`, [r.sid, SESSION_DAYS]);
  }
  return {
    id: r.id,
    companyId: r.company_id,
    name: r.name,
    email: r.email,
    role: r.role,
    companyName: r.company_name,
    companyKind: r.kind,
    timezone: r.timezone,
    verified: true,
  };
}

export async function destroySession(db: Db, rawToken: string): Promise<void> {
  await db.query(`DELETE FROM sessions WHERE token_hash = $1`, [sha256(rawToken)]);
}

/* ---------------------------------------------------------------- codes */

export interface IssuedCode {
  code?: string;
  link?: string;
  resendIn: number;
}

/** Issue a code (and optional link token). Older unused codes for the same purpose stop working. */
export async function issueCode(
  db: Db,
  user: { id: number; companyId: number },
  purpose: 'verify_email' | 'reset_password' | 'invite',
  opts: { withCode?: boolean; withLink?: boolean; now: Date; ttlMinutes?: number },
): Promise<IssuedCode> {
  const last = await maybe<{ created_at: Date }>(
    db,
    `SELECT created_at FROM auth_codes WHERE user_id = $1 AND purpose = $2 ORDER BY created_at DESC LIMIT 1`,
    [user.id, purpose],
  );
  if (last && purpose !== 'invite') {
    const wait = RESEND_SECONDS - Math.floor((opts.now.getTime() - last.created_at.getTime()) / 1000);
    if (wait > 0) throw new AppError(429, 'too_soon', `Please wait ${wait} seconds before asking for another code.`, undefined, { resendIn: wait });
  }
  await db.query(`UPDATE auth_codes SET used_at = $3 WHERE user_id = $1 AND purpose = $2 AND used_at IS NULL`, [user.id, purpose, opts.now]);
  const code = opts.withCode === false ? undefined : sixDigitCode();
  const link = opts.withLink ? token(32) : undefined;
  const ttl = opts.ttlMinutes ?? CODE_MINUTES;
  await db.query(
    `INSERT INTO auth_codes (company_id, user_id, purpose, code_hash, link_hash, expires_at, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      user.companyId,
      user.id,
      purpose,
      code ? hmac(`${purpose}:${user.id}:code`, code) : null,
      link ? hmac(`${purpose}:link`, link) : null,
      new Date(opts.now.getTime() + ttl * 60_000),
      opts.now,
    ],
  );
  return { code, link, resendIn: RESEND_SECONDS };
}

/**
 * Check a code with attempt limits and constant-time comparison. Marks it used on success.
 * Never throws: the caller must COMMIT (so a wrong attempt is counted) before reporting failure.
 */
export async function useCode(db: Db, userId: number, purpose: 'verify_email' | 'reset_password', code: string, now: Date): Promise<'ok' | 'bad' | 'locked'> {
  const row = await maybe<{ id: number; code_hash: string | null; attempts: number; expires_at: Date }>(
    db,
    `SELECT id, code_hash, attempts, expires_at FROM auth_codes WHERE user_id = $1 AND purpose = $2 AND used_at IS NULL ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
    [userId, purpose],
  );
  if (!row || !row.code_hash || row.expires_at <= now) return 'bad';
  if (row.attempts >= CODE_ATTEMPTS) return 'locked';
  const ok = safeEqualHex(row.code_hash, hmac(`${purpose}:${userId}:code`, code));
  if (!ok) {
    await db.query(`UPDATE auth_codes SET attempts = attempts + 1 WHERE id = $1`, [row.id]);
    return row.attempts + 1 >= CODE_ATTEMPTS ? 'locked' : 'bad';
  }
  await db.query(`UPDATE auth_codes SET used_at = $2 WHERE id = $1`, [row.id, now]);
  return 'ok';
}

export function codeError(result: 'bad' | 'locked'): AppError {
  return result === 'locked'
    ? new AppError(429, 'too_many_attempts', 'Too many wrong codes. Ask for a new code.')
    : new AppError(400, 'bad_code', 'That code isn’t right or has expired.', { code: 'Check the code' });
}

export async function useLink(db: Db, purpose: 'invite' | 'reset_password', linkToken: string, now: Date): Promise<{ userId: number; companyId: number } | null> {
  const row = await maybe<{ id: number; user_id: number; company_id: number; expires_at: Date; used_at: Date | null }>(
    db,
    `SELECT id, user_id, company_id, expires_at, used_at FROM auth_codes WHERE link_hash = $1 AND purpose = $2 FOR UPDATE`,
    [hmac(`${purpose}:link`, linkToken), purpose],
  );
  if (!row || row.used_at || row.expires_at <= now) return null;
  await db.query(`UPDATE auth_codes SET used_at = $2 WHERE id = $1`, [row.id, now]);
  return { userId: row.user_id, companyId: row.company_id };
}

export async function peekLink(db: Db, purpose: 'invite', linkToken: string, now: Date) {
  return maybe<{ name: string; email: string; company: string }>(
    db,
    `SELECT u.name, u.email, c.name AS company FROM auth_codes a JOIN users u ON u.id = a.user_id JOIN companies c ON c.id = a.company_id
      WHERE a.link_hash = $1 AND a.purpose = $2 AND a.used_at IS NULL AND a.expires_at > $3`,
    [hmac(`${purpose}:link`, linkToken), purpose, now],
  );
}

/* ---------------------------------------------------------------- emails */

export async function sendVerificationEmail(to: string, name: string, code: string): Promise<void> {
  await sendMail({
    to,
    subject: `${code} is your Arka verification code`,
    lines: [`Hello ${name.split(' ')[0]},`, 'Use this code to confirm your email address. It expires in 10 minutes.'],
    code,
  });
}

export async function sendResetEmail(to: string, name: string, code: string): Promise<void> {
  await sendMail({
    to,
    subject: `${code} is your Arka password reset code`,
    lines: [`Hello ${name.split(' ')[0]},`, 'Someone asked to reset your Arka password. Use this code within 10 minutes. If it wasn’t you, ignore this email; your password stays the same.'],
    code,
  });
}

export async function sendInviteEmail(to: string, name: string, company: string, inviter: string, link: string, demo: boolean): Promise<void> {
  await sendMail(
    {
      to,
      subject: `${inviter} invited you to ${company} on Arka`,
      lines: [`Hello ${name.split(' ')[0]},`, `${inviter} added you to ${company} on Arka. Set a password to start. The link works for 72 hours.`],
      action: { label: 'Set your password', url: `${config().APP_URL}/invite/${link}` },
    },
    { demo },
  );
}

/* ---------------------------------------------------------------- users */

export async function createInvitedUser(
  db: Db,
  inv: { name: string; email: string; phone?: string | undefined; role: Role; hourlyCostPaise?: number | undefined },
  companyId: number,
  now: Date,
): Promise<{ id: number; link: string }> {
  const taken = await maybe(db, `SELECT 1 FROM users WHERE email = $1`, [inv.email]);
  if (taken) throw conflict('email_taken', 'Someone with this email already has an Arka account.');
  const u = await one<{ id: number }>(
    db,
    `INSERT INTO users (company_id, name, email, phone, role, status, hourly_cost_paise, created_at) VALUES ($1, $2, $3, $4, $5, 'invited', $6, $7) RETURNING id`,
    [companyId, inv.name, inv.email, inv.phone ?? null, inv.role, inv.hourlyCostPaise ?? 0, now],
  );
  const issued = await issueCode(db, { id: u.id, companyId }, 'invite', { withCode: false, withLink: true, now, ttlMinutes: INVITE_HOURS * 60 });
  return { id: u.id, link: issued.link! };
}

export { hashPassword, verifyPassword };
