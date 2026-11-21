import { isoDateInTz, daysBetween } from '@arka/shared';
import { randomBytes } from 'node:crypto';
import { asSystem, checkout } from './pool.js';
import { log } from '../lib/log.js';
import { AppError } from '../lib/errors.js';
import { cloneWorkspace } from './demo-clone.js';
import { createDemoPeople, simulate, type SimEnv } from './demo-story.js';
import { createWorkspace, scopeTo } from './workspace.js';

const TZ = 'Asia/Kolkata';
const STALE_MS = 12 * 3600_000;
/** Demo workspaces alive at once (each is a full copy); protects real workspaces' database. */
const MAX_LIVE_DEMOS = Number(process.env.MAX_LIVE_DEMOS ?? 300);

export interface DemoScale {
  days: number;
  perDay: number;
}

export function demoScale(): DemoScale {
  const days = Number(process.env.DEMO_DAYS ?? 95);
  const perDay = Number(process.env.DEMO_PER_DAY ?? 1.9);
  return { days: Number.isFinite(days) ? Math.max(10, Math.min(200, days)) : 95, perDay: Number.isFinite(perDay) ? Math.max(0.3, Math.min(4, perDay)) : 1.9 };
}

/** Build the demo template: a full SunPower history up to now. Takes a while; runs in the background. */
export async function buildTemplate(scale: DemoScale = demoScale(), seed = 20261121): Promise<number> {
  const started = Date.now();
  return asSystem(async () => {
    const db = await checkout();
    try {
      await db.query('BEGIN');
      const now = new Date();
      const slug = `t${randomBytes(3).toString('hex')}`;
      const ws = await createWorkspace(db, {
        name: 'SunPower Solutions',
        kind: 'template',
        now: new Date(now.getTime() - 1000 * 86_400_000),
        owner: { name: 'Vikram Mehta', email: `vikram.mehta.${slug}@sunpower.example`, verified: true },
      });
      await db.query(`UPDATE companies SET phone = '+917940012345', email = 'hello@sunpower.example', address = '402, Sun Arcade, S.G. Highway, Ahmedabad 380054', gstin = '24ABCDS1234F1Z5' WHERE id = $1`, [
        ws.companyId,
      ]);
      const people = await createDemoPeople(db, ws.ownerId, slug, new Date(now.getTime() - 1000 * 86_400_000));
      const env: SimEnv = { db, companyId: ws.companyId, tz: TZ, now, realNow: now, people, photos: [], signatures: [], surveyPhotos: [] };
      const res = await simulate(env, { seed, ...scale });
      await scopeTo(db, null);
      await db.query(`DELETE FROM companies WHERE kind = 'template' AND id <> $1`, [ws.companyId]);
      await db.query('COMMIT');
      log.info({ ms: Date.now() - started, ...res }, 'demo template built');
      return ws.companyId;
    } catch (err) {
      await db.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      await db.query(`SELECT set_config('app.company_id', '', false), set_config('app.bypass', 'off', false)`).catch(() => {});
      db.release();
    }
  });
}

let building: Promise<number> | null = null;

export function ensureTemplate(): Promise<number> {
  if (!building) {
    building = buildTemplate()
      .catch((err) => {
        log.error({ err }, 'demo template build failed');
        throw err;
      })
      .finally(() => {
        building = null;
      });
  }
  return building;
}

export const templateBuilding = () => building !== null;

async function latestTemplate(): Promise<{ id: number; created_at: Date } | null> {
  return asSystem(async () => {
    const db = await checkout();
    try {
      const r = await db.query<{ id: number; created_at: Date }>(`SELECT id, created_at FROM companies WHERE kind = 'template' ORDER BY id DESC LIMIT 1`);
      return r.rows[0] ?? null;
    } finally {
      db.release();
    }
  });
}

/** Rebuild the template when missing or stale; called at boot and hourly. Never blocks requests. */
export async function maintainTemplate(): Promise<void> {
  const t = await latestTemplate();
  // the template's own created_at is back-dated; staleness is judged by its newest activity instead
  if (!t) {
    void ensureTemplate().catch(() => {});
    return;
  }
  const fresh = await asSystem(async () => {
    const db = await checkout();
    try {
      const r = await db.query<{ last: Date | null }>(`SELECT max(created_at) AS last FROM activities WHERE company_id = $1`, [t.id]);
      return r.rows[0]?.last ?? null;
    } finally {
      db.release();
    }
  });
  if (!fresh || Date.now() - fresh.getTime() > STALE_MS) void ensureTemplate().catch(() => {});
}

/**
 * A private copy of the template for one visitor, dated to today, expiring in 24 hours. Fails with
 * 503 "demo_warming" while the very first template is still being built.
 */
export async function createDemoWorkspace(kind: 'demo' | 'real' = 'demo', name = 'SunPower Solutions'): Promise<{ companyId: number; ownerId: number }> {
  const live = await asSystem(async () => {
    const db = await checkout();
    try {
      return (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM companies WHERE kind = 'demo' AND demo_expires_at > now()`)).rows[0]!.n;
    } finally {
      db.release();
    }
  });
  if (kind === 'demo' && live >= MAX_LIVE_DEMOS) {
    throw new AppError(503, 'demo_busy', 'Lots of people are trying the demo right now. Try again in a few minutes, or create your own workspace.');
  }
  const t = await latestTemplate();
  if (!t) {
    void ensureTemplate().catch(() => {});
    throw new AppError(503, 'demo_warming', 'The demo is being prepared for the first time. It takes about a minute; this page retries by itself.', undefined, { retryIn: 8 });
  }
  const builtAt = await asSystem(async () => {
    const db = await checkout();
    try {
      const r = await db.query<{ last: Date }>(`SELECT coalesce(max(created_at), now()) AS last FROM activities WHERE company_id = $1`, [t.id]);
      return r.rows[0]!.last;
    } finally {
      db.release();
    }
  });
  const now = new Date();
  const shiftDays = daysBetween(isoDateInTz(builtAt, TZ), isoDateInTz(now, TZ));
  return asSystem(async () => {
    const db = await checkout();
    try {
      await db.query('BEGIN');
      const out = await cloneWorkspace(db, t.id, {
        name,
        kind,
        now,
        shiftMs: shiftDays * 86_400_000,
        shiftDays,
        emailSlug: `d${randomBytes(4).toString('hex')}`,
        expiresAt: kind === 'demo' ? new Date(now.getTime() + 24 * 3600_000) : null,
      });
      await db.query('COMMIT');
      return out;
    } catch (err) {
      await db.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      db.release();
    }
  });
}

/** Demo workspaces live for a day. */
export async function purgeExpiredDemos(): Promise<number> {
  return asSystem(async () => {
    const db = await checkout();
    try {
      const r = await db.query(`DELETE FROM companies WHERE kind = 'demo' AND demo_expires_at < now()`);
      if (r.rowCount) log.info({ removed: r.rowCount }, 'expired demo workspaces removed');
      return r.rowCount ?? 0;
    } finally {
      db.release();
    }
  });
}
