/**
 * The demo simulation drives every domain function through months of history; then each visitor
 * gets a private copy. This checks both, at a small scale.
 */
import { describe, expect, it } from 'vitest';
import { asCompany, asSystem, query } from '../src/db/pool.js';
import { buildTemplate, createDemoWorkspace } from '../src/db/demo.js';
import { loadSecret } from '../src/lib/secrets.js';

describe('demo workspaces', () => {
  let templateId: number;

  it('simulates a consistent history', async () => {
    await loadSecret();
    templateId = await buildTemplate({ days: 21, perDay: 1.2 }, 7);
    const counts = await asCompany(templateId, () =>
      query<Record<string, number>>(
        `SELECT (SELECT count(*) FROM leads)::int AS leads, (SELECT count(*) FROM jobs)::int AS jobs,
                (SELECT count(*) FROM jobs WHERE status IN ('installed', 'closed'))::int AS installed,
                (SELECT count(*) FROM serial_units WHERE warranty_end IS NOT NULL)::int AS warranties,
                (SELECT count(*) FROM tickets)::int AS tickets,
                (SELECT count(*) FROM products WHERE on_hand < 0)::int AS negative_stock,
                (SELECT count(*) FROM serial_units su JOIN jobs j ON j.id = su.job_id WHERE su.status = 'installed' AND su.customer_id <> j.customer_id)::int AS wrong_customer`,
      ),
    );
    const c = counts.rows[0]!;
    expect(c.leads).toBeGreaterThan(20);
    expect(c.installed).toBeGreaterThan(10);
    expect(c.warranties).toBeGreaterThan(50);
    expect(c.tickets).toBeGreaterThan(2);
    expect(c.negative_stock).toBe(0);
    expect(c.wrong_customer).toBe(0);
    // stock on hand equals the ledger for every product
    const drift = await asCompany(templateId, () =>
      query<{ n: number }>(
        `SELECT count(*)::int AS n FROM products p
          WHERE p.tracking <> 'none' AND p.on_hand <> coalesce((SELECT sum(CASE WHEN m.direction = 'in' THEN m.qty ELSE -m.qty END) FROM stock_moves m WHERE m.product_id = p.id), 0)`,
      ),
    );
    expect(drift.rows[0]!.n).toBe(0);
  });

  it('copies it into a private workspace for each visitor, ids and tokens all new', async () => {
    const one = await createDemoWorkspace();
    const two = await createDemoWorkspace();
    expect(one.companyId).not.toBe(two.companyId);
    const count = (id: number) => asCompany(id, () => query<{ jobs: number; serials: number; tokens: number }>(
      `SELECT (SELECT count(*) FROM jobs)::int AS jobs, (SELECT count(*) FROM serial_units)::int AS serials,
              (SELECT count(*) FROM customers c WHERE c.portal_token IN (SELECT portal_token FROM customers WHERE company_id = ${templateId}))::int AS tokens`,
    ));
    const [t, a, b] = await Promise.all([count(templateId), count(one.companyId), count(two.companyId)]);
    expect(a.rows[0]!.jobs).toBe(t.rows[0]!.jobs);
    expect(a.rows[0]!.serials).toBe(t.rows[0]!.serials);
    expect(a.rows[0]!.tokens).toBe(0);
    expect(b.rows[0]!.jobs).toBe(t.rows[0]!.jobs);
    // every reference stays inside the copy
    const leaks = await asSystem(() =>
      query<{ n: number }>(
        `SELECT count(*)::int AS n FROM serial_units su JOIN jobs j ON j.id = su.job_id WHERE su.company_id = $1 AND j.company_id <> $1`,
        [one.companyId],
      ),
    );
    expect(leaks.rows[0]!.n).toBe(0);
    const owner = await asCompany(one.companyId, () => query<{ role: string }>(`SELECT role FROM users WHERE id = $1`, [one.ownerId]));
    expect(owner.rows[0]!.role).toBe('owner');
  });
});
