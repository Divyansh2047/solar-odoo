// Accessibility audit (axe-core, WCAG 2.1 AA) of the main screens in light and dark.
// Usage: BASE_URL=http://localhost:4100 node e2e/a11y.mjs
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';

const BASE = process.env.BASE_URL ?? 'http://localhost:5173';
const browser = await chromium.launch();
const setup = await browser.newContext();
const sp = await setup.newPage();
await sp.goto(BASE + '/signin');
await sp.evaluate(() => fetch('/api/auth/demo', { method: 'POST', headers: { 'X-Requested-With': 'arka' } }));
const cookies = await setup.cookies();
const ids = await sp.evaluate(async () => {
  const j = await fetch('/api/jobs?open=0').then((r) => r.json());
  const t = await fetch('/api/tickets?open=1').then((r) => r.json());
  const nav = await fetch('/api/nav').then((r) => r.json());
  return { job: (j.jobs.find((x) => x.status === 'installed') ?? j.jobs.find((x) => x.status === 'closed'))?.id, ticket: t.tickets[0]?.id, key: nav.public_key };
});
await setup.close();
const pages = ['/signin', '/signup', '/app', '/app/enquiries', '/app/jobs', `/app/jobs/${ids.job}`, '/app/warehouse', '/app/service', `/app/service/${ids.ticket}`, '/app/money/invoices', '/app/reports', '/app/schedule', `/enquire/${ids.key}`];
let total = 0;
for (const scheme of ['light', 'dark']) {
  const ctx = await browser.newContext({ colorScheme: scheme, viewport: { width: 1366, height: 900 } });
  await ctx.addCookies(cookies);
  const p = await ctx.newPage();
  for (const path of pages) {
    await p.goto(BASE + path, { waitUntil: 'networkidle' });
    await p.waitForFunction(() => !document.querySelector('.skeleton, [aria-busy="true"]'), null, { timeout: 20000 }).catch(() => console.log(`[${scheme}] ${path}  still loading after 20 s`));
    await p.waitForTimeout(500);
    const r = await new AxeBuilder({ page: p }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).exclude('canvas').analyze();
    for (const v of r.violations) {
      total++;
      console.log(`[${scheme}] ${path}  ${v.impact}  ${v.id}: ${v.help} (${v.nodes.length})`);
      for (const n of v.nodes.slice(0, 2)) console.log(`     ${n.target.join(' ')}  ${(n.failureSummary ?? '').split('\n').slice(1, 2).join(' ').slice(0, 160)}`);
    }
  }
  await ctx.close();
}
await browser.close();
console.log(`\n${total} violation groups`);
