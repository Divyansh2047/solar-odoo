import { z } from 'zod';

const bool = z
  .string()
  .optional()
  .transform((v) => v === 'true' || v === '1');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  /** 'true' = TLS with certificate verification. Certificates are always verified; there is no opt-out. */
  DATABASE_SSL: z.enum(['true', 'false']).default('false'),
  APP_URL: z.string().url().default('http://localhost:5173'),
  /** Optional: if absent, the server generates one on first boot and keeps it in the database. */
  APP_SECRET: z.string().min(32).optional(),
  TRUST_PROXY: z.string().optional(),
  COOKIE_SECURE: z.string().optional(),
  SEED_DEMO: bool,
  OTP_DEV_ECHO: bool,
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  MAIL_FROM: z.string().default('Arka <no-reply@localhost>'),
  RESEND_API_KEY: z.string().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SERVE_WEB: z.string().optional(),
});

export type Config = z.infer<typeof schema> & { isProd: boolean; isTest: boolean; cookieSecure: boolean };

let cached: Config | null = null;

export function config(): Config {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid configuration:\n${issues}`);
  }
  const c = parsed.data;
  if (c.NODE_ENV === 'production' && c.OTP_DEV_ECHO) throw new Error('OTP_DEV_ECHO must not be enabled in production');
  cached = {
    ...c,
    isProd: c.NODE_ENV === 'production',
    isTest: c.NODE_ENV === 'test',
    cookieSecure: c.COOKIE_SECURE ? c.COOKIE_SECURE === 'true' : c.NODE_ENV === 'production',
  };
  return cached;
}

export function sslOption(): { rejectUnauthorized: true } | undefined {
  return config().DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : undefined;
}

/** Tests change env between files; let them reset the cache. */
export function resetConfig(): void {
  cached = null;
}
