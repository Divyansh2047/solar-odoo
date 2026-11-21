import { createHash, createHmac, randomBytes, randomInt, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number, opts: object) => Promise<Buffer>;

// N=2^15 (≈32 MB) in production; lighter in tests so the suite stays fast.
const COST = process.env.NODE_ENV === 'test' ? 1 << 10 : 1 << 15;
const PARAMS = { N: COST, r: 8, p: 1, maxmem: 128 * 1024 * 1024 };

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password.normalize('NFKC'), salt, 32, PARAMS);
  return `scrypt$${COST}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  // Always do the work, so unknown accounts take as long as known ones.
  const parts = stored?.split('$') ?? [];
  const valid = parts.length === 4 && parts[0] === 'scrypt';
  const n = valid ? Number(parts[1]) : COST;
  const salt = valid ? Buffer.from(parts[2]!, 'base64url') : randomBytes(16);
  const expected = valid ? Buffer.from(parts[3]!, 'base64url') : randomBytes(32);
  const key = await scrypt(password.normalize('NFKC'), salt, 32, { ...PARAMS, N: n });
  return valid && key.length === expected.length && timingSafeEqual(key, expected);
}

/** 256-bit URL-safe random token (sessions, public links). */
export function token(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

export function sixDigitCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

let secret: string | null = null;
export function setSecret(s: string): void {
  secret = s;
}

/** Keyed hash for one-time codes: purpose-scoped so a code for one thing can't be used for another. */
export function hmac(purpose: string, value: string): string {
  if (!secret) throw new Error('App secret not loaded');
  return createHmac('sha256', secret).update(`${purpose}:${value}`).digest('hex');
}

export function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}
