import { addDays, periodRange, startOfDayUtc, startOfWeek, type Period } from '@arka/shared';
import type { Db } from '../db/pool.js';
import { today, type Ctx } from './context.js';
import { many, one } from './util.js';

/**
 * Profit per job = revenue (ex GST) − parts issued at cost − installation labour − job expenses
 * − cost of repairs done free under warranty. Repairs flow back into the job that caused them.
 */
export const JOB_PROFIT_SQL = `
  WITH parts AS (SELECT job_id, sum(round(qty * unit_cost_paise))::bigint AS v FROM stock_moves WHERE reason = 'dispatch' AND job_id IS NOT NULL GROUP BY job_id),
       labour AS (SELECT job_id, sum(cost_paise)::bigint AS v, sum(hours)::numeric AS h FROM timesheets WHERE job_id IS NOT NULL AND ticket_id IS NULL GROUP BY job_id),
       exp AS (SELECT job_id, sum(amount_paise)::bigint AS v FROM expenses GROUP BY job_id),
       warr AS (SELECT job_id, sum(parts_cost_paise + labour_cost_paise)::bigint AS v, count(*)::int AS n FROM tickets
                 WHERE job_id IS NOT NULL AND coverage IN ('warranty', 'goodwill') AND status IN ('resolved', 'closed') GROUP BY job_id),
       paid AS (SELECT job_id, sum(amount_paise)::bigint AS v FROM payments WHERE job_id IS NOT NULL GROUP BY job_id)
  SELECT j.id, j.ref, j.kind, j.capacity_kw, j.status, j.installed_at, j.created_at, c.name AS customer, c.city,
         j.total_paise, j.revenue_ex_tax_paise AS revenue_paise,
         coalesce(parts.v, 0) AS parts_paise, coalesce(labour.v, 0) AS labour_paise, coalesce(labour.h, 0) AS labour_hours,
         coalesce(exp.v, 0) AS expenses_paise, coalesce(warr.v, 0) AS warranty_paise, coalesce(warr.n, 0) AS warranty_tickets,
         coalesce(paid.v, 0) AS paid_paise,
         j.revenue_ex_tax_paise - coalesce(parts.v, 0) - coalesce(labour.v, 0) - coalesce(exp.v, 0) - coalesce(warr.v, 0) AS profit_paise
    FROM jobs j JOIN customers c ON c.id = j.customer_id
    LEFT JOIN parts ON parts.job_id = j.id LEFT JOIN labour ON labour.job_id = j.id LEFT JOIN exp ON exp.job_id = j.id
    LEFT JOIN warr ON warr.job_id = j.id LEFT JOIN paid ON paid.job_id = j.id`;

export interface JobProfit {
  [k: string]: unknown;
  id: number;
  ref: string;
  customer: string;
  capacity_kw: number;
  status: string;
  revenue_paise: number;
  parts_paise: number;
  labour_paise: number;
  expenses_paise: number;
  warranty_paise: number;
  profit_paise: number;
}

export async function jobProfit(db: Db, ctx: Ctx, opts: { period?: Period; jobId?: number } = {}): Promise<JobProfit[]> {
  if (opts.jobId) return many<JobProfit>(db, `${JOB_PROFIT_SQL} WHERE j.id = $1`, [opts.jobId]);
  if (opts.period) {
    const r = periodRange(opts.period, ctx.now, ctx.tz);
    return many<JobProfit>(db, `${JOB_PROFIT_SQL} WHERE j.installed_at >= $1 AND j.installed_at < $2 ORDER BY profit_paise ASC`, [r.fromUtc, r.toUtc]);
  }
  return many<JobProfit>(db, `${JOB_PROFIT_SQL} WHERE j.status IN ('installed', 'closed') ORDER BY j.installed_at DESC LIMIT 500`);
}

export async function dashboard(db: Db, ctx: Ctx, period: Period) {
  const r = periodRange(period, ctx.now, ctx.tz);
  const p = [r.fromUtc, r.toUtc, r.from, r.to];
  const sla = await one<{ sla: number }>(db, `SELECT sla_first_call_minutes AS sla FROM companies WHERE id = app_company()`);
  const [k] = await many<Record<string, number>>(
    db,
    `SELECT
       (SELECT count(*) FROM leads WHERE created_at >= $1 AND created_at < $2)::int AS enquiries,
       (SELECT count(*) FROM leads WHERE created_at >= $1 AND created_at < $2 AND source = 'web_form')::int AS enquiries_web,
       (SELECT count(*) FROM surveys WHERE submitted_at >= $1 AND submitted_at < $2)::int AS surveys_done,
       (SELECT count(*) FROM quotes WHERE sent_at >= $1 AND sent_at < $2)::int AS quotes_sent,
       (SELECT count(*) FROM jobs WHERE created_at >= $1 AND created_at < $2)::int AS jobs_won,
       (SELECT coalesce(sum(total_paise), 0) FROM jobs WHERE created_at >= $1 AND created_at < $2)::bigint AS orders_value,
       (SELECT count(*) FROM jobs WHERE installed_at >= $1 AND installed_at < $2)::int AS installs,
       (SELECT coalesce(sum(capacity_kw), 0) FROM jobs WHERE installed_at >= $1 AND installed_at < $2)::numeric AS kw_installed,
       (SELECT coalesce(sum(subtotal_paise - discount_paise), 0) FROM invoices WHERE issued_on >= $3 AND issued_on < $4 AND status <> 'void')::bigint AS revenue_invoiced,
       (SELECT coalesce(sum(amount_paise), 0) FROM payments WHERE received_on >= $3 AND received_on < $4)::bigint AS cash_in,
       (SELECT coalesce(sum(amount_paise), 0) FROM payments p JOIN jobs j ON j.id = p.job_id WHERE p.received_on >= $3 AND p.received_on < $4 AND j.installed_at IS NULL)::bigint AS advances_in,
       (SELECT coalesce(sum(total_paise), 0) FROM purchases WHERE received_on >= $3 AND received_on < $4)::bigint AS stock_purchases,
       (SELECT coalesce(sum(hours), 0) FROM timesheets WHERE work_date >= $3 AND work_date < $4)::numeric AS tech_hours,
       (SELECT coalesce(sum(cost_paise), 0) FROM timesheets WHERE work_date >= $3 AND work_date < $4)::bigint AS tech_cost,
       (SELECT count(*) FROM tickets WHERE created_at >= $1 AND created_at < $2)::int AS tickets_opened`,
    p,
  );
  const [now] = await many<Record<string, number>>(
    db,
    `SELECT
       (SELECT count(*) FROM tickets WHERE status <> 'closed')::int AS open_repairs,
       (SELECT count(*) FROM tickets WHERE status <> 'closed' AND coverage = 'warranty')::int AS open_repairs_warranty,
       (SELECT count(*) FROM tickets WHERE status = 'resolved')::int AS awaiting_confirmation,
       (SELECT count(*) FROM tickets WHERE status <> 'closed' AND priority = 'urgent')::int AS urgent_repairs,
       (SELECT count(*) FROM leads WHERE status = 'new' AND first_contact_at IS NULL AND created_at < $1::timestamptz - make_interval(mins => $2))::int AS uncalled,
       (SELECT count(*) FROM surveys WHERE status = 'submitted')::int AS surveys_to_approve,
       (SELECT count(*) FROM invoices WHERE status = 'draft')::int AS invoices_to_send,
       (SELECT coalesce(sum(total_paise), 0) FROM invoices WHERE status = 'draft')::bigint AS invoices_to_send_value,
       (SELECT coalesce(sum(j.total_paise - coalesce((SELECT sum(amount_paise) FROM payments p WHERE p.job_id = j.id), 0)), 0)
          FROM jobs j WHERE j.status IN ('installed', 'closed'))::bigint AS receivable_jobs,
       (SELECT coalesce(sum(i.total_paise - coalesce((SELECT sum(amount_paise) FROM payments p WHERE p.invoice_id = i.id), 0)), 0)
          FROM invoices i WHERE i.kind = 'service' AND i.status IN ('sent', 'partially_paid'))::bigint AS receivable_service,
       (SELECT count(*) FROM subsidy_cases WHERE status NOT IN ('disbursed', 'rejected'))::int AS subsidy_pending,
       (SELECT coalesce(sum(expected_paise), 0) FROM subsidy_cases WHERE status NOT IN ('disbursed', 'rejected'))::bigint AS subsidy_pending_value,
       (SELECT coalesce(sum(cost_paise), 0) FROM timesheets WHERE payrun_id IS NULL)::bigint AS payroll_due,
       (SELECT count(DISTINCT technician_id) FROM timesheets WHERE payrun_id IS NULL)::int AS payroll_people,
       (SELECT count(*) FROM jobs WHERE status NOT IN ('closed', 'cancelled'))::int AS unfinished_jobs,
       (SELECT count(*) FROM pick_lists WHERE status = 'waiting_stock')::int AS short_pick_lists,
       (SELECT count(*) FROM products WHERE status = 'active' AND tracking <> 'none' AND on_hand <= reorder_level)::int AS low_stock`,
    [ctx.now, sla.sla],
  );
  const profit = await jobProfit(db, ctx, { period });
  const totals = profit.reduce(
    (s, j) => ({ revenue: s.revenue + j.revenue_paise, profit: s.profit + j.profit_paise, losses: s.losses + (j.profit_paise < 0 ? 1 : 0) }),
    { revenue: 0, profit: 0, losses: 0 },
  );
  const subsidy = await many(
    db,
    `SELECT status, count(*)::int AS n, coalesce(sum(expected_paise), 0)::bigint AS value FROM subsidy_cases GROUP BY status`,
  );
  return { period: r, kpis: k!, now: now!, profit: { jobs: profit, ...totals }, subsidy, slaMinutes: sla.sla };
}

/** Everything still open for customers, with the next step and how long it's been waiting. */
export async function unfinished(db: Db, ctx: Ctx) {
  const jobs = await many(
    db,
    `SELECT j.id, j.ref, j.status, j.capacity_kw, j.kind, c.name AS customer, c.city, j.total_paise, j.advance_required_paise,
            coalesce((SELECT sum(amount_paise) FROM payments p WHERE p.job_id = j.id), 0)::bigint AS paid_paise,
            (SELECT status FROM invoices i WHERE i.job_id = j.id AND i.status <> 'void' LIMIT 1) AS invoice_status,
            (SELECT status FROM subsidy_cases s WHERE s.job_id = j.id) AS subsidy_status,
            (SELECT min(v.starts_at) FROM visits v JOIN visit_links l ON l.visit_id = v.id WHERE l.job_id = j.id AND v.kind = 'installation' AND v.status = 'planned') AS install_at,
            (SELECT status FROM pick_lists pl WHERE pl.job_id = j.id) AS pick_status,
            greatest(j.created_at, j.confirmed_at, j.packed_at, j.dispatched_at, j.delivered_on::timestamptz, j.installed_at) AS since
       FROM jobs j JOIN customers c ON c.id = j.customer_id
      WHERE j.status NOT IN ('closed', 'cancelled')
      ORDER BY since ASC LIMIT 300`,
  );
  return jobs.map((j) => ({ ...j, next: nextStep(j as never) }));
}

function nextStep(j: {
  status: string;
  total_paise: number;
  advance_required_paise: number;
  paid_paise: number;
  invoice_status: string | null;
  subsidy_status: string | null;
  pick_status: string | null;
  install_at: string | null;
}): { label: string; owner: string } {
  switch (j.status) {
    case 'awaiting_advance':
      return { label: `Collect the advance (₹${Math.round((j.advance_required_paise - j.paid_paise) / 100).toLocaleString('en-IN')})`, owner: 'Sales' };
    case 'confirmed':
      return j.pick_status === 'waiting_stock' ? { label: 'Waiting for stock to arrive', owner: 'Warehouse' } : { label: 'Scan serials and pack the kit', owner: 'Warehouse' };
    case 'packed':
      return { label: 'Load the truck and dispatch', owner: 'Warehouse' };
    case 'dispatched':
      return { label: 'Confirm delivery on site', owner: 'Crew' };
    case 'delivered':
      return { label: j.install_at ? 'Install, test and get the homeowner’s signature' : 'Book the installation crew', owner: 'Crew' };
    case 'installed':
      if (j.invoice_status === 'draft') return { label: 'Send the final invoice', owner: 'Accounts' };
      if (j.paid_paise < j.total_paise) return { label: `Collect the balance (₹${Math.round((j.total_paise - j.paid_paise) / 100).toLocaleString('en-IN')})`, owner: 'Accounts' };
      if (j.subsidy_status && !['disbursed', 'rejected'].includes(j.subsidy_status)) return { label: 'Finish the subsidy paperwork', owner: 'Accounts' };
      return { label: 'Close the job', owner: 'Director' };
    default:
      return { label: '—', owner: '' };
  }
}

/** Weekly trend for the last N weeks (Monday-start, company time zone). */
export async function trend(db: Db, ctx: Ctx, weeks = 12) {
  const thisWeek = startOfWeek(today(ctx));
  const out: { week: string; enquiries: number; won: number; kw: number; cash: number; profit: number }[] = [];
  const starts = Array.from({ length: weeks }, (_, i) => addDays(thisWeek, -7 * (weeks - 1 - i)));
  const rows = await many<{ w: string; enquiries: number; won: number; kw: number; cash: number }>(
    db,
    `SELECT w::text AS w,
       (SELECT count(*) FROM leads WHERE created_at >= tz_start AND created_at < tz_end)::int AS enquiries,
       (SELECT count(*) FROM jobs WHERE created_at >= tz_start AND created_at < tz_end)::int AS won,
       (SELECT coalesce(sum(capacity_kw), 0) FROM jobs WHERE installed_at >= tz_start AND installed_at < tz_end)::numeric AS kw,
       (SELECT coalesce(sum(amount_paise), 0) FROM payments WHERE received_on >= w AND received_on < w + 7)::bigint AS cash
     FROM (SELECT d::date AS w, (d::date::timestamp AT TIME ZONE $2) AS tz_start, ((d::date + 7)::timestamp AT TIME ZONE $2) AS tz_end
             FROM unnest($1::date[]) AS d) weeks ORDER BY w`,
    [starts, ctx.tz],
  );
  const profitRows = await many<{ w: string; profit: number }>(
    db,
    `SELECT date_trunc('week', (x.installed_at AT TIME ZONE $1))::date::text AS w, sum(x.profit_paise)::bigint AS profit
       FROM (${JOB_PROFIT_SQL} WHERE j.installed_at >= $2) x GROUP BY 1`,
    [ctx.tz, startOfDayUtc(starts[0]!, ctx.tz)],
  );
  for (const r of rows) out.push({ week: r.w, enquiries: r.enquiries, won: r.won, kw: r.kw, cash: r.cash, profit: profitRows.find((p) => p.w === r.w)?.profit ?? 0 });
  return out;
}

export function toCsv(rows: Record<string, unknown>[], columns: { key: string; label: string; money?: boolean }[]): string {
  const esc = (v: unknown) => {
    if (typeof v === 'number') return String(v);
    let s = v === null || v === undefined ? '' : v instanceof Date ? v.toISOString() : String(v);
    // neutralise spreadsheet formula injection in text cells
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = columns.map((c) => esc(c.label)).join(',');
  const body = rows.map((r) => columns.map((c) => (c.money ? (Number(r[c.key] ?? 0) / 100).toFixed(2) : esc(r[c.key]))).join(',')).join('\n');
  return `${head}\n${body}\n`;
}
