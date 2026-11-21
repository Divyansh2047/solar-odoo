// End-to-end smoke test of the judges' path, in a real browser against a running server.
// Usage: BASE_URL=http://localhost:5173 node e2e/smoke.mjs   (or the production build on :4000)
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL ?? 'http://localhost:5173';
const results = [];
const errors = [];
const check = (name, ok, extra = '') => {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  (${extra})` : ''}`);
  console.log(results.at(-1));
};
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});

async function newPage(ctx, label) {
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(`[${label}] ${e.message}`));
  p.on('console', (m) => {
    if (m.type() === 'error' && !/401|403|409|404|Failed to load resource|WebGL/.test(m.text())) errors.push(`[${label}] ${m.text()}`);
  });
  return p;
}
const step = async (name, fn) => {
  try {
    const extra = await fn();
    check(name, true, extra ?? '');
  } catch (e) {
    check(name, false, String(e.message ?? e).split('\n')[0].slice(0, 180));
  }
};

const director = await browser.newContext({ viewport: { width: 1366, height: 900 } });
const d = await newPage(director, 'director');

await step('landing page loads with a demo button above the fold', async () => {
  await d.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  const btn = d.getByRole('button', { name: /live demo/i }).first();
  await btn.waitFor({ timeout: 20000 });
  const box = await btn.boundingBox();
  if (!box || box.y > 900) throw new Error('demo button below the fold');
});

await step('one-click demo opens a private SunPower workspace', async () => {
  await d.getByRole('button', { name: /live demo/i }).first().click();
  await d.waitForURL(/\/app/, { timeout: 90000 });
  await d.getByRole('heading', { name: 'Dashboard' }).waitFor({ timeout: 30000 });
  await d.getByText('SunPower Solutions,').first().waitFor();
});

await step('director sees the month module and profit per job', async () => {
  await d.getByText('Which installations made money').waitFor();
  const rows = await d.locator('.profit-row').count();
  if (rows < 3) throw new Error(`only ${rows} profit rows`);
  return `${rows} jobs listed`;
});

await step('search finds a customer and their covered inverter in under two seconds', async () => {
  await d.keyboard.press('Control+k');
  const t0 = Date.now();
  await d.getByPlaceholder('Name, phone, serial or reference…').fill('Dipika');
  await d.getByText('Dipika Raval').first().waitFor({ timeout: 5000 });
  const ms = Date.now() - t0;
  await d.keyboard.press('Escape');
  if (ms > 2000) throw new Error(`${ms} ms`);
  return `${ms} ms`;
});

await step('rainy-season ticket is under warranty and shows ₹0 to the customer', async () => {
  await d.goto(BASE + '/app/service');
  await d.locator('tr', { hasText: 'Pouring rain' }).first().click();
  await d.getByText('Free for the customer: under warranty').waitFor({ timeout: 10000 });
});

await step('public enquiry lands in sales live, in another session, without a reload', async () => {
  await d.goto(BASE + '/app/enquiries');
  await d.getByRole('heading', { name: 'Enquiries', exact: true }).waitFor();
  const nav = await d.evaluate(() => fetch('/api/nav').then((r) => r.json()));
  const visitor = await browser.newContext();
  const v = await newPage(visitor, 'visitor');
  await v.goto(`${BASE}/enquire/${nav.public_key}`);
  await v.getByLabel('Your name', { exact: true }).fill('Live Test Homeowner');
  await v.getByLabel('Mobile', { exact: true }).fill('9876512345');
  await v.getByLabel('Address', { exact: true }).fill('21, Gulmohar Park, Satellite');
  await v.getByLabel('City', { exact: true }).fill('Ahmedabad');
  await v.getByLabel('PIN code').fill('380015');
  await v.getByLabel(/may call or WhatsApp me/).check();
  await v.getByRole('button', { name: 'Send enquiry' }).click();
  await v.getByText(/has reached our team/).waitFor({ timeout: 10000 });
  await d.getByText('Live Test Homeowner').first().waitFor({ timeout: 10000 });
  await visitor.close();
});

await step('dispatch day: packed off-grid kit leaves with every serial recorded', async () => {
  await d.goto(BASE + '/app/warehouse');
  const card = d.locator('a.card-row', { hasText: 'Bharatbhai' }).first();
  await card.click();
  await d.getByRole('button', { name: 'Dispatch' }).click();
  await d.getByLabel('Vehicle number').fill('GJ02XY4321');
  await d.getByLabel('Driver', { exact: true }).fill('Salim Pathan');
  await d.getByRole('button', { name: 'Dispatch now' }).click();
  // the toast is brief; the dispatched page (vehicle number on screen) proves it too
  await d.getByText(/On the truck:|GJ02XY4321/).first().waitFor({ timeout: 15000 });
});

await step('role switch: the technician sees their day on a phone', async () => {
  const people = await d.evaluate(() => fetch('/api/auth/demo/people').then((r) => r.json()));
  const tech = people.people.find((p) => p.role === 'technician');
  await d.evaluate((id) => fetch('/api/auth/demo/switch', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'arka' }, body: JSON.stringify({ userId: id }) }), tech.id);
  await d.setViewportSize({ width: 390, height: 844 });
  await d.goto(BASE + '/app');
  await d.getByRole('heading', { name: /Your day|Tomorrow/ }).waitFor({ timeout: 10000 });
  const tabbar = await d.locator('.tabbar').isVisible();
  if (!tabbar) throw new Error('no mobile tab bar');
});

const signup = await browser.newContext();
const s = await newPage(signup, 'signup');
await step('sign-up validates, verifies email by code, opens an empty workspace', async () => {
  await s.goto(BASE + '/signup');
  await s.getByRole('button', { name: 'Create workspace' }).click();
  await s.getByText('Enter at least 2 characters').first().waitFor();
  const email = `e2e.${Date.now()}@test.example`;
  await s.getByLabel('Company name').fill('Surya Rooftops');
  await s.getByLabel('Your name').fill('Asha Patel');
  await s.getByLabel('Work email').fill(email);
  await s.getByLabel('Password', { exact: true }).fill('Rooftop-solar-26');
  await s.getByLabel('Type it again').fill('Rooftop-solar-26');
  await s.getByRole('button', { name: 'Create workspace' }).click();
  await s.waitForURL(/\/verify/);
  const code = await s.locator('.callout .mono').innerText();
  await s.getByLabel('Code').fill(code.trim());
  await s.getByRole('button', { name: 'Confirm email' }).click();
  await s.waitForURL(/\/app/, { timeout: 20000 });
  await s.getByRole('heading', { name: 'Dashboard' }).waitFor();
  await s.getByText('Surya Rooftops,').first().waitFor();
});

await browser.close();
const unexpected = [...new Set(errors)];
if (unexpected.length) console.log('\nConsole errors:\n' + unexpected.slice(0, 10).join('\n'));
const failed = results.filter((r) => r.startsWith('FAIL')).length;
console.log(`\n${results.length - failed} passed, ${failed} failed, ${unexpected.length} unexpected console errors`);
process.exit(failed || unexpected.length ? 1 : 0);
