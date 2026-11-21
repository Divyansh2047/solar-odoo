/**
 * The brief's "week at SunPower", scene by scene, through the real HTTP API and a real database.
 * Each `it` is one scene; together they take one homeowner from the web form to a covered repair
 * 18 months later, and end at the director's month-end numbers.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { addMonths } from '@arka/shared';
import { asSystem, query } from '../src/db/pool.js';
import { Client, getApp, newWorkspace, png, sig, at, todayIst, type Workspace } from './helpers.js';

let ws: Workspace;
let leadId: number;
let surveyId: number;
let quoteId: number;
let quoteToken: string;
let jobId: number;
let pickId: number;
let inverterSerial: string;
let portalToken: string;

beforeAll(async () => {
  ws = await newWorkspace('SunPower');
});

describe('Scene 1 — the rooftop inquiry', () => {
  it('lands with sales straight away from the public web form', async () => {
    const visitor = new Client(await getApp());
    const form = await visitor.get(`/api/public/enquiry/${ws.publicKey}`);
    expect(form.status).toBe(200);
    const r = await visitor.post(`/api/public/enquiry/${ws.publicKey}`, {
      name: 'Ritu Malhotra',
      phone: '98240 11223',
      email: 'ritu@example.com',
      address: '14, Shanti Park, Satellite',
      city: 'Ahmedabad',
      pincode: '380015',
      customerKind: 'home',
      systemType: 'on_grid',
      requestedKw: 3,
      wantsSubsidy: true,
      consent: true,
    });
    expect(r.status).toBe(201);
    expect(r.body.ref).toMatch(/^ENQ-\d{4}$/);

    const sales = await ws.as('sales');
    const list = await sales.get('/api/leads');
    const lead = list.body.leads.find((l: { phone: string }) => l.phone === '+919824011223');
    expect(lead).toBeTruthy();
    expect(lead.status).toBe('new');
    leadId = lead.id;
    const notes = await sales.get('/api/notifications');
    expect(notes.body.notifications.some((n: { title: string }) => n.title.includes('Ritu Malhotra'))).toBe(true);
  });

  it('validates the form the same way on the server', async () => {
    const visitor = new Client(await getApp());
    const r = await visitor.post(`/api/public/enquiry/${ws.publicKey}`, {
      name: 'R',
      phone: '12345',
      address: 'x',
      city: '',
      pincode: '012345',
      customerKind: 'home',
      systemType: 'on_grid',
      consent: false,
    });
    expect(r.status).toBe(400);
    expect(Object.keys(r.body.error.fields)).toEqual(expect.arrayContaining(['name', 'phone', 'address', 'city', 'pincode', 'consent']));
  });

  it('never vanishes: a repeat enquiry attaches to the open one, and closing needs a reason', async () => {
    const visitor = new Client(await getApp());
    await visitor.post(`/api/public/enquiry/${ws.publicKey}`, {
      name: 'Ritu Malhotra',
      phone: '+91 9824011223',
      address: '14, Shanti Park, Satellite',
      city: 'Ahmedabad',
      pincode: '380015',
      customerKind: 'home',
      systemType: 'on_grid',
      consent: true,
      message: 'Any update?',
    });
    const sales = await ws.as('sales');
    const list = await sales.get('/api/leads?q=Ritu');
    expect(list.body.leads).toHaveLength(1);
    const close = await sales.post(`/api/leads/${leadId}/close`, {});
    expect(close.status).toBe(400);
    const del = await sales.a.delete(`/api/leads/${leadId}`).set('x-requested-with', 'arka');
    expect(del.status).toBe(404); // there is no way to delete an enquiry
  });

  it('records the qualification call and recommends a size', async () => {
    const sales = await ws.as('sales');
    const call = await sales.post(`/api/leads/${leadId}/activities`, { kind: 'call', body: 'Called; flat RCC roof, no shade.' });
    expect(call.status).toBe(200);
    const q = await sales.post(`/api/leads/${leadId}/qualify`, {
      roofAreaSqft: 450,
      monthlyBillRupees: 3200,
      gridConnection: 'single_phase',
      roofType: 'rcc',
      shading: 'none',
      systemType: 'on_grid',
      gridSuitable: true,
      outcome: 'qualified',
    });
    expect(q.status).toBe(200);
    expect(q.body.recommendedKw).toBe(4);
    const d = await sales.get(`/api/leads/${leadId}`);
    expect(d.body.lead.status).toBe('qualified');
    expect(d.body.lead.first_contact_at).toBeTruthy();
  });

  it('refuses a quote before the survey is approved', async () => {
    const sales = await ws.as('sales');
    const kits = await sales.get('/api/kits');
    const ong3 = kits.body.kits.find((k: { code: string }) => k.code === 'ONG-3');
    const r = await sales.post('/api/quotes', { leadId, templateId: ong3.id });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('survey_not_approved');
  });

  it('sends a technician to measure roof direction, tilt and cable distance', async () => {
    const sales = await ws.as('sales');
    const tech = ws.people.technician![0]!;
    const s = await sales.post('/api/surveys', { leadId, technicianId: tech, startsAt: at(1, 10), durationMinutes: 90 });
    expect(s.status).toBe(200);
    surveyId = s.body.id;
    // the same technician can't be in two places at once
    const clash = await sales.post('/api/surveys', { leadId, technicianId: tech, startsAt: at(1, 10), durationMinutes: 60 });
    expect(clash.status).toBe(409);

    const techClient = await ws.as('technician', 0);
    const photo = await techClient.upload('/api/files?purpose=survey_photo', png(3));
    expect(photo.status).toBe(200);
    const bad = await techClient.post(`/api/surveys/${surveyId}/submit`, { azimuthDeg: 400, tiltDeg: 90, cableDistanceM: 0 });
    expect(bad.status).toBe(400);
    expect(Object.keys(bad.body.error.fields)).toEqual(expect.arrayContaining(['azimuthDeg', 'tiltDeg', 'cableDistanceM', 'photoIds']));
    const sub = await techClient.post(`/api/surveys/${surveyId}/submit`, {
      azimuthDeg: 180,
      tiltDeg: 18,
      usableAreaSqft: 420,
      cableDistanceM: 20,
      structureType: 'elevated_low',
      roofType: 'rcc',
      shading: 'none',
      earthingPossible: true,
      recommendedKw: 3,
      photoIds: [photo.body.id],
    });
    expect(sub.status).toBe(200);
    const rev = await sales.post(`/api/surveys/${surveyId}/review`, { decision: 'approve' });
    expect(rev.status).toBe(200);
  });
});

describe('Scene 2 — getting the kit right', () => {
  it('builds the quote from a template; the exact parts list follows on its own', async () => {
    const sales = await ws.as('sales');
    const kits = await sales.get('/api/kits');
    const ong3 = kits.body.kits.find((k: { code: string }) => k.code === 'ONG-3');
    const r = await sales.post('/api/quotes', { leadId, templateId: ong3.id });
    expect(r.status).toBe(200);
    quoteId = r.body.id;
    const q = await sales.get(`/api/quotes/${quoteId}`);
    const bySku = Object.fromEntries(q.body.lines.map((l: { sku: string; qty: number }) => [l.sku, l.qty]));
    expect(bySku['PNL-550']).toBe(6); // panels
    expect(bySku['INV-OG-3']).toBe(1); // inverter
    expect(bySku['STR-GI']).toBe(6); // a stand per panel
    expect(bySku['SW-DCISO']).toBe(1); // switches
    expect(bySku['SW-MCB32']).toBe(1);
    expect(bySku['EARTH-KIT']).toBe(3); // safety
    expect(bySku['LA-ESE']).toBe(1);
    expect(bySku['CBL-DC4']).toBe(Math.ceil(2 * 20 * 1.1)); // wires sized from the survey's 20 m cable run
    expect(bySku['SVC-INSTALL']).toBe(3); // installation per kW
    expect(q.body.quote.subsidy_paise).toBe(78_000_00); // PM Surya Ghar for 3 kW
    const sum = q.body.lines.reduce((s: number, l: { amount_paise: number }) => s + l.amount_paise, 0);
    expect(q.body.quote.subtotal_paise).toBe(sum);
    expect(q.body.quote.total_paise).toBe(q.body.quote.subtotal_paise + q.body.quote.tax_paise);
    quoteToken = q.body.quote.public_token;
  });

  it('the customer reads and accepts it online', async () => {
    const sales = await ws.as('sales');
    const draftView = await new Client(await getApp()).get(`/api/public/quotes/${quoteToken}`);
    expect(draftView.status).toBe(404); // drafts aren't visible to customers
    expect((await sales.post(`/api/quotes/${quoteId}/send`)).status).toBe(200);
    const customer = new Client(await getApp());
    const view = await customer.get(`/api/public/quotes/${quoteToken}`);
    expect(view.status).toBe(200);
    expect(view.body.quote.created_by).toBeUndefined();
    const acc = await customer.post(`/api/public/quotes/${quoteToken}/accept`, { name: 'Ritu Malhotra', agree: true });
    expect(acc.status).toBe(200);
    expect(acc.body.jobRef).toMatch(/^JOB-/);
    const again = await customer.post(`/api/public/quotes/${quoteToken}/accept`, { name: 'Ritu Malhotra', agree: true });
    expect(again.status).toBe(409);
    const jobs = await sales.get('/api/jobs');
    jobId = jobs.body.jobs.find((j: { ref: string }) => j.ref === acc.body.jobRef).id;
  });

  it('the advance confirms the order: the warehouse gets a pick list and the crew gets the job', async () => {
    const accounts = await ws.as('accounts');
    const job = (await accounts.get(`/api/jobs/${jobId}`)).body;
    expect(job.job.status).toBe('awaiting_advance');
    const over = await accounts.post(`/api/jobs/${jobId}/payments`, { amountPaise: job.job.total_paise + 100, method: 'upi', receivedOn: todayIst() });
    expect(over.status).toBe(409);
    const noUtr = await accounts.post(`/api/jobs/${jobId}/payments`, { amountPaise: job.job.advance_required_paise, method: 'bank_transfer', receivedOn: todayIst() });
    expect(noUtr.status).toBe(400);
    const pay = await accounts.post(`/api/jobs/${jobId}/payments`, { amountPaise: job.job.advance_required_paise, method: 'upi', reference: 'UTR123456', receivedOn: todayIst() });
    expect(pay.status).toBe(200);
    expect(pay.body.confirmed).toBe(true);
    const after = (await accounts.get(`/api/jobs/${jobId}`)).body;
    expect(after.job.status).toBe('confirmed');
    expect(after.pick).toBeTruthy();
    pickId = after.pick.id;
    const install = after.visits.find((v: { kind: string }) => v.kind === 'installation');
    expect(install.crew.length).toBeGreaterThanOrEqual(2);
    const wh = await ws.as('warehouse');
    const n = await wh.get('/api/notifications');
    expect(n.body.notifications.some((x: { title: string }) => x.title.startsWith('Pack'))).toBe(true);
  });
});

describe('Scene 3 — dispatch day and serial numbers', () => {
  it('receives stock with a serial for every unit', async () => {
    const wh = await ws.as('warehouse');
    const products = (await wh.get('/api/products')).body.products as { id: number; sku: string; tracking: string }[];
    const pid = (sku: string) => products.find((p) => p.sku === sku)!.id;
    const missing = await wh.post('/api/purchases', {
      supplierName: 'Suryoday Modules',
      receivedOn: todayIst(),
      lines: [{ productId: pid('PNL-550'), qty: 6, unitCostPaise: 1_220_000, serials: ['PNL0001'] }],
    });
    expect(missing.status).toBe(400);
    const lines = (await wh.get(`/api/warehouse/pick/${pickId}`)).body.lines as { product_id: number; qty: number; tracking: string; sku: string }[];
    const serialsFor = (sku: string, n: number) => Array.from({ length: n }, (_, i) => `${sku.replace(/-/g, '')}T${String(i + 1).padStart(4, '0')}`);
    const r = await wh.post('/api/purchases', {
      supplierName: 'Mixed Supplies',
      receivedOn: todayIst(),
      lines: [
        ...lines.map((l) => ({ productId: l.product_id, qty: l.qty, unitCostPaise: 10_000, serials: l.tracking === 'serial' ? serialsFor(l.sku, l.qty) : undefined })),
        { productId: pid('INV-OG-5'), qty: 1, unitCostPaise: 3_550_000, serials: ['INVOG5SPARE01'] },
      ],
    });
    expect(r.status).toBe(200);
    const dup = await wh.post('/api/purchases', { supplierName: 'Another Trader', receivedOn: todayIst(), lines: [{ productId: pid('INV-OG-3'), qty: 1, unitCostPaise: 1, serials: ['INVOG3T0001'] }] });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('serial_taken');
  });

  it('refuses to dispatch until every serial is scanned, and explains wrong scans', async () => {
    const wh = await ws.as('warehouse');
    const early = await wh.post(`/api/warehouse/pick/${pickId}/dispatch`, { vehicleNo: 'GJ01AB1234', driverName: 'Bharat Rabari' });
    expect(early.status).toBe(409);
    expect(early.body.error.code).toBe('scan_incomplete');
    expect((await wh.post(`/api/warehouse/pick/${pickId}/scan`, { serial: 'NOPE0000' })).status).toBe(404);
    const wrong = await wh.post(`/api/warehouse/pick/${pickId}/scan`, { serial: 'INVOG5SPARE01' });
    expect(wrong.status).toBe(409);
    expect(wrong.body.error.code).toBe('wrong_product');
    const lines = (await wh.get(`/api/warehouse/pick/${pickId}`)).body.lines as { tracking: string; sku: string; qty: number }[];
    for (const l of lines.filter((x) => x.tracking === 'serial')) {
      for (let i = 1; i <= l.qty; i++) {
        const s = await wh.post(`/api/warehouse/pick/${pickId}/scan`, { serial: `${l.sku.replace(/-/g, '')}t${String(i).padStart(4, '0')}`.toUpperCase() });
        expect(s.status).toBe(200);
      }
    }
    const extra = await wh.post(`/api/warehouse/pick/${pickId}/scan`, { serial: 'PNL550T0001' });
    expect(extra.status).toBe(409);
    expect((await wh.post(`/api/warehouse/pick/${pickId}/pack`)).status).toBe(200);
    const badVehicle = await wh.post(`/api/warehouse/pick/${pickId}/dispatch`, { vehicleNo: 'NOT A PLATE', driverName: 'B' });
    expect(badVehicle.status).toBe(400);
    const d = await wh.post(`/api/warehouse/pick/${pickId}/dispatch`, { vehicleNo: 'gj 01 ab 1234', driverName: 'Bharat Rabari' });
    expect(d.status).toBe(200);
    expect(d.body.goodsValuePaise).toBeGreaterThan(0);
    // which unit went to which customer
    const inv = (await wh.get(`/api/stock/${await productId(wh, 'INV-OG-3')}`)).body;
    expect(inv.serials.find((s: { serial: string }) => s.serial === 'INVOG3T0001').customer).toBe('Ritu Malhotra');
  });

  it('starts the warranty clock by itself on delivery, per product', async () => {
    const tech = await ws.as('technician', 0);
    const day = todayIst();
    const d = await tech.post(`/api/jobs/${jobId}/deliver`, { deliveredOn: day, receivedBy: 'Ritu Malhotra' });
    expect(d.status).toBe(200);
    const inverter = d.body.warranties.find((w: { product: string }) => w.product.startsWith('Grid-tie'));
    const panel = d.body.warranties.find((w: { product: string }) => w.product.startsWith('Mono PERC'));
    expect(inverter.end).toBe(addMonths(day, 24));
    expect(panel.end).toBe(addMonths(day, 240));
    inverterSerial = inverter.serial;
  });
});

describe('Scene 4 — on the roof', () => {
  it('checks the crew’s form: times, size, photos, signature', async () => {
    const tech = await ws.as('technician', 0);
    const p1 = (await tech.upload('/api/files?purpose=install_photo', png(5))).body.id;
    const p2 = (await tech.upload('/api/files?purpose=install_photo', png(6))).body.id;
    const sgn = (await tech.upload('/api/files?purpose=signature', sig(7))).body.id;
    const notImage = await tech.upload('/api/files?purpose=install_photo', Buffer.from('not really an image'), 'image/png');
    expect(notImage.status).toBe(400);
    const start = new Date(Date.now() - 6 * 3600_000).toISOString();
    const end = new Date(Date.now() - 600_000).toISOString();
    const base = {
      startedAt: start,
      finishedAt: end,
      confirmedKw: 3,
      generationKw: 2.1,
      checklist: { structure: true, panels: true, wiring: true, earthing: true, generation: true },
      photoIds: [p1, p2],
      signatureFileId: sgn,
      signedByName: 'Ritu Malhotra',
      crewIds: [ws.people.technician![0]!],
    };
    expect((await tech.post(`/api/jobs/${jobId}/install-report`, { ...base, finishedAt: start, startedAt: end })).status).toBe(400);
    expect((await tech.post(`/api/jobs/${jobId}/install-report`, { ...base, photoIds: [p1] })).status).toBe(400);
    expect((await tech.post(`/api/jobs/${jobId}/install-report`, { ...base, checklist: { ...base.checklist, earthing: false } })).status).toBe(400);
    const mismatch = await tech.post(`/api/jobs/${jobId}/install-report`, { ...base, confirmedKw: 2.5 });
    expect(mismatch.status).toBe(400);
    expect(mismatch.body.error.fields.sizeMismatchReason).toBeTruthy();
    const ok = await tech.post(`/api/jobs/${jobId}/install-report`, base);
    expect(ok.status).toBe(200);
    expect(ok.body.invoiceNumber).toMatch(/^INV\/\d{2}-\d{2}\/\d{4}$/);
    const job = (await ws.owner.get(`/api/jobs/${jobId}`)).body;
    expect(job.job.status).toBe('installed');
    expect(job.report.signed_by_name).toBe('Ritu Malhotra');
    expect(job.profit.labour_paise).toBeGreaterThan(0);
    portalToken = job.job.portal_token;
  });

  it('gives the customer a page with what was installed', async () => {
    const customer = new Client(await getApp());
    const p = await customer.get(`/api/public/portal/${portalToken}`);
    expect(p.status).toBe(200);
    expect(p.body.serials.some((s: { serial: string }) => s.serial === inverterSerial)).toBe(true);
    expect(p.body.reports[0].photo_ids).toHaveLength(2);
    const img = await customer.get(`/api/public/portal/${portalToken}/files/${p.body.reports[0].signature_file_id}`);
    expect(img.status).toBe(200);
    expect(img.headers['content-type']).toBe('image/png');
  });
});

describe('Scene 5 — the rainy season breakdown', () => {
  it('support finds the customer and the exact inverter serial from a fragment', async () => {
    const support = await ws.as('support');
    const r = await support.get(`/api/search?q=${inverterSerial.slice(-6)}`);
    expect(r.status).toBe(200);
    const hit = r.body.serials.find((s: { serial: string }) => s.serial === inverterSerial);
    expect(hit.customer).toBe('Ritu Malhotra');
    expect(hit.covered).toBe(true);
    const byPhone = await support.get('/api/search?q=24011223');
    expect(byPhone.body.customers[0].name).toBe('Ritu Malhotra');
  });

  it('under warranty: the replacement costs the customer nothing; the cost lands on the job', async () => {
    const support = await ws.as('support');
    const unit = (await support.get(`/api/search?q=${inverterSerial}`)).body.serials[0];
    const t = await support.post('/api/tickets', { customerId: unit.customer_id, serialUnitId: unit.id, channel: 'call', faultCode: 'E-021', description: 'Fault code E-021 and zero power in the rain.', priority: 'urgent' });
    expect(t.status).toBe(200);
    expect(t.body.coverage).toBe('warranty');
    const tech = await ws.as('technician', 1);
    expect((await support.post(`/api/tickets/${t.body.id}/assign`, { technicianId: ws.people.technician![1] })).status).toBe(200);
    expect((await support.post(`/api/tickets/${t.body.id}/confirm`, { method: 'phone' })).status).toBe(409); // not fixed yet
    const profitBefore = (await ws.owner.get(`/api/jobs/${jobId}`)).body.profit.profit_paise;
    const res = await tech.post(`/api/tickets/${t.body.id}/resolve`, {
      resolution: 'Replaced the inverter after a surge.',
      parts: [{ productId: unit.product_id ?? (await productId(tech, 'INV-OG-3')), qty: 1, replacesSerialUnitId: unit.id, newSerial: 'INVOG3SPARE99' }],
      labourHours: 2,
    });
    // there is no INVOG3SPARE99 in stock: the scan is refused with a clear reason
    expect(res.status).toBe(400);
    const wh = await ws.as('warehouse');
    await wh.post('/api/purchases', { supplierName: 'Power Electronics', receivedOn: todayIst(), lines: [{ productId: await productId(wh, 'INV-OG-3'), qty: 1, unitCostPaise: 2_450_000, serials: ['INVOG3SPARE99'] }] });
    const ok = await tech.post(`/api/tickets/${t.body.id}/resolve`, {
      resolution: 'Replaced the inverter after a surge.',
      parts: [{ productId: await productId(tech, 'INV-OG-3'), qty: 1, replacesSerialUnitId: unit.id, newSerial: 'INVOG3SPARE99' }],
      labourHours: 2,
    });
    expect(ok.status).toBe(200);
    expect(ok.body.billedPaise).toBe(0);
    expect(ok.body.invoiceNumber).toBeNull();
    const swapped = (await support.get('/api/search?q=INVOG3SPARE99')).body.serials[0];
    const old = (await ws.owner.get(`/api/serials/${unit.id}`)).body.serial;
    expect(swapped.warranty_end).toBe(old.warranty_end); // replacement keeps the original warranty
    expect(old.status).toBe('replaced');
    const profitAfter = (await ws.owner.get(`/api/jobs/${jobId}`)).body.profit.profit_paise;
    expect(profitAfter).toBe(profitBefore - ok.body.costPaise);

    // closed only when the customer confirms, from their own page
    const customer = new Client(await getApp());
    const c = await customer.post(`/api/public/portal/${portalToken}/tickets/${t.body.id}/confirm`);
    expect(c.status).toBe(200);
    const closed = (await support.get(`/api/tickets/${t.body.id}`)).body.ticket;
    expect(closed.status).toBe('closed');
    expect(closed.confirm_method).toBe('portal');
  });

  it('out of warranty: parts and labour are billed automatically', async () => {
    // jump 30 months ahead for this unit by ending its warranty
    const support = await ws.as('support');
    const unit = (await support.get('/api/search?q=INVOG3SPARE99')).body.serials[0];
    await asSystem(() => query(`UPDATE serial_units SET warranty_start = current_date - 900, warranty_end = current_date - 170 WHERE id = $1`, [unit.id]));
    const t = await support.post('/api/tickets', { customerId: unit.customer_id, serialUnitId: unit.id, channel: 'whatsapp', description: 'MCB trips every afternoon.', priority: 'normal' });
    expect(t.body.coverage).toBe('paid');
    const wh = await ws.as('warehouse');
    await wh.post('/api/purchases', { supplierName: 'Shree Electricals', receivedOn: todayIst(), lines: [{ productId: await productId(wh, 'SW-MCB32'), qty: 5, unitCostPaise: 40_000 }] });
    const tech = await ws.as('technician', 2);
    await support.post(`/api/tickets/${t.body.id}/assign`, { technicianId: ws.people.technician![2] });
    const r = await tech.post(`/api/tickets/${t.body.id}/resolve`, { resolution: 'Replaced the MCB.', parts: [{ productId: await productId(tech, 'SW-MCB32'), qty: 1 }], labourHours: 2 });
    expect(r.status).toBe(200);
    expect(r.body.coverage).toBe('paid');
    // ₹620 part + 2 h × ₹600 labour, plus GST (5% and 18%)
    expect(r.body.billedPaise).toBe(62_000 + 3_100 + 120_000 + 21_600);
    const inv = (await ws.owner.get('/api/invoices')).body.invoices.find((i: { number: string }) => i.number === r.body.invoiceNumber);
    expect(inv.kind).toBe('service');
    expect(inv.status).toBe('sent');
  });
});

describe('Scene 6 — the director’s month-end', () => {
  it('shows today, this week and this month, with profit per job and open repairs', async () => {
    const d = await ws.owner.get('/api/dashboard?period=month');
    expect(d.status).toBe(200);
    expect(d.body.kpis.enquiries).toBeGreaterThanOrEqual(1);
    expect(d.body.kpis.installs).toBe(1);
    expect(d.body.profit.jobs).toHaveLength(1);
    const j = d.body.profit.jobs[0];
    expect(j.profit_paise).toBe(j.revenue_paise - j.parts_paise - j.labour_paise - j.expenses_paise - j.warranty_paise);
    expect(j.warranty_paise).toBeGreaterThan(0);
    expect(d.body.now.open_repairs).toBe(1);
    expect(d.body.now.invoices_to_send).toBe(1);
    for (const p of ['today', 'week']) expect((await ws.owner.get(`/api/dashboard?period=${p}`)).status).toBe(200);
    const sales = await ws.as('sales');
    expect((await sales.get('/api/dashboard')).status).toBe(403); // money is for the director and accounts
  });

  it('lists what is still unfinished, with the next step', async () => {
    const u = await ws.owner.get('/api/reports/unfinished');
    const row = u.body.jobs.find((j: { id: number }) => j.id === jobId);
    expect(row.next.label).toMatch(/Send the final invoice/);
  });

  it('tracks subsidy paperwork in order', async () => {
    const acc = await ws.as('accounts');
    const skip = await acc.put(`/api/jobs/${jobId}/subsidy`, { status: 'applied', docsBill: true, docsId: false, docsBank: true, docsPhoto: true });
    expect(skip.status).toBe(400);
    const ok = await acc.put(`/api/jobs/${jobId}/subsidy`, { status: 'applied', applicationNo: 'PMSG/GJ/2026/123456', docsBill: true, docsId: true, docsBank: true, docsPhoto: true });
    expect(ok.status).toBe(200);
  });

  it('pays technicians from their hours', async () => {
    const acc = await ws.as('accounts');
    const p = await acc.get('/api/payroll');
    const due = p.body.unpaid.reduce((s: number, x: { amount_paise: number }) => s + Number(x.amount_paise), 0);
    expect(due).toBeGreaterThan(0);
    const run = await acc.post('/api/payroll/runs', { periodStart: '2020-01-01', periodEnd: '2099-12-31' });
    expect(run.status).toBe(200);
    expect(run.body.totalPaise).toBe(due);
  });

  it('shares the numbers with a read-only link that can be revoked', async () => {
    const s = await ws.owner.post('/api/reports/share', { period: 'month', expiresInDays: 7 });
    expect(s.status).toBe(200);
    const token = s.body.url.split('/r/')[1];
    const anyone = new Client(await getApp());
    const r = await anyone.get(`/api/public/report/${token}`);
    expect(r.status).toBe(200);
    expect(r.body.profit.jobs).toHaveLength(1);
    const links = (await ws.owner.get('/api/reports/share')).body.links;
    await ws.owner.post(`/api/reports/share/${links[0].id}/revoke`);
    expect((await anyone.get(`/api/public/report/${token}`)).status).toBe(404);
    const csv = await ws.owner.get('/api/reports/profit.csv?period=month');
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.text).toContain('Ritu Malhotra');
  });
});

async function productId(c: Client, sku: string): Promise<number> {
  const products = (await c.get('/api/products')).body.products as { id: number; sku: string }[];
  return products.find((p) => p.sku === sku)!.id;
}
