import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { config, sslOption } from '../config.js';
import { log } from '../lib/log.js';
import { TENANT_ROLE } from './pool.js';

const here = dirname(fileURLToPath(import.meta.url));

/** Migrations live next to this file in dev, and are copied next to the bundle in production. */
function migrationsDir(): string {
  const candidates = [join(here, 'migrations'), join(here, 'db', 'migrations'), join(here, '..', 'src', 'db', 'migrations')];
  for (const c of candidates) {
    try {
      readdirSync(c);
      return c;
    } catch {
      /* try next */
    }
  }
  throw new Error('migrations folder not found');
}

/**
 * Apply unapplied .sql files in order, each in its own transaction, under an advisory lock so
 * two instances booting together can't race. Uses the owner connection (no tenant role).
 */
export async function migrate(): Promise<void> {
  const c = config();
  const client = new pg.Client({ connectionString: c.DATABASE_URL, ssl: sslOption() });
  await client.connect();
  try {
    const enc = await client.query<{ server_encoding: string }>(`SHOW server_encoding`);
    const dbEnc = await client.query<{ e: string }>(`SELECT pg_encoding_to_char(encoding) AS e FROM pg_database WHERE datname = current_database()`);
    if (dbEnc.rows[0]?.e !== 'UTF8') {
      throw new Error(`The database must use UTF8 encoding (found ${dbEnc.rows[0]?.e ?? enc.rows[0]?.server_encoding}). Create it with ENCODING 'UTF8' TEMPLATE template0.`);
    }
    await client.query(`SELECT pg_advisory_lock(727274)`);
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
    const done = new Set((await client.query<{ name: string }>(`SELECT name FROM schema_migrations`)).rows.map((r) => r.name));
    const dir = migrationsDir();
    const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
    for (const f of files) {
      if (done.has(f)) continue;
      const sql = readFileSync(join(dir, f), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(`INSERT INTO schema_migrations (name) VALUES ($1)`, [f]);
        await client.query('COMMIT');
        log.info({ migration: f }, 'migration applied');
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${f} failed: ${(err as Error).message}`);
      }
    }
    await ensureTenantRole(client);
  } finally {
    await client.query(`SELECT pg_advisory_unlock(727274)`).catch(() => {});
    await client.end();
  }
}

/**
 * When the app connects as a superuser (local embedded Postgres, the Docker image), RLS would be
 * bypassed. Create a plain role the pool switches to. Managed hosts give an owner role instead, which
 * FORCE ROW LEVEL SECURITY already covers, so this is skipped there.
 */
async function ensureTenantRole(client: pg.Client): Promise<void> {
  const r = await client.query<{ s: boolean; cr: boolean }>(
    `SELECT (rolsuper OR rolbypassrls) AS s, (rolsuper OR rolcreaterole) AS cr FROM pg_roles WHERE rolname = current_user`,
  );
  const row = r.rows[0];
  if (!row?.s) return;
  await client.query(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${TENANT_ROLE}') THEN
        CREATE ROLE ${TENANT_ROLE} NOLOGIN NOSUPERUSER NOBYPASSRLS;
      END IF;
    END $$;`);
  await client.query(`GRANT ${TENANT_ROLE} TO current_user`).catch(() => {});
  await client.query(`GRANT USAGE ON SCHEMA public TO ${TENANT_ROLE}`);
  await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${TENANT_ROLE}`);
  await client.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${TENANT_ROLE}`);
  await client.query(`GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO ${TENANT_ROLE}`);
}
