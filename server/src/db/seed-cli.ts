/**
 * `npm run seed`: build the demo template at full scale and create a permanent local workspace
 * "SunPower Solutions" with a director login, for development and rehearsals.
 * The director's password comes from SEED_PASSWORD, or a random one is printed once.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';

for (const p of [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../.env')]) {
  if (existsSync(p)) {
    process.loadEnvFile(p);
    break;
  }
}

const { migrate } = await import('./migrate.js');
const { loadSecret } = await import('../lib/secrets.js');
const { buildTemplate, createDemoWorkspace } = await import('./demo.js');
const { asSystem, query, closePool } = await import('./pool.js');
const { hashPassword } = await import('../lib/crypto.js');

await migrate();
await loadSecret();
const t0 = Date.now();
console.log('Simulating SunPower’s history (a minute or two)…');
await buildTemplate();
console.log(`Template ready in ${Math.round((Date.now() - t0) / 1000)} s.`);

const email = process.env.SEED_EMAIL ?? 'director@sunpower.example';
await asSystem(() => query(`DELETE FROM companies WHERE id IN (SELECT company_id FROM users WHERE email = $1)`, [email]));
const ws = await createDemoWorkspace('real', 'SunPower Solutions');
const password = process.env.SEED_PASSWORD ?? `Sun-${randomBytes(6).toString('base64url')}-26`;
const hash = await hashPassword(password);
await asSystem(() => query(`UPDATE users SET email = $2, password_hash = $3 WHERE id = $1`, [ws.ownerId, email, hash]));
console.log(`\nSunPower Solutions is ready.\n  Sign in: ${email}\n  Password: ${process.env.SEED_PASSWORD ? '(from SEED_PASSWORD)' : password}\n`);
await closePool();
