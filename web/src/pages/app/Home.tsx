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
import { ModuleCell } from '../../components/solar';
import { ProfitBars, WeeklyBars, type ProfitRow } from '../../components/charts';
import { Dialog, useToast } from '../../components/overlay';
import Warehouse from './Warehouse';
import Service from './Service';

export default function Home() {
  const { me } = useSession();
  useEffect(() => {
    document.title = 'Today · Arka';
  }, []);
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

export function DashboardBody({ data, shared, aside }: { data: Dash; shared?: boolean; aside?: React.ReactNode }) {
  const k = data.kpis;
  const n = data.now;
  const margin = formatPercent(data.profit.profit, data.profit.revenue);
  const link = (to: string) => (shared ? undefined : to);
  return (
    <>
      <section className="module" aria-label={`Key numbers, ${data.period.label.toLowerCase()}`}>
        <div className="module-grid">
          <ModuleCell k="Enquiries in" v={k.enquiries} s={`${k.enquiries_web} from the web form`} to={link('/app/enquiries')} />
          <ModuleCell k="Orders won" v={k.jobs_won} s={`${formatINRShort(k.orders_value ?? 0)} incl. GST`} to={link('/app/jobs')} />
          <ModuleCell k="Installed" v={formatKw(k.kw_installed)} s={`${k.installs} rooftop${k.installs === 1 ? '' : 's'}`} tone="lit" to={link('/app/jobs?status=installed')} />
          <ModuleCell k="Cash collected" v={formatINRShort(k.cash_in ?? 0)} s={`${formatINRShort(k.advances_in ?? 0)} of it advances`} to={link('/app/money/payments')} />
          <ModuleCell
            k="Profit on installed jobs"
            v={formatINRShort(data.profit.profit)}
            s={`${margin} margin${data.profit.losses ? `, ${data.profit.losses} lost money` : ''}`}
            tone={data.profit.profit < 0 ? 'alert' : 'good'}
            to={link('/app/reports')}
          />
          <ModuleCell k="Repairs still open" v={n.open_repairs} s={`${n.urgent_repairs} urgent, ${n.open_repairs_warranty} under warranty`} tone={n.urgent_repairs ? 'alert' : undefined} to={link('/app/service')} />
          <ModuleCell k="Invoices to send" v={n.invoices_to_send} s={formatINRShort(n.invoices_to_send_value ?? 0)} to={link('/app/money/invoices')} />
          <ModuleCell k="Subsidy pending" v={n.subsidy_pending} s={`${formatINRShort(n.subsidy_pending_value ?? 0)} for customers`} to={link('/app/money/subsidy')} />
        </div>
      </section>
      <div className="dash-grid">
        <Panel
          title="Which installations made money"
          actions={<span className="muted" style={{ fontSize: 13 }}>{data.profit.jobs.length} installed {data.period.label.toLowerCase()}, losses first</span>}
        >
          <div className="panel-body">
            {data.profit.jobs.length ? (
              <ProfitBars rows={data.profit.jobs} limit={shared ? 40 : 12} />
            ) : (
              <Empty title="Nothing installed in this period yet">Profit appears here as soon as a crew signs off a job.</Empty>
            )}
          </div>
          {!shared && data.profit.jobs.length > 12 && (
            <div className="panel-foot">
              <Link to="/app/reports">See all {data.profit.jobs.length} jobs</Link>
            </div>
          )}
        </Panel>
        <div className="stack">
          {aside}
          <Panel title="Subsidy paperwork">
            <div className="panel-body">
              <div className="pipeline">
                {(['not_started', 'documents', 'applied', 'inspection', 'approved', 'disbursed'] as SubsidyStatus[]).map((s) => {
                  const row = data.subsidy.find((x) => x.status === s);
                  return (
                    <div key={s}>
                      <b>{row?.n ?? 0}</b>
                      <span>{SUBSIDY_STATUS_LABEL[s]}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </Panel>
          <Panel title="Money in the pipeline">
            <div className="panel-body">
              <div className="stat-row">
                <div className="stat">
                  <span className="stat-label">Customers still owe</span>
                  <span className="stat-value">{formatINRShort((n.receivable_jobs ?? 0) + (n.receivable_service ?? 0))}</span>
                </div>
                <div className="stat">
                  <span className="stat-label">Technicians to pay</span>
                  <span className="stat-value">{formatINRShort(n.payroll_due ?? 0)}</span>
                  <span className="muted" style={{ fontSize: 13 }}>{n.payroll_people} people, unpaid hours</span>
                </div>
                <div className="stat">
                  <span className="stat-label">Stock bought</span>
                  <span className="stat-value">{formatINRShort(k.stock_purchases ?? 0)}</span>
                  <span className="muted" style={{ fontSize: 13 }}>{data.period.label.toLowerCase()}</span>
                </div>
                <div className="stat">
                  <span className="stat-label">Technician hours</span>
                  <span className="stat-value">{Math.round(k.tech_hours ?? 0)} h</span>
                  <span className="muted" style={{ fontSize: 13 }}>{formatINRShort(k.tech_cost ?? 0)} cost</span>
                </div>
              </div>
            </div>
          </Panel>
        </div>
      </div>
    </>
  );
}

function Director() {
  const [period, setPeriod] = useState<Period>('month');
  const { me } = useSession();
  const [share, setShare] = useState(false);
  const dash = useQuery({ queryKey: ['dashboard', period], queryFn: () => api.get<Dash>(`/api/dashboard?period=${period}`) });
  const trend = useQuery({ queryKey: ['trend'], queryFn: () => api.get<{ weeks: { week: string; kw: number; cash: number; enquiries: number; won: number; profit: number }[] }>('/api/reports/trend') });
  const unfinished = useQuery({ queryKey: ['unfinished'], queryFn: () => api.get<{ jobs: UnfinishedJob[] }>('/api/reports/unfinished') });
  const range = periodRange(period, new Date(), me?.timezone ?? 'Asia/Kolkata');
  return (
    <div className="page">
      <div className="dash-head">
        <div>
          <h1>How is {me?.companyName.replace(/ \(demo\)$/, '')} doing {period === 'today' ? 'today' : period === 'week' ? 'this week' : 'this month'}?</h1>
          <p className="lead muted">
            {period === 'today' ? formatDate(range.from) : `${formatDate(range.from)} to today`}. Numbers update live as the team works.
          </p>
        </div>
        <div className="row">
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
              Share these numbers
            </Button>
          )}
        </div>
      </div>
      {dash.isLoading && <SkeletonRows rows={6} />}
      {dash.isError && <ErrorBlock error={dash.error} retry={() => dash.refetch()} />}
      {dash.data && <DashboardBody data={dash.data} aside={<Attention now={dash.data.now} sla={dash.data.slaMinutes} />} />}
      <div className="dash-grid">
        <Panel title="What is still unfinished" actions={<Link to="/app/reports">All of it</Link>}>
          {unfinished.isLoading ? <SkeletonRows rows={5} /> : <UnfinishedList jobs={(unfinished.data?.jobs ?? []).slice(0, 8)} />}
        </Panel>
        <Panel title="Rooftops installed per week">
          <div className="panel-body">
            {trend.data && (
              <>
                <div className="chart-head">
                  <span className="muted">Last 12 weeks</span>
                  <span className="big">{formatKw(trend.data.weeks.reduce((s, w) => s + Number(w.kw), 0))}</span>
                </div>
                <WeeklyBars data={trend.data.weeks.map((w) => ({ week: w.week, value: Number(w.kw) }))} format={(v) => `${Math.round(v)} kW`} label="kW installed per week" />
                <div className="chart-head" style={{ marginTop: 16 }}>
                  <span className="muted">Cash collected per week</span>
                  <span className="big">{formatINRShort(trend.data.weeks.reduce((s, w) => s + Number(w.cash), 0))}</span>
                </div>
                <WeeklyBars data={trend.data.weeks.map((w) => ({ week: w.week, value: Number(w.cash) }))} format={(v) => formatINRShort(v)} label="Cash collected per week" />
              </>
            )}
          </div>
        </Panel>
      </div>
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
  if (!items.length) return null;
  return (
    <section aria-label="Needs attention now" className="attention">
      <h2 style={{ fontSize: 17, marginBottom: 2 }}>Needs someone now</h2>
      {items.slice(0, 5).map((i) => (
        <Link key={i.text} to={i.to} className={i.tone}>
          <span className="n">{i.n}</span>
          {i.text}
          <CaretRight className="go" size={16} aria-hidden />
        </Link>
      ))}
    </section>
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

export function UnfinishedList({ jobs }: { jobs: UnfinishedJob[] }) {
  if (!jobs.length) return <Empty title="Nothing unfinished">Every job is closed. Time for chai.</Empty>;
  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: '4px 8px 8px' }}>
      {jobs.map((j) => (
        <li key={j.id}>
          <Link to={`/app/jobs/${j.id}`} className="profit-row" style={{ gridTemplateColumns: 'minmax(0, 1.2fr) minmax(0, 1.4fr) auto' }}>
            <span className="who">
              <b>{j.customer}</b>
              <span className="mono">{j.ref}</span> <span>{formatKw(j.capacity_kw)}</span>
            </span>
            <span>
              {j.next.label}
              <span className="muted" style={{ display: 'block', fontSize: 12 }}>
                {j.next.owner}
              </span>
            </span>
            <span className="muted num" style={{ fontSize: 13, textAlign: 'right' }}>
              waiting {relativeTime(j.since).replace(' ago', '')}
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
          <h1>Who needs a call, {me?.name.split(' ')[0]}?</h1>
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

