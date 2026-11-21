import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../src/http/app.js';
import { loadSecret } from '../src/lib/secrets.js';
import { asSystem, query } from '../src/db/pool.js';
import { hashPassword } from '../src/lib/crypto.js';
import { roofPhoto, signature } from '../src/lib/png.js';

let app: Express | null = null;

export async function getApp(): Promise<Express> {
  if (!app) {
    await loadSecret();
    app = createApp();
  }
  return app;
}

/** A browser-like client: keeps cookies, sends the app's CSRF header on writes. */
export class Client {
  readonly a: ReturnType<typeof request.agent>;
  constructor(appInstance: Express) {
    this.a = request.agent(appInstance);
  }
  get(url: string) {
    return this.a.get(url);
  }
  post(url: string, body: unknown = {}) {
    return this.a.post(url).set('x-requested-with', 'arka').send(body as object);
  }
  put(url: string, body: unknown = {}) {
    return this.a.put(url).set('x-requested-with', 'arka').send(body as object);
  }
  patch(url: string, body: unknown = {}) {
    return this.a.patch(url).set('x-requested-with', 'arka').send(body as object);
  }
  upload(url: string, bytes: Buffer, type = 'image/png') {
    return this.a.post(url).set('x-requested-with', 'arka').set('Content-Type', type).send(bytes);
  }
}

let seq = 0;
export const PASSWORD = 'Solar-panels-2026';

export interface Workspace {
  companyId: number;
  owner: Client;
  as: (role: 'sales' | 'technician' | 'warehouse' | 'support' | 'accounts', i?: number) => Promise<Client>;
  people: Record<string, number[]>;
  publicKey: string;
}

/** Sign up a new workspace through the real flow, then add a small team directly. */
export async function newWorkspace(name = 'Test Solar'): Promise<Workspace> {
  const appI = await getApp();
  const owner = new Client(appI);
  const n = ++seq;
  const email = `owner${n}.${Date.now()}@test.example`;
  const s = await owner.post('/api/auth/signup', { companyName: `${name} ${n}`, name: 'Asha Director', email, password: PASSWORD, confirmPassword: PASSWORD });
  if (s.status !== 201) throw new Error(`signup failed: ${s.status} ${JSON.stringify(s.body)}`);
  const v = await owner.post('/api/auth/verify-email', { email, code: s.body.devCode });
  if (v.status !== 200) throw new Error(`verify failed: ${JSON.stringify(v.body)}`);
  const me = await owner.get('/api/auth/session');
  const companyId = me.body.user.companyId as number;
  const hash = await hashPassword(PASSWORD);
  const people: Record<string, number[]> = {};
  const emails: Record<string, string[]> = {};
  await asSystem(async () => {
    for (const [role, count, cost] of [
      ['sales', 1, 0],
      ['technician', 4, 30000],
      ['warehouse', 1, 0],
      ['support', 1, 0],
      ['accounts', 1, 0],
    ] as const) {
      for (let i = 0; i < count; i++) {
        const e = `${role}${i}.${n}.${Date.now()}@test.example`;
        const r = await query<{ id: number }>(
          `INSERT INTO users (company_id, name, email, role, status, hourly_cost_paise, password_hash, email_verified_at) VALUES ($1, $2, $3, $4, 'active', $5, $6, now()) RETURNING id`,
          [companyId, `${role[0]!.toUpperCase()}${role.slice(1)} Person ${i + 1}`, e, role, cost, hash],
        );
        (people[role] ??= []).push(r.rows[0]!.id);
        (emails[role] ??= []).push(e);
      }
    }
  });
  const key = await asSystem(() => query<{ public_key: string }>(`SELECT public_key FROM companies WHERE id = $1`, [companyId]));
  const cache = new Map<string, Client>();
  return {
    companyId,
    owner,
    people,
    publicKey: key.rows[0]!.public_key,
    as: async (role, i = 0) => {
      const k = `${role}${i}`;
      if (cache.has(k)) return cache.get(k)!;
      const c = new Client(appI);
      const r = await c.post('/api/auth/login', { email: emails[role]![i], password: PASSWORD });
      if (r.status !== 200) throw new Error(`login ${role} failed: ${JSON.stringify(r.body)}`);
      cache.set(k, c);
      return c;
    },
  };
}

export const png = (seed = 1) => roofPhoto(seed, 1, 2);
export const sig = (seed = 1) => signature(seed);

export function at(dayOffset: number, hour: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + dayOffset);
  d.setUTCHours(hour - 5, 30, 0, 0); // hour in IST
  return d.toISOString();
}

export const todayIst = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
