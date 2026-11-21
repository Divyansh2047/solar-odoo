import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CurrencyInr, Truck, ClipboardText, CheckCircle, XCircle, Package, ArrowSquareOut, CalendarBlank, CaretRight } from '@phosphor-icons/react';
import {
  formatPhone,
  CATEGORY_LABEL,
  COVERAGE_LABEL,
  EXPENSE_CATEGORIES,
  EXPENSE_LABEL,
  JOB_STATUS_LABEL,
  KIT_KIND_LABEL,
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABEL,
  SUBSIDY_STATUSES,
  SUBSIDY_STATUS_LABEL,
  TICKET_STATUS_LABEL,
  deliverSchema,
  formatDate,
  formatDateTime,
  formatINR,
  formatKw,
  formatQty,
  formatTime,
  jobCancelSchema,
  paymentSchema,
  rupees,
  expenseSchema,
  subsidyUpdateSchema,
  type Coverage,
  type JobStage,
  type JobStatus,
  type ProductCategory,
  type SubsidyStatus,
  type TicketStatus,
  formatPercent,
} from '@arka/shared';
import { api, ApiError } from '../../lib/api';
import { useSession } from '../../lib/session';
import { Button, Callout, Chip, ErrorBlock, KV, Money, PageHead, Panel, ProfitAmount, SkeletonRows } from '../../components/ui';
import { CoverageChip, Stages, WarrantyRuler } from '../../components/solar';
import { Timeline, type ActivityItem } from '../../components/timeline';
import { Dialog, useToast } from '../../components/overlay';
import { applyServerError, CheckField, FormError, SelectField, TextArea, TextField, useZodForm } from '../../components/form';
import { Kit3D } from '../../components/Kit3D';
import { JOB_TONE } from './Jobs';

interface Detail {
  job: {
    id: number;
    ref: string;
    status: JobStatus;
    kind: keyof typeof KIT_KIND_LABEL;
    capacity_kw: number;
    total_paise: number;
    revenue_ex_tax_paise: number;
    advance_required_paise: number;
    subsidy_applicable: boolean;
    customer: string;
    customer_id: number;
    phone: string;
    address: string;
    city: string;
    portal_token?: string;
    quote_id: number;
    quote_ref: string;
    quote_version: number;
    accepted_name: string;
    accepted_at: string;
    created_at: string;
    confirmed_at: string | null;
    packed_at: string | null;
    dispatched_at: string | null;
    delivered_on: string | null;
    installed_at: string | null;
    closed_at: string | null;
    cancelled_reason: string | null;
  };
  lines: { id: number; description: string; qty: number; uom: string; category: ProductCategory; amount_paise: number }[];
  payments: { id: number; ref: string; amount_paise: number; method: keyof typeof PAYMENT_METHOD_LABEL; received_on: string; reference: string | null; recorded_by_name: string | null }[];
  paidPaise: number;
  balancePaise: number;
  pick: { id: number; ref: string; status: string; vehicle_no: string | null; driver_name: string | null; goods_value_paise: number | null; progress: { name: string; need: number; scanned: number }[]; shortages: { name: string; need: number; available: number }[] } | null;
  visits: { id: number; kind: string; starts_at: string; ends_at: string; status: string; crew: { id: number; name: string }[] }[];
  report: { started_at: string; finished_at: string; confirmed_kw: number; size_mismatch_reason: string | null; generation_kw: number; signed_by_name: string; signature_file_id: number; photo_ids: number[]; submitted_by_name: string | null; notes: string | null } | null;
  invoices: { id: number; number: string; status: string; total_paise: number; issued_on: string; sent_at: string | null }[];
  subsidy: { status: SubsidyStatus; expected_paise: number; application_no: string | null; docs_bill: boolean; docs_id: boolean; docs_bank: boolean; docs_photo: boolean; applied_on: string | null; disbursed_on: string | null; disbursed_paise: number | null; stage_changed_at: string } | null;
  expenses: { id: number; category: keyof typeof EXPENSE_LABEL; amount_paise: number; spent_on: string; note: string | null }[];
  serials: { id: number; serial: string; status: string; warranty_start: string | null; warranty_end: string | null; product: string; category: ProductCategory; warranty_months: number }[];
  tickets: { id: number; ref: string; status: TicketStatus; coverage: Coverage; created_at: string; cost_paise: number; billed_paise: number }[];
  activities: ActivityItem[];
  profit: { revenue_paise: number; parts_paise: number; labour_paise: number; labour_hours: number; expenses_paise: number; warranty_paise: number; profit_paise: number } | null;
  kit: { kind: Detail['job']['kind']; panels: number; inverters: number; batteries: number; controllers: number; batteryKwh: number };
  stages: Record<JobStage, 'done' | 'todo' | 'na'>;
}

export default function JobDetail() {
  const { id } = useParams();
  const q = useQuery({ queryKey: ['job', id], queryFn: () => api.get<Detail>(`/api/jobs/${id}`) });
  const { can, me } = useSession();
  const [dlg, setDlg] = useState<null | 'pay' | 'deliver' | 'cancel' | 'expense' | 'subsidy'>(null);
  const qc = useQueryClient();
  const toast = useToast();
  useEffect(() => {
    if (q.data) document.title = `${q.data.job.ref} ${q.data.job.customer} · Arka`;
  }, [q.data]);
  if (q.isLoading) return <div className="page"><SkeletonRows rows={10} /></div>;
  if (q.isError) return <div className="page"><ErrorBlock error={q.error} retry={() => q.refetch()} /></div>;
  const d = q.data!;
  const j = d.job;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: me?.timezone ?? 'Asia/Kolkata' }).format(new Date());
  const inverter = d.serials.find((s) => s.category === 'inverter');
  const battery = d.serials.find((s) => s.category === 'battery');
  const panelsSerials = d.serials.filter((s) => s.category === 'panel');
  const installVisit = d.visits.find((v) => v.kind === 'installation' && v.status !== 'cancelled');
  const inv = d.invoices.find((i) => i.status !== 'void');
  const stageDates: Partial<Record<JobStage, string | null>> = {
    paid: j.confirmed_at,
    packed: j.packed_at,
    dispatched: j.dispatched_at,
    delivered: j.delivered_on,
    installed: j.installed_at,
    invoiced: inv?.sent_at ?? null,
    subsidy: d.subsidy?.disbursed_on ?? null,
    closed: j.closed_at,
  };
  const closeJob = async () => {
    try {
      await api.post(`/api/jobs/${j.id}/close`);
      toast(`${j.ref} closed.`);
      void qc.invalidateQueries({ queryKey: ['job', id] });
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Couldn’t close the job.', 'bad');
    }
  };
  return (
    <div className="page">
      <PageHead
        back={{ to: '/app/jobs', label: 'Jobs' }}
        title={j.customer}
        actions={
          <>
            {can('payments.write') && d.balancePaise > 0 && j.status !== 'cancelled' && (
              <Button variant={j.status === 'awaiting_advance' ? 'primary' : 'secondary'} icon={<CurrencyInr size={18} />} onClick={() => setDlg('pay')}>
                Record payment
              </Button>
            )}
            {d.pick && ['confirmed', 'packed'].includes(j.status) && can('dispatch.write') && (
              <Link className="btn btn-primary" to={`/app/warehouse/pick/${d.pick.id}`}>
                <Package size={18} /> {j.status === 'packed' ? 'Dispatch' : 'Scan and pack'}
              </Link>
            )}
            {j.status === 'dispatched' && can('delivery.write') && (
              <Button variant="primary" icon={<Truck size={18} />} onClick={() => setDlg('deliver')}>
                Mark delivered
              </Button>
            )}
            {j.status === 'delivered' && can('install.write') && (
              <Link className="btn btn-primary" to={`/app/jobs/${j.id}/install`}>
                <ClipboardText size={18} /> Fill the installation report
              </Link>
            )}
            {j.status === 'installed' && d.balancePaise <= 0 && can('jobs.write') && (
              <Button variant="primary" icon={<CheckCircle size={18} />} onClick={closeJob}>
                Close job
              </Button>
            )}
            {['awaiting_advance', 'confirmed', 'packed'].includes(j.status) && can('jobs.write') && (
              <Button variant="danger" icon={<XCircle size={18} />} onClick={() => setDlg('cancel')}>
                Cancel
              </Button>
            )}
          </>
        }
      >
        <div className="row" style={{ marginTop: 8 }}>
          <span className="mono muted">{j.ref}</span>
          <Chip tone={JOB_TONE[j.status]}>{JOB_STATUS_LABEL[j.status]}</Chip>
          <span className="muted">
            {formatKw(j.capacity_kw)} {KIT_KIND_LABEL[j.kind]}, {j.city}
          </span>
        </div>
      </PageHead>
      {j.status !== 'cancelled' ? <Stages stages={d.stages} dates={stageDates} /> : <Callout tone="warn">Cancelled: {j.cancelled_reason}</Callout>}
      <NextCallout d={d} />

      <div className="split">
        <div className="stack">
          <Panel title="The system on the roof">
            <div className="panel-body stack">
              <Kit3D
                kind={d.kit.kind}
                panels={d.kit.panels}
                inverters={d.kit.inverters}
                batteries={d.kit.batteries}
                controllers={d.kit.controllers}
                height={300}
                labels={[
                  inverter && { part: 'inverter' as const, title: 'Inverter', detail: inverter.warranty_end ? (inverter.warranty_end >= today ? `Covered until ${formatDate(inverter.warranty_end)}` : 'Warranty ended') : 'Warranty starts on delivery', tone: inverter.warranty_end ? (inverter.warranty_end >= today ? ('good' as const) : ('bad' as const)) : ('neutral' as const) },
                  panelsSerials[0] && { part: 'panel' as const, title: `${panelsSerials.length} panels`, detail: panelsSerials[0].warranty_end ? `Covered until ${formatDate(panelsSerials[0].warranty_end)}` : '20-year warranty', tone: 'good' as const },
                  battery && { part: 'battery' as const, title: 'Battery', detail: battery.warranty_end ? `Covered until ${formatDate(battery.warranty_end)}` : '2-year warranty', tone: 'neutral' as const },
                ].filter(Boolean) as never}
              />
              <details className="disclosure">
                <summary>
                  <CaretRight size={16} weight="bold" aria-hidden className="disclosure-caret" />
                  <span>Parts list</span>
                  <span className="muted">
                    {d.lines.length} lines, <Money paise={d.lines.reduce((s, l) => s + Number(l.amount_paise), 0)} /> before GST
                  </span>
                </summary>
                <table className="table" style={{ marginTop: 8 }}>
                  <tbody>
                    {d.lines.map((l) => (
                      <tr key={l.id}>
                        <td style={{ paddingLeft: 0 }}>
                          {l.description}
                          <div className="cell-sub">{CATEGORY_LABEL[l.category]}</div>
                        </td>
                        <td className="r num">{formatQty(l.qty, l.uom === 'unit' ? undefined : l.uom)}</td>
                        <td className="r num" style={{ paddingRight: 0 }}>
                          <Money paise={l.amount_paise} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            </div>
          </Panel>

          <Panel title="Serial numbers and warranty" actions={d.serials.length > 0 && <span className="muted" style={{ fontSize: 13 }}>{d.serials.length} units, warranty from delivery</span>}>
            <div className="panel-body stack">
              {!d.serials.length && <p className="muted">Serials are recorded when the warehouse scans the kit before dispatch.</p>}
              {[inverter, battery, d.serials.find((s) => s.category === 'charge_controller')].filter(Boolean).map((s) => (
                <div key={s!.id}>
                  <div className="row between">
                    <span>
                      <b>{s!.product}</b>{' '}
                      <Link to={`/app/serials/${s!.id}`} className="mono">
                        {s!.serial}
                      </Link>
                    </span>
                    <CoverageChip end={s!.warranty_end} today={today} />
                  </div>
                  <WarrantyRuler start={s!.warranty_start} end={s!.warranty_end} today={today} years={20} label={s!.product} />
                </div>
              ))}
              {panelsSerials.length > 0 && (
                <div>
                  <div className="row between">
                    <b>{panelsSerials.length} solar panels</b>
                    <CoverageChip end={panelsSerials[0]!.warranty_end} today={today} />
                  </div>
                  <WarrantyRuler start={panelsSerials[0]!.warranty_start} end={panelsSerials[0]!.warranty_end} today={today} label="Solar panels" />
                  <p className="mono muted" style={{ fontSize: 13, marginTop: 4 }}>
                    {panelsSerials.map((p) => p.serial).join(', ')}
                  </p>
                </div>
              )}
            </div>
          </Panel>

          {d.report && (
            <Panel title="Installation report">
              <div className="panel-body stack">
                <KV
                  items={[
                    ['On the roof', `${formatDateTime(d.report.started_at)} to ${formatTime(d.report.finished_at)}`],
                    ['Size confirmed', `${formatKw(d.report.confirmed_kw)}${d.report.size_mismatch_reason ? ` (${d.report.size_mismatch_reason})` : ''}`],
                    ['Test reading', `${d.report.generation_kw} kW generating at handover`],
                    ['Checklist', 'Stands mounted, panels laid, boxes connected, earthing done, power tested'],
                    ['Signed by', d.report.signed_by_name],
                    ['Report by', d.report.submitted_by_name],
                    ['Notes', d.report.notes],
                  ]}
                />
                <div className="thumbs">
                  {d.report.photo_ids.map((p) => (
                    <a key={p} className="thumb" href={`/api/files/${p}`} target="_blank" rel="noreferrer">
                      <img src={`/api/files/${p}`} alt="Finished roof" loading="lazy" />
                    </a>
                  ))}
                  <div className="thumb" style={{ background: '#fff' }}>
                    <img src={`/api/files/${d.report.signature_file_id}`} alt={`Signature of ${d.report.signed_by_name}`} style={{ objectFit: 'contain' }} />
                  </div>
                </div>
              </div>
            </Panel>
          )}

          <Panel title="History">
            <div className="panel-body">
              <Timeline items={d.activities} />
            </div>
          </Panel>
        </div>

        <div className="stack">
          {(can('invoices.read') || can('payments.write')) && (
          <Panel title="Money" actions={inv && <Link to={`/app/money/invoices/${inv.id}`}>Invoice {inv.number}</Link>}>
            <div className="panel-body stack">
              <div className="stat-row">
                <div className="stat">
                  <span className="stat-label">Total</span>
                  <span className="stat-value">
                    <Money paise={j.total_paise} />
                  </span>
                </div>
                <div className="stat">
                  <span className="stat-label">Paid</span>
                  <span className="stat-value">
                    <Money paise={d.paidPaise} />
                  </span>
                </div>
                <div className="stat">
                  <span className="stat-label">{d.balancePaise > 0 ? 'Still due' : 'Balance'}</span>
                  <span className="stat-value" style={{ color: d.balancePaise > 0 ? 'var(--warn)' : 'var(--good)' }}>
                    {d.balancePaise > 0 ? <Money paise={d.balancePaise} /> : 'Paid in full'}
                  </span>
                </div>
              </div>
              {j.status === 'awaiting_advance' && <p className="muted">The advance needed to confirm is <b>{formatINR(j.advance_required_paise)}</b>.</p>}
              {d.payments.length > 0 && (
                <table className="table">
                  <tbody>
                    {d.payments.map((p) => (
                      <tr key={p.id}>
                        <td style={{ paddingLeft: 0 }}>
                          {formatDate(p.received_on)}
                          <div className="cell-sub">
                            {PAYMENT_METHOD_LABEL[p.method]}
                            {p.reference ? `, ${p.reference}` : ''}
                          </div>
                        </td>
                        <td className="mono muted">{p.ref}</td>
                        <td className="r" style={{ paddingRight: 0 }}>
                          <Money paise={p.amount_paise} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </Panel>
          )}

          {can('reports.read') && d.profit && (
            <Panel title="Did this job make money?" actions={can('expenses.write') && <Button size="sm" onClick={() => setDlg('expense')}>Add expense</Button>}>
              <div className="panel-body">
                <dl className="kv">
                  <dt>Revenue, excluding GST</dt>
                  <dd className="num">{formatINR(d.profit.revenue_paise)}</dd>
                  <dt>Parts at cost</dt>
                  <dd className="num">−{formatINR(d.profit.parts_paise)}</dd>
                  <dt>Crew ({Math.round(d.profit.labour_hours)} h)</dt>
                  <dd className="num">−{formatINR(d.profit.labour_paise)}</dd>
                  <dt>Expenses{d.expenses.length > 0 && <span className="kv-sub">{d.expenses.map((e) => `${EXPENSE_LABEL[e.category]} ${formatINR(e.amount_paise)}`).join(', ')}</span>}</dt>
                  <dd className="num">{d.profit.expenses_paise ? `−${formatINR(d.profit.expenses_paise)}` : 'None'}</dd>
                  {d.profit.warranty_paise > 0 && (
                    <>
                      <dt>Free repairs under warranty</dt>
                      <dd className="num">−{formatINR(d.profit.warranty_paise)}</dd>
                    </>
                  )}
                  <dt style={{ fontWeight: 800, color: 'var(--ink)' }}>{d.profit.profit_paise < 0 ? 'Loss' : 'Profit'}</dt>
                  <dd>
                    <ProfitAmount paise={d.profit.profit_paise} />{' '}
                    <span className="muted">({formatPercent(d.profit.profit_paise, d.profit.revenue_paise)})</span>
                  </dd>
                </dl>
              </div>
            </Panel>
          )}

          <Panel title="Crew visit" actions={<Link to="/app/schedule"><CalendarBlank size={16} /> Schedule</Link>}>
            <div className="panel-body">
              {installVisit ? (
                <KV
                  items={[
                    ['When', `${formatDate(installVisit.starts_at)}, ${formatTime(installVisit.starts_at)}–${formatTime(installVisit.ends_at)}`],
                    ['Crew', installVisit.crew.map((c) => c.name).join(', ')],
                    ['Status', installVisit.status === 'done' ? 'Done' : 'Planned'],
                  ]}
                />
              ) : (
                <p className="muted">{j.status === 'awaiting_advance' ? 'The crew is booked automatically when the advance arrives.' : 'No installation visit booked.'}</p>
              )}
            </div>
          </Panel>

          {d.pick && (
            <Panel title="Warehouse" actions={<Link to={`/app/warehouse/pick/${d.pick.id}`}>{d.pick.ref}</Link>}>
              <div className="panel-body stack">
                {d.pick.shortages.length > 0 && ['waiting_stock', 'ready'].includes(d.pick.status) && (
                  <Callout tone="warn">Short: {d.pick.shortages.map((s) => `${s.name} (need ${formatQty(s.need)}, have ${formatQty(s.available)})`).join(', ')}. It moves to packing when the stock is received.</Callout>
                )}
                {d.pick.progress.map((p) => (
                  <div key={p.name}>
                    <div className="row between" style={{ fontSize: 14 }}>
                      <span>{p.name}</span>
                      <span className="num">
                        {p.scanned} of {formatQty(p.need)} scanned
                      </span>
                    </div>
                    <div className="progress">
                      <i style={{ width: `${Math.min(100, (p.scanned / p.need) * 100)}%` }} />
                    </div>
                  </div>
                ))}
                {d.pick.vehicle_no && (
                  <p className="muted">
                    Left on {d.pick.vehicle_no} with {d.pick.driver_name}, {formatINR(d.pick.goods_value_paise ?? 0)} of stock at cost.
                  </p>
                )}
              </div>
            </Panel>
          )}

          {d.subsidy && (
            <Panel title="Subsidy paperwork" actions={can('subsidy.write') && <Button size="sm" onClick={() => setDlg('subsidy')}>Update</Button>}>
              <div className="panel-body">
                <KV
                  items={[
                    ['Stage', <Chip tone={d.subsidy.status === 'disbursed' ? 'good' : d.subsidy.status === 'rejected' ? 'bad' : 'info'}>{SUBSIDY_STATUS_LABEL[d.subsidy.status]}</Chip>],
                    ['Expected', formatINR(d.subsidy.expected_paise)],
                    ['Application', d.subsidy.application_no],
                    ['Documents', `${[d.subsidy.docs_bill, d.subsidy.docs_id, d.subsidy.docs_bank, d.subsidy.docs_photo].filter(Boolean).length} of 4 collected`],
                    ['Received', d.subsidy.disbursed_paise !== null ? `${formatINR(d.subsidy.disbursed_paise)} on ${formatDate(d.subsidy.disbursed_on)}` : null],
                  ]}
                />
              </div>
            </Panel>
          )}

          {d.tickets.length > 0 && (
            <Panel title="Service tickets">
              <div className="panel-body tight" style={{ display: 'grid', gap: 6 }}>
                {d.tickets.map((t) => (
                  <Link key={t.id} to={`/app/service/${t.id}`} className="row between">
                    <span className="mono">{t.ref}</span>
                    <span className="muted">
                      {TICKET_STATUS_LABEL[t.status]}, {COVERAGE_LABEL[t.coverage].toLowerCase()}
                    </span>
                  </Link>
                ))}
              </div>
            </Panel>
          )}

          <Panel title="Customer">
            <div className="panel-body stack">
              <KV
                items={[
                  ['Address', `${j.address}, ${j.city}`],
                  ['Phone', <a href={`tel:${j.phone}`}>{formatPhone(j.phone)}</a>],
                  ['Quote', <Link to={`/app/quotes/${j.quote_id}`} className="mono">{j.quote_ref} v{j.quote_version}</Link>],
                  ['Accepted', `${j.accepted_name}, ${formatDate(j.accepted_at)}`],
                ]}
              />
              {j.portal_token && (
                <a className="btn btn-sm" href={`/my/${j.portal_token}`} target="_blank" rel="noreferrer">
                  <ArrowSquareOut size={16} /> Customer’s page
                </a>
              )}
              <Link to={`/app/customers/${j.customer_id}`}>Everything about this customer</Link>
            </div>
          </Panel>
        </div>
      </div>

      <PaymentDialog open={dlg === 'pay'} onClose={() => setDlg(null)} jobId={j.id} due={d.balancePaise} advanceDue={j.status === 'awaiting_advance' ? Math.max(0, j.advance_required_paise - d.paidPaise) : 0} />
      <DeliverDialog open={dlg === 'deliver'} onClose={() => setDlg(null)} jobId={j.id} customer={j.customer} />
      <CancelDialog open={dlg === 'cancel'} onClose={() => setDlg(null)} jobId={j.id} />
      <ExpenseDialog open={dlg === 'expense'} onClose={() => setDlg(null)} jobId={j.id} />
      {d.subsidy && <SubsidyDialog open={dlg === 'subsidy'} onClose={() => setDlg(null)} jobId={j.id} current={d.subsidy} />}
    </div>
  );
}

function NextCallout({ d }: { d: Detail }) {
  const j = d.job;
  switch (j.status) {
    case 'awaiting_advance':
      return <Callout tone="warn">Waiting for the advance of {formatINR(Math.max(0, j.advance_required_paise - d.paidPaise))}. Recording it confirms the order: the warehouse gets the pick list and the crew gets the job on their schedule, without a phone call.</Callout>;
    case 'confirmed':
      return d.pick?.status === 'waiting_stock' ? <Callout tone="warn">Confirmed, but some parts are short. Packing starts when the stock is received.</Callout> : <Callout>Confirmed. The warehouse scans every serial and packs the kit.</Callout>;
    case 'packed':
      return <Callout>Packed and scanned. Next: load the truck and dispatch.</Callout>;
    case 'dispatched':
      return <Callout>On the truck. When it arrives, mark it delivered: the warranty clock starts for every serial.</Callout>;
    case 'delivered':
      return <Callout>Delivered. The crew installs, tests and gets the homeowner’s signature on the phone.</Callout>;
    case 'installed':
      return d.balancePaise > 0 ? <Callout tone="warn">Installed and signed. {formatINR(d.balancePaise)} is still due.</Callout> : <Callout tone="good">Installed, signed and paid. Close the job when the paperwork is done.</Callout>;
    default:
      return null;
  }
}

function PaymentDialog({ open, onClose, jobId, due, advanceDue }: { open: boolean; onClose: () => void; jobId: number; due: number; advanceDue: number }) {
  const schema = paymentSchema.safeExtend({ amountPaise: rupees('Enter the amount received') }) as unknown as typeof paymentSchema;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
  const form = useZodForm(schema, { amountPaise: (advanceDue ? advanceDue / 100 : due / 100) as never, method: 'upi', reference: '', receivedOn: today, note: '' });
  const [error, setError] = useState<string | null>(null);
  const qc = useQueryClient();
  const toast = useToast();
  useEffect(() => {
    if (open) form.reset({ amountPaise: (advanceDue ? advanceDue / 100 : due / 100) as never, method: 'upi', reference: '', receivedOn: today, note: '' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  return (
    <Dialog open={open} onClose={onClose} title="Record a payment" description={`${formatINR(due)} is still due${advanceDue ? `; ${formatINR(advanceDue)} confirms the order` : ''}.`}>
      <form
        noValidate
        className="stack"
        onSubmit={form.handleSubmit(async (v) => {
          setError(null);
          try {
            const r = await api.post<{ ref: string; confirmed: boolean; balancePaise: number }>(`/api/jobs/${jobId}/payments`, v);
            toast(r.confirmed ? `Payment ${r.ref} recorded. Order confirmed: the warehouse and crew have been told.` : `Payment ${r.ref} recorded. ${r.balancePaise > 0 ? `${formatINR(r.balancePaise)} still due.` : 'Paid in full.'}`);
            void qc.invalidateQueries({ queryKey: ['job'] });
            onClose();
          } catch (e) {
            setError(applyServerError(form, e));
          }
        })}
      >
        <FormError message={error} />
        <div className="form-grid">
          <TextField form={form as never} name="amountPaise" label="Amount" prefix="₹" inputMode="decimal" />
          <SelectField form={form as never} name="method" label="Paid by" options={PAYMENT_METHODS.map((m) => ({ value: m, label: PAYMENT_METHOD_LABEL[m] }))} />
          <TextField form={form as never} name="reference" label="UTR or cheque number" optional hint="Needed for bank transfers and cheques." />
          <TextField form={form as never} name="receivedOn" label="Received on" type="date" max={today} />
        </div>
        <div className="form-actions">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" busy={form.formState.isSubmitting}>
            Record payment
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function DeliverDialog({ open, onClose, jobId, customer }: { open: boolean; onClose: () => void; jobId: number; customer: string }) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
  const form = useZodForm(deliverSchema, { deliveredOn: today, receivedBy: customer });
  const [error, setError] = useState<string | null>(null);
  const qc = useQueryClient();
  const toast = useToast();
  return (
    <Dialog open={open} onClose={onClose} title="Kit delivered" description="The warranty clock starts now for every serial number on the truck. Nobody types warranty dates.">
      <form
        noValidate
        className="stack"
        onSubmit={form.handleSubmit(async (v) => {
          setError(null);
          try {
            const r = await api.post<{ warranties: { serial: string; product: string; end: string }[] }>(`/api/jobs/${jobId}/deliver`, v);
            toast(`Delivered. Warranty started for ${r.warranties.length} serial numbers.`);
            void qc.invalidateQueries({ queryKey: ['job'] });
            onClose();
          } catch (e) {
            setError(applyServerError(form, e));
          }
        })}
      >
        <FormError message={error} />
        <div className="form-grid">
          <TextField form={form as never} name="deliveredOn" label="Delivered on" type="date" max={today} />
          <TextField form={form as never} name="receivedBy" label="Received by" />
        </div>
        <div className="form-actions">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" busy={form.formState.isSubmitting}>
            Confirm delivery
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function CancelDialog({ open, onClose, jobId }: { open: boolean; onClose: () => void; jobId: number }) {
  const form = useZodForm(jobCancelSchema, { reason: '' });
  const [error, setError] = useState<string | null>(null);
  const qc = useQueryClient();
  return (
    <Dialog open={open} onClose={onClose} title="Cancel this job" description="Scanned serials go back to stock and crew visits are cancelled. Payments stay on record for a refund.">
      <form
        noValidate
        className="stack"
        onSubmit={form.handleSubmit(async (v) => {
          setError(null);
          try {
            await api.post(`/api/jobs/${jobId}/cancel`, v);
            void qc.invalidateQueries({ queryKey: ['job'] });
            onClose();
          } catch (e) {
            setError(applyServerError(form, e));
          }
        })}
      >
        <FormError message={error} />
        <TextArea form={form as never} name="reason" label="Reason" rows={3} />
        <div className="form-actions">
          <Button onClick={onClose}>Keep the job</Button>
          <Button type="submit" variant="danger" busy={form.formState.isSubmitting}>
            Cancel job
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function ExpenseDialog({ open, onClose, jobId }: { open: boolean; onClose: () => void; jobId: number }) {
  const schema = expenseSchema.safeExtend({ amountPaise: rupees('Enter the amount') }) as unknown as typeof expenseSchema;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
  const form = useZodForm(schema, { jobId, category: 'transport', amountPaise: '' as never, spentOn: today, note: '' });
  const [error, setError] = useState<string | null>(null);
  const qc = useQueryClient();
  return (
    <Dialog open={open} onClose={onClose} title="Add a job expense" description="Expenses count against this job’s profit.">
      <form
        noValidate
        className="stack"
        onSubmit={form.handleSubmit(async (v) => {
          setError(null);
          try {
            await api.post('/api/expenses', v);
            void qc.invalidateQueries({ queryKey: ['job'] });
            onClose();
          } catch (e) {
            setError(applyServerError(form, e));
          }
        })}
      >
        <FormError message={error} />
        <div className="form-grid">
          <SelectField form={form as never} name="category" label="What for" options={EXPENSE_CATEGORIES.map((c) => ({ value: c, label: EXPENSE_LABEL[c] }))} />
          <TextField form={form as never} name="amountPaise" label="Amount" prefix="₹" inputMode="decimal" />
          <TextField form={form as never} name="spentOn" label="Date" type="date" max={today} />
          <TextField form={form as never} name="note" label="Note" optional />
        </div>
        <div className="form-actions">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" busy={form.formState.isSubmitting}>
            Add expense
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export function SubsidyDialog({ open, onClose, jobId, current }: { open: boolean; onClose: () => void; jobId: number; current: NonNullable<Detail['subsidy']> }) {
  const schema = subsidyUpdateSchema.safeExtend({ disbursedPaise: rupees('Enter the amount received').optional() }) as unknown as typeof subsidyUpdateSchema;
  const form = useZodForm(schema, {
    status: current.status,
    applicationNo: current.application_no ?? '',
    docsBill: current.docs_bill,
    docsId: current.docs_id,
    docsBank: current.docs_bank,
    docsPhoto: current.docs_photo,
    disbursedPaise: (current.disbursed_paise !== null ? current.disbursed_paise / 100 : current.expected_paise / 100) as never,
    note: '',
  });
  const [error, setError] = useState<string | null>(null);
  const qc = useQueryClient();
  const toast = useToast();
  const status = form.watch('status');
  return (
    <Dialog open={open} onClose={onClose} title="Subsidy paperwork" description="PM Surya Ghar: documents, portal application, inspection after installation, approval, then money to the customer’s bank.">
      <form
        noValidate
        className="stack"
        onSubmit={form.handleSubmit(async (v) => {
          setError(null);
          try {
            const body = { ...v, disbursedPaise: v.status === 'disbursed' ? v.disbursedPaise : undefined };
            await api.put(`/api/jobs/${jobId}/subsidy`, body);
            toast(`Subsidy: ${SUBSIDY_STATUS_LABEL[v.status]}.`);
            void qc.invalidateQueries({ queryKey: ['job'] });
            void qc.invalidateQueries({ queryKey: ['subsidy'] });
            onClose();
          } catch (e) {
            setError(applyServerError(form, e));
          }
        })}
      >
        <FormError message={error} />
        <SelectField form={form as never} name="status" label="Stage" options={SUBSIDY_STATUSES.map((s) => ({ value: s, label: SUBSIDY_STATUS_LABEL[s] }))} />
        <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="field-label">Documents collected</legend>
          <div className="form-grid">
            <CheckField form={form as never} name="docsBill" label="Latest electricity bill" />
            <CheckField form={form as never} name="docsId" label="Identity proof" />
            <CheckField form={form as never} name="docsBank" label="Cancelled cheque or passbook" />
            <CheckField form={form as never} name="docsPhoto" label="Photo with the installed system" />
          </div>
        </fieldset>
        <TextField form={form as never} name="applicationNo" label="Portal application number" optional={!['applied', 'inspection', 'approved', 'disbursed'].includes(status)} />
        {status === 'disbursed' && <TextField form={form as never} name="disbursedPaise" label="Amount received by the customer" prefix="₹" inputMode="decimal" />}
        <TextField form={form as never} name="note" label="Note" optional />
        <div className="form-actions">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" busy={form.formState.isSubmitting}>
            Save
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
