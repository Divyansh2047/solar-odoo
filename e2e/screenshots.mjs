// Screenshot matrix: every main screen × desktop/phone × light/dark, for the UI critique loop.
// Usage: BASE_URL=http://localhost:5173 node e2e/screenshots.mjs [filter]
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE_URL ?? 'http://localhost:5173';
const OUT = process.env.OUT ?? 'e2e/shots';
const filter = process.argv[2];
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const errors = [];

// one demo workspace shared by all shots
const setup = await browser.newContext();
const sp = await setup.newPage();
await sp.goto(BASE + '/signin');
const res = await sp.evaluate(() => fetch('/api/auth/demo', { method: 'POST', headers: { 'X-Requested-With': 'arka' } }).then((r) => r.status));
if (res !== 201) throw new Error(`demo failed: ${res}`);
const cookies = await setup.cookies();
const ids = await sp.evaluate(async () => {
  const j = await fetch('/api/jobs').then((r) => r.json());
  const t = await fetch('/api/tickets?open=1').then((r) => r.json());
  const w = await fetch('/api/warehouse').then((r) => r.json());
  const l = await fetch('/api/leads').then((r) => r.json());
  const q = await fetch('/api/quotes?status=sent').then((r) => r.json());
  const nav = await fetch('/api/nav').then((r) => r.json());
  const installed = j.jobs.find((x) => x.status === 'installed' || x.status === 'closed');
  const detail = installed ? await fetch(`/api/jobs/${installed.id}`).then((r) => r.json()) : null;
  const portal = detail ? { customer: { portal_token: detail.job.portal_token } } : null;
  return {
    job: j.jobs.find((x) => x.status === 'installed')?.id ?? j.jobs[0].id,
    delivered: j.jobs.find((x) => x.status === 'delivered')?.id,
    ticket: t.tickets.find((x) => x.priority === 'urgent')?.id ?? t.tickets[0]?.id,
    pick: w.picks.find((x) => x.status === 'packed')?.id ?? w.picks[0]?.id,
    lead: l.leads.find((x) => x.status === 'new')?.id ?? l.leads[0].id,
    quote: q.quotes[0]?.id,
    key: nav.public_key,
    portal: portal?.customer?.portal_token,
  };
});
await setup.close();

const pages = [
  ['landing', '/', false],
  ['signin', '/signin', false],
  ['signup', '/signup', false],
  ['dashboard', '/app', true],
  ['enquiries', '/app/enquiries', true],
  ['enquiry', `/app/enquiries/${ids.lead}`, true],
  ['surveys', '/app/surveys', true],
  ['quote', `/app/quotes/${ids.quote}`, true],
  ['jobs', '/app/jobs', true],
  ['job', `/app/jobs/${ids.job}`, true],
  ['install-form', `/app/jobs/${ids.delivered}/install`, true],
  ['warehouse', '/app/warehouse', true],
  ['picklist', `/app/warehouse/pick/${ids.pick}`, true],
  ['schedule', '/app/schedule', true],
  ['service', '/app/service', true],
  ['ticket', `/app/service/${ids.ticket}`, true],
  ['money', '/app/money/invoices', true],
  ['subsidy', '/app/money/subsidy', true],
  ['reports', '/app/reports', true],
  ['catalog', '/app/catalog', true],
  ['settings', '/app/settings', true],
  ['enquire-public', `/enquire/${ids.key}`, false],
  ['portal', `/my/${ids.portal}`, false],
].filter(([n]) => !filter || filter.split(',').some((f) => n === f));

const sizes = [
  ['desktop', { width: 1440, height: 900 }],
  ['phone', { width: 390, height: 844 }],
];
for (const [scheme] of [['light'], ['dark']]) {
  for (const [sizeName, viewport] of sizes) {
    const ctx = await browser.newContext({ viewport, colorScheme: scheme, deviceScaleFactor: 1 });
    await ctx.addCookies(cookies);
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errors.push(`${e.message}`));
    for (const [name, path] of pages) {
      try {
        await p.goto(BASE + path, { waitUntil: 'networkidle', timeout: 45000 });
        await p.waitForFunction(() => !document.querySelector('.skeleton'), null, { timeout: 20000 }).catch(() => errors.push(`${name}: still loading after 20s`));
        await p.waitForTimeout(name === 'landing' ? 2500 : 900);
        await p.screenshot({ path: `${OUT}/${name}-${sizeName}-${scheme}.png`, fullPage: false });
        const wide = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        if (wide > 1) errors.push(`${name} ${sizeName}: page scrolls sideways by ${wide}px`);
      } catch (e) {
        errors.push(`${name} ${sizeName} ${scheme}: ${String(e.message).slice(0, 120)}`);
      }
    }
    await ctx.close();
  }
}
await browser.close();
console.log(`shots in ${OUT}; ${errors.length} errors`);
for (const e of [...new Set(errors)].slice(0, 20)) console.log(' -', e);
