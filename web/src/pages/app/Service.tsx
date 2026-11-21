import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { MagnifyingGlass, Plus, Lightning } from '@phosphor-icons/react';
import {
  COVERAGE_LABEL,
  TICKET_CHANNELS,
  TICKET_CHANNEL_LABEL,
  TICKET_PRIORITIES,
  TICKET_PRIORITY_LABEL,
  TICKET_STATUS_LABEL,
  formatDate,
  formatPhone,
  relativeTime,
  ticketCreateSchema,
  warrantyLeft,
  type Coverage,
  type TicketStatus,
} from '@arka/shared';
import { api } from '../../lib/api';
import { useSession } from '../../lib/session';
import { Button, Callout, Chip, Empty, ErrorBlock, PageHead, Panel, Seg, SkeletonRows, type Tone } from '../../components/ui';
import { DataTable } from '../../components/table';
import { Dialog, useToast } from '../../components/overlay';
import { applyServerError, FormError, SelectField, TextArea, TextField, useZodForm } from '../../components/form';

export const TICKET_TONE: Record<TicketStatus, Tone> = { open: 'bad', assigned: 'warn', in_progress: 'info', resolved: 'sun', closed: 'neutral' };
export const COVERAGE_TONE: Record<Coverage, Tone> = { warranty: 'good', goodwill: 'good', paid: 'warn' };

interface TicketRow {
  id: number;
  ref: string;
  status: TicketStatus;
  priority: keyof typeof TICKET_PRIORITY_LABEL;
  coverage: Coverage;
  fault_code: string | null;
  description: string;
  created_at: string;
  customer: string;
  city: string;
  serial: string | null;
  product: string | null;
  assigned_name: string | null;
}

interface SearchResult {
  customers: { id: number; name: string; phone: string; city: string; jobs: number; open_tickets: number }[];
  serials: { id: number; serial: string; product: string; category: string; customer: string | null; customer_id: number | null; phone: string | null; covered: boolean | null; warranty_end: string | null; job_ref: string | null; job_id: number | null; status: string }[];
  ms: number;
}

export default function Service() {
  const { can, me } = useSession();
  const [term, setTerm] = useState('');
  const [filter, setFilter] = useState('open');
  const [create, setCreate] = useState<{ customerId: number; customer: string; serialUnitId?: number } | null>(null);
  useEffect(() => {
    document.title = 'Service · Arka';
  }, []);
  const t = term.trim();
  const search = useQuery({ queryKey: ['search', t], queryFn: () => api.get<SearchResult>(`/api/search?q=${encodeURIComponent(t)}`), enabled: t.length >= 2, staleTime: 10_000 });
  const tickets = useQuery({ queryKey: ['tickets', filter], queryFn: () => api.get<{ tickets: TicketRow[] }>(`/api/tickets${filter === 'open' ? '?open=1' : filter === 'all' ? '' : `?status=${filter}`}`) });
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: me?.timezone ?? 'Asia/Kolkata' }).format(new Date());
  return (
    <div className="page">
      <PageHead title="Service" lead="Complaints, repairs and warranty cover." />
      {can('customers.read') && (
        <Panel>
          <div className="panel-body stack">
            <label htmlFor="svc-search" className="field-label">
              Find the customer or the unit
            </label>
            <div className="scan-input">
              <span className="scan-field">
                <MagnifyingGlass size={22} aria-hidden />
                <input
                  id="svc-search"
                  className="input"
                  value={term}
                  onChange={(e) => setTerm(e.target.value)}
                  placeholder="Serial, phone or name"
                  autoComplete="off"
                  spellCheck={false}
                  autoFocus
                />
              </span>
            </div>
            <span className="field-hint">The last 4 digits of a serial are enough.</span>
            {t.length >= 2 && search.data && (
              <div aria-live="polite" style={{ display: 'grid', gap: 10 }}>
                <span className="muted" style={{ fontSize: 13 }}>
                  Found in {search.data.ms} ms
                </span>
                {search.data.serials.map((s) => (
                  <div key={s.id} className="unit" style={{ borderColor: s.covered ? 'color-mix(in srgb, var(--good) 45%, var(--line))' : s.covered === false ? 'color-mix(in srgb, var(--bad) 45%, var(--line))' : undefined }}>
                    <div className="unit-top">
                      <span>
                        <Link className="mono" to={`/app/serials/${s.id}`} style={{ fontSize: 18, fontWeight: 800 }}>
                          {s.serial}
                        </Link>{' '}
                        <span className="muted">{s.product}</span>
                      </span>
                      {s.warranty_end ? (
                        <Chip tone={s.covered ? 'good' : 'bad'}>{s.covered ? `Under warranty: ${warrantyLeft(s.warranty_end, today)}` : `Out of warranty since ${formatDate(s.warranty_end)}`}</Chip>
                      ) : (
                        <Chip>{s.status.replace('_', ' ')}</Chip>
                      )}
                    </div>
                    {s.customer && (
                      <div className="row between">
                        <span>
                          <b>{s.customer}</b> <span className="muted">{s.phone ? formatPhone(s.phone) : ''}</span>{' '}
                          {s.job_id && (
                            <Link to={`/app/jobs/${s.job_id}`} className="mono">
                              {s.job_ref}
                            </Link>
                          )}
                        </span>
                        {can('tickets.write') && s.customer_id && (
                          <Button variant="primary" icon={<Plus size={16} />} onClick={() => setCreate({ customerId: s.customer_id!, customer: s.customer!, serialUnitId: s.id })}>
                            Open a complaint
                          </Button>
                        )}
                      </div>
                    )}
                    {s.customer && <p className="muted" style={{ fontSize: 14 }}>{s.covered ? 'A repair or replacement costs the customer nothing.' : s.covered === false ? 'Parts and labour will be billed automatically when the repair is done.' : ''}</p>}
                  </div>
                ))}
                {search.data.customers.map((c) => (
                  <div key={c.id} className="unit">
                    <div className="unit-top">
                      <span>
                        <Link to={`/app/customers/${c.id}`} style={{ fontWeight: 800 }}>
                          {c.name}
                        </Link>{' '}
                        <span className="muted">
                          {formatPhone(c.phone)}, {c.city}
                        </span>
                      </span>
                      <span className="row">
                        {c.open_tickets > 0 && <Chip tone="warn">{c.open_tickets} open</Chip>}
                        {can('tickets.write') && (
                          <Button size="sm" icon={<Plus size={14} />} onClick={() => setCreate({ customerId: c.id, customer: c.name })}>
                            Complaint
                          </Button>
                        )}
                      </span>
                    </div>
                  </div>
                ))}
                {!search.data.serials.length && !search.data.customers.length && <p className="muted">Nothing matches “{t}”. Try fewer characters of the serial, or the phone number.</p>}
              </div>
            )}
          </div>
        </Panel>
      )}
      <div className="toolbar">
        <Seg
          label="Show"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'open', label: 'Open' },
            { value: 'resolved', label: 'Waiting for customer' },
            { value: 'closed', label: 'Closed' },
            { value: 'all', label: 'All' },
          ]}
        />
      </div>
      <Panel>
        {tickets.isLoading ? (
          <SkeletonRows />
        ) : tickets.isError ? (
          <ErrorBlock error={tickets.error} retry={() => tickets.refetch()} />
        ) : (
          <DataTable
            rows={tickets.data!.tickets}
            rowKey={(r) => r.id}
            to={(r) => `/app/service/${r.id}`}
            rowTone={(r) => (r.priority === 'urgent' && r.status !== 'closed' ? 'hot' : undefined)}
            empty={<Empty title="No complaints here">When a customer calls, find them above and open a complaint.</Empty>}
            columns={[
              { header: 'Customer', cell: (r) => (<><span className="cell-main">{r.customer}</span><div className="cell-sub">{r.city}</div></>) },
              {
                header: 'Problem',
                cell: (r) => (
                  <>
                    {r.priority === 'urgent' && <Lightning size={14} weight="fill" color="var(--bad)" aria-label="Urgent" style={{ display: 'inline', verticalAlign: '-2px', marginRight: 4 }} />}
                    {r.description.slice(0, 70)}
                    {r.description.length > 70 ? '…' : ''}
                    <div className="cell-sub">
                      {r.fault_code ? `Fault ${r.fault_code}, ` : ''}
                      {r.product ? <span className="mono">{r.serial}</span> : 'No unit selected'}
                    </div>
                  </>
                ),
              },
              { header: 'Who pays', cell: (r) => <Chip tone={COVERAGE_TONE[r.coverage]}>{COVERAGE_LABEL[r.coverage]}</Chip> },
              { header: 'Status', cell: (r) => <Chip tone={TICKET_TONE[r.status]}>{TICKET_STATUS_LABEL[r.status]}</Chip> },
              { header: 'With', cell: (r) => r.assigned_name ?? <span className="muted">Unassigned</span> },
              { header: 'Opened', className: 'r nowrap', cell: (r) => relativeTime(r.created_at) },
            ]}
            card={(r) => ({ title: r.customer, right: <Chip tone={TICKET_TONE[r.status]}>{TICKET_STATUS_LABEL[r.status]}</Chip>, meta: [r.ref, COVERAGE_LABEL[r.coverage], relativeTime(r.created_at)], extra: <span style={{ fontSize: 14 }}>{r.description.slice(0, 90)}</span> })}
          />
        )}
      </Panel>
      {create && <NewTicket {...create} onClose={() => setCreate(null)} />}
    </div>
  );
}

export function NewTicket({ customerId, customer, serialUnitId, onClose }: { customerId: number; customer: string; serialUnitId?: number; onClose: () => void }) {
  const units = useQuery({ queryKey: ['customer', customerId], queryFn: () => api.get<{ serials: { id: number; serial: string; product: string; category: string; status: string; warranty_end: string | null }[] }>(`/api/customers/${customerId}`) });
  const form = useZodForm(ticketCreateSchema, { customerId, serialUnitId: (serialUnitId ?? '') as never, channel: 'call', faultCode: '', description: '', priority: 'normal' });
  const sid = form.watch('serialUnitId');
  const cov = useQuery({
    queryKey: ['coverage', customerId, sid],
    queryFn: () => api.get<{ coverage: Coverage; warrantyEnd: string | null }>(`/api/coverage?customerId=${customerId}${sid ? `&serialUnitId=${sid}` : ''}`),
  });
  const [error, setError] = useState<string | null>(null);
  const nav = useNavigate();
  const toast = useToast();
  const installed = (units.data?.serials ?? []).filter((s) => s.status === 'installed');
  return (
    <Dialog open onClose={onClose} title={`Complaint from ${customer}`} description="Coverage is decided now, from the unit’s warranty on today’s date.">
      <form
        noValidate
        className="stack"
        onSubmit={form.handleSubmit(async (v) => {
          setError(null);
          try {
            const r = await api.post<{ id: number; ref: string; coverage: Coverage }>('/api/tickets', v);
            toast(`${r.ref} opened. ${r.coverage === 'warranty' ? 'Covered: the customer pays nothing.' : 'Not covered: parts and labour will be billed.'}`);
            nav(`/app/service/${r.id}`);
          } catch (e) {
            setError(applyServerError(form, e));
          }
        })}
      >
        <FormError message={error} />
        <SelectField
          form={form as never}
          name="serialUnitId"
          label="Which unit?"
          placeholder="Not sure / the whole system"
          options={installed.map((s) => ({ value: s.id, label: `${s.product}: ${s.serial}` }))}
        />
        {cov.data && (
          <Callout tone={cov.data.coverage === 'warranty' ? 'good' : 'warn'}>
            {cov.data.coverage === 'warranty'
              ? `Under warranty${cov.data.warrantyEnd ? ` until ${formatDate(cov.data.warrantyEnd)}` : ''}. The repair or replacement costs the customer nothing.`
              : `Out of warranty${cov.data.warrantyEnd ? ` since ${formatDate(cov.data.warrantyEnd)}` : ''}. Parts and labour will be billed automatically.`}
          </Callout>
        )}
        <div className="form-grid">
          <SelectField form={form as never} name="channel" label="They contacted us by" options={TICKET_CHANNELS.map((c) => ({ value: c, label: TICKET_CHANNEL_LABEL[c] }))} />
          <SelectField form={form as never} name="priority" label="Priority" options={TICKET_PRIORITIES.map((p) => ({ value: p, label: TICKET_PRIORITY_LABEL[p] }))} />
          <TextField form={form as never} name="faultCode" label="Fault code on the display" optional className="mono" placeholder="E-021" />
        </div>
        <TextArea form={form as never} name="description" label="What’s wrong" rows={3} placeholder="e.g. zero power since the rain, inverter shows E-021" />
        <div className="form-actions">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" busy={form.formState.isSubmitting}>
            Open complaint
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
