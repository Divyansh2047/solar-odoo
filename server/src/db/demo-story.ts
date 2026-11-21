/**
 * Simulates months of a real installer's life through the same domain functions the API uses, in
 * time order, so every number in the demo (stock, ledger, warranty dates, profit) is consistent.
 * Each customer is a small "story" that yields the time of its next step; a scheduler runs the
 * earliest step across all stories, and anything that would happen after "now" simply hasn't yet.
 */
import { addDays, isoDateInTz, startOfDayUtc, type Role } from '@arka/shared';
import type pg from 'pg';
import type { Ctx } from '../domain/context.js';
import { addLeadActivity, assignLead, closeLead, createEnquiry, qualifyLead } from '../domain/leads.js';
import { reviewSurvey, scheduleSurvey, submitSurvey } from '../domain/surveys.js';
import { acceptQuote, createQuote, declineQuote, sendQuote } from '../domain/quotes.js';
import { cancelJob, closeJob, paidOnJob, recordJobPayment } from '../domain/jobs.js';
import { log } from '../lib/log.js';
import { deliverPickList, dispatchPickList, packPickList, receivePurchase, scanSerial, shortages } from '../domain/warehouse.js';
import { submitInstallReport } from '../domain/installs.js';
import { addExpense, createPayrun, markPayrunPaid, sendInvoice, updateSubsidy } from '../domain/money.js';
import { assignTicket, confirmTicket, createTicket, resolveTicket, startTicket } from '../domain/tickets.js';
import { freeTechnicians, rescheduleVisit } from '../domain/schedule.js';
import { saveFile } from '../lib/files.js';
import { roofPhoto, signature } from '../lib/png.js';
import { hashPassword } from '../lib/crypto.js';

type Db = pg.PoolClient;

export interface DemoPeople {
  owner: number;
  sales: number[];
  support: number;
  accounts: number;
  warehouse: number;
  technicians: number[];
  names: Map<number, string>;
}

const TECHNICIANS = [
  'Suresh Patel', 'Ramesh Yadav', 'Anil Kumar', 'Deepak Solanki', 'Mahesh Parmar', 'Kiran Desai', 'Sanjay Rathod', 'Vijay Chauhan',
  'Ravi Thakor', 'Prakash Vaghela', 'Manoj Bhatt', 'Ajay Rana', 'Nilesh Joshi', 'Harish Makwana', 'Dinesh Prajapati',
];

export async function createDemoPeople(db: Db, ownerId: number, slug: string, now: Date): Promise<DemoPeople> {
  const hash = await hashPassword(Buffer.from(crypto.getRandomValues(new Uint8Array(18))).toString('base64url'));
  const names = new Map<number, string>();
  const add = async (name: string, role: Role, cost = 0) => {
    const email = `${name.toLowerCase().replace(/[^a-z]+/g, '.')}.${slug}@sunpower.example`;
    const r = await db.query<{ id: number }>(
      `INSERT INTO users (name, email, phone, role, status, hourly_cost_paise, password_hash, email_verified_at, created_at)
       VALUES ($1, $2, $3, $4, 'active', $5, $6, $7, $7) RETURNING id`,
      [name, email, `+9198${String(10000000 + names.size * 7919).slice(0, 8)}`, role, cost, hash, now],
    );
    names.set(r.rows[0]!.id, name);
    return r.rows[0]!.id;
  };
  names.set(ownerId, 'Vikram Mehta');
  const sales = [await add('Priya Shah', 'sales'), await add('Arjun Nair', 'sales')];
  const support = await add('Neha Iyer', 'support');
  const accounts = await add('Rakesh Jain', 'accounts');
  const warehouse = await add('Imran Shaikh', 'warehouse');
  const technicians: number[] = [];
  for (const [i, n] of TECHNICIANS.entries()) technicians.push(await add(n, 'technician', 24000 + ((i * 3700) % 14000)));
  return { owner: ownerId, sales, support, accounts, warehouse, technicians, names };
}

/* ------------------------------------------------------------------ randomness and places */

function rng(seed: number) {
  let a = seed;
  const next = () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: <T>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)]!,
    chance: (p: number) => next() < p,
    weighted: <T>(xs: readonly [T, number][]): T => {
      const total = xs.reduce((s, x) => s + x[1], 0);
      let r = next() * total;
      for (const [v, w] of xs) if ((r -= w) <= 0) return v;
      return xs[xs.length - 1]![0];
    },
  };
}

const FIRST = ['Hemant', 'Jignesh', 'Rupal', 'Kalpesh', 'Meena', 'Bhavesh', 'Nirav', 'Dhruv', 'Komal', 'Pooja', 'Rajesh', 'Sunita', 'Hiral', 'Chirag', 'Darshan', 'Falguni', 'Gaurang', 'Ishita', 'Jayesh', 'Ketan', 'Lata', 'Mitesh', 'Nisha', 'Paresh', 'Rakhi', 'Sameer', 'Tejal', 'Umang', 'Varsha', 'Yogesh', 'Ankit', 'Bhavna', 'Hardik', 'Kavita', 'Manish', 'Rina', 'Sneha', 'Tushar', 'Alpesh', 'Devang'];
const LAST = ['Patel', 'Shah', 'Desai', 'Mehta', 'Trivedi', 'Joshi', 'Pandya', 'Bhatt', 'Modi', 'Parikh', 'Dave', 'Vyas', 'Chokshi', 'Sheth', 'Gandhi', 'Thakkar', 'Amin', 'Soni', 'Kapadia', 'Raval'];
const PLACES: [area: string, city: string, pin: string][] = [
  ['Satellite', 'Ahmedabad', '380015'], ['Bopal', 'Ahmedabad', '380058'], ['Prahlad Nagar', 'Ahmedabad', '380015'], ['Navrangpura', 'Ahmedabad', '380009'],
  ['Maninagar', 'Ahmedabad', '380008'], ['Chandkheda', 'Ahmedabad', '382424'], ['Thaltej', 'Ahmedabad', '380059'], ['Vastrapur', 'Ahmedabad', '380015'],
  ['Gota', 'Ahmedabad', '382481'], ['Naranpura', 'Ahmedabad', '380013'], ['Sector 21', 'Gandhinagar', '382021'], ['Kudasan', 'Gandhinagar', '382421'],
  ['Sargasan', 'Gandhinagar', '382421'], ['Sector 7', 'Gandhinagar', '382007'], ['Alkapuri', 'Vadodara', '390007'], ['Gotri', 'Vadodara', '390021'],
  ['Manjalpur', 'Vadodara', '390011'], ['Anand Vidyanagar', 'Anand', '388120'], ['Mehsana Highway', 'Mehsana', '384002'],
];
const SOCIETIES = ['Shanti Park', 'Sundarvan Society', 'Gulmohar Residency', 'Shivalik Bungalows', 'Arjun Tenements', 'Sarthak Heights', 'Parishram Park', 'Akshar Villa', 'Navkar Row Houses', 'Sahjanand Society'];
const BUSINESSES = ['Krishna Plastics', 'Om Sai Engineering', 'Shreeji Textiles', 'Matrix Packaging', 'Ambica Dairy', 'Sunrise Fabricators'];

/* ------------------------------------------------------------------ the simulation */

type Stage =
  | 'enquiry'
  | 'contacted'
  | 'qualified'
  | 'survey_scheduled'
  | 'survey_submitted'
  | 'quote_draft'
  | 'quote_sent'
  | 'won'
  | 'confirmed'
  | 'packed'
  | 'dispatched'
  | 'delivered'
  | 'installed';

interface TicketSpec {
  afterDays: number;
  serial: 'inverter' | 'panel' | null;
  fault?: string;
  description: string;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  parts: 'replace_inverter' | 'mcb' | 'none';
  labourHours: number;
  stopAt?: 'open' | 'assigned' | 'in_progress' | 'resolved';
  /** exact opening time (overrides afterDays) */
  at?: Date;
}

interface Spec {
  start: Date;
  /** set once the story has an order, so a story that has to stop can cancel it cleanly */
  jobId?: number;
  name: string;
  phone: string;
  email?: string;
  address: string;
  city: string;
  pincode: string;
  customerKind: 'home' | 'business';
  source: 'web_form' | 'whatsapp' | 'call' | 'walk_in' | 'referral';
  system: 'on_grid' | 'off_grid';
  kw: number;
  subsidy: boolean;
  billRupees: number;
  roofSqft: number;
  azimuth: number;
  tilt: number;
  cable: number;
  fate: 'won' | 'lost_call' | 'not_suitable' | 'lost_after_survey' | 'declined';
  discountPct: number;
  fullUpfront: boolean;
  payLagDays: number;
  crane?: boolean;
  stopAt?: Stage;
  installOn?: string;
  tickets: TicketSpec[];
  message?: string;
}

export interface SimEnv {
  db: Db;
  companyId: number;
  tz: string;
  now: Date;
  realNow: Date;
  people: DemoPeople;
  photos: number[];
  signatures: number[];
  surveyPhotos: number[];
}

const ctx = (env: SimEnv, userId: number | null, role: Ctx['role']): Ctx => ({
  companyId: env.companyId,
  userId,
  role,
  tz: env.tz,
  now: new Date(env.now),
  isDemo: true,
});

/** A local wall-clock time on a date. */
function at(env: SimEnv, isoDate: string, h: number, m = 0): Date {
  return new Date(startOfDayUtc(isoDate, env.tz).getTime() + (h * 60 + m) * 60_000);
}
const localDate = (env: SimEnv, d: Date) => isoDateInTz(d, env.tz);
const plusMin = (d: Date, min: number) => new Date(d.getTime() + min * 60_000);

/** Move a time into working hours (09:30–19:00, Mon–Sat). */
function working(env: SimEnv, d: Date): Date {
  let day = localDate(env, d);
  const mins = Math.round((d.getTime() - startOfDayUtc(day, env.tz).getTime()) / 60_000);
  let t = d;
  if (mins < 9 * 60 + 30) t = at(env, day, 9, 30 + (mins % 25));
  else if (mins > 19 * 60) {
    day = addDays(day, 1);
    t = at(env, day, 9, 40 + (mins % 30));
  }
  while (new Date(`${localDate(env, t)}T12:00:00Z`).getUTCDay() === 0) t = new Date(t.getTime() + 86_400_000);
  return t;
}

async function* story(env: SimEnv, s: Spec, r: ReturnType<typeof rng>): AsyncGenerator<Date, void, void> {
  const P = env.people;
  const salesId = P.sales[s.phone.charCodeAt(s.phone.length - 1) % P.sales.length]!;
  yield s.start;
  const { lead } = await createEnquiry(env.db, ctx(env, s.source === 'web_form' ? null : salesId, s.source === 'web_form' ? 'system' : 'sales'), {
    name: s.name,
    phone: s.phone,
    email: s.email,
    address: s.address,
    city: s.city,
    pincode: s.pincode,
    customerKind: s.customerKind,
    systemType: r.chance(0.2) ? 'not_sure' : s.system,
    requestedKw: r.chance(0.7) ? s.kw : undefined,
    wantsSubsidy: s.subsidy,
    monthlyBillRupees: r.chance(0.5) ? s.billRupees : undefined,
    message: s.message,
    source: s.source,
  });
  if (s.stopAt === 'enquiry') return;

  yield working(env, plusMin(s.start, r.int(15, 140)));
  await assignLead(env.db, ctx(env, P.owner, 'owner'), lead.id, salesId);
  if (s.fate === 'lost_call') {
    await addLeadActivity(env.db, ctx(env, salesId, 'sales'), lead.id, { kind: 'call', body: r.pick(['No answer; left a WhatsApp message.', 'Said they are only comparing prices for now.', 'Busy, asked us to call next month.']) });
    yield working(env, plusMin(env.now, r.int(1, 6) * 24 * 60));
    await closeLead(env.db, ctx(env, salesId, 'sales'), lead.id, r.pick(['not_interested', 'unreachable', 'too_expensive'] as const));
    return;
  }
  await addLeadActivity(env.db, ctx(env, salesId, 'sales'), lead.id, {
    kind: 'call',
    body: `Called. ${s.customerKind === 'home' ? 'Homeowner' : 'Owner'} wants ${s.kw} kW ${s.system === 'on_grid' ? 'on-grid' : 'off-grid'}${s.subsidy ? ' under the subsidy' : ''}.`,
  });
  if (s.stopAt === 'contacted') return;

  yield plusMin(env.now, r.int(5, 15));
  const suitable = s.fate !== 'not_suitable';
  await qualifyLead(env.db, ctx(env, salesId, 'sales'), lead.id, {
    roofAreaSqft: suitable ? s.roofSqft : r.int(40, 85),
    monthlyBillRupees: s.billRupees,
    gridConnection: s.system === 'off_grid' && r.chance(0.5) ? 'none' : r.chance(0.8) ? 'single_phase' : 'three_phase',
    sanctionedLoadKw: undefined,
    roofType: r.weighted([['rcc', 8], ['metal_sheet', 2], ['tiled', 1]] as const),
    shading: r.weighted([['none', 6], ['partial', 3]] as const),
    systemType: s.system,
    gridSuitable: true,
    outcome: suitable ? 'qualified' : 'not_suitable',
    note: suitable ? undefined : 'Shadow-free roof is too small after the water tank and stairwell.',
  });
  if (!suitable || s.stopAt === 'qualified') return;

  // survey: first technician free in a slot 1–3 days out (looked up right before booking)
  yield plusMin(env.now, 5);
  let surveyStart: Date | null = null;
  let tech: number | null = null;
  for (let d = 1; d <= 6 && !tech; d++) {
    const day = addDays(localDate(env, env.now), d);
    if (new Date(`${day}T12:00:00Z`).getUTCDay() === 0) continue;
    // real offices book surveys across the day, not all at ten
    const slots: [number, number][] = [[9, 30], [11, 0], [12, 30], [14, 30], [16, 0]];
    const first = r.int(0, slots.length - 1);
    for (let k = 0; k < slots.length; k++) {
      const [h, m] = slots[(first + k) % slots.length]!;
      const st = at(env, day, h, m);
      const free = await freeTechnicians(env.db, st, plusMin(st, 90));
      if (free.length) {
        surveyStart = st;
        tech = free[r.int(0, Math.min(free.length - 1, 4))]!.id;
        break;
      }
    }
  }
  if (!tech || !surveyStart) return;
  const survey = await scheduleSurvey(env.db, ctx(env, salesId, 'sales'), { leadId: lead.id, technicianId: tech, startsAt: surveyStart.toISOString(), durationMinutes: 90 });
  if (s.stopAt === 'survey_scheduled') return;

  yield plusMin(surveyStart, r.int(80, 110));
  await submitSurvey(env.db, ctx(env, tech, 'technician'), survey.id, {
    azimuthDeg: s.azimuth,
    tiltDeg: s.tilt,
    usableAreaSqft: s.roofSqft,
    cableDistanceM: s.cable,
    structureType: r.weighted([['elevated_low', 7], ['elevated_high', 2], ['flush', 1]] as const),
    roofType: 'rcc',
    shading: 'none',
    earthingPossible: true,
    recommendedKw: s.kw,
    shadingNotes: r.chance(0.3) ? 'Neighbour’s tree shades the west corner after 4 pm.' : undefined,
    notes: undefined,
    photoIds: [env.surveyPhotos[r.int(0, env.surveyPhotos.length - 1)]!],
  });
  if (s.stopAt === 'survey_submitted') return;

  yield working(env, plusMin(env.now, r.int(60, 300)));
  await reviewSurvey(env.db, ctx(env, salesId, 'sales'), survey.id, { decision: 'approve' });
  if (s.fate === 'lost_after_survey') {
    yield working(env, plusMin(env.now, r.int(2, 5) * 24 * 60));
    await closeLead(env.db, ctx(env, salesId, 'sales'), lead.id, r.pick(['too_expensive', 'chose_competitor'] as const));
    return;
  }

  yield working(env, plusMin(env.now, r.int(18, 26) * 60));
  const tpl = await env.db.query<{ id: number }>(`SELECT id FROM kit_templates WHERE code = $1`, [`${s.system === 'on_grid' ? 'ONG' : 'OFG'}-${s.kw}`]);
  const quote = await createQuote(env.db, ctx(env, salesId, 'sales'), { leadId: lead.id, templateId: tpl.rows[0]!.id });
  if (s.discountPct > 0) {
    const sub = quote.subtotal_paise;
    // apply the discount through the normal edit path so totals and tax are recomputed
    const lines = await env.db.query<{ product_id: number; description: string; qty: number; unit_price_paise: number }>(
      `SELECT product_id, description, qty, unit_price_paise FROM quote_lines WHERE quote_id = $1 ORDER BY sort`,
      [quote.id],
    );
    const { updateQuote } = await import('../domain/quotes.js');
    await updateQuote(env.db, ctx(env, salesId, 'sales'), quote.id, {
      lines: lines.rows.map((l) => ({ productId: l.product_id, description: l.description, qty: l.qty, unitPricePaise: l.unit_price_paise })),
      discountPaise: Math.round((sub * s.discountPct) / 100 / 100) * 100,
      advancePercent: quote.advance_percent,
      validUntil: quote.valid_until,
    });
  }
  if (s.stopAt === 'quote_draft') return;
  yield plusMin(env.now, r.int(20, 90));
  await sendQuote(env.db, ctx(env, salesId, 'sales'), quote.id);
  if (s.stopAt === 'quote_sent') return;

  yield working(env, plusMin(env.now, r.int(1, 4) * 24 * 60 + r.int(0, 300)));
  if (s.fate === 'declined') {
    await declineQuote(env.db, ctx(env, null, 'customer'), quote.id, r.pick(['Found a cheaper offer.', 'Postponing until after Diwali.', 'Society did not approve roof use.']));
    return;
  }
  const { jobId } = await acceptQuote(env.db, ctx(env, null, 'customer'), quote.id, s.name);
  s.jobId = jobId;
  if (s.stopAt === 'won') return;

  // advance (or full) payment
  yield working(env, plusMin(env.now, r.int(2, 40) * 60));
  const job = (await env.db.query<{ total_paise: number; advance_required_paise: number; ref: string; customer_id: number }>(`SELECT total_paise, advance_required_paise, ref, customer_id FROM jobs WHERE id = $1`, [jobId])).rows[0]!;
  const first = s.fullUpfront ? job.total_paise : job.advance_required_paise;
  await recordJobPayment(env.db, ctx(env, P.accounts, 'accounts'), jobId, {
    amountPaise: first,
    method: r.weighted([['upi', 5], ['bank_transfer', 4], ['cheque', 1]] as const),
    reference: `UTR${r.int(100000000, 999999999)}`,
    receivedOn: localDate(env, env.now),
  });
  if (s.stopAt === 'confirmed' && !s.installOn) return;

  // pin the installation day for showcase stories
  const visit = (await env.db.query<{ id: number; starts_at: Date }>(
    `SELECT v.id, v.starts_at FROM visits v JOIN visit_links l ON l.visit_id = v.id WHERE l.job_id = $1 AND v.kind = 'installation' AND v.status = 'planned' ORDER BY v.starts_at LIMIT 1`,
    [jobId],
  )).rows[0];
  if (!visit) return;
  let installStart = visit.starts_at;
  if (s.installOn) {
    const st = at(env, s.installOn, 9);
    const free = await freeTechnicians(env.db, st, plusMin(st, 480));
    if (free.length >= 2) {
      await rescheduleVisit(env.db, ctx(env, salesId, 'sales'), visit.id, { startsAt: st, endsAt: plusMin(st, 480), technicianIds: free.slice(0, s.kw >= 4 ? 3 : 2).map((f) => f.id) });
      installStart = st;
    }
  }
  if (s.stopAt === 'confirmed') return;

  // pack the evening before
  const packAt = at(env, addDays(localDate(env, installStart), -1), 16, r.int(0, 50));
  yield packAt < env.now ? plusMin(env.now, 30) : packAt;
  const pick = (await env.db.query<{ id: number }>(`SELECT id FROM pick_lists WHERE job_id = $1`, [jobId])).rows[0]!;
  await ensureStock(env, pick.id);
  const lines = await env.db.query<{ product_id: number; qty: number }>(
    `SELECT pl.product_id, pl.qty FROM pick_lines pl JOIN products p ON p.id = pl.product_id WHERE pl.pick_list_id = $1 AND p.tracking = 'serial'`,
    [pick.id],
  );
  const wctx = ctx(env, P.warehouse, 'warehouse');
  for (const l of lines.rows) {
    const units = await env.db.query<{ serial: string }>(`SELECT serial FROM serial_units WHERE product_id = $1 AND status = 'in_stock' ORDER BY id LIMIT $2`, [l.product_id, l.qty]);
    for (const u of units.rows) await scanSerial(env.db, wctx, pick.id, u.serial);
  }
  await packPickList(env.db, wctx, pick.id);
  if (s.stopAt === 'packed') return;

  yield plusMin(installStart, -90);
  await dispatchPickList(env.db, ctx(env, P.warehouse, 'warehouse'), pick.id, {
    vehicleNo: `GJ01${r.pick(['AB', 'CX', 'DT', 'KM'])}${r.int(1000, 9999)}`,
    driverName: r.pick(['Bharat Rabari', 'Salim Pathan', 'Jaydeep Zala', 'Govind Bharwad']),
    driverPhone: undefined,
  });
  await addExpense(env.db, ctx(env, P.accounts, 'accounts'), { jobId, category: 'transport', amountPaise: r.int(8, 22) * 10000, spentOn: localDate(env, env.now) });
  if (s.crane) await addExpense(env.db, ctx(env, P.accounts, 'accounts'), { jobId, category: 'crane', amountPaise: 1_800_000, spentOn: localDate(env, env.now), note: 'Crane to lift panels to a G+4 roof' });
  if (s.stopAt === 'dispatched') return;

  const crew = (await env.db.query<{ technician_id: number }>(`SELECT technician_id FROM visit_crew c JOIN visit_links l ON l.visit_id = c.visit_id WHERE l.job_id = $1 AND c.active`, [jobId])).rows.map(
    (c) => c.technician_id,
  );
  const lead_ = crew[0] ?? P.technicians[0]!;
  yield plusMin(installStart, r.int(-20, 15));
  await deliverPickList(env.db, ctx(env, lead_, 'technician'), pick.id, { deliveredOn: localDate(env, env.now), receivedBy: s.name });
  if (s.stopAt === 'delivered') return;

  const started = plusMin(installStart, r.int(20, 45));
  const finished = plusMin(started, (s.kw * 55 + r.int(150, 260)) * 1);
  yield finished;
  await submitInstallReport(env.db, ctx(env, lead_, 'technician'), jobId, {
    startedAt: started.toISOString(),
    finishedAt: finished.toISOString(),
    confirmedKw: s.kw,
    sizeMismatchReason: undefined,
    generationKw: Math.round(s.kw * (0.55 + r.next() * 0.3) * 100) / 100,
    checklist: { structure: true, panels: true, wiring: true, earthing: true, generation: true },
    photoIds: (() => {
      const i1 = r.int(0, env.photos.length - 1);
      const i2 = (i1 + 1 + r.int(0, env.photos.length - 2)) % env.photos.length;
      return [env.photos[i1]!, env.photos[i2]!];
    })(),
    signatureFileId: env.signatures[r.int(0, env.signatures.length - 1)]!,
    signedByName: s.name,
    crewIds: crew.length ? crew : [lead_],
    notes: undefined,
  });
  if (s.stopAt === 'installed') return;

  // accounts sends the invoice the next working day
  yield working(env, at(env, addDays(localDate(env, env.now), r.chance(0.25) ? r.int(2, 4) : 1), 11, r.int(0, 50)));
  const inv = (await env.db.query<{ id: number }>(`SELECT id FROM invoices WHERE job_id = $1 AND status = 'draft'`, [jobId])).rows[0];
  if (inv) await sendInvoice(env.db, ctx(env, P.accounts, 'accounts'), inv.id);

  // subsidy paperwork and balance payment interleave
  const installDay = localDate(env, finished);
  const steps: [Date, () => Promise<void>][] = [];
  if (s.subsidy && s.system === 'on_grid' && s.customerKind === 'home') {
    const app = `PMSG/GJ/${installDay.slice(0, 4)}/${r.int(100000, 999999)}`;
    const docs = { docsBill: true, docsId: true, docsBank: true, docsPhoto: true, applicationNo: app };
    const sub = (status: 'documents' | 'applied' | 'inspection' | 'approved' | 'disbursed', extra: object = {}) => () =>
      updateSubsidy(env.db, ctx(env, P.accounts, 'accounts'), jobId, { ...docs, docsBank: status !== 'documents', status, ...extra } as never);
    steps.push([at(env, addDays(installDay, 1), 12), sub('documents')]);
    steps.push([at(env, addDays(installDay, r.int(3, 6)), 15), sub('applied')]);
    steps.push([at(env, addDays(installDay, r.int(14, 20)), 12), sub('inspection')]);
    steps.push([at(env, addDays(installDay, r.int(26, 34)), 16), sub('approved')]);
    const expected = (await env.db.query<{ expected_paise: number }>(`SELECT expected_paise FROM subsidy_cases WHERE job_id = $1`, [jobId])).rows[0]?.expected_paise ?? 0;
    steps.push([at(env, addDays(installDay, r.int(40, 58)), 11), sub('disbursed', { disbursedPaise: expected })]);
  }
  const balanceAt = working(env, at(env, addDays(installDay, s.payLagDays), 12, r.int(0, 59)));
  steps.push([
    balanceAt,
    async () => {
      const paid = await paidOnJob(env.db, jobId);
      if (paid < job.total_paise) {
        await recordJobPayment(env.db, ctx(env, P.accounts, 'accounts'), jobId, {
          amountPaise: job.total_paise - paid,
          method: r.weighted([['bank_transfer', 5], ['upi', 4], ['cheque', 1]] as const),
          reference: `UTR${r.int(100000000, 999999999)}`,
          receivedOn: localDate(env, env.now),
        });
      }
    },
  ]);
  steps.push([plusMin(balanceAt, 26 * 60), async () => closeJob(env.db, ctx(env, P.owner, 'owner'), jobId).catch(() => undefined)]);
  for (const t of s.tickets) {
    const opened = t.at ?? working(env, at(env, addDays(installDay, t.afterDays), r.int(9, 17), r.int(0, 59)));
    steps.push([opened, () => ticketStory(env, t, job.customer_id, jobId, r, opened)]);
  }
  steps.sort((a, b) => a[0].getTime() - b[0].getTime());
  for (const [when, run] of steps) {
    yield when;
    await run();
  }
}

/** Tickets run inline (open → assign → fix → confirm), stopping at "now" or at stopAt. */
async function ticketStory(env: SimEnv, t: TicketSpec, customerId: number, jobId: number, r: ReturnType<typeof rng>, opened: Date): Promise<void> {
  const P = env.people;
  const serial = t.serial
    ? (await env.db.query<{ id: number; product_id: number }>(
        `SELECT su.id, su.product_id FROM serial_units su JOIN products p ON p.id = su.product_id WHERE su.job_id = $1 AND p.category = $2 AND su.status = 'installed' ORDER BY su.id LIMIT 1`,
        [jobId, t.serial],
      )).rows[0]
    : undefined;
  env.now = opened;
  const ticket = await createTicket(env.db, ctx(env, P.support, 'support'), {
    customerId,
    serialUnitId: serial?.id,
    channel: r.weighted([['call', 6], ['whatsapp', 3], ['portal', 1]] as const),
    faultCode: t.fault,
    description: t.description,
    priority: t.priority,
  });
  if (t.stopAt === 'open') return;
  const advance = (min: number) => {
    const next = plusMin(env.now, min);
    if (next > env.realNow) return false;
    env.now = next;
    return true;
  };
  if (!advance(r.int(10, 60))) return;
  const tech = P.technicians[r.int(0, P.technicians.length - 1)]!;
  await assignTicket(env.db, ctx(env, P.support, 'support'), ticket.id, tech);
  if (t.stopAt === 'assigned') return;
  if (!advance(r.int(3, 20) * 60)) return;
  await startTicket(env.db, ctx(env, tech, 'technician'), ticket.id);
  if (t.stopAt === 'in_progress') return;
  if (!advance(r.int(60, 180))) return;
  const parts: { productId: number; qty: number; replacesSerialUnitId?: number; newSerial?: string }[] = [];
  if (t.parts === 'replace_inverter' && serial) {
    await ensureSerials(env, serial.product_id, 1);
    const fresh = (await env.db.query<{ serial: string }>(`SELECT serial FROM serial_units WHERE product_id = $1 AND status = 'in_stock' ORDER BY id LIMIT 1`, [serial.product_id])).rows[0]!;
    parts.push({ productId: serial.product_id, qty: 1, replacesSerialUnitId: serial.id, newSerial: fresh.serial });
  } else if (t.parts === 'mcb') {
    const mcb = (await env.db.query<{ id: number }>(`SELECT id FROM products WHERE sku = 'SW-MCB32'`)).rows[0]!;
    await ensureQty(env, mcb.id, 1);
    parts.push({ productId: mcb.id, qty: 1 });
  }
  await resolveTicket(env.db, ctx(env, tech, 'technician'), ticket.id, {
    resolution:
      t.parts === 'replace_inverter'
        ? 'Inverter control board failed after the storm surge. Replaced the inverter, tested generation and grid sync.'
        : t.parts === 'mcb'
          ? 'Tripping AC MCB replaced; tightened loose terminals in the ACDB.'
          : 'Cleaned the panels and re-torqued MC4 connectors; generation back to normal.',
    parts: parts as never,
    labourHours: t.labourHours,
  });
  if (t.stopAt === 'resolved') return;
  if (!advance(r.int(4, 30) * 60)) return;
  await confirmTicket(env.db, ctx(env, P.support, 'support'), ticket.id, r.pick(['phone', 'portal'] as const));
}

async function ensureStock(env: SimEnv, pickId: number): Promise<void> {
  // received stock goes to the oldest waiting pick list first, so top up until this one is covered too
  for (let round = 0; round < 4; round++) {
    const short = await shortages(env.db, pickId);
    if (!short.length) return;
    for (const s of short) {
      const p = (await env.db.query<{ tracking: string }>(`SELECT tracking FROM products WHERE id = $1`, [s.productId])).rows[0]!;
      const need = Math.ceil(s.need - s.available);
      if (p.tracking === 'serial') await ensureSerials(env, s.productId, need, true);
      else await ensureQty(env, s.productId, need, true);
    }
  }
}

let serialCounter = 0;
async function ensureSerials(env: SimEnv, productId: number, n: number, force = false): Promise<void> {
  const have = (await env.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM serial_units WHERE product_id = $1 AND status = 'in_stock'`, [productId])).rows[0]!.n;
  if (!force && have >= n) return;
  const p = (await env.db.query<{ sku: string; unit_cost_paise: number }>(`SELECT sku, unit_cost_paise FROM products WHERE id = $1`, [productId])).rows[0]!;
  const qty = force ? n : n - have;
  const year = localDate(env, env.now).slice(2, 4);
  const prefix = p.sku.replace(/[^A-Z0-9]/g, '').slice(0, 6);
  const serials = Array.from({ length: qty }, () => `${prefix}${year}${String(++serialCounter).padStart(6, '0')}`);
  await receivePurchase(env.db, ctx(env, env.people.warehouse, 'warehouse'), {
    supplierName: supplierFor(p.sku),
    supplierInvoice: `SI-${r6()}`,
    receivedOn: localDate(env, env.now),
    lines: [{ productId, qty, unitCostPaise: p.unit_cost_paise, serials }],
    notes: 'Urgent top-up',
  });
}

async function ensureQty(env: SimEnv, productId: number, n: number, force = false): Promise<void> {
  const p = (await env.db.query<{ sku: string; unit_cost_paise: number; on_hand: number; uom: string }>(`SELECT sku, unit_cost_paise, on_hand, uom FROM products WHERE id = $1`, [productId])).rows[0]!;
  if (!force && p.on_hand >= n) return;
  const qty = p.uom === 'm' ? Math.ceil(n / 100) * 100 : Math.ceil(n);
  await receivePurchase(env.db, ctx(env, env.people.warehouse, 'warehouse'), {
    supplierName: supplierFor(p.sku),
    supplierInvoice: `SI-${r6()}`,
    receivedOn: localDate(env, env.now),
    lines: [{ productId, qty, unitCostPaise: p.unit_cost_paise }],
  });
}

let invCounter = 4000;
const r6 = () => String(++invCounter);

function supplierFor(sku: string): string {
  if (sku.startsWith('PNL')) return 'Suryoday Modules Pvt Ltd';
  if (sku.startsWith('INV') || sku.startsWith('CC')) return 'Power Electronics Traders';
  if (sku.startsWith('BAT')) return 'LFP Energy Storage Co';
  if (sku.startsWith('STR')) return 'Gujarat GI Structures';
  return 'Shree Electricals';
}

/** Weekly purchasing on Mondays: refill to the reorder level plus what open pick lists need. */
async function* procurement(env: SimEnv, from: string): AsyncGenerator<Date, void, void> {
  let monday = from;
  while (new Date(`${monday}T12:00:00Z`).getUTCDay() !== 1) monday = addDays(monday, 1);
  for (;;) {
    yield at(env, monday, 10, 15);
    const rows = await env.db.query<{ id: number; sku: string; tracking: string; uom: string; on_hand: number; reorder_level: number; unit_cost_paise: number; need: number }>(
      `SELECT p.id, p.sku, p.tracking, p.uom, p.on_hand, p.reorder_level, p.unit_cost_paise,
              coalesce((SELECT sum(pl.qty) FROM pick_lines pl JOIN pick_lists k ON k.id = pl.pick_list_id WHERE pl.product_id = p.id AND k.status IN ('waiting_stock', 'ready', 'packed')), 0)::numeric AS need
         FROM products p WHERE p.status = 'active' AND p.tracking <> 'none' ORDER BY p.id`,
    );
    const bySupplier = new Map<string, { productId: number; qty: number; unitCostPaise: number; serials?: string[] }[]>();
    for (const p of rows.rows) {
      // order up to twice the reorder level (batteries only to what open orders need: they’re expensive)
      const target = p.need + (p.sku.startsWith('BAT') ? 0 : p.reorder_level * 2);
      if (p.on_hand > p.reorder_level && p.on_hand >= p.need + (p.sku.startsWith('BAT') ? 0 : p.reorder_level)) continue;
      const gap = target - p.on_hand;
      if (gap <= 0) continue;
      let qty = p.uom === 'm' ? Math.ceil(gap / 100) * 100 : Math.ceil(gap);
      if (p.sku === 'PNL-550') qty = Math.ceil(gap / 36) * 36; // pallets of 36
      const line: { productId: number; qty: number; unitCostPaise: number; serials?: string[] } = { productId: p.id, qty, unitCostPaise: p.unit_cost_paise };
      if (p.tracking === 'serial') {
        const prefix = p.sku.replace(/[^A-Z0-9]/g, '').slice(0, 6);
        const year = monday.slice(2, 4);
        line.serials = Array.from({ length: qty }, () => `${prefix}${year}${String(++serialCounter).padStart(6, '0')}`);
      }
      const sup = supplierFor(p.sku);
      bySupplier.set(sup, [...(bySupplier.get(sup) ?? []), line]);
    }
    for (const [supplierName, lines] of bySupplier) {
      await receivePurchase(env.db, ctx(env, env.people.warehouse, 'warehouse'), {
        supplierName,
        supplierInvoice: `SI-${r6()}`,
        receivedOn: monday,
        lines,
        notes: 'Weekly stock order',
      });
    }
    monday = addDays(monday, 7);
  }
}

/** Monthly pay runs: created on the 2nd for the previous month, paid on the 5th. */
async function* payroll(env: SimEnv, from: string): AsyncGenerator<Date, void, void> {
  let month = `${from.slice(0, 7)}-01`;
  for (;;) {
    const next = new Date(`${month}T00:00:00Z`);
    next.setUTCMonth(next.getUTCMonth() + 1);
    const nextMonth = next.toISOString().slice(0, 10);
    yield at(env, addDays(nextMonth, 1), 11);
    const run = await createPayrun(env.db, ctx(env, env.people.accounts, 'accounts'), month, addDays(nextMonth, -1)).catch(() => null);
    yield at(env, addDays(nextMonth, 4), 17);
    if (run) await markPayrunPaid(env.db, ctx(env, env.people.owner, 'owner'), run.id);
    month = nextMonth;
  }
}

/* ------------------------------------------------------------------ the cast */

function makeSpecs(env: SimEnv, r: ReturnType<typeof rng>, days: number, perDay: number): Spec[] {
  const today = localDate(env, env.realNow);
  const specs: Spec[] = [];
  let phoneSeq = 0;
  const usedNames = new Set<string>();
  const person = (business = false) => {
    // different people get different names, so a list never shows the same name three times
    let f = r.pick(FIRST);
    let l = r.pick(LAST);
    for (let tries = 0; usedNames.has(`${f} ${l}`) && tries < 30; tries++) {
      f = r.pick(FIRST);
      l = r.pick(LAST);
    }
    usedNames.add(`${f} ${l}`);
    const [area, city, pin] = r.pick(PLACES);
    phoneSeq++;
    // unique per person: a repeated number would merge two people into one customer
    const phone = `+91${r.pick(['98', '97', '94', '90', '88', '79', '70', '63'])}${String(10000000 + ((phoneSeq * 7_919) % 89_999_999)).padStart(8, '0')}`;
    return {
      name: business ? `${f} ${l}` : `${f} ${l}`,
      phone,
      email: r.chance(0.6) ? `${f}.${l}${phoneSeq}@example.com`.toLowerCase() : undefined,
      address: business ? `${r.pick(BUSINESSES)}, Plot ${r.int(10, 240)}, GIDC ${area}` : `${r.int(1, 120)}, ${r.pick(SOCIETIES)}, ${area}`,
      city,
      pincode: pin,
    };
  };
  const base = (start: Date, over: Partial<Spec> = {}): Spec => {
    const business = r.chance(0.13);
    const kw = r.weighted([[1, 8], [2, 22], [3, 38], [4, 17], [5, 15]] as const);
    const system = r.chance(0.17) ? 'off_grid' : 'on_grid';
    const fate = r.weighted([['won', 70], ['lost_call', 13], ['not_suitable', 5], ['lost_after_survey', 4], ['declined', 8]] as const);
    return {
      start,
      ...person(business),
      customerKind: business ? 'business' : 'home',
      source: r.weighted([['web_form', 40], ['whatsapp', 30], ['call', 20], ['walk_in', 5], ['referral', 5]] as const),
      system,
      kw,
      subsidy: !business && system === 'on_grid' && r.chance(0.85),
      billRupees: kw * 1000 + r.int(-300, 900),
      roofSqft: kw * 110 + r.int(30, 260),
      azimuth: r.weighted([[180, 6], [160, 2], [200, 2], [135, 1], [225, 1]] as const),
      tilt: r.weighted([[10, 2], [15, 4], [20, 3], [25, 1]] as const),
      cable: r.int(8, 35),
      fate,
      discountPct: r.weighted([[0, 7], [2, 2], [5, 1]] as const),
      fullUpfront: r.chance(0.2),
      payLagDays: r.int(2, 18),
      tickets: [],
      ...over,
      // a scripted person keeps their own name in their email, never the random stand-in's
      ...(over.name && !('email' in over) ? { email: r.chance(0.5) ? `${over.name.split(' (')[0]!.toLowerCase().replace(/[^a-z]+/g, '.')}@example.com` : undefined } : {}),
    };
  };
  const randomTime = (day: string) => at(env, day, r.weighted([[8, 1], [10, 3], [12, 3], [15, 3], [18, 2], [21, 1]] as const), r.int(0, 59));

  // ~18 installations 15–30 months ago, so warranties are live, ending and ended.
  for (let i = 0; i < 18; i++) {
    const day = addDays(today, -r.int(460, 900));
    const s = base(randomTime(day), { fate: 'won', payLagDays: r.int(3, 12) });
    if (r.chance(0.35)) {
      s.tickets.push({
        afterDays: r.int(60, 420),
        serial: r.chance(0.5) ? 'inverter' : null,
        description: r.pick(['Generation dropped by half on sunny days.', 'Inverter beeping and showing a red light.', 'MCB keeps tripping in the afternoon.']),
        priority: 'normal',
        parts: r.weighted([['none', 3], ['mcb', 2], ['replace_inverter', 1]] as const),
        labourHours: r.pick([1, 1.5, 2, 3]),
      });
    }
    specs.push(s);
  }
  // the steady flow of the last `days` days
  for (let d = days; d >= 1; d--) {
    const day = addDays(today, -d);
    if (new Date(`${day}T12:00:00Z`).getUTCDay() === 0 && r.chance(0.6)) continue;
    const n = Math.max(0, Math.round(perDay + (r.next() - 0.5) * 2));
    for (let i = 0; i < n; i++) {
      const s = base(randomTime(day));
      if (s.fate === 'won' && r.chance(0.1) && d > 25) {
        s.tickets.push({
          afterDays: r.int(5, Math.max(6, d - 18)),
          serial: r.chance(0.4) ? 'inverter' : null,
          description: r.pick(['App shows zero generation since yesterday.', 'Water leaking near the inverter after rain.', 'One string not producing.']),
          priority: r.pick(['normal', 'high'] as const),
          parts: r.weighted([['none', 4], ['mcb', 2], ['replace_inverter', 1]] as const),
          labourHours: r.pick([1, 2, 2.5]),
        });
      }
      specs.push(s);
    }
  }
  return specs.concat(showcase(env, r, base));
}

/** Hand-placed stories that put every scene of the brief on screen today. */
function showcase(env: SimEnv, r: ReturnType<typeof rng>, base: (start: Date, over?: Partial<Spec>) => Spec): Spec[] {
  const now = env.realNow;
  const today = localDate(env, now);
  const ago = (min: number) => new Date(now.getTime() - min * 60_000);
  const daysAgo = (d: number, h: number, m = 0) => at(env, addDays(today, -d), h, m);
  const nextWorkday = (d: number) => {
    let day = addDays(today, d);
    while (new Date(`${day}T12:00:00Z`).getUTCDay() === 0) day = addDays(day, 1);
    return day;
  };
  return [
    // Scene 1: a homeowner asks online for 3 kW under the subsidy. Nobody has called yet.
    base(ago(170), {
      name: 'Ritu Malhotra', phone: '+919824011223', email: 'ritu.malhotra@example.com', address: '14, Shanti Park, Satellite', city: 'Ahmedabad', pincode: '380015',
      customerKind: 'home', source: 'web_form', system: 'on_grid', kw: 3, subsidy: true, billRupees: 3200, stopAt: 'enquiry', fate: 'won',
      message: 'Looking for a 3 kW system under the PM Surya Ghar subsidy. Flat RCC roof, no shade.',
    }),
    base(ago(25), { name: 'Farhan Qureshi', phone: '+919979055410', source: 'whatsapp', system: 'off_grid', kw: 2, subsidy: false, stopAt: 'enquiry', fate: 'won', message: 'Farm house, power cuts daily. Need battery backup.' }),
    // a qualified lead waiting for a survey slot
    base(daysAgo(1, 11, 20), { name: 'Sonal Bhavsar', phone: '+919898120045', kw: 4, stopAt: 'qualified', fate: 'won' }),
    // Scene 1b: survey done yesterday, waiting for approval
    base(daysAgo(3, 10, 5), { name: 'Kamlesh Desai', phone: '+919825077310', kw: 3, system: 'on_grid', subsidy: true, customerKind: 'home', stopAt: 'survey_submitted', fate: 'won', cable: 18 }),
    // Scene 2: quote sent, customer deciding
    base(daysAgo(6, 12, 30), { name: 'Anjali Trivedi', phone: '+919909123456', kw: 3, system: 'on_grid', subsidy: true, customerKind: 'home', stopAt: 'quote_sent', fate: 'won', cable: 22 }),
    // accepted, waiting for the advance
    base(daysAgo(8, 15, 0), { name: 'Hitesh Panchal', phone: '+919727334411', kw: 2, system: 'on_grid', stopAt: 'won', fate: 'won' }),
    // Scene 3: dispatch day. Off-grid 5 kW, packed last night, truck leaves today.
    base(daysAgo(13, 10, 40), {
      name: 'Bharatbhai Chaudhary', phone: '+919426011890', address: 'Chaudhary Farm, Mehsana Highway', city: 'Mehsana', pincode: '384002', customerKind: 'home',
      system: 'off_grid', kw: 5, subsidy: false, stopAt: 'packed', installOn: today, fate: 'won', fullUpfront: true,
    }),
    // delivered this morning; the crew is on the roof now
    base(daysAgo(12, 9, 50), { name: 'Meera Joshi', phone: '+919374455120', kw: 3, system: 'on_grid', subsidy: true, customerKind: 'home', stopAt: 'delivered', installOn: today, fate: 'won' }),
    // confirmed, installation booked for the next working day
    base(daysAgo(7, 16, 10), { name: 'Pankaj Rawal', phone: '+919825600781', kw: 4, stopAt: 'confirmed', installOn: nextWorkday(1), fate: 'won' }),
    // Scene 5: eighteen months later it pours; inverter shows a fault code and zero power. Covered.
    base(at(env, addDays(today, -560), 11, 15), {
      name: 'Dipika Raval', phone: '+919824566012', email: 'dipika.raval@example.com', address: '7, Gulmohar Residency, Bopal', city: 'Ahmedabad', pincode: '380058',
      customerKind: 'home', system: 'on_grid', kw: 3, subsidy: true, fate: 'won', payLagDays: 4,
      tickets: [{ afterDays: 0, at: ago(65), serial: 'inverter', fault: 'E-021', description: 'Pouring rain since morning. Inverter shows fault code E-021 and the app says zero power.', priority: 'urgent', parts: 'replace_inverter', labourHours: 2, stopAt: 'open' }],
    }),
    // out of warranty: billable repair in progress
    base(at(env, addDays(today, -840), 12, 0), {
      name: 'Nitin Sheth', phone: '+919879012345', customerKind: 'home', system: 'on_grid', kw: 2, subsidy: true, fate: 'won', payLagDays: 6,
      tickets: [{ afterDays: 0, at: ago(26 * 60), serial: 'inverter', fault: 'E-035', description: 'Inverter stopped feeding the grid. Display shows E-035 (isolation fault).', priority: 'high', parts: 'replace_inverter', labourHours: 2, stopAt: 'in_progress' }],
    }),
    // fixed under warranty yesterday, waiting for the customer to confirm
    base(at(env, addDays(today, -300), 10, 0), {
      name: 'Yamini Kapadia', phone: '+919712233445', system: 'on_grid', kw: 3, fate: 'won',
      tickets: [{ afterDays: 0, at: ago(30 * 60), serial: null, description: 'Generation lower than the neighbour’s similar system.', priority: 'normal', parts: 'none', labourHours: 1.5, stopAt: 'resolved' }],
    }),
    // Scene 6: a job that lost money — small system, discounted, then a free inverter replacement
    base(daysAgo(Math.min(24, Number(today.slice(8, 10)) + 4), 11, 0), {
      name: 'Gopal Vora', phone: '+919825099887', kw: 1, system: 'on_grid', subsidy: true, customerKind: 'home', discountPct: 10, fate: 'won', payLagDays: 3,
      tickets: [{ afterDays: 4, serial: 'inverter', fault: 'E-011', description: 'Inverter dead after a lightning strike nearby.', priority: 'high', parts: 'replace_inverter', labourHours: 3 }],
    }),
    // and one where a crane and a deep discount ate the margin
    base(daysAgo(Math.min(22, Number(today.slice(8, 10)) + 2), 12, 0), { name: 'Shreeji Textiles (Ramesh Amin)', phone: '+919909887766', customerKind: 'business', kw: 5, system: 'on_grid', subsidy: false, discountPct: 16, crane: true, fate: 'won', payLagDays: 9 }),
  ].map((s) => ({ ...s, fate: s.fate }));
}

/* ------------------------------------------------------------------ run it */

export async function simulate(env: SimEnv, opts: { seed: number; days: number; perDay: number }): Promise<{ steps: number; stories: number; dropped: number }> {
  const r = rng(opts.seed);
  // shared photo and signature files
  for (let i = 0; i < 4; i++) env.photos.push((await saveFile(env.db, 'install_photo', roofPhoto(opts.seed + i, 2, 3 + (i % 2)), env.people.technicians[i]!, env.realNow)).id);
  for (let i = 0; i < 2; i++) env.surveyPhotos.push((await saveFile(env.db, 'survey_photo', roofPhoto(opts.seed + 40 + i, 0, 0), env.people.technicians[i]!, env.realNow)).id);
  for (let i = 0; i < 5; i++) env.signatures.push((await saveFile(env.db, 'signature', signature(opts.seed + 90 + i), null, env.realNow)).id);

  const specs = makeSpecs(env, r, opts.days, opts.perDay).sort((a, b) => a.start.getTime() - b.start.getTime());
  const earliest = localDate(env, specs[0]!.start);
  const gens: { gen: AsyncGenerator<Date, void, void>; at: Date; spec?: Spec }[] = [];
  const push = async (gen: AsyncGenerator<Date, void, void>, spec?: Spec) => {
    const first = await gen.next();
    if (!first.done) gens.push({ gen, at: first.value, spec });
  };
  await push(procurement(env, addDays(earliest, -3)));
  await push(payroll(env, earliest));
  for (const s of specs) await push(story(env, s, rng(opts.seed + gens.length * 7919)), s);

  let steps = 0;
  let dropped = 0;
  for (;;) {
    let idx = -1;
    for (let i = 0; i < gens.length; i++) if (idx < 0 || gens[i]!.at < gens[idx]!.at) idx = i;
    if (idx < 0) break;
    const g = gens[idx]!;
    if (g.at > env.realNow) {
      gens.splice(idx, 1);
      continue;
    }
    env.now = g.at;
    // each step is a savepoint: a story that hits a rule (e.g. a clash) stops there; the rest go on
    await env.db.query('SAVEPOINT step');
    try {
      const res = await g.gen.next();
      await env.db.query('RELEASE SAVEPOINT step');
      steps++;
      if (res.done) gens.splice(idx, 1);
      else g.at = res.value < env.now ? env.now : res.value;
    } catch (err) {
      await env.db.query('ROLLBACK TO SAVEPOINT step');
      gens.splice(idx, 1);
      dropped++;
      log.debug({ err: (err as Error).message, customer: g.spec?.name }, 'demo story stopped early');
      if (dropped > 25) throw err;
      // an order left half-way would sit in the warehouse for months; the office would cancel it
      const jobId = g.spec?.jobId;
      if (jobId) {
        await env.db.query('SAVEPOINT tidy');
        try {
          await cancelJob(env.db, ctx(env, env.people.owner, 'owner'), jobId, 'customer postponed the installation');
          await env.db.query('RELEASE SAVEPOINT tidy');
        } catch {
          await env.db.query('ROLLBACK TO SAVEPOINT tidy');
        }
      }
    }
  }

  // quiet the notification bell: only the last few stay unread
  await env.db.query(`DELETE FROM notifications WHERE created_at < $1`, [new Date(env.realNow.getTime() - 3 * 86_400_000)]);
  await env.db.query(
    `UPDATE notifications SET read_at = created_at WHERE id NOT IN (SELECT id FROM notifications ORDER BY created_at DESC LIMIT 400)`,
  );
  return { steps, stories: specs.length, dropped };
}
