import { beforeAll, describe, expect, it } from 'vitest';
import { asCompany, asSystem, query } from '../src/db/pool.js';
import { Client, getApp, newWorkspace, PASSWORD, todayIst, type Workspace } from './helpers.js';

let a: Workspace;
let b: Workspace;
let aCustomerId: number;
let aLeadId: number;

beforeAll(async () => {
  a = await newWorkspace('Alpha Solar');
  b = await newWorkspace('Beta Solar');
  const sales = await a.as('sales');
  const r = await sales.post('/api/leads', {
    name: 'Private Person',
    phone: '9876501234',
    address: '1, Hidden Lane, Navrangpura',
    city: 'Ahmedabad',
    pincode: '380009',
    customerKind: 'home',
    systemType: 'on_grid',
    source: 'call',
  });
  aLeadId = r.body.id;
  aCustomerId = (await sales.get(`/api/leads/${aLeadId}`)).body.lead.customer_id;
});

describe('workspace isolation (row-level security)', () => {
  it('another workspace sees none of it', async () => {
    const bSales = await b.as('sales');
    expect((await bSales.get(`/api/leads/${aLeadId}`)).status).toBe(404);
    expect((await bSales.get(`/api/customers/${aCustomerId}`)).status).toBe(404);
    expect((await bSales.get('/api/leads')).body.leads).toHaveLength(0);
    expect((await bSales.get('/api/search?q=Private')).body.customers).toHaveLength(0);
  });

  it('can’t write into or reference another workspace’s records', async () => {
    const bSupport = await b.as('support');
    const t = await bSupport.post('/api/tickets', { customerId: aCustomerId, channel: 'call', description: 'Trying to reach across.', priority: 'normal' });
    expect(t.status).toBe(404);
    const bSales = await b.as('sales');
    const q = await bSales.post(`/api/leads/${aLeadId}/activities`, { kind: 'note', body: 'sneaky' });
    expect(q.status).toBe(404);
  });

  it('the same phone number can be a customer in two workspaces', async () => {
    const bSales = await b.as('sales');
    const r = await bSales.post('/api/leads', {
      name: 'Private Person',
      phone: '9876501234',
      address: '1, Hidden Lane, Navrangpura',
      city: 'Ahmedabad',
      pincode: '380009',
      customerKind: 'home',
      systemType: 'on_grid',
      source: 'call',
    });
    expect(r.status).toBe(200);
    expect(r.body.merged).toBe(false);
  });

  it('a workspace that does not exist sees nothing at all', async () => {
    const r = await asCompany(-42, () => query<{ n: number }>(`SELECT count(*)::int AS n FROM users`));
    expect(r.rows[0]!.n).toBe(0);
    const all = await asSystem(() => query<{ n: number }>(`SELECT count(*)::int AS n FROM users`));
    expect(all.rows[0]!.n).toBeGreaterThan(0);
  });
});

describe('account security', () => {
  it('writes need the app header (cross-site requests are refused)', async () => {
    const c = new Client(await getApp());
    const r = await c.a.post('/api/auth/login').send({ email: 'x@example.com', password: 'whatever123' });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('csrf');
    const foreign = await c.a.post('/api/auth/login').set('x-requested-with', 'arka').set('Origin', 'https://evil.example').send({ email: 'x@example.com', password: 'a' });
    expect(foreign.status).toBe(403);
  });

  it('one message for a wrong password and an unknown email', async () => {
    const c = new Client(await getApp());
    const unknown = await c.post('/api/auth/login', { email: 'nobody@example.com', password: PASSWORD });
    const me = await a.owner.get('/api/auth/session');
    const wrong = await c.post('/api/auth/login', { email: me.body.user.email, password: 'Wrong-password-1' });
    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(unknown.body.error.message).toBe(wrong.body.error.message);
  });

  it('sign-up rules: strong password, matching confirmation, unique email', async () => {
    const c = new Client(await getApp());
    const weak = await c.post('/api/auth/signup', { companyName: 'Weak Co', name: 'Weak Person', email: 'weak@example.com', password: 'short', confirmPassword: 'other' });
    expect(weak.status).toBe(400);
    expect(Object.keys(weak.body.error.fields)).toEqual(expect.arrayContaining(['password', 'confirmPassword']));
    const me = await a.owner.get('/api/auth/session');
    const dup = await c.post('/api/auth/signup', { companyName: 'Dup Co', name: 'Dup Person', email: me.body.user.email, password: PASSWORD, confirmPassword: PASSWORD });
    expect(dup.status).toBe(409);
  });

  it('unverified accounts must confirm their email, and codes lock after 5 wrong tries', async () => {
    const c = new Client(await getApp());
    const email = `unverified.${Date.now()}@test.example`;
    const s = await c.post('/api/auth/signup', { companyName: 'Later Co', name: 'Later Person', email, password: PASSWORD, confirmPassword: PASSWORD });
    expect(s.status).toBe(201);
    const login = await c.post('/api/auth/login', { email, password: PASSWORD });
    expect(login.status).toBe(403);
    expect(login.body.error.code).toBe('email_unverified');
    for (let i = 0; i < 4; i++) expect((await c.post('/api/auth/verify-email', { email, code: '000000' })).status).toBe(400);
    expect((await c.post('/api/auth/verify-email', { email, code: '000000' })).status).toBe(429);
    // even the right code no longer works once locked: a new code must be requested
    const locked = await c.post('/api/auth/verify-email', { email, code: s.body.devCode });
    expect(locked.status).toBe(429);
  });

  it('password reset proves the inbox and signs out other sessions', async () => {
    const email = (await a.owner.get('/api/auth/session')).body.user.email;
    const c = new Client(await getApp());
    const f = await c.post('/api/auth/forgot', { email });
    expect(f.status).toBe(200);
    const unknown = await c.post('/api/auth/forgot', { email: 'nobody@example.com' });
    expect(Object.keys(unknown.body).sort()).toEqual(['email', 'resendIn']); // same shape, no code, no hint
    const r = await c.post('/api/auth/reset', { email, code: f.body.devCode, password: 'Brand-new-pass-77', confirmPassword: 'Brand-new-pass-77' });
    expect(r.status).toBe(200);
    expect((await a.owner.get('/api/auth/session')).body.user).toBeNull(); // old session is gone
    const back = await a.owner.post('/api/auth/login', { email, password: 'Brand-new-pass-77' });
    expect(back.status).toBe(200);
  });

  it('roles are enforced on the server', async () => {
    const tech = await a.as('technician');
    expect((await tech.post('/api/leads', {})).status).toBe(403);
    expect((await tech.get('/api/invoices')).status).toBe(403);
    expect((await tech.put('/api/settings', {})).status).toBe(403);
    const wh = await a.as('warehouse');
    expect((await wh.post('/api/jobs/1/payments', { amountPaise: 100, method: 'cash', receivedOn: todayIst() })).status).toBe(403);
  });

  it('invitations: the invitee sets a password and joins the same workspace', async () => {
    const inv = await a.owner.post('/api/team/invite', { name: 'New Tech', email: `newtech.${Date.now()}@test.example`, role: 'technician', hourlyCostPaise: 30000 });
    expect(inv.status).toBe(200);
    const token = inv.body.inviteUrl.split('/invite/')[1];
    const c = new Client(await getApp());
    expect((await c.get(`/api/auth/invite/${token}`)).status).toBe(200);
    const acc = await c.post('/api/auth/invite/accept', { token, password: PASSWORD, confirmPassword: PASSWORD });
    expect(acc.status).toBe(200);
    const me = await c.get('/api/auth/session');
    expect(me.body.user.companyId).toBe(a.companyId);
    expect(me.body.user.role).toBe('technician');
    expect((await c.post('/api/auth/invite/accept', { token, password: PASSWORD, confirmPassword: PASSWORD })).status).toBe(404);
  });

  it('only the director can change roles; a role change signs the person out', async () => {
    const sales = await a.as('sales');
    const team = (await a.owner.get('/api/team')).body.people as { id: number; role: string }[];
    const salesId = team.find((p) => p.role === 'sales')!.id;
    expect((await sales.patch(`/api/team/${salesId}`, { role: 'owner' })).status).toBe(403);
    expect((await a.owner.patch(`/api/team/${salesId}`, { role: 'support' })).status).toBe(200);
    expect((await sales.get('/api/auth/session')).body.user).toBeNull();
  });
});

describe('need to know', () => {
  it('a technician sees the customer, but not the link to their private page', async () => {
    const tech = await a.as('technician');
    const seen = await tech.get(`/api/customers/${aCustomerId}`);
    expect(seen.status).toBe(200);
    expect(seen.body.customer.name).toBe('Private Person');
    expect(seen.body.customer.portal_token).toBeUndefined();
    // (the sales person became support in the test above; the director shares links too)
    expect((await a.owner.get(`/api/customers/${aCustomerId}`)).body.customer.portal_token).toEqual(expect.any(String));
  });

  it('purchase costs are shown only to the roles that buy, stock and account', async () => {
    const withCost = (await (await a.as('warehouse')).get('/api/products')).body.products as { unit_cost_paise: number | null }[];
    expect(withCost.length).toBeGreaterThan(0);
    expect(withCost.every((p) => p.unit_cost_paise !== null)).toBe(true);
    for (const role of ['technician', 'support'] as const) {
      const rows = (await (await a.as(role)).get('/api/products')).body.products as { unit_cost_paise: number | null; sale_price_paise: number }[];
      expect(rows.every((p) => p.unit_cost_paise === null)).toBe(true);
      expect(rows.every((p) => p.sale_price_paise > 0 || p.sale_price_paise === 0)).toBe(true);
    }
  });

  it('a forwarded customer link can be replaced; the old one stops working at once', async () => {
    const sales = a.owner;
    const before = (await sales.get(`/api/customers/${aCustomerId}`)).body.customer.portal_token as string;
    const anyone = new Client(await getApp());
    expect((await anyone.get(`/api/public/portal/${before}`)).status).toBe(200);
    expect((await (await a.as('technician')).post(`/api/customers/${aCustomerId}/new-link`, {})).status).toBe(403);
    expect((await sales.post(`/api/customers/${aCustomerId}/new-link`, {})).status).toBe(200);
    const after = (await sales.get(`/api/customers/${aCustomerId}`)).body.customer.portal_token as string;
    expect(after).not.toBe(before);
    expect((await anyone.get(`/api/public/portal/${before}`)).status).toBe(404);
    expect((await anyone.get(`/api/public/portal/${after}`)).status).toBe(200);
    const trail = await asSystem(() => query(`SELECT action FROM audit_log WHERE company_id = $1 AND action = 'customer.new_link'`, [a.companyId]));
    expect(trail.rowCount).toBe(1);
  });

  it('another workspace can’t replace this workspace’s customer link', async () => {
    const bSales = await b.as('sales');
    expect((await bSales.post(`/api/customers/${aCustomerId}/new-link`, {})).status).toBe(404);
  });
});
