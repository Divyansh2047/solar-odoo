// Local PostgreSQL without installing anything system-wide: real Postgres binaries from the
// `embedded-postgres` package, data kept in .data/. Used by `npm run db`, `npm run dev` and the tests.
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(root, 'server', 'package.json'));
const load = async (name) => (await import(pathToFileURL(require.resolve(name)).href)).default;

export function portOpen(port) {
  return new Promise((res) => {
    const s = net.connect({ port, host: '127.0.0.1' });
    s.once('connect', () => (s.end(), res(true)));
    s.once('error', () => res(false));
  });
}

/** Start (or reuse) a local cluster. Returns a connection string for `database`. */
export async function startLocalPg({ name = 'dev', port = 54320, database = 'arka' } = {}) {
  const dir = join(root, '.data', `pg-${name}`);
  const pwFile = join(root, '.data', `pg-${name}.password`);
  mkdirSync(join(root, '.data'), { recursive: true });
  if (!existsSync(pwFile)) writeFileSync(pwFile, randomBytes(18).toString('base64url'), { mode: 0o600 });
  const password = readFileSync(pwFile, 'utf8').trim();
  const url = (db) => `postgres://postgres:${encodeURIComponent(password)}@127.0.0.1:${port}/${db}`;
  const pg = await load('pg');

  const healthy = async () => {
    const c = new pg.Client({ connectionString: url('postgres'), connectionTimeoutMillis: 4000, query_timeout: 4000 });
    try {
      await c.connect();
      await c.query('SELECT 1');
      return true;
    } catch {
      return false;
    } finally {
      await c.end().catch(() => {});
    }
  };

  let instance = null;
  if (await portOpen(port)) {
    if (!(await healthy())) {
      throw new Error(`Port ${port} is taken by something that isn't a healthy local PostgreSQL. Stop leftover postgres.exe processes and retry.`);
    }
  } else {
    const EmbeddedPostgres = await load('embedded-postgres');
    instance = new EmbeddedPostgres({
      databaseDir: dir,
      user: 'postgres',
      password,
      port,
      persistent: true,
      initdbFlags: ['--encoding=UTF8', '--locale=C'],
      onLog: () => {},
    });
    if (!existsSync(join(dir, 'PG_VERSION'))) await instance.initialise();
    await instance.start();
  }
  const admin = new pg.Client({ connectionString: url('postgres') });
  await admin.connect();
  const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [database]);
  if (!exists.rowCount) await admin.query(`CREATE DATABASE "${database}" ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C' TEMPLATE template0`);
  await admin.end();
  return { url: url(database), adminUrl: url('postgres'), instance };
}
