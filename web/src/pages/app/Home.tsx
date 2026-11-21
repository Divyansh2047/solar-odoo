import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { CaretRight, ShareNetwork, DownloadSimple, MapPin, Phone, Wrench, SolarPanel, Ruler, Truck } from '@phosphor-icons/react';
import {
  formatDate,
  formatINRShort,
  formatKw,
  formatPhone,
  formatTime,
  periodRange,
  relativeTime,
  SUBSIDY_STATUS_LABEL,
  VISIT_KIND_LABEL,
  type Period,
  type SubsidyStatus,
  formatPercent,
} from '@arka/shared';
import { api } from '../../lib/api';
import { useSession } from '../../lib/session';
import { Button, Chip, Empty, ErrorBlock, Money, Panel, Seg, SkeletonRows } from '../../components/ui';
import { ProfitBars, Sparkline, WeeklyBars, type ProfitRow } from '../../components/charts';
import { shownCompany } from '../../lib/demo';
import { Dialog, useToast } from '../../components/overlay';
import { DataTable } from '../../components/table';
import Warehouse from './Warehouse';
import Service from './Service';

export default function Home() {
  const { me } = useSession();
  useEffect(() => {
    document.title = me?.role === 'owner' || me?.role === 'accounts' ? 'Dashboard · Arka' : 'Today · Arka';
  }, [me?.role]);
  if (!me) return null;
  if (me.role === 'owner' || me.role === 'accounts') return <Director />;
  if (me.role === 'sales') return <SalesDesk />;
  if (me.role === 'technician') return <MyDay />;
  if (me.role === 'warehouse') return <Warehouse />;
  return <Service />;
}

/* ------------------------------------------------------------------ director */

interface Dash {
  period: { label: string; from: string; to: string };
  kpis: Record<string, number>;
  now: Record<string, number>;
  profit: { jobs: ProfitRow[]; revenue: number; profit: number; losses: number };
  subsidy: { status: SubsidyStatus; n: number; value: number }[];
  slaMinutes: number;
}

interface TrendWeek {
  week: string;
  kw: number;
  cash: number;
  enquiries: number;
  won: number;
  profit: number;
}

/**
 * The director's numbers. Used by the dashboard and by the read-only shared report, so the optional
 * parts (trend lines, the attention list, the order pipeline) are passed in only where they exist.
 */
export function DashboardBody({ data, shared, trend, attention, pipeline }: { data: Dash; shared?: boolean; trend?: TrendWeek[]; attention?: React.ReactNode; pipeline?: React.ReactNode }) {
  const k = data.kpis;
  const n = data.now;
  const margin = formatPercent(data.profit.profit, data.profit.revenue);
  const link = (to: string) => (shared ? undefined : to);
  const series = (pick: (w: TrendWeek) => number) => trend?.map((w) => Number(pick(w)));
  const period = data.period.label.toLowerCase();
  return (
    <>
      <section className="kpi-board" aria-label={`Key numbers, ${period}`}>
        <div className="kpi-main">
          <KpiCell label="Enquiries" value={k.enquiries} sub={`${k.enquiries_web} from the web form`} spark={series((w) => w.enquiries)} to={link('/app/enquiries')} />
          <KpiCell label="Orders won" value={k.jobs_won} sub={`${formatINRShort(k.orders_value ?? 0)} incl. GST`} spark={series((w) => w.won)} to={link('/app/jobs')} />
          <KpiCell label="Installed" value={formatKw(k.kw_installed)} sub={`${k.installs} rooftop${k.installs === 1 ? '' : 's'}`} spark={series((w) => w.kw)} lit to={link('/app/jobs?status=installed')} />
          <KpiCell label="Cash collected" value={formatINRShort(k.cash_in ?? 0)} sub={`${formatINRShort(k.advances_in ?? 0)} of it advances`} spark={series((w) => w.cash)} to={link('/app/money/payments')} />
        </div>
        <div className="kpi-sub">
          <KpiMini
            label="Profit on installed jobs"
            value={formatINRShort(data.profit.profit)}
            sub={`${margin} margin${data.profit.losses ? `, ${data.profit.losses} lost money` : ''}`}
            tone={data.profit.profit < 0 ? 'bad' : 'good'}
            to={link('/app/reports')}
          />
          <KpiMini label="Repairs still open" value={n.open_repairs} sub={`${n.urgent_repairs} urgent, ${n.open_repairs_warranty} under warranty`} tone={n.urgent_repairs ? 'bad' : undefined} to={link('/app/service')} />
          <KpiMini label="Invoices to send" value={n.invoices_to_send} sub={formatINRShort(n.invoices_to_send_value ?? 0)} to={link('/app/money/invoices')} />
          <KpiMini label="Subsidy pending" value={n.subsidy_pending} sub={`${formatINRShort(n.subsidy_pending_value ?? 0)} for customers`} to={link('/app/money/subsidy')} />
        </div>
        {trend && <p className="kpi-note">Numbers are for {period}; the lines show the last 12 weeks.</p>}
      </section>

      {(trend || attention) && (
        <div className="dash-split">
          {trend ? <Performance weeks={trend} /> : <span />}
          {attention}
        </div>
      )}

      {pipeline}

      <div className="dash-split wide-left">
        <Panel
          title="Which installations made money"
          actions={<span className="muted">{data.profit.jobs.length} installed {period}, losses first</span>}
          foot={
            !shared && data.profit.jobs.length > 10 ? (
              <Link to="/app/reports">
                See all {data.profit.jobs.length} jobs in the month-end report <CaretRight size={14} aria-hidden style={{ display: 'inline', verticalAlign: '-2px' }} />
              </Link>
            ) : undefined
          }
        >
          <div className="panel-body">
            {data.profit.jobs.length ? (
              <ProfitBars rows={data.profit.jobs} limit={shared ? 40 : 10} />
            ) : (
              <Empty title="Nothing installed in this period yet">Profit appears here as soon as a crew signs off a job.</Empty>
            )}
          </div>
        </Panel>
        <div className="stack">
          <Panel title="Money in the pipeline">
            <div className="panel-body">
              <div className="fin-grid">
                <FinStat label="Customers still owe" value={formatINRShort((n.receivable_jobs ?? 0) + (n.receivable_service ?? 0))} sub="invoices and job balances" />
                <FinStat label="Technicians to pay" value={formatINRShort(n.payroll_due ?? 0)} sub={`${n.payroll_people ?? 0} people, unpaid hours`} />
                <FinStat label="Stock bought" value={formatINRShort(k.stock_purchases ?? 0)} sub={period} />
                <FinStat label="Technician hours" value={`${Math.round(k.tech_hours ?? 0)} h`} sub={`${formatINRShort(k.tech_cost ?? 0)} cost`} />
              </div>
            </div>
          </Panel>
          <SubsidyStages rows={data.subsidy} />
        </div>
      </div>
    </>
  );
}

function KpiCell({ label, value, sub, spark, lit, to }: { label: string; value: React.ReactNode; sub: string; spark?: number[]; lit?: boolean; to?: string }) {
  const body = (
    <>
      <span className="kpi-k">{label}</span>
      <span className="kpi-v">{value}</span>
      <span className="kpi-s">{sub}</span>
      {spark && spark.length > 1 && <Sparkline values={spark} />}
    </>
  );
  const cls = `kpi-cell${lit ? ' lit' : ''}`;
  return to ? (
    <Link className={cls} to={to}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

function KpiMini({ label, value, sub, tone, to }: { label: string; value: React.ReactNode; sub: string; tone?: 'good' | 'bad'; to?: string }) {
  const body = (
    <>
      <span className="kpi-k">{label}</span>
      <span className={`kpi-v${tone ? ` ${tone}` : ''}`}>{value}</span>
      <span className="kpi-s">{sub}</span>
    </>
  );
  return to ? (
    <Link className="kpi-mini" to={to}>
      {body}
    </Link>
  ) : (
    <div className="kpi-mini">{body}</div>
  );
}

function FinStat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="fin-stat">
      <span className="fin-k">{label}</span>
      <span className="fin-v">{value}</span>
      <span className="fin-s">{sub}</span>
    </div>
  );
}

const SUBSIDY_ORDER: SubsidyStatus[] = ['not_started', 'documents', 'applied', 'inspection', 'approved', 'disbursed'];

/** PM Surya Ghar paperwork, stage by stage: one hue, bar length = customers at that stage. */
function SubsidyStages({ rows }: { rows: Dash['subsidy'] }) {
  const counts = SUBSIDY_ORDER.map((s) => ({ s, n: rows.find((r) => r.status === s)?.n ?? 0 }));
  const total = counts.reduce((a, c) => a + c.n, 0);
  const max = Math.max(1, ...counts.map((c) => c.n));
  return (
    <Panel title="Subsidy paperwork" actions={<span className="muted">{total} customers</span>}>
      <div className="panel-body">
        <ul className="stage-bars">
          {counts.map((c) => (
            <li key={c.s}>
              <span className="sb-label">{SUBSIDY_STATUS_LABEL[c.s]}</span>
              <span className="sb-track" aria-hidden>
                <i style={{ width: `${(c.n / max) * 100}%` }} />
              </span>
              <span className="sb-n">{c.n}</span>
            </li>
          ))}
        </ul>
      </div>
    </Panel>
  );
}

const MEASURES = {
  kw: { label: 'Installed', unit: (v: number) => `${Math.round(v)} kW` },
  cash: { label: 'Cash collected', unit: (v: number) => formatINRShort(v) },
  enquiries: { label: 'Enquiries', unit: (v: number) => String(Math.round(v)) },
  won: { label: 'Orders won', unit: (v: number) => String(Math.round(v)) },
} as const;
type Measure = keyof typeof MEASURES;

/** Twelve weeks of one measure at a time: one axis, one hue, no dual scales. */
function Performance({ weeks }: { weeks: TrendWeek[] }) {
  const [m, setM] = useState<Measure>('kw');
  const meta = MEASURES[m];
  const data = weeks.map((w) => ({ week: w.week, value: Number(w[m]) }));
  const total = data.reduce((s, d) => s + d.value, 0);
  const thisWeek = data[data.length - 1]?.value ?? 0;
  const avg = data.length ? total / data.length : 0;
  return (
    <Panel
      title="Last 12 weeks"
      actions={
        <Seg
          label="Measure"
          value={m}
          onChange={setM}
          options={[
            { value: 'kw', label: 'Installed' },
            { value: 'cash', label: 'Cash' },
            { value: 'enquiries', label: 'Enquiries' },
            { value: 'won', label: 'Orders' },
          ]}
        />
      }
    >
      <div className="panel-body">
        <div className="perf-head">
          <div>
            <span className="perf-k">{meta.label}, 12 weeks</span>
            <span className="perf-v">{meta.unit(total)}</span>
          </div>
          <div>
            <span className="perf-k">This week</span>
            <span className="perf-v sm">{meta.unit(thisWeek)}</span>
          </div>
          <div>
            <span className="perf-k">Weekly average</span>
            <span className="perf-v sm">{meta.unit(avg)}</span>
          </div>
        </div>
        <WeeklyBars data={data} format={meta.unit} label={`${meta.label} per week`} />
      </div>
    </Panel>
  );
}

const PIPELINE: { status: string; label: string }[] = [
  { status: 'awaiting_advance', label: 'Waiting for advance' },
  { status: 'confirmed', label: 'To pack' },
  { status: 'packed', label: 'Packed' },
  { status: 'dispatched', label: 'On the truck' },
  { status: 'delivered', label: 'Delivered' },
  { status: 'installed', label: 'Installed, not closed' },
];

/** Every open order by stage, left to right in the order the work happens. */
function OrderPipeline() {
  const q = useQuery({ queryKey: ['jobs', 'pipeline'], queryFn: () => api.get<{ jobs: { status: string; total_paise: number }[] }>('/api/jobs?open=1') });
  const stages = PIPELINE.map((p) => {
    const jobs = (q.data?.jobs ?? []).filter((j) => j.status === p.status);
    return { ...p, n: jobs.length, value: jobs.reduce((s, j) => s + Number(j.total_paise), 0) };
  });
  const open = stages.reduce((s, x) => s + x.n, 0);
  return (
    <Panel title="Orders in progress" actions={<Link to="/app/jobs">{q.data ? `${open} open jobs` : 'All jobs'}</Link>}>
      {q.isLoading ? (
        <SkeletonRows rows={2} />
      ) : (
        <ol className="pipe" aria-label="Open orders by stage">
          {stages.map((s) => (
            <li key={s.status}>
              <Link to={`/app/jobs?status=${s.status}`} className={`pipe-cell${s.n ? '' : ' empty'}`}>
                <span className="pipe-k">{s.label}</span>
                <span className="pipe-n">{s.n}</span>
                <span className="pipe-s">{s.n ? formatINRShort(s.value) : 'None'}</span>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}

function Director() {
  const [period, setPeriod] = useState<Period>('month');
  const { me } = useSession();
  const [share, setShare] = useState(false);
  const dash = useQuery({ queryKey: ['dashboard', period], queryFn: () => api.get<Dash>(`/api/dashboard?period=${period}`) });
  const trend = useQuery({ queryKey: ['trend'], queryFn: () => api.get<{ weeks: TrendWeek[] }>('/api/reports/trend') });
  const unfinished = useQuery({ queryKey: ['unfinished'], queryFn: () => api.get<{ jobs: UnfinishedJob[] }>('/api/reports/unfinished') });
  const range = periodRange(period, new Date(), me?.timezone ?? 'Asia/Kolkata');
  const company = me ? shownCompany(me.companyName) : '';
  return (
    <div className="page">
      <div className="dash-head">
        <div>
          <h1>Dashboard</h1>
          <p className="dash-sub">
            {company}, {period === 'today' ? formatDate(range.from) : `${formatDate(range.from)} to today`}
            <span className="live-pill" title="Numbers update as the team works, without reloading.">Live</span>
          </p>
        </div>
        <div className="row dash-actions">
          <Seg
            label="Period"
            value={period}
            onChange={setPeriod}
            options={[
              { value: 'today', label: 'Today' },
              { value: 'week', label: 'This week' },
              { value: 'month', label: 'This month' },
            ]}
          />
          {me?.role === 'owner' && (
            <Button onClick={() => setShare(true)} icon={<ShareNetwork size={18} />}>
              Share
            </Button>
          )}
        </div>
      </div>
      {dash.isLoading && <SkeletonRows rows={6} />}
      {dash.isError && <ErrorBlock error={dash.error} retry={() => dash.refetch()} />}
      {dash.data && (
        <DashboardBody
          data={dash.data}
          trend={trend.data?.weeks}
          attention={<Attention now={dash.data.now} sla={dash.data.slaMinutes} />}
          pipeline={<OrderPipeline />}
        />
      )}
      <Panel title="Jobs not closed yet, oldest first" actions={<Link to="/app/reports">See all</Link>}>
        {unfinished.isLoading ? <SkeletonRows rows={5} /> : <UnfinishedTable jobs={(unfinished.data?.jobs ?? []).slice(0, 8)} />}
      </Panel>
      <ShareDialog open={share} onClose={() => setShare(false)} period={period} />
    </div>
  );
}

function Attention({ now, sla }: { now: Record<string, number>; sla: number }) {
  const items = [
    now.uncalled && { to: '/app/enquiries?status=new', n: now.uncalled, text: `Enquiries not called within ${sla >= 60 ? `${sla / 60} hours` : `${sla} minutes`}`, tone: 'hot' },
    now.urgent_repairs && { to: '/app/service', n: now.urgent_repairs, text: 'Urgent repairs open', tone: 'hot' },
    now.surveys_to_approve && { to: '/app/surveys?status=submitted', n: now.surveys_to_approve, text: 'Roof surveys waiting for approval', tone: 'sun' },
    now.short_pick_lists && { to: '/app/warehouse', n: now.short_pick_lists, text: 'Pick lists short of stock', tone: '' },
    now.awaiting_confirmation && { to: '/app/service', n: now.awaiting_confirmation, text: 'Repairs waiting for the customer to confirm', tone: '' },
    now.low_stock && { to: '/app/catalog', n: now.low_stock, text: 'Products at or below reorder level', tone: '' },
  ].filter(Boolean) as { to: string; n: number; text: string; tone: string }[];
  return (
    <Panel title="Needs attention" actions={items.length ? <span className="badge">{items.length}</span> : undefined}>
      {items.length ? (
        <ul className="attn" aria-label="Needs attention now">
          {items.map((i) => (
            <li key={i.text}>
              <Link to={i.to} className={i.tone}>
                <span className="n">{i.n}</span>
                <span className="t">{i.text}</span>
                <CaretRight className="go" size={16} aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div className="panel-body">
          <p className="muted">All clear. Nothing is waiting on anyone right now.</p>
        </div>
      )}
    </Panel>
  );
}

export interface UnfinishedJob {
  id: number;
  ref: string;
  status: string;
  customer: string;
  city: string;
  capacity_kw: number;
  since: string;
  next: { label: string; owner: string };
}

/** Full-width form: a table with the next step and who owns it; phones get cards. */
export function UnfinishedTable({ jobs }: { jobs: UnfinishedJob[] }) {
  return (
    <DataTable
      rows={jobs}
      rowKey={(j) => j.id}
      to={(j) => `/app/jobs/${j.id}`}
      empty={<Empty title="Nothing unfinished">Every job is closed. Time for chai.</Empty>}
      columns={[
        { header: 'Customer', cell: (j) => (<><span className="cell-main">{j.customer}</span><div className="cell-sub">{j.city}</div></>) },
        { header: 'Job', className: 'nowrap', cell: (j) => (<><span className="mono">{j.ref}</span><div className="cell-sub">{formatKw(j.capacity_kw)}</div></>) },
        { header: 'Next step', cell: (j) => j.next.label },
        { header: 'With', cell: (j) => <Chip plain>{j.next.owner}</Chip> },
        { header: 'Waiting', className: 'r nowrap', cell: (j) => relativeTime(j.since).replace(' ago', '') },
      ]}
      card={(j) => ({ title: j.customer, right: <Chip plain>{j.next.owner}</Chip>, meta: [j.ref, formatKw(j.capacity_kw), `waiting ${relativeTime(j.since).replace(' ago', '')}`], extra: <span>{j.next.label}</span> })}
    />
  );
}

export function UnfinishedList({ jobs }: { jobs: UnfinishedJob[] }) {
  if (!jobs.length) return <Empty title="Nothing unfinished">Every job is closed. Time for chai.</Empty>;
  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: '4px 20px 8px' }}>
      {jobs.map((j) => (
        <li key={j.id}>
          <Link to={`/app/jobs/${j.id}`} className="profit-row" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.25fr)' }}>
            <span className="who">
              <b>{j.customer}</b>
              <span className="meta-line">
                <span className="mono">{j.ref}</span> {formatKw(j.capacity_kw)}
              </span>
              <span className="meta-line">Waiting {relativeTime(j.since).replace(' ago', '')}</span>
            </span>
            <span>
              {j.next.label}
              <span className="muted" style={{ display: 'block', fontSize: 12 }}>
                {j.next.owner}
              </span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function ShareDialog({ open, onClose, period }: { open: boolean; onClose: () => void; period: Period }) {
  const [p, setP] = useState<Period>(period);
  const [days, setDays] = useState(7);
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  useEffect(() => {
    if (open) {
      setUrl(null);
      setP(period);
    }
  }, [open, period]);
  return (
    <Dialog open={open} onClose={onClose} title="Share these numbers" description="A read-only link for your accountant or partner. It shows the dashboard and profit per job, nothing else, and stops working when it expires.">
      <div className="field">
        <span className="field-label">Period</span>
        <Seg label="Period" value={p} onChange={setP} options={[{ value: 'today', label: 'Today' }, { value: 'week', label: 'This week' }, { value: 'month', label: 'This month' }]} />
      </div>
      <div className="field">
        <label htmlFor="share-days">Link works for</label>
        <select id="share-days" className="select" value={days} onChange={(e) => setDays(Number(e.target.value))}>
          <option value={1}>1 day</option>
          <option value={7}>7 days</option>
          <option value={30}>30 days</option>
        </select>
      </div>
      {url && (
        <div className="field">
          <label htmlFor="share-url">Copy this link</label>
          <input id="share-url" className="input mono" readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
        </div>
      )}
      <div className="form-actions">
        <a className="btn" href={`/api/reports/profit.csv?period=${p}`} download>
          <DownloadSimple size={18} /> Download CSV
        </a>
        {url ? (
          <Button
            variant="primary"
            onClick={async () => {
              await navigator.clipboard?.writeText(url).catch(() => {});
              toast('Link copied. It shows numbers only, and you can turn it off in Month-end.');
            }}
          >
            Copy link
          </Button>
        ) : (
          <Button
            variant="primary"
            busy={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const r = await api.post<{ url: string }>('/api/reports/share', { period: p, expiresInDays: days });
                setUrl(r.url);
              } finally {
                setBusy(false);
              }
            }}
          >
            Create link
          </Button>
        )}
      </div>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ sales desk */

function SalesDesk() {
  const leads = useQuery({ queryKey: ['leads', 'desk'], queryFn: () => api.get<{ leads: { id: number; ref: string; name: string; city: string; phone: string; status: string; created_at: string; overdue: boolean; requested_kw: number | null; source: string }[] }>('/api/leads?status=new') });
  const surveys = useQuery({ queryKey: ['surveys', 'desk'], queryFn: () => api.get<{ surveys: { id: number; ref: string; status: string; customer: string; city: string; technician: string; starts_at: string | null; recommended_kw: number | null }[] }>('/api/surveys') });
  const quotes = useQuery({ queryKey: ['quotes', 'desk'], queryFn: () => api.get<{ quotes: { id: number; ref: string; version: number; status: string; customer: string; total_paise: number; sent_at: string | null; valid_until: string }[] }>('/api/quotes?status=sent') });
  const { me } = useSession();
  const toReview = surveys.data?.surveys.filter((s) => s.status === 'submitted') ?? [];
  const upcoming = surveys.data?.surveys.filter((s) => s.status === 'scheduled').slice(0, 6) ?? [];
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Sales desk</h1>
          <p className="lead">New enquiries first. The red ones have waited longer than they should.</p>
        </div>
        <div className="actions">
          <Link className="btn btn-primary" to="/app/enquiries?new=1">
            Log an enquiry
          </Link>
        </div>
      </div>
      <div className="split">
        <Panel title="New enquiries, not called yet">
          {leads.isLoading ? (
            <SkeletonRows />
          ) : !leads.data?.leads.length ? (
            <Empty title="Everyone has been called">New web-form enquiries appear here the moment they arrive.</Empty>
          ) : (
            <ul className="attention" style={{ listStyle: 'none', margin: 0, padding: 12 }}>
              {leads.data.leads.map((l) => (
                <li key={l.id}>
                  <Link to={`/app/enquiries/${l.id}`} className={l.overdue ? 'hot' : ''}>
                    <span className="n" aria-hidden>
                      <Phone size={16} />
                    </span>
                    <span>
                      {l.name}, {l.city}
                      <span className="muted" style={{ display: 'block', fontSize: 13, fontWeight: 400 }}>
                        {formatPhone(l.phone)}, {l.requested_kw ? `${formatKw(l.requested_kw)}, ` : ''}arrived {relativeTime(l.created_at)}
                      </span>
                    </span>
                    {l.overdue && <Chip tone="bad">Overdue</Chip>}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <div className="stack">
          <Panel title="Surveys to approve">
            <div className="panel-body tight">
              {!toReview.length ? (
                <p className="muted">Nothing waiting.</p>
              ) : (
                <ul className="attention" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                  {toReview.map((s) => (
                    <li key={s.id}>
                      <Link to={`/app/surveys/${s.id}`} className="sun">
                        <span className="n">
                          <Ruler size={16} />
                        </span>
                        {s.customer}, {formatKw(s.recommended_kw)}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Panel>
          <Panel title="Quotes with customers">
            <div className="panel-body tight">
              {!quotes.data?.quotes.length ? (
                <p className="muted">No quotes waiting for an answer.</p>
              ) : (
                <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
                  {quotes.data.quotes.slice(0, 6).map((q) => (
                    <li key={q.id} className="row between">
                      <Link to={`/app/quotes/${q.id}`}>
                        {q.customer} <span className="mono muted">{q.ref}</span>
                      </Link>
                      <span className="num">
                        <Money paise={q.total_paise} short />
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Panel>
          <Panel title="Upcoming roof surveys">
            <div className="panel-body tight">
              {!upcoming.length ? (
                <p className="muted">None booked.</p>
              ) : (
                <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
                  {upcoming.map((s) => (
                    <li key={s.id} className="row between">
                      <Link to={`/app/surveys/${s.id}`}>{s.customer}</Link>
                      <span className="muted" style={{ fontSize: 13 }}>
                        {s.starts_at ? `${formatDate(s.starts_at)}, ${formatTime(s.starts_at)}` : ''} with {s.technician.split(' ')[0]}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ technician */

interface DayVisit {
  id: number;
  kind: 'survey' | 'installation' | 'service';
  starts_at: string;
  ends_at: string;
  status: string;
  customer: string;
  address: string;
  city: string;
  phone: string;
  job_id: number | null;
  survey_id: number | null;
  ticket_id: number | null;
  job_ref: string | null;
  job_status: string | null;
  capacity_kw: number | null;
  survey_ref: string | null;
  survey_status: string | null;
  ticket_ref: string | null;
  ticket_status: string | null;
  ticket_description: string | null;
}

function visitAction(v: DayVisit): { to: string; label: string } {
  if (v.kind === 'survey') return { to: `/app/surveys/${v.survey_id}`, label: v.survey_status === 'scheduled' || v.survey_status === 'rejected' ? 'Measure the roof' : 'Open survey' };
  if (v.kind === 'installation') {
    if (v.job_status === 'dispatched') return { to: `/app/jobs/${v.job_id}`, label: 'Confirm delivery' };
    if (v.job_status === 'delivered') return { to: `/app/jobs/${v.job_id}/install`, label: 'Fill the installation report' };
    return { to: `/app/jobs/${v.job_id}`, label: 'Open job' };
  }
  return { to: `/app/service/${v.ticket_id}`, label: 'Open complaint' };
}

function MyDay() {
  const { me } = useSession();
  const [offset, setOffset] = useState(0);
  const day = new Date(Date.now() + offset * 86_400_000);
  const iso = new Intl.DateTimeFormat('en-CA', { timeZone: me?.timezone ?? 'Asia/Kolkata' }).format(day);
  const q = useQuery({ queryKey: ['myday', iso], queryFn: () => api.get<{ visits: DayVisit[]; tickets: { id: number; ref: string; status: string; priority: string; coverage: string; description: string; customer: string; city: string }[] }>(`/api/me/day?date=${iso}`) });
  const Icon = { survey: Ruler, installation: SolarPanel, service: Wrench } as const;
  return (
    <div className="page narrow">
      <div className="page-head">
        <div>
          <h1>{offset === 0 ? 'Your day' : offset === 1 ? 'Tomorrow' : formatDate(iso)}</h1>
          <p className="lead">{formatDate(iso)}. Tap a visit to open its form.</p>
        </div>
        <Seg label="Day" value={String(offset)} onChange={(v) => setOffset(Number(v))} options={[{ value: '0', label: 'Today' }, { value: '1', label: 'Tomorrow' }, { value: '2', label: 'Day after' }]} />
      </div>
      {q.isLoading && <SkeletonRows rows={4} />}
      {q.data && !q.data.visits.length && <Empty title="No visits booked">Your schedule is clear. Check the complaints assigned to you below.</Empty>}
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 12 }}>
        {q.data?.visits.map((v) => {
          const a = visitAction(v);
          const I = Icon[v.kind];
          return (
            <li key={v.id} className="panel">
              <div className="panel-body" style={{ display: 'grid', gap: 10 }}>
                <div className="row between">
                  <span className="row" style={{ gap: 8 }}>
                    <I size={20} aria-hidden />
                    <b>{VISIT_KIND_LABEL[v.kind]}</b>
                    <span className="mono muted">{v.job_ref ?? v.survey_ref ?? v.ticket_ref}</span>
                  </span>
                  <span className="num" style={{ fontWeight: 800 }}>
                    {formatTime(v.starts_at)}–{formatTime(v.ends_at)}
                  </span>
                </div>
                <div>
                  <b style={{ fontSize: 17 }}>{v.customer}</b>
                  {v.capacity_kw && <span className="muted"> {formatKw(v.capacity_kw)}</span>}
                  <p className="muted" style={{ marginTop: 2 }}>
                    <MapPin size={14} style={{ verticalAlign: '-2px' }} aria-hidden /> {v.address}, {v.city}
                  </p>
                  {v.ticket_description && <p style={{ marginTop: 6 }}>{v.ticket_description}</p>}
                </div>
                <div className="row">
                  <Link className="btn btn-primary btn-lg" to={a.to} style={{ flex: 1 }}>
                    {v.kind === 'installation' && v.job_status === 'dispatched' ? <Truck size={18} /> : null}
                    {a.label}
                  </Link>
                  <a className="btn btn-lg" href={`tel:${v.phone}`} aria-label={`Call ${v.customer}`}>
                    <Phone size={18} />
                  </a>
                  <a className="btn btn-lg" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${v.address}, ${v.city}`)}`} target="_blank" rel="noreferrer" aria-label="Open the address in maps">
                    <MapPin size={18} />
                  </a>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      <Panel title="Complaints assigned to you">
        <div className="panel-body tight">
          {!q.data?.tickets.length ? (
            <p className="muted">None right now.</p>
          ) : (
            <ul className="attention" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {q.data.tickets.map((t) => (
                <li key={t.id}>
                  <Link to={`/app/service/${t.id}`} className={t.priority === 'urgent' ? 'hot' : ''}>
                    <span className="n">
                      <Wrench size={16} />
                    </span>
                    <span>
                      {t.customer}, {t.city}
                      <span className="muted" style={{ display: 'block', fontSize: 13, fontWeight: 400 }}>
                        {t.description.slice(0, 90)}
                      </span>
                    </span>
                    <Chip tone={t.coverage === 'warranty' ? 'good' : 'warn'}>{t.coverage === 'warranty' ? 'Covered' : 'Billable'}</Chip>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Panel>
    </div>
  );
}

