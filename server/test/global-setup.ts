/**
 * Tests run against a real PostgreSQL: TEST_DATABASE_URL if given (CI), otherwise a local embedded
 * cluster. The test database is dropped and recreated each run, then migrated once.
 */
import pg from 'pg';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
let stop: (() => Promise<void>) | null = null;

export default async function setup() {
  let url = process.env.TEST_DATABASE_URL;
  if (!url) {
    const { startLocalPg } = await import(pathToFileUrl(join(root, 'scripts', 'pg-local.mjs')));
    const local = await startLocalPg({ name: 'test', port: 54329, database: 'postgres' });
    if (local.instance) stop = () => local.instance.stop();
    url = local.url.replace(/\/postgres$/, '/arka_test');
  }
  if (!url) throw new Error('No test database URL');
  const dbName = new URL(url).pathname.slice(1);
  if (!/test/.test(dbName)) throw new Error(`Refusing to wipe "${dbName}": test databases must have "test" in the name.`);
  const admin = new pg.Client({ connectionString: url.replace(/\/[^/]+$/, '/postgres') });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
  await admin.query(`CREATE DATABASE "${dbName}" ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C' TEMPLATE template0`);
  await admin.end();

  process.env.DATABASE_URL = url;
  process.env.NODE_ENV = 'test';
  const { migrate } = await import('../src/db/migrate.js');
  await migrate();
  mkdirSync(join(here, '.tmp'), { recursive: true });
  writeFileSync(join(here, '.tmp', 'db-url'), url);

  return async () => {
    if (stop) await stop();
  };
}

function pathToFileUrl(p: string): string {
  return `file:///${p.replace(/\\/g, '/')}`;
}
