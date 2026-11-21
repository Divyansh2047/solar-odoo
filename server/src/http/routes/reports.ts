import { Router } from 'express';
import { z } from 'zod';
import { shareLinkSchema, type Period } from '@arka/shared';
import { config } from '../../config.js';
import { dashboard, jobProfit, toCsv, trend, unfinished } from '../../domain/reports.js';
import { audit } from '../../domain/context.js';
import { sha256, token } from '../../lib/crypto.js';
import { act, idParam, query, read, withDb, zParse } from '../context.js';

const period = (v: unknown): Period => zParse(z.enum(['today', 'week', 'month']).default('month'), v);

export function reportRoutes(): Router {
  const r = Router();

  r.get('/dashboard', read('reports.read', async (req, ctx) => withDb((db) => dashboard(db, ctx, period(req.query.period)))));
  r.get('/reports/trend', read('reports.read', async (_req, ctx) => ({ weeks: await withDb((db) => trend(db, ctx, 12)) })));
  r.get('/reports/unfinished', read('jobs.read', async (_req, ctx) => ({ jobs: await withDb((db) => unfinished(db, ctx)) })));
  r.get(
    '/reports/profit',
    read('reports.read', async (req, ctx) => ({
      jobs: await withDb((db) => (req.query.period ? jobProfit(db, ctx, { period: period(req.query.period) }) : jobProfit(db, ctx))),
    })),
  );

  r.get(
    '/reports/profit.csv',
    read('reports.read', async (req, ctx, res) => {
      const rows = await withDb((db) => (req.query.period ? jobProfit(db, ctx, { period: period(req.query.period) }) : jobProfit(db, ctx)));
      const csv = toCsv(rows, [
        { key: 'ref', label: 'Job' },
        { key: 'customer', label: 'Customer' },
        { key: 'capacity_kw', label: 'kW' },
        { key: 'status', label: 'Status' },
        { key: 'revenue_paise', label: 'Revenue ex GST (INR)', money: true },
        { key: 'parts_paise', label: 'Parts at cost (INR)', money: true },
        { key: 'labour_paise', label: 'Labour (INR)', money: true },
        { key: 'expenses_paise', label: 'Expenses (INR)', money: true },
        { key: 'warranty_paise', label: 'Warranty repairs (INR)', money: true },
        { key: 'profit_paise', label: 'Profit (INR)', money: true },
      ]);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="arka-job-profit-${req.query.period ?? 'all'}.csv"`);
      res.send('﻿' + csv);
    }),
  );

  /** A read-only link to the director's numbers, for an accountant or partner. */
  r.post(
    '/reports/share',
    act('reports.share', shareLinkSchema, async (input, db, ctx) => {
      const t = token(24);
      const expires = new Date(ctx.now.getTime() + input.expiresInDays * 86_400_000);
      const row = await db.query<{ id: number }>(`INSERT INTO share_links (token_hash, period, expires_at, created_by, created_at) VALUES ($1, $2, $3, $4, $5) RETURNING id`, [
        sha256(t),
        input.period,
        expires,
        ctx.userId,
        ctx.now,
      ]);
      await audit(db, ctx, 'share.create', 'share_link', row.rows[0]!.id, { period: input.period, days: input.expiresInDays });
      return { url: `${config().APP_URL}/r/${t}`, expiresAt: expires };
    }),
  );
  r.get(
    '/reports/share',
    read('reports.share', async () => {
      const rows = await query(
        `SELECT s.id, s.period, s.expires_at, s.revoked_at, s.created_at, u.name AS created_by FROM share_links s LEFT JOIN users u ON u.id = s.created_by ORDER BY s.created_at DESC LIMIT 20`,
      );
      return { links: rows.rows };
    }),
  );
  r.post(
    '/reports/share/:id/revoke',
    act('reports.share', null, async (_i, db, ctx, req) => {
      await db.query(`UPDATE share_links SET revoked_at = $2 WHERE id = $1 AND revoked_at IS NULL`, [idParam(req), ctx.now]);
      await audit(db, ctx, 'share.revoke', 'share_link', idParam(req));
    }),
  );

  return r;
}
