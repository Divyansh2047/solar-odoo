import pino from 'pino';

const level = process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'test' ? 'silent' : 'info');

/** Six-digit codes never reach the logs. */
export function redact(s: string): string {
  return s.replace(/\b\d{6}\b/g, '••••••');
}

export const log = pino({
  level,
  base: undefined,
  redact: { paths: ['req.headers.cookie', 'req.headers.authorization', 'password', 'code', 'token'], censor: '[redacted]' },
});
