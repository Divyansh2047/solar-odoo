import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash, UserCircle, Play, CheckCircle, ArrowCounterClockwise, CalendarPlus, Barcode } from '@phosphor-icons/react';
import {
  CONFIRM_METHODS,
  CONFIRM_METHOD_LABEL,
  COVERAGE_LABEL,
  TICKET_CHANNEL_LABEL,
  TICKET_PRIORITY_LABEL,
  TICKET_STATUS_LABEL,
  formatDate,
  formatDateTime,
  formatINR,
  formatPhone,
  formatTime,
  localDateTime,
  ticketReopenSchema,
  visitSchema,
  warrantyLeft,
  type Coverage,
  type TicketStatus,
} from '@arka/shared';
import { api, ApiError } from '../../lib/api';
import { useSession } from '../../lib/session';
import { Button, Callout, Chip, ErrorBlock, KV, Money, PageHead, Panel, SkeletonRows } from '../../components/ui';
import { WarrantyRuler } from '../../components/solar';
import { Timeline, type ActivityItem } from '../../components/timeline';
import { Dialog, useToast } from '../../components/overlay';
import { applyServerError, FormError, TextArea, useZodForm } from '../../components/form';
import { TICKET_TONE } from './Service';

interface Detail {
  ticket: {
    id: number;
    ref: string;
    status: TicketStatus;
    coverage: Coverage;
    priority: keyof typeof TICKET_PRIORITY_LABEL;
    channel: keyof typeof TICKET_CHANNEL_LABEL;
    fault_code: string | null;
    description: string;
    resolution: string | null;
    labour_hours: number | null;
    parts_cost_paise: number;
    labour_cost_paise: number;
    billed_paise: number;
    created_at: string;
    resolved_at: string | null;
    closed_at: string | null;
    confirm_method: keyof typeof CONFIRM_METHOD_LABEL | null;
    reopen_count: number;
    customer_id: number;
    customer: string;
    phone: string;
    address: string;
    city: string;
    portal_token: string;
    serial_unit_id: number | null;
    serial: string | null;
    product: string | null;
    product_id: number | null;
    warranty_start: string | null;
    warranty_end: string | null;
    warranty_end_at_open: string | null;
    assigned_to: number | null;
    assigned_name: string | null;
    job_id: number | null;
    job_ref: string | null;
    created_by_name: string | null;
    invoice_id: number | null;
    invoice_number: string | null;
    invoice_status: string | null;
  };
  parts: { id: number; name: string; sku: string; qty: number; unit_cost_paise: number | null; unit_price_paise: number; new_serial: string | null; old_serial: string | null }[];
  activities: ActivityItem[];
  customerSerials: { id: number; serial: string; product: string; category: string; product_id: number; warranty_end: string | null }[];
  visits: { id: number; starts_at: string; ends_at: string; status: string; crew: { name: string }[] }[];
}

export default function TicketDetail() {
  const { id } = useParams();
  const q = useQuery({ queryKey: ['ticket', id], queryFn: () => api.get<Detail>(`/api/tickets/${id}`) });
  const { can, me } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [dlg, setDlg] = useState<null | 'assign' | 'resolve' | 'confirm' | 'reopen' | 'visit'>(null);
  useEffect(() => {
    if (q.data) document.title = `${q.data.ticket.ref} · Arka`;
  }, [q.data]);
  if (q.isLoading) return <div className="page"><SkeletonRows rows={8} /></div>;
  if (q.isError) return <div className="page"><ErrorBlock error={q.error} retry={() => q.refetch()} /></div>;
  const d = q.data!;
  const t = d.ticket;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: me?.timezone ?? 'Asia/Kolkata' }).format(new Date());
  const writable = can('tickets.write');
  const mine = me?.role !== 'technician' || t.assigned_to === me.id;
  // the yellow button is whatever unblocks the ticket next: assign, then book, then start, then fix
  const live = ['open', 'assigned', 'in_progress'].includes(t.status);
  const upcoming = d.visits.some((v) => v.status === 'planned' || v.status === 'in_progress');
  const next: 'assign' | 'visit' | 'start' | 'resolve' | null = !live
    ? null
    : t.status === 'in_progress'
      ? 'resolve'
      : !t.assigned_to && me?.role !== 'technician'
        ? 'assign'
        : !upcoming && can('schedule.write')
          ? 'visit'
          : mine
            ? 'start'
            : null;
  const v = (k: typeof next) => (next === k ? ('primary' as const) : undefined);
  const start = async () => {
    try {
      await api.post(`/api/tickets/${t.id}/start`);
      void qc.invalidateQueries({ queryKey: ['ticket', id] });
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Failed.', 'bad');
    }
  };
  return (
    <div className="page">
      <PageHead
        back={{ to: '/app/service', label: 'Service' }}
        title={t.customer}
        actions={
          writable && (
            <>
              {['open', 'assigned', 'in_progress'].includes(t.status) && me?.role !== 'technician' && (
                <Button variant={v('assign')} icon={<UserCircle size={18} />} onClick={() => setDlg('assign')}>
                  {t.assigned_name ? 'Reassign' : 'Assign'}
                </Button>
              )}
              {['open', 'assigned', 'in_progress'].includes(t.status) && can('schedule.write') && (
                <Button variant={v('visit')} icon={<CalendarPlus size={18} />} onClick={() => setDlg('visit')}>
                  Book a visit
                </Button>
              )}
              {['open', 'assigned'].includes(t.status) && mine && (
                <Button variant={v('start')} icon={<Play size={18} />} onClick={start}>
                  Start work
                </Button>
              )}
              {['open', 'assigned', 'in_progress'].includes(t.status) && mine && (
                <Button variant={next === 'resolve' ? 'primary' : 'ghost'} icon={<CheckCircle size={18} />} onClick={() => setDlg('resolve')}>
                  Mark fixed
                </Button>
              )}
              {t.status === 'resolved' && (
                <>
                  <Button icon={<ArrowCounterClockwise size={18} />} onClick={() => setDlg('reopen')}>
                    Still not working
                  </Button>
                  <Button variant="primary" icon={<CheckCircle size={18} />} onClick={() => setDlg('confirm')}>
                    Customer confirmed
                  </Button>
                </>
              )}
            </>
          )
        }
      >
        <div className="row" style={{ marginTop: 8 }}>
          <span className="mono muted">{t.ref}</span>
          <Chip tone={TICKET_TONE[t.status]}>{TICKET_STATUS_LABEL[t.status]}</Chip>
          <Chip tone={t.priority === 'urgent' ? 'bad' : 'neutral'}>{TICKET_PRIORITY_LABEL[t.priority]}</Chip>
          <span className="muted">
            {TICKET_CHANNEL_LABEL[t.channel]}, {formatDateTime(t.created_at)}
            {t.created_by_name ? ` by ${t.created_by_name}` : ''}
          </span>
        </div>
      </PageHead>

      <section className={`callout ${t.coverage === 'paid' ? 'warn' : 'good'}`} style={{ fontSize: 16 }} aria-label="Who pays">
        <div style={{ display: 'grid', gap: 4 }}>
          <b style={{ fontSize: 18 }}>{t.coverage === 'paid' ? 'Billable: out of warranty' : t.coverage === 'goodwill' ? 'Free, as goodwill' : 'Free for the customer: under warranty'}</b>
          <span>
            {t.coverage === 'paid'
              ? `Warranty ${t.warranty_end_at_open ? `ended ${formatDate(t.warranty_end_at_open)}` : 'had not started'}. When it’s fixed, parts and labour are invoiced automatically.`
              : `Covered until ${formatDate(t.warranty_end_at_open)}. The repair or replacement costs the customer nothing; the cost is charged to the original job.`}
          </span>
        </div>
      </section>

      {t.status === 'resolved' && <Callout>Fixed {formatDateTime(t.resolved_at)}. The ticket closes only when the customer confirms everything works (they can tap a button on their customer page).</Callout>}
      {t.status === 'closed' && <Callout tone="good">Closed {formatDateTime(t.closed_at)}: the customer confirmed it works ({t.confirm_method ? CONFIRM_METHOD_LABEL[t.confirm_method].toLowerCase() : ''}).</Callout>}

      <div className="split">
        <div className="stack">
          <Panel title="The complaint">
            <div className="panel-body stack">
              <p style={{ fontSize: 17 }}>{t.description}</p>
              <KV
                items={[
                  ['Fault code', t.fault_code ? <span className="mono">{t.fault_code}</span> : null],
                  ['Unit', t.serial ? <><Link className="mono" to={`/app/serials/${t.serial_unit_id}`}>{t.serial}</Link> {t.product}</> : 'Whole system'],
                  ['Job', t.job_ref ? <Link className="mono" to={`/app/jobs/${t.job_id}`}>{t.job_ref}</Link> : null],
                  ['With', t.assigned_name ?? 'Nobody yet'],
                  ['Visits', d.visits.length ? d.visits.map((v) => `${formatDate(v.starts_at)} ${formatTime(v.starts_at)} (${v.crew.map((c) => c.name).join(', ')})`).join('; ') : null],
                  ['Reopened', t.reopen_count ? `${t.reopen_count} time${t.reopen_count === 1 ? '' : 's'}` : null],
                ]}
              />
              {t.serial && <WarrantyRuler start={t.warranty_start} end={t.warranty_end} today={today} years={t.product?.includes('panel') ? 20 : 5} label={t.product ?? undefined} />}
            </div>
          </Panel>
          {(t.resolution || d.parts.length > 0) && (
            <Panel title="What was done">
              <div className="panel-body stack">
                {t.resolution && <p>{t.resolution}</p>}
                {d.parts.length > 0 && (
                  <table className="table">
                    <tbody>
                      {d.parts.map((p) => (
                        <tr key={p.id}>
                          <td style={{ paddingLeft: 0 }}>
                            {p.name}
                            {p.new_serial && (
                              <div className="cell-sub">
                                New <span className="mono">{p.new_serial}</span>
                                {p.old_serial ? (
                                  <>
                                    {' '}
                                    replaced <span className="mono">{p.old_serial}</span>
                                  </>
                                ) : null}
                              </div>
                            )}
                          </td>
                          <td className="r num">× {p.qty}</td>
                          <td className="r" style={{ paddingRight: 0 }}>
                            <Money paise={p.unit_cost_paise === null ? null : Math.round(p.qty * p.unit_cost_paise)} />
                            <div className="cell-sub">at cost</div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                <KV
                  items={[
                    ['Labour', t.labour_hours !== null ? `${t.labour_hours} h` : null],
                    ['Cost to us', formatINR(t.parts_cost_paise + t.labour_cost_paise)],
                    ['Billed to the customer', t.invoice_id ? <Link to={`/app/money/invoices/${t.invoice_id}`}>{formatINR(t.billed_paise)} on {t.invoice_number}</Link> : formatINR(0)],
                  ]}
                />
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
          <Panel title="Customer">
            <div className="panel-body stack">
              <KV
                items={[
                  ['Phone', <a href={`tel:${t.phone}`}>{formatPhone(t.phone)}</a>],
                  ['Address', `${t.address}, ${t.city}`],
                ]}
              />
              <Link to={`/app/customers/${t.customer_id}`}>Everything about this customer</Link>
            </div>
          </Panel>
          <Panel title="Their units">
            <div className="panel-body tight" style={{ display: 'grid', gap: 6 }}>
              {d.customerSerials.map((s) => (
                <div key={s.id} className="unit-row">
                  <span>
                    <Link className="mono" to={`/app/serials/${s.id}`}>
                      {s.serial}
                    </Link>
                    <span className="muted">{s.product}</span>
                  </span>
                  <Chip tone={s.warranty_end && s.warranty_end >= today ? 'good' : 'bad'}>{s.warranty_end ? warrantyLeft(s.warranty_end, today) : '—'}</Chip>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      </div>
      {dlg === 'assign' && <AssignDialog ticketId={t.id} onClose={() => setDlg(null)} />}
      {dlg === 'visit' && <VisitDialog ticketId={t.id} techId={t.assigned_to} onClose={() => setDlg(null)} />}
      {dlg === 'resolve' && <ResolveDialog detail={d} onClose={() => setDlg(null)} />}
      {dlg === 'confirm' && <ConfirmDialog ticketId={t.id} onClose={() => setDlg(null)} />}
      {dlg === 'reopen' && <ReopenDialog ticketId={t.id} onClose={() => setDlg(null)} />}
    </div>
  );
}

function AssignDialog({ ticketId, onClose }: { ticketId: number; onClose: () => void }) {
  const techs = useQuery({ queryKey: ['technicians'], queryFn: () => api.get<{ technicians: { id: number; name: string }[] }>('/api/technicians') });
  const [tech, setTech] = useState('');
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  return (
    <Dialog open onClose={onClose} title="Assign a technician">
      <div className="field">
        <label htmlFor="as-t">Technician</label>
        <select id="as-t" className="select" value={tech} onChange={(e) => setTech(e.target.value)}>
          <option value="">Choose…</option>
          {techs.data?.technicians.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </div>
      <div className="form-actions">
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="primary"
          disabled={!tech}
          busy={busy}
          onClick={async () => {
            setBusy(true);
            await api.post(`/api/tickets/${ticketId}/assign`, { technicianId: Number(tech) }).finally(() => setBusy(false));
            void qc.invalidateQueries({ queryKey: ['ticket'] });
            onClose();
          }}
        >
          Assign
        </Button>
      </div>
    </Dialog>
  );
}

function VisitDialog({ ticketId, techId, onClose }: { ticketId: number; techId: number | null; onClose: () => void }) {
  const techs = useQuery({ queryKey: ['technicians'], queryFn: () => api.get<{ technicians: { id: number; name: string }[] }>('/api/technicians') });
  const tomorrow = new Date(Date.now() + 86_400_000);
  const p = (n: number) => String(n).padStart(2, '0');
  const day = `${tomorrow.getFullYear()}-${p(tomorrow.getMonth() + 1)}-${p(tomorrow.getDate())}`;
  const schema = visitSchema.safeExtend({ startsAt: localDateTime, endsAt: localDateTime }) as unknown as typeof visitSchema;
  const form = useZodForm(schema, { startsAt: `${day}T10:00`, endsAt: `${day}T12:00`, technicianIds: techId ? [techId] : [], notes: '' });
  const [error, setError] = useState<string | null>(null);
  const qc = useQueryClient();
  const crew = form.watch('technicianIds') as number[];
  return (
    <Dialog open onClose={onClose} title="Book a service visit">
      <form
        noValidate
        className="stack"
        onSubmit={form.handleSubmit(async (v) => {
          setError(null);
          try {
            await api.post(`/api/tickets/${ticketId}/visits`, v);
            void qc.invalidateQueries({ queryKey: ['ticket'] });
            onClose();
          } catch (e) {
            setError(applyServerError(form, e));
          }
        })}
      >
        <FormError message={error} />
        <div className="form-grid">
          <div className="field">
            <label htmlFor="sv-s">Starts</label>
            <input id="sv-s" type="datetime-local" className="input" {...form.register('startsAt')} />
          </div>
          <div className="field">
            <label htmlFor="sv-e">Ends</label>
            <input id="sv-e" type="datetime-local" className="input" {...form.register('endsAt')} />
          </div>
        </div>
        <div className="choice-grid">
          {techs.data?.technicians.map((t) => (
            <label key={t.id} className="check">
              <input type="checkbox" checked={crew.includes(t.id)} onChange={(e) => form.setValue('technicianIds', (e.target.checked ? [...crew, t.id] : crew.filter((x) => x !== t.id)) as never)} />
              {t.name}
            </label>
          ))}
        </div>
        <div className="form-actions">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" busy={form.formState.isSubmitting}>
            Book visit
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

interface PartLine {
  key: number;
  productId: string;
  qty: string;
  replaces: string;
  newSerial: string;
}

function ResolveDialog({ detail, onClose }: { detail: Detail; onClose: () => void }) {
  const t = detail.ticket;
  const { me } = useSession();
  const products = useQuery({ queryKey: ['products'], queryFn: () => api.get<{ products: { id: number; sku: string; name: string; tracking: string; sale_price_paise: number; on_hand: number }[] }>('/api/products') });
  const [resolution, setResolution] = useState('');
  const [labour, setLabour] = useState('1');
  const [coverage, setCoverage] = useState<Coverage>(t.coverage);
  const [parts, setParts] = useState<PartLine[]>(
    t.serial_unit_id && t.product_id ? [{ key: 1, productId: String(t.product_id), qty: '1', replaces: String(t.serial_unit_id), newSerial: '' }] : [],
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  const toast = useToast();
  const stocked = (products.data?.products ?? []).filter((p) => p.tracking !== 'none');
  const set = (i: number, patch: Partial<PartLine>) => setParts((ps) => ps.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const submit = async () => {
    setBusy(true);
    setError(null);
    setErrors({});
    try {
      const r = await api.post<{ coverage: Coverage; billedPaise: number; invoiceNumber: string | null }>(`/api/tickets/${t.id}/resolve`, {
        resolution,
        labourHours: Number(labour),
        coverage: coverage !== t.coverage ? coverage : undefined,
        parts: parts.map((p) => ({
          productId: Number(p.productId) || undefined,
          qty: Number(p.qty) || undefined,
          replacesSerialUnitId: p.replaces ? Number(p.replaces) : undefined,
          newSerial: p.newSerial || undefined,
        })),
      });
      toast(r.billedPaise ? `Fixed. Invoice ${r.invoiceNumber} for ${formatINR(r.billedPaise)} sent to the customer.` : 'Fixed, at no cost to the customer. Waiting for them to confirm.');
      void qc.invalidateQueries({ queryKey: ['ticket'] });
      onClose();
    } catch (e) {
      if (e instanceof ApiError) {
        setErrors(e.fields ?? {});
        setError(e.message);
      }
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onClose={onClose} wide title="Mark it fixed" description={coverage === 'paid' ? 'Out of warranty: the parts below and the labour hours are invoiced automatically.' : 'Covered: nothing is billed. Parts and hours are charged to the original job so its profit stays honest.'}>
      {error && <div className="form-error">{error}</div>}
      <div className="field">
        <label htmlFor="rs-what">What was done</label>
        <textarea id="rs-what" className="textarea" rows={3} value={resolution} onChange={(e) => setResolution(e.target.value)} aria-invalid={!!errors.resolution} />
        {errors.resolution && <span className="field-error">{errors.resolution}</span>}
      </div>
      <div style={{ display: 'grid', gap: 10 }}>
        <span className="field-label">Parts used</span>
        {parts.map((p, i) => {
          const prod = stocked.find((x) => String(x.id) === p.productId);
          return (
            <div key={p.key} className="panel" style={{ padding: 12, display: 'grid', gap: 8 }}>
              <div className="form-grid cols-3" style={{ alignItems: 'end' }}>
                <div className="field">
                  <label htmlFor={`pp${i}`}>Part</label>
                  <select id={`pp${i}`} className="select" value={p.productId} onChange={(e) => set(i, { productId: e.target.value })}>
                    <option value="">Choose…</option>
                    {stocked.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name} ({x.on_hand} in stock)
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor={`pq${i}`}>Qty</label>
                  <input id={`pq${i}`} className="input num" inputMode="decimal" value={p.qty} onChange={(e) => set(i, { qty: e.target.value })} disabled={prod?.tracking === 'serial'} />
                </div>
                <Button variant="ghost" size="sm" icon={<Trash size={16} />} onClick={() => setParts((ps) => ps.filter((_, j) => j !== i))}>
                  Remove
                </Button>
              </div>
              {prod?.tracking === 'serial' && (
                <div className="form-grid">
                  <div className="field">
                    <label htmlFor={`pr${i}`}>Replaces</label>
                    <select id={`pr${i}`} className="select" value={p.replaces} onChange={(e) => set(i, { replaces: e.target.value })}>
                      <option value="">Nothing (an extra unit)</option>
                      {detail.customerSerials
                        .filter((s) => String(s.product_id) === p.productId)
                        .map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.serial}
                          </option>
                        ))}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor={`pn${i}`}>
                      <Barcode size={14} /> Serial of the new unit
                    </label>
                    <input id={`pn${i}`} className="input mono" value={p.newSerial} onChange={(e) => set(i, { newSerial: e.target.value.toUpperCase() })} aria-invalid={!!errors[`parts.${i}.newSerial`]} placeholder="Scan or type" />
                    {errors[`parts.${i}.newSerial`] && <span className="field-error">{errors[`parts.${i}.newSerial`]}</span>}
                    {p.replaces && coverage === 'warranty' && <span className="field-hint">The new unit keeps the original warranty end date.</span>}
                  </div>
                </div>
              )}
            </div>
          );
        })}
        <Button size="sm" icon={<Plus size={16} />} onClick={() => setParts((ps) => [...ps, { key: Date.now(), productId: '', qty: '1', replaces: '', newSerial: '' }])}>
          Add a part
        </Button>
      </div>
      <div className="form-grid">
        <div className="field">
          <label htmlFor="rs-h">Labour hours</label>
          <input id="rs-h" className="input num" inputMode="decimal" value={labour} onChange={(e) => setLabour(e.target.value)} aria-invalid={!!errors.labourHours} />
          {errors.labourHours && <span className="field-error">{errors.labourHours}</span>}
        </div>
        {me?.role === 'owner' && (
          <div className="field">
            <label htmlFor="rs-c">Who pays</label>
            <select id="rs-c" className="select" value={coverage} onChange={(e) => setCoverage(e.target.value as Coverage)}>
              {(['warranty', 'paid', 'goodwill'] as Coverage[]).map((c) => (
                <option key={c} value={c}>
                  {COVERAGE_LABEL[c]}
                </option>
              ))}
            </select>
            <span className="field-hint">Only the director can change this.</span>
          </div>
        )}
      </div>
      <div className="form-actions">
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" busy={busy} onClick={submit}>
          {coverage === 'paid' ? 'Mark fixed and bill' : 'Mark fixed'}
        </Button>
      </div>
    </Dialog>
  );
}

function ConfirmDialog({ ticketId, onClose }: { ticketId: number; onClose: () => void }) {
  const [method, setMethod] = useState<(typeof CONFIRM_METHODS)[number]>('phone');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  return (
    <Dialog open onClose={onClose} title="The customer confirmed it works" description="This closes the ticket.">
      <div className="field">
        <label htmlFor="cf-m">How they confirmed</label>
        <select id="cf-m" className="select" value={method} onChange={(e) => setMethod(e.target.value as never)}>
          {CONFIRM_METHODS.filter((m) => m !== 'portal').map((m) => (
            <option key={m} value={m}>
              {CONFIRM_METHOD_LABEL[m]}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="cf-n">
          Note <span className="opt">(optional)</span>
        </label>
        <input id="cf-n" className="input" value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      <div className="form-actions">
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="primary"
          busy={busy}
          onClick={async () => {
            setBusy(true);
            await api.post(`/api/tickets/${ticketId}/confirm`, { method, note: note || undefined }).finally(() => setBusy(false));
            void qc.invalidateQueries({ queryKey: ['ticket'] });
            onClose();
          }}
        >
          Close the ticket
        </Button>
      </div>
    </Dialog>
  );
}

function ReopenDialog({ ticketId, onClose }: { ticketId: number; onClose: () => void }) {
  const form = useZodForm(ticketReopenSchema, { reason: '' });
  const [error, setError] = useState<string | null>(null);
  const qc = useQueryClient();
  return (
    <Dialog open onClose={onClose} title="It’s still not working">
      <form
        noValidate
        className="stack"
        onSubmit={form.handleSubmit(async (v) => {
          setError(null);
          try {
            await api.post(`/api/tickets/${ticketId}/reopen`, v);
            void qc.invalidateQueries({ queryKey: ['ticket'] });
            onClose();
          } catch (e) {
            setError(applyServerError(form, e));
          }
        })}
      >
        <FormError message={error} />
        <TextArea form={form as never} name="reason" label="What’s still wrong" rows={3} />
        <div className="form-actions">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" busy={form.formState.isSubmitting}>
            Reopen
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
