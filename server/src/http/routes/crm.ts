import { Router } from 'express';
import {
  activitySchema,
  leadAssignSchema,
  leadCloseSchema,
  leadCreateSchema,
  qualificationSchema,
  recommendSize,
  estimateGeneration,
  surveyRescheduleSchema,
  surveyReviewSchema,
  surveyScheduleSchema,
  surveySubmitSchema,
  type Shading,
} from '@arka/shared';
import { addLeadActivity, assignLead, closeLead, createEnquiry, qualifyLead, reopenLead } from '../../domain/leads.js';
import { cancelSurvey, rescheduleSurvey, reviewSurvey, scheduleSurvey, submitSurvey } from '../../domain/surveys.js';
import { notFound } from '../../lib/errors.js';
import { act, canShareLinks, idParam, query, read } from '../context.js';
import { token } from '../../lib/crypto.js';
import { audit } from '../../domain/context.js';

const like = (s: unknown) => (typeof s === 'string' && s.trim() ? `%${s.trim().replace(/[%_\\]/g, (m) => '\\' + m)}%` : null);

export function crmRoutes(): Router {
  const r = Router();

  /* ---------------- enquiries ---------------- */
  r.get(
    '/leads',
    read('leads.read', async (req) => {
      const status = typeof req.query.status === 'string' && req.query.status !== 'all' ? req.query.status : null;
      const source = typeof req.query.source === 'string' && req.query.source !== 'all' ? req.query.source : null;
      const mine = req.query.mine === '1' ? req.user!.id : null;
      const rows = await query(
        `SELECT l.id, l.ref, l.status, l.source, l.system_type, l.requested_kw, l.recommended_kw, l.wants_subsidy, l.created_at, l.first_contact_at,
                l.lost_reason, c.id AS customer_id, c.name, c.phone, c.city, c.kind AS customer_kind, u.name AS assigned_name, l.assigned_to,
                (l.status = 'new' AND l.first_contact_at IS NULL AND l.created_at < now() - make_interval(mins => co.sla_first_call_minutes)) AS overdue,
                (SELECT max(created_at) FROM activities a WHERE a.lead_id = l.id) AS last_activity_at,
                (SELECT s.status FROM surveys s WHERE s.lead_id = l.id ORDER BY s.created_at DESC LIMIT 1) AS survey_status,
                (SELECT q.status FROM quotes q WHERE q.lead_id = l.id AND q.status <> 'superseded' ORDER BY q.created_at DESC LIMIT 1) AS quote_status
           FROM leads l JOIN customers c ON c.id = l.customer_id JOIN companies co ON co.id = l.company_id LEFT JOIN users u ON u.id = l.assigned_to
          WHERE ($1::text IS NULL OR l.status = $1) AND ($2::text IS NULL OR l.source = $2) AND ($3::bigint IS NULL OR l.assigned_to = $3)
            AND ($4::text IS NULL OR c.name ILIKE $4 OR c.phone LIKE $5 OR l.ref ILIKE $4 OR c.city ILIKE $4)
          ORDER BY (l.status = 'new' AND l.first_contact_at IS NULL) DESC, l.created_at DESC LIMIT 300`,
        [status, source, mine, like(req.query.q), `%${String(req.query.q ?? '').replace(/\D/g, '') || '§'}%`],
      );
      const counts = await query(`SELECT status, count(*)::int AS n FROM leads GROUP BY status`);
      return { leads: rows.rows, counts: Object.fromEntries(counts.rows.map((c) => [c.status, c.n])) };
    }),
  );

  r.post(
    '/leads',
    act('leads.write', leadCreateSchema, async (input, db, ctx) => {
      const out = await createEnquiry(db, ctx, input);
      return { id: out.lead.id, ref: out.lead.ref, merged: out.merged };
    }),
  );

  r.get(
    '/leads/:id',
    read('leads.read', async (req) => {
      const id = idParam(req);
      const l = await query(
        `SELECT l.*, c.name, c.phone, c.email, c.address, c.city, c.pincode, c.kind AS customer_kind, c.portal_token, u.name AS assigned_name,
                co.sla_first_call_minutes
           FROM leads l JOIN customers c ON c.id = l.customer_id JOIN companies co ON co.id = l.company_id LEFT JOIN users u ON u.id = l.assigned_to WHERE l.id = $1`,
        [id],
      );
      const lead = l.rows[0];
      if (!lead) throw notFound('That enquiry');
      const [activities, surveys, quotes, jobs, others] = await Promise.all([
        query(`SELECT a.id, a.kind, a.body, a.created_at, u.name AS actor FROM activities a LEFT JOIN users u ON u.id = a.actor_id WHERE a.customer_id = $1 ORDER BY a.created_at DESC, a.id DESC LIMIT 200`, [
          lead.customer_id,
        ]),
        query(
          `SELECT s.id, s.ref, s.status, s.recommended_kw, s.cable_distance_m, s.azimuth_deg, s.tilt_deg, s.submitted_at, s.reviewed_at, v.starts_at, u.name AS technician
             FROM surveys s LEFT JOIN visits v ON v.id = s.visit_id JOIN users u ON u.id = s.technician_id WHERE s.lead_id = $1 ORDER BY s.created_at DESC`,
          [id],
        ),
        query(`SELECT id, ref, version, status, total_paise, capacity_kw, kind, sent_at, valid_until FROM quotes WHERE lead_id = $1 ORDER BY ref, version DESC`, [id]),
        query(`SELECT id, ref, status FROM jobs WHERE lead_id = $1`, [id]),
        query(`SELECT id, ref, status, created_at FROM leads WHERE customer_id = $1 AND id <> $2 ORDER BY created_at DESC`, [lead.customer_id, id]),
      ]);
      const sizing =
        lead.monthly_bill_paise || lead.roof_area_sqft
          ? recommendSize({
              monthlyBillPaise: lead.monthly_bill_paise,
              roofAreaSqft: lead.roof_area_sqft,
              shading: lead.shading as Shading | null,
              gridConnection: lead.grid_connection,
              systemType: lead.system_type,
            })
          : null;
      return { lead, sizing, activities: activities.rows, surveys: surveys.rows, quotes: quotes.rows, jobs: jobs.rows, otherEnquiries: others.rows };
    }),
  );

  r.post('/leads/:id/activities', act('leads.write', activitySchema, async (input, db, ctx, req) => addLeadActivity(db, ctx, idParam(req), input)));
  r.post('/leads/:id/assign', act('leads.write', leadAssignSchema, async (input, db, ctx, req) => assignLead(db, ctx, idParam(req), input.assignedTo)));
  r.post('/leads/:id/qualify', act('leads.write', qualificationSchema, async (input, db, ctx, req) => qualifyLead(db, ctx, idParam(req), input)));
  r.post('/leads/:id/close', act('leads.write', leadCloseSchema, async (input, db, ctx, req) => closeLead(db, ctx, idParam(req), input.reason, input.note)));
  r.post('/leads/:id/reopen', act('leads.write', null, async (_i, db, ctx, req) => reopenLead(db, ctx, idParam(req))));

  /* ---------------- customers ---------------- */
  r.get(
    '/customers/:id',
    read('customers.read', async (req, ctx) => {
      const id = idParam(req);
      const c = await query(`SELECT * FROM customers WHERE id = $1`, [id]);
      if (!c.rows[0]) throw notFound('That customer');
      const [leads, jobs, serials, tickets, activities] = await Promise.all([
        query(`SELECT id, ref, status, created_at FROM leads WHERE customer_id = $1 ORDER BY created_at DESC`, [id]),
        query(`SELECT id, ref, status, kind, capacity_kw, total_paise, installed_at FROM jobs WHERE customer_id = $1 ORDER BY created_at DESC`, [id]),
        query(
          `SELECT su.id, su.serial, su.status, su.warranty_start, su.warranty_end, p.name AS product, p.category, j.ref AS job_ref
             FROM serial_units su JOIN products p ON p.id = su.product_id LEFT JOIN jobs j ON j.id = su.job_id WHERE su.customer_id = $1 ORDER BY p.category, su.serial`,
          [id],
        ),
        query(`SELECT id, ref, status, coverage, priority, created_at, description FROM tickets WHERE customer_id = $1 ORDER BY created_at DESC`, [id]),
        query(`SELECT a.id, a.kind, a.body, a.created_at, u.name AS actor FROM activities a LEFT JOIN users u ON u.id = a.actor_id WHERE a.customer_id = $1 ORDER BY a.created_at DESC LIMIT 100`, [id]),
      ]);
      const customer = c.rows[0]!;
      if (!canShareLinks(ctx.role)) delete customer.portal_token;
      return { customer, leads: leads.rows, jobs: jobs.rows, serials: serials.rows, tickets: tickets.rows, activities: activities.rows };
    }),
  );

  /** Replace a customer's page link (e.g. if it was forwarded to the wrong person). The old link stops working. */
  r.post(
    '/customers/:id/new-link',
    act('customers.write', null, async (_i, db, ctx, req) => {
      const id = idParam(req);
      const c = await db.query<{ id: number }>(`UPDATE customers SET portal_token = $2 WHERE id = $1 RETURNING id`, [id, token(24)]);
      if (!c.rows[0]) throw notFound('That customer');
      await audit(db, ctx, 'customer.new_link', 'customer', id);
    }),
  );

  /* ---------------- surveys ---------------- */
  r.get(
    '/surveys',
    read('surveys.read', async (req, ctx) => {
      const status = typeof req.query.status === 'string' && req.query.status !== 'all' ? req.query.status : null;
      const mineOnly = ctx.role === 'technician' || req.query.mine === '1';
      const rows = await query(
        `SELECT s.id, s.ref, s.status, s.recommended_kw, s.submitted_at, s.reviewed_at, v.starts_at, v.ends_at, u.name AS technician, s.technician_id,
                c.name AS customer, c.city, c.address, c.phone, l.ref AS lead_ref, l.id AS lead_id, l.requested_kw
           FROM surveys s JOIN users u ON u.id = s.technician_id JOIN customers c ON c.id = s.customer_id JOIN leads l ON l.id = s.lead_id
           LEFT JOIN visits v ON v.id = s.visit_id
          WHERE ($1::text IS NULL OR s.status = $1) AND ($2::bigint IS NULL OR s.technician_id = $2)
          ORDER BY CASE s.status WHEN 'submitted' THEN 0 WHEN 'scheduled' THEN 1 WHEN 'rejected' THEN 2 ELSE 3 END, v.starts_at DESC NULLS LAST LIMIT 300`,
        [status, mineOnly ? ctx.userId : null],
      );
      return { surveys: rows.rows };
    }),
  );

  r.get(
    '/surveys/:id',
    read('surveys.read', async (req) => {
      const id = idParam(req);
      const s = await query(
        `SELECT s.*, v.starts_at, v.ends_at, u.name AS technician, rv.name AS reviewer, c.name AS customer, c.phone, c.address, c.city, c.pincode, c.kind AS customer_kind,
                l.ref AS lead_ref, l.requested_kw, l.system_type, l.wants_subsidy, l.roof_area_sqft, l.monthly_bill_paise
           FROM surveys s JOIN users u ON u.id = s.technician_id JOIN customers c ON c.id = s.customer_id JOIN leads l ON l.id = s.lead_id
           LEFT JOIN visits v ON v.id = s.visit_id LEFT JOIN users rv ON rv.id = s.reviewed_by WHERE s.id = $1`,
        [id],
      );
      const survey = s.rows[0];
      if (!survey) throw notFound('That survey');
      const photos = await query(`SELECT file_id FROM survey_photos WHERE survey_id = $1`, [id]);
      const generation =
        survey.azimuth_deg !== null && survey.recommended_kw
          ? estimateGeneration({ capacityKw: survey.recommended_kw, azimuthDeg: survey.azimuth_deg, tiltDeg: survey.tilt_deg, shading: survey.shading })
          : null;
      return { survey, photoIds: photos.rows.map((p) => p.file_id), generation };
    }),
  );

  r.post('/surveys', act('surveys.schedule', surveyScheduleSchema, async (input, db, ctx) => scheduleSurvey(db, ctx, input).then((s) => ({ id: s.id, ref: s.ref }))));
  r.post('/surveys/:id/reschedule', act('surveys.schedule', surveyRescheduleSchema, async (input, db, ctx, req) => rescheduleSurvey(db, ctx, idParam(req), input)));
  r.post('/surveys/:id/submit', act('surveys.submit', surveySubmitSchema, async (input, db, ctx, req) => submitSurvey(db, ctx, idParam(req), input)));
  r.post('/surveys/:id/review', act('surveys.review', surveyReviewSchema, async (input, db, ctx, req) => reviewSurvey(db, ctx, idParam(req), input)));
  r.post('/surveys/:id/cancel', act('surveys.schedule', null, async (_i, db, ctx, req) => cancelSurvey(db, ctx, idParam(req))));

  return r;
}
