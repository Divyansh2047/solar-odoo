import { randomBytes } from 'node:crypto';
import { config } from '../config.js';
import { asSystem, query } from '../db/pool.js';
import { setSecret } from './crypto.js';

/**
 * The HMAC key for one-time codes. Taken from APP_SECRET if set; otherwise generated once on first
 * boot and kept in an RLS-protected table, so nobody ever has to copy a secret by hand.
 */
export async function loadSecret(): Promise<void> {
  const env = config().APP_SECRET;
  if (env) {
    setSecret(env);
    return;
  }
  const value = await asSystem(async () => {
    await query(`INSERT INTO app_secrets (name, value) VALUES ('hmac', $1) ON CONFLICT (name) DO NOTHING`, [randomBytes(48).toString('base64url')]);
    const r = await query<{ value: string }>(`SELECT value FROM app_secrets WHERE name = 'hmac'`);
    return r.rows[0]!.value;
  });
  setSecret(value);
}
