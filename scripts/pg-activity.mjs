// Debug helper: show what the local test or dev database is doing (locks, long queries).
// Usage: node scripts/pg-activity.mjs [test|dev]
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(root, 'server', 'package.json'));
const pg = require('pg');
const name = process.argv[2] ?? 'test';
const port = name === 'test' ? 54329 : 54320;
const pw = readFileSync(join(root, '.data', `pg-${name}.password`), 'utf8').trim();
const c = new pg.Client({ connectionString: `postgres://postgres:${encodeURIComponent(pw)}@127.0.0.1:${port}/postgres` });
await c.connect();
const r = await c.query(
  `SELECT pid, datname, state, wait_event_type AS wtype, wait_event AS wevent, round(extract(epoch FROM now() - query_start))::int AS secs, left(regexp_replace(query, '\\s+', ' ', 'g'), 110) AS q
     FROM pg_stat_activity WHERE datname IS NOT NULL AND pid <> pg_backend_pid() ORDER BY query_start`,
);
console.table(r.rows);
await c.end();
