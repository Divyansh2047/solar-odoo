import {
  LEAD_CLOSE_LABEL,
  LEAD_SOURCE_LABEL,
  formatKw,
  recommendSize,
  type LeadCreateInput,
  type LeadSource,
  type QualificationInput,
} from '@arka/shared';
import type { Db } from '../db/pool.js';
import { token } from '../lib/crypto.js';
import { conflict, invalid } from '../lib/errors.js';
import { publish } from '../lib/events.js';
import { logActivity, nextRef, notifyRoles, type Ctx } from './context.js';
import { maybe, one } from './util.js';

export interface LeadRow {
  [k: string]: unknown;
  id: number;
  ref: string;
  customer_id: number;
  status: string;
  system_type: string;
  requested_kw: number | null;
  wants_subsidy: boolean;
  first_contact_at: string | null;
  qualified_at: string | null;
}

type EnquiryInput = Omit<LeadCreateInput, 'source' | 'assignedTo'> & { source: LeadSource; assignedTo?: number | undefined };

/**
 * Every enquiry, from any channel, lands here. The customer is found by phone (or created); a repeat
 * enquiry from someone with an open enquiry is attached to it instead of creating a duplicate, so
 * nothing gets lost and nobody calls the same person twice.
 */
export async function createEnquiry(db: Db, ctx: Ctx, input: EnquiryInput): Promise<{ lead: LeadRow; merged: boolean }> {
  const existing = await maybe<{ id: number; name: string; email: string | null; address: string; city: string; pincode: string }>(
    db,
    `SELECT id, name, email, address, city, pincode FROM customers WHERE phone = $1`,
    [input.phone],
  );
  let customerId: number;
  let unverifiedChanges: string | null = null;
  if (existing) {
    customerId = existing.id;
    if (ctx.userId !== null) {
      // staff, signed in, updating details they were given
      await db.query(
        `UPDATE customers SET email = coalesce($2, email), address = $3, city = $4, pincode = $5, kind = $6 WHERE id = $1`,
        [customerId, input.email ?? null, input.address, input.city, input.pincode, input.customerKind],
      );
    } else {
      // The public form proves nothing about who owns this phone number, so it never changes an
      // existing customer's contact details (that would redirect their emails). Staff review instead.
      const diffs = [
        input.email && input.email !== existing.email ? `email ${input.email}` : null,
        input.address !== existing.address || input.city !== existing.city || input.pincode !== existing.pincode ? `address ${input.address}, ${input.city} ${input.pincode}` : null,
      ].filter(Boolean);
      if (diffs.length) unverifiedChanges = `The web form gave different details (not applied; check with the customer): ${diffs.join('; ')}.`;
    }
  } else {
    const c = await one<{ id: number }>(
      db,
      `INSERT INTO customers (name, phone, email, address, city, pincode, kind, portal_token, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [input.name, input.phone, input.email ?? null, input.address, input.city, input.pincode, input.customerKind, token(24), ctx.now],
    );
    customerId = c.id;
  }

  const need = [
    input.requestedKw ? formatKw(input.requestedKw) : null,
    input.systemType !== 'not_sure' ? (input.systemType === 'on_grid' ? 'On-Grid' : 'Off-Grid') : null,
    input.wantsSubsidy ? 'under the subsidy' : null,
  ]
    .filter(Boolean)
    .join(', ');

  const open = await maybe<LeadRow>(db, `SELECT * FROM leads WHERE customer_id = $1 AND status NOT IN ('won', 'lost') ORDER BY created_at DESC LIMIT 1 FOR UPDATE`, [
    customerId,
  ]);
  if (open) {
    await db.query(
      `UPDATE leads SET requested_kw = coalesce($2, requested_kw), wants_subsidy = wants_subsidy OR $3,
         message = CASE WHEN $4::text IS NULL THEN message ELSE concat_ws(E'\n\n', message, $4::text) END, updated_at = $5 WHERE id = $1`,
      [open.id, input.requestedKw ?? null, input.wantsSubsidy, input.message ?? null, ctx.now],
    );
    await logActivity(db, ctx, {
      customerId,
      leadId: open.id,
      kind: input.source === 'whatsapp' ? 'whatsapp' : 'system',
      body: `Asked again via ${LEAD_SOURCE_LABEL[input.source]}${need ? ` (${need})` : ''}. Attached to ${open.ref} instead of a duplicate.`,
    });
    if (unverifiedChanges) await logActivity(db, ctx, { customerId, leadId: open.id, body: unverifiedChanges });
    await notifyRoles(db, ['sales'], { title: `${input.name} asked again`, body: `${open.ref}: same customer, new message via ${LEAD_SOURCE_LABEL[input.source]}.`, link: `/app/enquiries/${open.id}` });
    await publish(db, ['leads', 'notifications']);
    const lead = await one<LeadRow>(db, `SELECT * FROM leads WHERE id = $1`, [open.id]);
    return { lead, merged: true };
  }

  const ref = await nextRef(db, 'ENQ');
  const monthlyBill = input.monthlyBillRupees ? input.monthlyBillRupees * 100 : null;
  const lead = await one<LeadRow>(
    db,
    `INSERT INTO leads (ref, customer_id, source, system_type, requested_kw, wants_subsidy, message, assigned_to, monthly_bill_paise, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10) RETURNING *`,
    [ref, customerId, input.source, input.systemType, input.requestedKw ?? null, input.wantsSubsidy, input.message ?? null, input.assignedTo ?? null, monthlyBill, ctx.now],
  );
  await logActivity(db, ctx, {
    customerId,
    leadId: lead.id,
    kind: input.source === 'whatsapp' ? 'whatsapp' : input.source === 'call' ? 'call' : 'system',
    body: `Enquiry ${ref} received via ${LEAD_SOURCE_LABEL[input.source]}${need ? `: ${need}` : ''}.`,
  });
  if (unverifiedChanges) await logActivity(db, ctx, { customerId, leadId: lead.id, body: unverifiedChanges });
  await notifyRoles(
    db,
    ['sales'],
    { title: `New enquiry from ${input.name}`, body: `${ref} · ${input.city}${need ? ` · ${need}` : ''}`, link: `/app/enquiries/${lead.id}` },
    ctx.userId,
  );
  await publish(db, ['leads', 'notifications']);
  return { lead, merged: false };
}

async function lockLead(db: Db, id: number): Promise<LeadRow> {
  return one<LeadRow>(db, `SELECT * FROM leads WHERE id = $1 FOR UPDATE`, [id], 'That enquiry');
}

/** A call, WhatsApp message or note. The first call stops the response-time clock. */
export async function addLeadActivity(db: Db, ctx: Ctx, leadId: number, a: { kind: 'note' | 'call' | 'whatsapp'; body: string }): Promise<void> {
  const lead = await lockLead(db, leadId);
  await logActivity(db, ctx, { customerId: lead.customer_id, leadId, kind: a.kind, body: a.body });
  if (a.kind !== 'note' && !lead.first_contact_at) {
    await db.query(`UPDATE leads SET first_contact_at = $2, status = CASE WHEN status = 'new' THEN 'contacted' ELSE status END, updated_at = $2 WHERE id = $1`, [
      leadId,
      ctx.now,
    ]);
  }
  await publish(db, ['leads']);
}

export async function assignLead(db: Db, ctx: Ctx, leadId: number, userId: number): Promise<void> {
  const lead = await lockLead(db, leadId);
  const u = await maybe<{ name: string }>(db, `SELECT name FROM users WHERE id = $1 AND status = 'active' AND role IN ('sales', 'owner')`, [userId]);
  if (!u) throw invalid('Assign enquiries to someone in sales.', { assignedTo: 'Choose a sales person' });
  await db.query(`UPDATE leads SET assigned_to = $2, updated_at = $3 WHERE id = $1`, [leadId, userId, ctx.now]);
  await logActivity(db, ctx, { customerId: lead.customer_id, leadId, body: `Assigned to ${u.name}.` });
  if (userId !== ctx.userId) {
    await db.query(`INSERT INTO notifications (user_id, title, body, link) VALUES ($1, $2, $3, $4)`, [
      userId,
      `${lead.ref} is yours`,
      'Call them and check the basics.',
      `/app/enquiries/${leadId}`,
    ]);
  }
  await publish(db, ['leads', 'notifications']);
}

/** The qualification call: roof space, bill, grid. Records the facts and a size recommendation. */
export async function qualifyLead(db: Db, ctx: Ctx, leadId: number, input: QualificationInput): Promise<{ recommendedKw: number | null }> {
  const lead = await lockLead(db, leadId);
  if (!['new', 'contacted', 'qualified'].includes(lead.status)) {
    throw conflict('wrong_stage', `${lead.ref} is past qualification (it’s at “${lead.status}”).`);
  }
  const sizing = recommendSize({
    monthlyBillPaise: input.monthlyBillRupees * 100,
    roofAreaSqft: input.roofAreaSqft,
    shading: input.shading,
    gridConnection: input.gridConnection,
    systemType: input.systemType,
  });
  const qualified = input.outcome === 'qualified';
  await db.query(
    `UPDATE leads SET roof_area_sqft = $2, monthly_bill_paise = $3, grid_connection = $4, sanctioned_load_kw = $5, roof_type = $6, shading = $7,
       system_type = $8, grid_suitable = $9, recommended_kw = $10,
       status = $11, qualified_at = CASE WHEN $12 THEN $13 ELSE qualified_at END, qualified_by = CASE WHEN $12 THEN $14 ELSE qualified_by END,
       first_contact_at = coalesce(first_contact_at, $13),
       lost_reason = CASE WHEN $12 THEN NULL ELSE $15 END, lost_note = CASE WHEN $12 THEN NULL ELSE $16 END,
       closed_at = CASE WHEN $12 THEN NULL ELSE $13 END, updated_at = $13
     WHERE id = $1`,
    [
      leadId,
      input.roofAreaSqft,
      input.monthlyBillRupees * 100,
      input.gridConnection,
      input.sanctionedLoadKw ?? null,
      input.roofType,
      input.shading,
      input.systemType,
      input.gridSuitable,
      sizing.recommendedKw,
      qualified ? 'qualified' : 'lost',
      qualified,
      ctx.now,
      ctx.userId,
      input.gridSuitable ? 'roof_not_suitable' : 'grid_not_suitable',
      input.note ?? null,
    ],
  );
  await logActivity(db, ctx, {
    customerId: lead.customer_id,
    leadId,
    kind: 'call',
    body: qualified
      ? `Qualified on the call: ${input.roofAreaSqft} sq ft shadow-free, bill ₹${input.monthlyBillRupees.toLocaleString('en-IN')}/month, grid ${input.gridSuitable ? 'suitable' : 'not suitable'}. Suggested ${sizing.recommendedKw ?? '—'} kW.`
      : `Not suitable: ${input.note ?? ''}`,
  });
  await publish(db, ['leads']);
  return { recommendedKw: sizing.recommendedKw };
}

export async function closeLead(db: Db, ctx: Ctx, leadId: number, reason: keyof typeof LEAD_CLOSE_LABEL, note?: string): Promise<void> {
  const lead = await lockLead(db, leadId);
  if (lead.status === 'won') throw conflict('wrong_stage', `${lead.ref} is already a job; cancel the job instead.`);
  if (lead.status === 'lost') throw conflict('wrong_stage', `${lead.ref} is already closed.`);
  await db.query(`UPDATE leads SET status = 'lost', lost_reason = $2, lost_note = $3, closed_at = $4, updated_at = $4 WHERE id = $1`, [
    leadId,
    reason,
    note ?? null,
    ctx.now,
  ]);
  // Open surveys and quotes for a closed enquiry stop too.
  await db.query(`UPDATE surveys SET status = 'cancelled' WHERE lead_id = $1 AND status = 'scheduled'`, [leadId]);
  await db.query(
    `UPDATE visits v SET status = 'cancelled' FROM visit_links l, surveys s
      WHERE l.visit_id = v.id AND l.survey_id = s.id AND s.lead_id = $1 AND v.status = 'planned'`,
    [leadId],
  );
  await db.query(`UPDATE visit_crew c SET active = false FROM visits v WHERE c.visit_id = v.id AND v.status = 'cancelled'`);
  await logActivity(db, ctx, { customerId: lead.customer_id, leadId, body: `Closed: ${LEAD_CLOSE_LABEL[reason]}${note ? ` (${note})` : ''}.` });
  await publish(db, ['leads', 'schedule', 'surveys']);
}

export async function reopenLead(db: Db, ctx: Ctx, leadId: number): Promise<void> {
  const lead = await lockLead(db, leadId);
  if (lead.status !== 'lost') throw conflict('wrong_stage', `${lead.ref} isn’t closed.`);
  await db.query(
    `UPDATE leads SET status = CASE WHEN qualified_at IS NOT NULL THEN 'qualified' ELSE 'contacted' END, lost_reason = NULL, lost_note = NULL, closed_at = NULL, updated_at = $2 WHERE id = $1`,
    [leadId, ctx.now],
  );
  await logActivity(db, ctx, { customerId: lead.customer_id, leadId, body: 'Reopened.' });
  await publish(db, ['leads']);
}
