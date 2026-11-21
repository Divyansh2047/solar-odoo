import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { pinoHttp } from 'pino-http';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import { log } from '../lib/log.js';
import { AppError } from '../lib/errors.js';
import { query } from '../db/pool.js';
import { errorHandler, loadSession, requireAuth } from './context.js';
import { authRoutes } from './routes/auth.js';
import { publicRoutes } from './routes/public.js';
import { crmRoutes } from './routes/crm.js';
import { salesRoutes } from './routes/sales.js';
import { opsRoutes } from './routes/ops.js';
import { serviceRoutes } from './routes/service.js';
import { moneyRoutes } from './routes/money.js';
import { reportRoutes } from './routes/reports.js';
import { adminRoutes } from './routes/admin.js';

const here = dirname(fileURLToPath(import.meta.url));

function webDist(): string | null {
  for (const p of [resolve(here, '../../../web/dist'), resolve(here, '../web'), resolve(here, '../../web/dist'), resolve(process.cwd(), 'web/dist')]) {
    if (existsSync(join(p, 'index.html'))) return p;
  }
  return null;
}

/**
 * Cross-site request defence in depth: SameSite cookies, plus every write must carry our custom header
 * (a cross-origin page can't add it without a CORS preflight we never approve), plus an Origin check.
 */
function csrfGuard(req: Request, _res: Response, next: NextFunction) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('x-requested-with') !== 'arka') return next(new AppError(403, 'csrf', 'This request didn’t come from the Arka app.'));
  const origin = req.get('origin');
  if (origin) {
    const allowed = new Set([new URL(config().APP_URL).origin, `${req.protocol}://${req.get('host')}`]);
    if (!allowed.has(origin)) return next(new AppError(403, 'csrf', 'This request came from another website.'));
  }
  next();
}

export function createApp() {
  const c = config();
  const app = express();
  app.disable('x-powered-by');
  if (c.TRUST_PROXY) app.set('trust proxy', /^\d+$/.test(c.TRUST_PROXY) ? Number(c.TRUST_PROXY) : c.TRUST_PROXY === 'true' ? true : c.TRUST_PROXY);

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          'default-src': ["'self'"],
          'script-src': ["'self'"],
          'style-src': ["'self'", "'unsafe-inline'"],
          'img-src': ["'self'", 'data:', 'blob:'],
          'font-src': ["'self'"],
          'connect-src': ["'self'"],
          'worker-src': ["'self'", 'blob:'],
          'media-src': ["'self'", 'blob:'],
          'object-src': ["'none'"],
          'base-uri': ["'self'"],
          'form-action': ["'self'"],
          'frame-ancestors': ["'self'"],
          ...(c.isProd ? { 'upgrade-insecure-requests': [] } : {}),
        },
      },
      crossOriginEmbedderPolicy: false,
      hsts: c.isProd ? { maxAge: 31_536_000, includeSubDomains: false } : false,
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    }),
  );
  app.use((_req, res, next) => {
    res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=(self), payment=()');
    next();
  });
  // The public enquiry form may be embedded in the installer's own website.
  app.use('/enquire', (_req, res, next) => {
    res.setHeader('Content-Security-Policy', (res.getHeader('Content-Security-Policy') as string).replace("frame-ancestors 'self'", 'frame-ancestors *'));
    next();
  });

  app.get('/api/health', async (_req, res) => {
    const t = Date.now();
    await query('SELECT 1');
    res.json({ ok: true, db: 'up', dbMs: Date.now() - t });
  });

  app.use(
    '/api',
    pinoHttp({
      logger: log,
      autoLogging: { ignore: (req) => req.url === '/events' || req.url === '/health' },
      customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'),
      serializers: { req: (req) => ({ method: req.method, url: String(req.url).replace(/[A-Za-z0-9_-]{20,}/g, ':token') }), res: (res) => ({ status: res.statusCode }) },
    }),
  );
  app.use('/api', express.json({ limit: '256kb' }), cookieParser(), csrfGuard, loadSession);
  app.use('/api/auth', authRoutes());
  app.use('/api/public', publicRoutes());
  const authed = express.Router();
  authed.use(requireAuth);
  authed.use(crmRoutes(), salesRoutes(), opsRoutes(), serviceRoutes(), moneyRoutes(), reportRoutes(), adminRoutes());
  app.use('/api', authed);
  app.use('/api', (_req, _res, next) => next(new AppError(404, 'not_found', 'No such API endpoint.')));

  const dist = c.SERVE_WEB === 'false' ? null : webDist();
  if (dist) {
    app.use('/assets', express.static(join(dist, 'assets'), { immutable: true, maxAge: '365d', index: false }));
    app.use(express.static(dist, { index: false, maxAge: '1h' }));
    app.get(/^(?!\/api\/).*/, (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(join(dist, 'index.html'));
    });
  }

  app.use(errorHandler);
  return app;
}
