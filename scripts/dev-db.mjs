// `npm run db`: start the local database and keep it running. Writes .env on first run.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startLocalPg } from './pg-local.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { url, instance } = await startLocalPg();
const envPath = join(root, '.env');
if (!existsSync(envPath)) {
  writeFileSync(
    envPath,
    [
      `DATABASE_URL=${url}`,
      'NODE_ENV=development',
      'APP_URL=http://localhost:5173',
      'OTP_DEV_ECHO=true',
      'LOG_LEVEL=info',
      '',
    ].join('\n'),
  );
  console.log('Wrote .env for local development.');
} else if (!readFileSync(envPath, 'utf8').includes('DATABASE_URL=')) {
  console.log('Add DATABASE_URL to .env:', url.replace(/:[^:@]+@/, ':****@'));
}
console.log(instance ? 'Local PostgreSQL started on port 54320. Press Ctrl+C to stop.' : 'Local PostgreSQL already running on port 54320.');
if (instance) {
  const stop = async () => {
    await instance.stop().catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  setInterval(() => {}, 1 << 30);
}
