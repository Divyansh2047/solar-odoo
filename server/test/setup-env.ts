import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
process.env.DATABASE_URL = readFileSync(join(here, '.tmp', 'db-url'), 'utf8');
process.env.NODE_ENV = 'test';
process.env.OTP_DEV_ECHO = 'true';
process.env.APP_SECRET = 'test-secret-that-is-long-enough-for-hmac-0123456789';
process.env.APP_URL = 'http://localhost:4000';
process.env.LOG_LEVEL = 'silent';
process.env.SERVE_WEB = 'false';
