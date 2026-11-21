import { asCompany, asSystem, checkout, query } from './db/pool.js';
import { maintainTemplate, purgeExpiredDemos } from './db/demo.js';
import { expireQuotes } from './domain/quotes.js';
import { log } from './lib/log.js';
import { config } from './config.js';

/**
 * Refuse to start if row-level security isn't actually isolating workspaces (for example when
 * connected as a superuser and the role switch failed). A fake workspace must see nothing.
 */
export async function assertTenantIsolation(): Promise<void> {
  const r = await asCompany(-1, () => query<{ n: number }>(`SELECT (SELECT count(*) FROM users) + (SELECT count(*) FROM customers) + (SELECT count(*) FROM companies) AS n`));
  if (Number(r.rows[0]!.n) !== 0) throw new Error('Tenant isolation self-test failed: rows are visible outside their workspace. Refusing to start.');
  log.info('tenant isolation self-test passed');
}

const timers: NodeJS.Timeout[] = [];

async function hourly(): Promise<void> {
  try {
    await purgeExpiredDemos();
    await asSystem(async () => {
      const db = await checkout();
      try {
        await db.query(`DELETE FROM sessions WHERE expires_at < now()`);
        await db.query(`DELETE FROM auth_codes WHERE expires_at < now() - interval '7 days'`);
        const companies = await db.query<{ id: number; timezone: string; kind: string }>(`SELECT id, timezone, kind FROM companies WHERE kind <> 'template'`);
        for (const co of companies.rows) {
          await asCompany(co.id, async () => {
            const c2 = await checkout();
            try {
              await c2.query('BEGIN');
              await expireQuotes(c2, { companyId: co.id, userId: null, role: 'system', tz: co.timezone, now: new Date(), isDemo: co.kind === 'demo' });
              await c2.query('COMMIT');
            } catch (err) {
              await c2.query('ROLLBACK').catch(() => {});
              throw err;
            } finally {
              c2.release();
            }
          });
        }
      } finally {
        db.release();
      }
    });
    if (!config().isTest) await maintainTemplate();
  } catch (err) {
    log.error({ err }, 'hourly housekeeping failed');
  }
}

export function startJobs(): void {
  // first run shortly after boot so the demo template starts building straight away
  timers.push(setTimeout(() => void hourly(), 2_000));
  timers.push(setInterval(() => void hourly(), 60 * 60_000));
}

export function stopJobs(): void {
  for (const t of timers) clearTimeout(t);
  timers.length = 0;
}
