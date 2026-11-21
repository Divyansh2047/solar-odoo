import { AsyncLocalStorage } from 'node:async_hooks';
import pg from 'pg';
import { config, sslOption } from '../config.js';
import { log } from '../lib/log.js';

// bigint → number (ids and paise fit easily), numeric → number (≤ 3 decimals), date stays 'YYYY-MM-DD'.
pg.types.setTypeParser(20, (v) => Number(v));
pg.types.setTypeParser(1700, (v) => Number(v));
pg.types.setTypeParser(1082, (v) => v);

export type Scope = { companyId: number } | { system: true };
const scopeStore = new AsyncLocalStorage<Scope>();

/** Run fn with every query scoped to one workspace (RLS sees only its rows). */
export const asCompany = <T>(companyId: number, fn: () => T): T => scopeStore.run({ companyId }, fn);
/** Run fn across workspaces. Only for auth lookups, boot tasks and the cleanup job. */
export const asSystem = <T>(fn: () => T): T => scopeStore.run({ system: true }, fn);
export const currentScope = (): Scope | undefined => scopeStore.getStore();

export const TENANT_ROLE = 'arka_tenant';

let raw: pg.Pool | null = null;
const prepared = new WeakSet<pg.PoolClient>();
let mustSwitchRole: boolean | null = null;

function poolOptions(): pg.PoolConfig {
  const c = config();
  return {
    connectionString: c.DATABASE_URL,
    ssl: sslOption(),
    max: c.isTest ? 6 : 12,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    application_name: 'arka',
  };
}

export function rawPool(): pg.Pool {
  if (!raw) {
    raw = new pg.Pool(poolOptions());
    raw.on('error', (err) => log.error({ err }, 'idle database client error'));
  }
  return raw;
}

async function isPrivileged(client: pg.PoolClient): Promise<boolean> {
  const r = await client.query<{ s: boolean }>(`SELECT (rolsuper OR rolbypassrls) AS s FROM pg_roles WHERE rolname = current_user`);
  return !!r.rows[0]?.s;
}

const SET_SCOPE = `SELECT set_config('app.company_id', $1, false), set_config('app.bypass', $2, false)`;

/** Check out a client with the current scope applied. Caller must release(). */
export async function checkout(): Promise<pg.PoolClient> {
  const client = await rawPool().connect();
  try {
    if (!prepared.has(client)) {
      if (mustSwitchRole === null) mustSwitchRole = await isPrivileged(client);
      // Superusers and BYPASSRLS roles ignore row-level security; drop to a plain role.
      if (mustSwitchRole) await client.query(`SET ROLE ${TENANT_ROLE}`);
      prepared.add(client);
    }
    const s = scopeStore.getStore();
    const companyId = s && 'companyId' in s ? String(s.companyId) : '';
    const bypass = s && 'system' in s ? 'on' : 'off';
    await client.query(SET_SCOPE, [companyId, bypass]);
    return client;
  } catch (err) {
    client.release(err as Error);
    throw err;
  }
}

export type Db = Pick<pg.PoolClient, 'query'>;

/** Scoped one-off query. */
export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, params?: unknown[]): Promise<pg.QueryResult<T>> {
  const c = await checkout();
  try {
    return await c.query<T>(text, params);
  } finally {
    c.release();
  }
}

/** Run fn inside one transaction with the current scope. Retries once on deadlock/serialization failure. */
export async function tx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const c = await checkout();
    try {
      await c.query('BEGIN');
      const out = await fn(c);
      await c.query('COMMIT');
      return out;
    } catch (err) {
      await c.query('ROLLBACK').catch(() => {});
      const code = (err as { code?: string }).code;
      if (attempt === 0 && (code === '40P01' || code === '40001')) continue;
      throw err;
    } finally {
      c.release();
    }
  }
}

export async function closePool(): Promise<void> {
  if (raw) {
    const p = raw;
    raw = null;
    mustSwitchRole = null;
    await p.end();
  }
}
