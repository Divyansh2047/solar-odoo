import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Local convenience: read .env from the repo root or server folder if present (never in production images).
for (const p of [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../.env')]) {
  if (existsSync(p)) {
    process.loadEnvFile(p);
    break;
  }
}

const { config } = await import('./config.js');
const { log } = await import('./lib/log.js');
const { migrate } = await import('./db/migrate.js');
const { loadSecret } = await import('./lib/secrets.js');
const { assertTenantIsolation, startJobs, stopJobs } = await import('./jobs.js');
const { createApp } = await import('./http/app.js');
const { startEventListener, stopEventListener } = await import('./lib/events.js');
const { closePool } = await import('./db/pool.js');

const c = config();
await migrate();
await loadSecret();
await assertTenantIsolation();
const app = createApp();
const server = app.listen(c.PORT, () => log.info({ port: c.PORT, env: c.NODE_ENV }, 'Arka is up'));
server.keepAliveTimeout = 65_000;
await startEventListener();
startJobs();

let closing = false;
async function shutdown(signal: string) {
  if (closing) return;
  closing = true;
  log.info({ signal }, 'shutting down');
  stopJobs();
  await stopEventListener();
  server.close();
  await closePool();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('unhandledRejection', (err) => log.error({ err }, 'unhandled rejection'));
