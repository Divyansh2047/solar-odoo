import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Plus, Copy } from '@phosphor-icons/react';
import {
  CUSTOMER_KINDS,
  LEAD_SOURCE_LABEL,
  LEAD_SOURCES,
  LEAD_STATUS_LABEL,
  SYSTEM_TYPE_LABEL,
  formatKw,
  formatPhone,
  leadCreateSchema,
  relativeTime,
  type LeadStatus,
} from '@arka/shared';
import { api, qs } from '../../lib/api';
import { useSession } from '../../lib/session';
import { Button, Chip, Empty, ErrorBlock, PageHead, Panel, Seg, SkeletonRows, type Tone } from '../../components/ui';
import { DataTable } from '../../components/table';
import { Dialog, useToast } from '../../components/overlay';
import { applyServerError, CheckField, FormError, SelectField, TextArea, TextField, useZodForm } from '../../components/form';

interface LeadRow {
  id: number;
  ref: string;
  status: LeadStatus;
  source: keyof typeof LEAD_SOURCE_LABEL;
  system_type: keyof typeof SYSTEM_TYPE_LABEL;
  requested_kw: number | null;
  recommended_kw: number | null;
  wants_subsidy: boolean;
  created_at: string;
  first_contact_at: string | null;
  name: string;
  phone: string;
  city: string;
  assigned_name: string | null;
  overdue: boolean;
  survey_status: string | null;
  quote_status: string | null;
  lost_reason: string | null;
}

export const LEAD_TONE: Record<LeadStatus, Tone> = { new: 'warn', contacted: 'info', qualified: 'info', survey: 'info', quoted: 'sun', won: 'good', lost: 'neutral' };

function nextStep(l: LeadRow): string {
  switch (l.status) {
    case 'new':
      return 'Call and check the basics';
    case 'contacted':
      return 'Record roof space, bill and grid';
    case 'qualified':
      return 'Book a roof survey';
    case 'survey':
      return l.survey_status === 'submitted' ? 'Approve the survey' : l.survey_status === 'approved' ? 'Make the quote' : 'Survey booked';
    case 'quoted':
      return l.quote_status === 'draft' ? 'Send the quote' : 'Waiting for the customer';
    case 'won':
      return 'Now a job';
    default:
      return '—';
  }
}

export default function Enquiries() {
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? 'open';
  const [q, setQ] = useState(params.get('q') ?? '');
  const [source, setSource] = useState('all');
  const [mine, setMine] = useState(false);
  const [logOpen, setLogOpen] = useState(params.get('new') === '1');
  const { can } = useSession();
  useEffect(() => {
    document.title = 'Enquiries · Arka';
  }, []);
  const list = useQuery({
    queryKey: ['leads', status, source, q, mine],
    queryFn: () => api.get<{ leads: LeadRow[]; counts: Record<string, number> }>(`/api/leads${qs({ status: status === 'open' ? 'all' : status, source, q: q.trim().length >= 2 ? q.trim() : null, mine: mine ? 1 : null })}`),
    placeholderData: (prev) => prev,
  });
  const rows = (list.data?.leads ?? []).filter((l) => (status === 'open' ? !['won', 'lost'].includes(l.status) : true));
  const c = list.data?.counts ?? {};
  const openCount = ['new', 'contacted', 'qualified', 'survey', 'quoted'].reduce((s, k) => s + (c[k] ?? 0), 0);
  return (
    <div className="page">
      <PageHead
        title="Who asked for solar, and what happens next?"
        lead="Web form, WhatsApp and phone enquiries land here. Nothing is ever deleted: closing one needs a reason."
        actions={
          can('leads.write') && (
            <>
              <WebFormLink />
              <Button variant="primary" icon={<Plus size={18} />} onClick={() => setLogOpen(true)}>
                Log an enquiry
              </Button>
            </>
          )
        }
      />
      <div className="toolbar">
        <Seg
          label="Status"
          value={status}
          onChange={(v) => setParams(v === 'open' ? {} : { status: v })}
          options={[
            { value: 'open', label: 'Open', count: openCount },
            { value: 'new', label: 'New', count: c.new ?? 0 },
            { value: 'quoted', label: 'Quoted', count: c.quoted ?? 0 },
            { value: 'won', label: 'Won', count: c.won ?? 0 },
            { value: 'lost', label: 'Closed', count: c.lost ?? 0 },
          ]}
        />
        <input className="input" type="search" placeholder="Name, phone, city or ENQ-…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search enquiries" />
        <select className="select" style={{ width: 'auto' }} value={source} onChange={(e) => setSource(e.target.value)} aria-label="Source">
          <option value="all">All sources</option>
          {LEAD_SOURCES.map((s) => (
            <option key={s} value={s}>
              {LEAD_SOURCE_LABEL[s]}
            </option>
          ))}
        </select>
        <label className="row" style={{ gap: 6, fontWeight: 600 }}>
          <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Assigned to me
        </label>
      </div>
      <Panel>
        {list.isLoading ? (
          <SkeletonRows />
        ) : list.isError ? (
          <ErrorBlock error={list.error} retry={() => list.refetch()} />
        ) : (
          <DataTable
            rows={rows}
            rowKey={(r) => r.id}
            to={(r) => `/app/enquiries/${r.id}`}
            rowTone={(r) => (r.overdue ? 'hot' : undefined)}
            caption="Enquiries"
            empty={<Empty title={q ? 'No enquiry matches that search' : 'No enquiries here'}>{q ? 'Try part of the phone number.' : 'New web-form enquiries appear the moment they arrive.'}</Empty>}
            columns={[
              {
                header: 'Customer',
                cell: (r) => (
                  <>
                    <span className="cell-main">{r.name}</span>
                    <div className="cell-sub">
                      {r.city}, {formatPhone(r.phone)}
                    </div>
                  </>
                ),
              },
              {
                header: 'Needs',
                cell: (r) => (
                  <>
                    {r.requested_kw ? formatKw(r.requested_kw) : <span className="muted">Size not given</span>}
                    <div className="cell-sub">
                      {SYSTEM_TYPE_LABEL[r.system_type]}
                      {r.wants_subsidy ? ', subsidy' : ''}
                    </div>
                  </>
                ),
              },
              { header: 'Came in by', cell: (r) => LEAD_SOURCE_LABEL[r.source] },
              { header: 'Stage', cell: (r) => <Chip tone={LEAD_TONE[r.status]}>{LEAD_STATUS_LABEL[r.status]}</Chip> },
              { header: 'Next step', cell: (r) => <span className={r.overdue ? '' : 'muted'}>{r.overdue ? <b style={{ color: 'var(--bad)' }}>Call now: waiting too long</b> : nextStep(r)}</span> },
              { header: 'Owner', cell: (r) => r.assigned_name ?? <span className="muted">Unassigned</span> },
              { header: 'Arrived', className: 'r nowrap', cell: (r) => <span className="num">{relativeTime(r.created_at)}</span> },
            ]}
            card={(r) => ({
              title: r.name,
              right: <Chip tone={LEAD_TONE[r.status]}>{LEAD_STATUS_LABEL[r.status]}</Chip>,
              meta: [r.city, r.requested_kw ? formatKw(r.requested_kw) : null, LEAD_SOURCE_LABEL[r.source], relativeTime(r.created_at)].filter(Boolean) as string[],
              extra: r.overdue ? <b style={{ color: 'var(--bad)', fontSize: 13 }}>Call now: waiting too long</b> : <span className="muted" style={{ fontSize: 13 }}>{nextStep(r)}</span>,
            })}
          />
        )}
      </Panel>
      <LogEnquiry open={logOpen} onClose={() => setLogOpen(false)} />
    </div>
  );
}

function WebFormLink() {
  const nav = useQuery({ queryKey: ['nav'], queryFn: () => api.get<{ public_key: string }>('/api/nav') });
  const toast = useToast();
  if (!nav.data?.public_key) return null;
  const url = `${location.origin}/enquire/${nav.data.public_key}`;
  return (
    <Button
      icon={<Copy size={18} />}
      onClick={async () => {
        await navigator.clipboard?.writeText(url).catch(() => {});
        toast(
          <>
            Copied your website enquiry form link. <a href={url} target="_blank" rel="noreferrer" style={{ color: 'var(--sun)' }}>Open it</a>
          </>,
        );
      }}
    >
      Copy web form link
    </Button>
  );
}

export function LogEnquiry({ open, onClose }: { open: boolean; onClose: () => void }) {
  const form = useZodForm(leadCreateSchema, {
    source: 'whatsapp',
    name: '',
    phone: '',
    email: '',
    address: '',
    city: 'Ahmedabad',
    pincode: '',
    customerKind: 'home',
    systemType: 'on_grid',
    requestedKw: '' as never,
    wantsSubsidy: true,
    monthlyBillRupees: '' as never,
    message: '',
  });
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const nav = useNavigate();
  useEffect(() => {
    if (open) setError(null);
  }, [open]);
  return (
    <Dialog open={open} onClose={onClose} wide title="Log an enquiry" description="For enquiries that came in on WhatsApp, a call or at the office. If this phone number already has an open enquiry, the new message is added to it instead.">
      <form
        noValidate
        className="stack"
        onSubmit={form.handleSubmit(async (v) => {
          setError(null);
          try {
            const r = await api.post<{ id: number; ref: string; merged: boolean }>('/api/leads', v);
            toast(r.merged ? `Added to ${r.ref}, the customer’s open enquiry.` : `Enquiry ${r.ref} logged.`);
            form.reset();
            onClose();
            nav(`/app/enquiries/${r.id}`);
          } catch (e) {
            setError(applyServerError(form, e));
          }
        })}
      >
        <FormError message={error} />
        <div className="form-grid">
          <SelectField form={form as never} name="source" label="Came in by" options={LEAD_SOURCES.filter((s) => s !== 'web_form').map((s) => ({ value: s, label: LEAD_SOURCE_LABEL[s] }))} />
          <SelectField form={form as never} name="customerKind" label="For a" options={CUSTOMER_KINDS.map((k) => ({ value: k, label: k === 'home' ? 'Home' : 'Business' }))} />
          <TextField form={form as never} name="name" label="Customer name" autoComplete="off" />
          <TextField form={form as never} name="phone" label="Mobile" type="tel" inputMode="tel" prefix="+91" placeholder="98250 12345" />
          <TextField form={form as never} name="address" label="Address" className="span-2" placeholder="House number, society, area" />
          <TextField form={form as never} name="city" label="City" />
          <TextField form={form as never} name="pincode" label="PIN code" inputMode="numeric" maxLength={6} />
          <SelectField form={form as never} name="systemType" label="System" options={[{ value: 'on_grid', label: 'On-Grid' }, { value: 'off_grid', label: 'Off-Grid (with battery)' }, { value: 'not_sure', label: 'Not sure yet' }]} />
          <TextField form={form as never} name="requestedKw" label="Size asked for" optional inputMode="decimal" suffix="kW" />
          <TextField form={form as never} name="monthlyBillRupees" label="Monthly electricity bill" optional inputMode="numeric" prefix="₹" />
          <TextField form={form as never} name="email" label="Email" optional type="email" />
          <TextArea form={form as never} name="message" label="What they said" optional className="span-2" rows={3} placeholder="Paste the WhatsApp message or note the call" />
          <CheckField form={form as never} name="wantsSubsidy" label="Wants the PM Surya Ghar subsidy" className="span-2" />
        </div>
        <div className="form-actions">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" busy={form.formState.isSubmitting}>
            Log enquiry
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

