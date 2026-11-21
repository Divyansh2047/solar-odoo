import type { Role } from '@arka/shared';
import type pg from 'pg';
import { hashPassword } from '../lib/crypto.js';
import { seedCatalog } from './seed-catalog.js';

/** Point an open transaction at one workspace (used when a request creates a new one). */
export async function scopeTo(db: pg.PoolClient, companyId: number | null): Promise<void> {
  await db.query(`SELECT set_config('app.company_id', $1, false), set_config('app.bypass', $2, false)`, [companyId ? String(companyId) : '', companyId ? 'off' : 'on']);
}

/**
 * A new workspace with its first person and the starting catalogue. Runs on a client already in a
 * transaction; leaves the client scoped to the new workspace.
 */
export async function createWorkspace(
  db: pg.PoolClient,
  opts: {
    name: string;
    kind: 'real' | 'demo' | 'template';
    now: Date;
    owner: { name: string; email: string; phone?: string | null; password?: string; verified: boolean; role?: Role };
  },
): Promise<{ companyId: number; ownerId: number; products: Map<string, number> }> {
  await scopeTo(db, null); // system scope just to create the company row
  const c = await db.query<{ id: number }>(
    `INSERT INTO companies (name, kind, demo_expires_at, created_at) VALUES ($1, $2, $3, $4) RETURNING id`,
    [opts.name, opts.kind, opts.kind === 'demo' ? new Date(opts.now.getTime() + 24 * 3600_000) : null, opts.now],
  );
  const companyId = c.rows[0]!.id;
  await scopeTo(db, companyId);
  const hash = opts.owner.password ? await hashPassword(opts.owner.password) : null;
  const u = await db.query<{ id: number }>(
    `INSERT INTO users (name, email, phone, role, status, password_hash, email_verified_at, created_at) VALUES ($1, $2, $3, $4, 'active', $5, $6, $7) RETURNING id`,
    [opts.owner.name, opts.owner.email, opts.owner.phone ?? null, opts.owner.role ?? 'owner', hash ?? (await hashPassword(cryptoRandom())), opts.owner.verified ? opts.now : null, opts.now],
  );
  const products = await seedCatalog(db, opts.now);
  return { companyId, ownerId: u.rows[0]!.id, products };
}

function cryptoRandom(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(24))).toString('base64url');
}
