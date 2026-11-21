import express, { Router } from 'express';
import { z } from 'zod';
import { inviteSchema, settingsSchema, updateMemberSchema, can, type Role } from '@arka/shared';
import { config } from '../../config.js';
import { createInvitedUser, issueCode, sendInviteEmail } from '../../domain/auth.js';
import { audit } from '../../domain/context.js';
import { conflict, invalid, notFound } from '../../lib/errors.js';
import { openStream, publish } from '../../lib/events.js';
import { saveFile, type FilePurpose } from '../../lib/files.js';
import { act, idParam, query, read, withDb } from '../context.js';
import { one } from '../../domain/util.js';

export function adminRoutes(): Router {
  const r = Router();

  /* ---------------- team ---------------- */
  r.get(
    '/team',
    read(null, async (_req, ctx) => {
      const showCost = can(ctx.role as Role, 'payroll.read') || ctx.role === 'owner';
      const rows = await query(
        `SELECT u.id, u.name, u.email, u.phone, u.role, u.status, u.created_at, ${showCost ? 'u.hourly_cost_paise' : 'NULL::bigint AS hourly_cost_paise'},
                (SELECT max(last_seen_at) FROM sessions s WHERE s.user_id = u.id) AS last_seen_at
           FROM users u ORDER BY CASE u.role WHEN 'owner' THEN 0 WHEN 'sales' THEN 1 WHEN 'accounts' THEN 2 WHEN 'support' THEN 3 WHEN 'warehouse' THEN 4 ELSE 5 END, u.name`,
      );
      return { people: rows.rows };
    }),
  );

  r.post(
    '/team/invite',
    act('team.manage', inviteSchema, async (input, db, ctx) => {
      // a demo must not reserve real people's email addresses
      if (ctx.isDemo && !/@([a-z0-9-]+\.)*example(\.[a-z]+)?$/.test(input.email)) {
        throw invalid('In a demo, invite people with an example.com address.', { email: 'Use name@example.com in a demo' });
      }
      const out = await createInvitedUser(db, input, ctx.companyId, ctx.now);
      const co = await one<{ name: string }>(db, `SELECT name FROM companies WHERE id = app_company()`);
      const me = await one<{ name: string }>(db, `SELECT name FROM users WHERE id = $1`, [ctx.userId]);
      await sendInviteEmail(input.email, input.name, co.name, me.name, out.link, ctx.isDemo);
      await audit(db, ctx, 'team.invite', 'user', out.id, { role: input.role });
      await publish(db, ['team']);
      return { id: out.id, ...(config().OTP_DEV_ECHO || ctx.isDemo ? { inviteUrl: `${config().APP_URL}/invite/${out.link}` } : {}) };
    }),
  );

  r.post(
    '/team/:id/resend-invite',
    act('team.manage', null, async (_i, db, ctx, req) => {
      const u = await one<{ id: number; name: string; email: string; status: string }>(db, `SELECT id, name, email, status FROM users WHERE id = $1`, [idParam(req)], 'That person');
      if (u.status !== 'invited') throw conflict('already_active', `${u.name} has already joined.`);
      const issued = await issueCode(db, { id: u.id, companyId: ctx.companyId }, 'invite', { withCode: false, withLink: true, now: ctx.now, ttlMinutes: 72 * 60 });
      const co = await one<{ name: string }>(db, `SELECT name FROM companies WHERE id = app_company()`);
      await sendInviteEmail(u.email, u.name, co.name, 'Your director', issued.link!, ctx.isDemo);
      return config().OTP_DEV_ECHO || ctx.isDemo ? { inviteUrl: `${config().APP_URL}/invite/${issued.link}` } : { ok: true };
    }),
  );

  r.patch(
    '/team/:id',
    act('team.manage', updateMemberSchema, async (input, db, ctx, req) => {
      const id = idParam(req);
      const u = await one<{ id: number; role: Role; status: string }>(db, `SELECT id, role, status FROM users WHERE id = $1 FOR UPDATE`, [id], 'That person');
      if (id === ctx.userId && (input.role && input.role !== u.role || input.active === false)) throw conflict('self', 'You can’t change your own role or switch yourself off.');
      if (u.role === 'owner' && ((input.role && input.role !== 'owner') || input.active === false)) {
        const owners = await one<{ n: number }>(db, `SELECT count(*)::int AS n FROM users WHERE role = 'owner' AND status = 'active'`);
        if (owners.n <= 1) throw conflict('last_owner', 'A workspace needs at least one director.');
      }
      await db.query(
        `UPDATE users SET role = coalesce($2, role), hourly_cost_paise = coalesce($3, hourly_cost_paise), phone = coalesce($4, phone),
           status = CASE WHEN $5::boolean IS NULL THEN status WHEN $5 THEN (CASE WHEN status = 'disabled' THEN 'active' ELSE status END) ELSE 'disabled' END WHERE id = $1`,
        [id, input.role ?? null, input.hourlyCostPaise ?? null, input.phone ?? null, input.active ?? null],
      );
      // a role change or switch-off signs the person out everywhere
      if ((input.role && input.role !== u.role) || input.active === false) await db.query(`DELETE FROM sessions WHERE user_id = $1`, [id]);
      await audit(db, ctx, 'team.update', 'user', id, input);
      await publish(db, ['team']);
    }),
  );

  /* ---------------- settings ---------------- */
  r.get('/settings', read(null, async () => ({ company: (await query(`SELECT * FROM companies WHERE id = app_company()`)).rows[0] })));
  r.put(
    '/settings',
    act('settings.manage', settingsSchema, async (input, db, ctx) => {
      await db.query(
        `UPDATE companies SET name = $1, phone = $2, email = $3, address = $4, gstin = $5, advance_percent = $6, labour_rate_paise = $7, sla_first_call_minutes = $8,
           quote_validity_days = $9, subsidy_enabled = $10, subsidy_slab1_per_kw_paise = $11, subsidy_slab2_per_kw_paise = $12, subsidy_cap_paise = $13 WHERE id = app_company()`,
        [
          input.name,
          input.phone ?? null,
          input.email ?? null,
          input.address ?? null,
          input.gstin ?? null,
          input.advancePercent,
          input.labourRatePaise,
          input.slaFirstCallMinutes,
          input.quoteValidityDays,
          input.subsidyEnabled,
          input.subsidySlab1PerKwPaise,
          input.subsidySlab2PerKwPaise,
          input.subsidyCapPaise,
        ],
      );
      await audit(db, ctx, 'settings.update', 'company', ctx.companyId, input);
    }),
  );
  r.get(
    '/audit',
    read('settings.manage', async () => ({
      entries: (await query(`SELECT a.id, a.action, a.entity, a.entity_id, a.detail, a.created_at, u.name AS actor FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id ORDER BY a.created_at DESC LIMIT 200`)).rows,
    })),
  );

  /** Live counts on the navigation: what needs someone now. */
  r.get(
    '/nav',
    read(null, async (_req, ctx) => {
      const mine = ctx.role === 'technician' ? ctx.userId : null;
      const r2 = await query(
        `SELECT
           (SELECT count(*) FROM leads WHERE status = 'new' AND first_contact_at IS NULL)::int AS leads_new,
           (SELECT count(*) FROM leads l JOIN companies co ON co.id = l.company_id
             WHERE l.status = 'new' AND l.first_contact_at IS NULL AND l.created_at < now() - make_interval(mins => co.sla_first_call_minutes))::int AS leads_overdue,
           (SELECT count(*) FROM surveys WHERE status = 'submitted')::int AS surveys_review,
           (SELECT count(*) FROM surveys WHERE status = 'scheduled' AND ($1::bigint IS NULL OR technician_id = $1))::int AS surveys_open,
           (SELECT count(*) FROM quotes WHERE status IN ('draft', 'sent'))::int AS quotes_open,
           (SELECT count(*) FROM jobs WHERE status NOT IN ('closed', 'cancelled'))::int AS jobs_open,
           (SELECT count(*) FROM pick_lists WHERE status IN ('ready', 'packed'))::int AS picks_ready,
           (SELECT count(*) FROM pick_lists WHERE status = 'waiting_stock')::int AS picks_short,
           (SELECT count(*) FROM tickets WHERE status <> 'closed' AND ($1::bigint IS NULL OR assigned_to = $1))::int AS tickets_open,
           (SELECT count(*) FROM tickets WHERE status <> 'closed' AND priority = 'urgent')::int AS tickets_urgent,
           (SELECT count(*) FROM invoices WHERE status = 'draft')::int AS invoices_draft,
           (SELECT count(*) FROM notifications WHERE user_id = $2 AND read_at IS NULL)::int AS unread,
           (SELECT public_key FROM companies WHERE id = app_company()) AS public_key`,
        [mine, ctx.userId],
      );
      return r2.rows[0];
    }),
  );

  /* ---------------- notifications ---------------- */
  r.get(
    '/notifications',
    read(null, async (_req, ctx) => {
      const [list, unread] = await Promise.all([
        query(`SELECT id, title, body, link, read_at, created_at FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 30`, [ctx.userId]),
        query(`SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL`, [ctx.userId]),
      ]);
      return { notifications: list.rows, unread: unread.rows[0]!.n };
    }),
  );
  r.post(
    '/notifications/read',
    act(null, z.object({ ids: z.array(z.number().int().positive()).max(100).optional() }), async (input, db, ctx) => {
      await db.query(`UPDATE notifications SET read_at = $3 WHERE user_id = $1 AND read_at IS NULL AND ($2::bigint[] IS NULL OR id = ANY($2))`, [ctx.userId, input.ids ?? null, ctx.now]);
    }),
  );

  /* ---------------- files ---------------- */
  r.post(
    '/files',
    express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: '3mb' }),
    act(null, null, async (_i, db, ctx, req) => {
      const purpose = z.enum(['survey_photo', 'install_photo', 'signature', 'ticket_photo']).parse(req.query.purpose) as FilePurpose;
      if (!Buffer.isBuffer(req.body)) throw conflict('no_file', 'Send the image as the request body.');
      return saveFile(db, purpose, req.body, ctx.userId, ctx.now);
    }),
  );
  r.get(
    '/files/:id',
    read(null, async (req, _ctx, res) => {
      const f = await withDb((db) => db.query<{ mime: string; bytes: Buffer; sha256: string }>(`SELECT mime, bytes, sha256 FROM files WHERE id = $1`, [idParam(req)]));
      const file = f.rows[0];
      if (!file) throw notFound('That file');
      sendImage(res, file);
    }),
  );

  /* ---------------- live updates ---------------- */
  r.get('/events', (req, res) => {
    const close = openStream(res, req.user!.companyId, req.user!.id);
    req.on('close', close);
  });

  return r;
}

export function sendImage(res: express.Response, file: { mime: string; bytes: Buffer; sha256: string }) {
  res.setHeader('Content-Type', file.mime);
  res.setHeader('Cache-Control', 'private, max-age=86400, immutable');
  res.setHeader('ETag', `"${file.sha256.slice(0, 32)}"`);
  res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Disposition', 'inline');
  res.end(file.bytes);
}
