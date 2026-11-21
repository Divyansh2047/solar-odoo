import { addDays, estimateGeneration, formatDate, formatINR, lineAmount, subsidyFor, taxOn, type Shading } from '@arka/shared';
import type { Db } from '../db/pool.js';
import { config } from '../config.js';
import { token } from '../lib/crypto.js';
import { conflict, invalid } from '../lib/errors.js';
import { publish } from '../lib/events.js';
import { sendMail } from '../lib/mailer.js';
import { afterCommit, logActivity, nextRef, notifyRoles, today, type Ctx } from './context.js';
import { expandTemplate } from './catalog.js';
import { createJobFromQuote } from './jobs.js';
import { maybe, one } from './util.js';

export interface QuoteRow {
  [k: string]: unknown;
  id: number;
  ref: string;
  version: number;
  lead_id: number;
  customer_id: number;
  survey_id: number;
  template_id: number;
  kind: 'on_grid' | 'off_grid' | 'panel_set' | 'service';
  capacity_kw: number;
  status: string;
  valid_until: string;
  subtotal_paise: number;
  discount_paise: number;
  tax_paise: number;
  total_paise: number;
  subsidy_paise: number;
  advance_percent: number;
  public_token: string;
}

export function quoteTotals(lines: { amount: number; gstRateBp: number }[], discountPaise: number) {
  const subtotal = lines.reduce((s, l) => s + l.amount, 0);
  if (discountPaise > subtotal) throw invalid('The discount can’t be more than the subtotal.', { discountPaise: `At most ${formatINR(subtotal)}` });
  const ratio = subtotal ? discountPaise / subtotal : 0;
  const tax = lines.reduce((s, l) => s + taxOn(Math.round(l.amount * (1 - ratio)), l.gstRateBp), 0);
  return { subtotal, discount: discountPaise, tax, total: subtotal - discountPaise + tax };
}

async function companySettings(db: Db) {
  return one<{
    advance_percent: number;
    quote_validity_days: number;
    subsidy_enabled: boolean;
    subsidy_slab1_kw: number;
    subsidy_slab1_per_kw_paise: number;
    subsidy_slab2_kw: number;
    subsidy_slab2_per_kw_paise: number;
    subsidy_cap_paise: number;
    name: string;
    kind: string;
  }>(db, `SELECT * FROM companies WHERE id = app_company()`);
}

/**
 * Build a quote from a ready template. The survey must be approved (the database enforces this too);
 * the parts list follows on its own, with cable lengths taken from the measured cable distance.
 */
export async function createQuote(
  db: Db,
  ctx: Ctx,
  input: { leadId: number; templateId: number; capacityKw?: number | undefined; discountPaise?: number | undefined; advancePercent?: number | undefined; notes?: string | undefined },
): Promise<QuoteRow> {
  const lead = await one<{ id: number; ref: string; status: string; customer_id: number; kind: string }>(
    db,
    `SELECT l.id, l.ref, l.status, l.customer_id, c.kind FROM leads l JOIN customers c ON c.id = l.customer_id WHERE l.id = $1 FOR UPDATE OF l`,
    [input.leadId],
    'That enquiry',
  );
  if (lead.status === 'won' || lead.status === 'lost') throw conflict('wrong_stage', `${lead.ref} is ${lead.status === 'won' ? 'already a job' : 'closed'}.`);
  const survey = await maybe<{ id: number; ref: string; cable_distance_m: number; azimuth_deg: number; tilt_deg: number; shading: Shading }>(
    db,
    `SELECT id, ref, cable_distance_m, azimuth_deg, tilt_deg, shading FROM surveys WHERE lead_id = $1 AND status = 'approved' ORDER BY reviewed_at DESC LIMIT 1`,
    [lead.id],
  );
  if (!survey) throw conflict('survey_not_approved', `Approve a roof survey for ${lead.ref} before making a quote. The customer only gets a quote after the survey is approved.`);
  const live = await maybe<{ ref: string; status: string }>(db, `SELECT ref, status FROM quotes WHERE lead_id = $1 AND status IN ('draft', 'sent')`, [lead.id]);
  if (live) throw conflict('quote_open', `${live.ref} is already ${live.status === 'draft' ? 'being drafted' : 'with the customer'}. Revise it instead of starting another.`);

  const { template, lines } = await expandTemplate(db, input.templateId, survey.cable_distance_m, input.capacityKw ?? null);
  if (template.status !== 'active') throw invalid('That kit is archived.', { templateId: 'Choose an active kit' });
  const settings = await companySettings(db);
  const priced = lines.map((l) => ({ ...l, amount: lineAmount(l.qty, l.unitPricePaise) }));
  const t = quoteTotals(priced.map((l) => ({ amount: l.amount, gstRateBp: l.gstRateBp })), input.discountPaise ?? 0);
  const capacity = template.capacity_kw ?? input.capacityKw ?? 1;
  const subsidy = subsidyFor(capacity, template.kind, lead.kind as 'home' | 'business', {
    enabled: settings.subsidy_enabled,
    slab1Kw: settings.subsidy_slab1_kw,
    slab1PerKwPaise: settings.subsidy_slab1_per_kw_paise,
    slab2Kw: settings.subsidy_slab2_kw,
    slab2PerKwPaise: settings.subsidy_slab2_per_kw_paise,
    capPaise: settings.subsidy_cap_paise,
  });
  const gen = estimateGeneration({ capacityKw: capacity, azimuthDeg: survey.azimuth_deg, tiltDeg: survey.tilt_deg, shading: survey.shading });
  const ref = await nextRef(db, 'QT');
  const quote = await one<QuoteRow>(
    db,
    `INSERT INTO quotes (ref, lead_id, customer_id, survey_id, template_id, kind, capacity_kw, valid_until, subtotal_paise, discount_paise, tax_paise, total_paise,
       subsidy_paise, advance_percent, est_monthly_units, notes, public_token, created_by, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19) RETURNING *`,
    [
      ref,
      lead.id,
      lead.customer_id,
      survey.id,
      template.id,
      template.kind,
      capacity,
      addDays(today(ctx), settings.quote_validity_days),
      t.subtotal,
      t.discount,
      t.tax,
      t.total,
      subsidy,
      input.advancePercent ?? settings.advance_percent,
      gen.monthlyUnits,
      input.notes ?? null,
      token(24),
      ctx.userId,
      ctx.now,
    ],
  );
  let sort = 0;
  for (const l of priced) {
    await db.query(
      `INSERT INTO quote_lines (quote_id, product_id, description, qty, unit_price_paise, gst_rate_bp, amount_paise, rule_explain, sort) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [quote.id, l.productId, l.name, l.qty, l.unitPricePaise, l.gstRateBp, l.amount, l.explain, sort++],
    );
  }
  await logActivity(db, ctx, { customerId: lead.customer_id, leadId: lead.id, body: `Quote ${ref} drafted from ${template.name} (${formatINR(t.total)}).` });
  await publish(db, ['quotes', 'leads']);
  return quote;
}

async function lockQuote(db: Db, id: number): Promise<QuoteRow> {
  return one<QuoteRow>(db, `SELECT * FROM quotes WHERE id = $1 FOR UPDATE`, [id], 'That quote');
}

/** Edit a draft: lines, discount, advance and validity. Totals are recalculated on the server. */
export async function updateQuote(
  db: Db,
  ctx: Ctx,
  id: number,
  input: { lines: { productId: number; description?: string | undefined; qty: number; unitPricePaise: number }[]; discountPaise: number; advancePercent: number; validUntil: string; notes?: string | undefined },
): Promise<QuoteRow> {
  const q = await lockQuote(db, id);
  if (q.status !== 'draft') throw conflict('wrong_stage', `${q.ref} v${q.version} was already sent. Revise it to make changes.`);
  if (input.validUntil < today(ctx)) throw invalid('The quote can’t expire in the past.', { validUntil: 'Pick today or later' });
  const prods = await db.query<{ id: number; name: string; gst_rate_bp: number; status: string }>(
    `SELECT id, name, gst_rate_bp, status FROM products WHERE id = ANY($1::bigint[])`,
    [input.lines.map((l) => l.productId)],
  );
  const lines = input.lines.map((l) => {
    const p = prods.rows.find((x) => x.id === l.productId);
    if (!p) throw invalid('A line points to a product that doesn’t exist.', { lines: 'Check the products' });
    return { ...l, name: l.description || p.name, gstRateBp: p.gst_rate_bp, amount: lineAmount(l.qty, l.unitPricePaise) };
  });
  const t = quoteTotals(lines, input.discountPaise);
  await db.query(`DELETE FROM quote_lines WHERE quote_id = $1`, [id]);
  let sort = 0;
  for (const l of lines) {
    await db.query(
      `INSERT INTO quote_lines (quote_id, product_id, description, qty, unit_price_paise, gst_rate_bp, amount_paise, rule_explain, sort) VALUES ($1, $2, $3, $4, $5, $6, $7, 'Edited', $8)`,
      [id, l.productId, l.name, l.qty, l.unitPricePaise, l.gstRateBp, l.amount, sort++],
    );
  }
  const row = await one<QuoteRow>(
    db,
    `UPDATE quotes SET subtotal_paise = $2, discount_paise = $3, tax_paise = $4, total_paise = $5, advance_percent = $6, valid_until = $7, notes = $8 WHERE id = $1 RETURNING *`,
    [id, t.subtotal, t.discount, t.tax, t.total, input.advancePercent, input.validUntil, input.notes ?? null],
  );
  await publish(db, ['quotes']);
  return row;
}

export async function sendQuote(db: Db, ctx: Ctx, id: number): Promise<{ link: string; emailed: boolean }> {
  const q = await lockQuote(db, id);
  if (q.status !== 'draft') throw conflict('wrong_stage', `${q.ref} v${q.version} is already ${q.status}.`);
  if (q.valid_until < today(ctx)) throw conflict('expired', 'Move the “valid until” date forward before sending.');
  await db.query(`UPDATE quotes SET status = 'sent', sent_at = $2 WHERE id = $1`, [id, ctx.now]);
  await db.query(`UPDATE leads SET status = 'quoted', updated_at = $2 WHERE id = $1 AND status IN ('survey', 'qualified')`, [q.lead_id, ctx.now]);
  const c = await one<{ name: string; email: string | null }>(db, `SELECT name, email FROM customers WHERE id = $1`, [q.customer_id]);
  const co = await companySettings(db);
  const link = `${config().APP_URL}/q/${q.public_token}`;
  let emailed = false;
  if (c.email) {
    afterCommit(ctx, () => sendMail(
      {
        to: c.email!,
        subject: `Your solar quote ${q.ref} from ${co.name}`,
        lines: [`Hello ${c.name.split(' ')[0]},`, `Here is your quote for a ${q.capacity_kw} kW system: ${formatINR(q.total_paise)} including GST.`, 'Open it to see the full parts list, the subsidy estimate and your expected savings. You can accept it online.'],
        action: { label: 'View your quote', url: link },
        footer: `${co.name}. Valid until ${formatDate(q.valid_until)}.`,
      },
      { demo: ctx.isDemo },
    ));
    emailed = true;
  }
  await logActivity(db, ctx, { customerId: q.customer_id, leadId: q.lead_id, body: `Quote ${q.ref} v${q.version} sent${emailed ? ` to ${c.email}` : ''}.` });
  await publish(db, ['quotes', 'leads']);
  return { link, emailed };
}

/** Start a new version from a sent, declined or expired quote. */
export async function reviseQuote(db: Db, ctx: Ctx, id: number): Promise<QuoteRow> {
  const q = await lockQuote(db, id);
  if (!['sent', 'rejected', 'expired'].includes(q.status)) throw conflict('wrong_stage', `Only sent, declined or expired quotes can be revised.`);
  const lead = await one<{ status: string }>(db, `SELECT status FROM leads WHERE id = $1`, [q.lead_id]);
  if (lead.status === 'won' || lead.status === 'lost') throw conflict('wrong_stage', 'That enquiry is closed.');
  await db.query(`UPDATE quotes SET status = 'superseded' WHERE id = $1`, [id]);
  const settings = await companySettings(db);
  const nq = await one<QuoteRow>(
    db,
    `INSERT INTO quotes (ref, version, lead_id, customer_id, survey_id, template_id, kind, capacity_kw, valid_until, subtotal_paise, discount_paise, tax_paise,
       total_paise, subsidy_paise, advance_percent, est_monthly_units, notes, public_token, created_by, created_at)
     SELECT ref, version + 1, lead_id, customer_id, survey_id, template_id, kind, capacity_kw, $2, subtotal_paise, discount_paise, tax_paise,
       total_paise, subsidy_paise, advance_percent, est_monthly_units, notes, $3, $4, $5 FROM quotes WHERE id = $1 RETURNING *`,
    [id, addDays(today(ctx), settings.quote_validity_days), token(24), ctx.userId, ctx.now],
  );
  await db.query(
    `INSERT INTO quote_lines (quote_id, product_id, description, qty, unit_price_paise, gst_rate_bp, amount_paise, rule_explain, sort)
     SELECT $2, product_id, description, qty, unit_price_paise, gst_rate_bp, amount_paise, rule_explain, sort FROM quote_lines WHERE quote_id = $1`,
    [id, nq.id],
  );
  await logActivity(db, ctx, { customerId: q.customer_id, leadId: q.lead_id, body: `Quote ${q.ref} revised to v${nq.version}.` });
  await publish(db, ['quotes']);
  return nq;
}

/** The customer says yes (on the quote page, or sales records a yes given on the phone). Creates the job. */
export async function acceptQuote(db: Db, ctx: Ctx, id: number, acceptedName: string): Promise<{ jobId: number; jobRef: string }> {
  const q = await lockQuote(db, id);
  if (q.status !== 'sent') throw conflict('wrong_stage', q.status === 'accepted' ? 'This quote was already accepted.' : 'This quote can no longer be accepted.');
  if (q.valid_until < today(ctx)) {
    await db.query(`UPDATE quotes SET status = 'expired' WHERE id = $1`, [id]);
    throw conflict('expired', 'This quote has expired. Ask us for a fresh one.');
  }
  await db.query(`UPDATE quotes SET status = 'accepted', decided_at = $2, accepted_name = $3 WHERE id = $1`, [id, ctx.now, acceptedName]);
  await db.query(`UPDATE leads SET status = 'won', updated_at = $2 WHERE id = $1`, [q.lead_id, ctx.now]);
  const job = await createJobFromQuote(db, ctx, q);
  await logActivity(db, ctx, {
    customerId: q.customer_id,
    leadId: q.lead_id,
    jobId: job.id,
    body: `${acceptedName} accepted ${q.ref} v${q.version}. Job ${job.ref} created.`,
  });
  await notifyRoles(db, ['sales', 'accounts'], { title: `${q.ref} accepted`, body: `Job ${job.ref}: collect the advance to confirm.`, link: `/app/jobs/${job.id}` });
  await publish(db, ['quotes', 'leads', 'jobs', 'notifications']);
  return { jobId: job.id, jobRef: job.ref };
}

export async function declineQuote(db: Db, ctx: Ctx, id: number, reason: string): Promise<void> {
  const q = await lockQuote(db, id);
  if (q.status !== 'sent') throw conflict('wrong_stage', 'This quote can no longer be declined.');
  await db.query(`UPDATE quotes SET status = 'rejected', decided_at = $2, rejected_reason = $3 WHERE id = $1`, [id, ctx.now, reason]);
  await logActivity(db, ctx, { customerId: q.customer_id, leadId: q.lead_id, body: `Quote ${q.ref} declined: ${reason}` });
  await notifyRoles(db, ['sales'], { title: `${q.ref} declined`, body: reason, link: `/app/quotes/${id}` });
  await publish(db, ['quotes', 'notifications']);
}

/** Housekeeping: sent quotes past their date become expired. */
export async function expireQuotes(db: Db, ctx: Ctx): Promise<number> {
  const r = await db.query(`UPDATE quotes SET status = 'expired' WHERE status = 'sent' AND valid_until < $1`, [today(ctx)]);
  if (r.rowCount) await publish(db, ['quotes']);
  return r.rowCount ?? 0;
}
