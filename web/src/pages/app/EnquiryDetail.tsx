import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Phone, WhatsappLogo, MapPin, XCircle, ArrowCounterClockwise } from '@phosphor-icons/react';
import {
  GRID_LABEL,
  LEAD_CLOSE_LABEL,
  LEAD_CLOSE_REASONS,
  LEAD_SOURCE_LABEL,
  LEAD_STATUS_LABEL,
  QUOTE_STATUS_LABEL,
  ROOF_LABEL,
  SHADING_LABEL,
  SURVEY_STATUS_LABEL,
  SYSTEM_TYPE_LABEL,
  activitySchema,
  formatDate,
  formatDateTime,
  formatINR,
  formatKw,
  formatPhone,
  leadCloseSchema,
  qualificationSchema,
  recommendSize,
  relativeTime,
  surveyScheduleSchema,
  subsidyFor,
  localDateTime,
  type LeadStatus,
} from '@arka/shared';
import { api } from '../../lib/api';
import { useSession } from '../../lib/session';
import { Button, Callout, Chip, ErrorBlock, KV, Money, PageHead, Panel, SkeletonRows } from '../../components/ui';
import { Timeline, type ActivityItem } from '../../components/timeline';
import { Dialog, useToast } from '../../components/overlay';
import { applyServerError, ChoiceField, FormError, SelectField, TextArea, TextField, useZodForm } from '../../components/form';
import { LEAD_TONE } from './Enquiries';

interface Lead {
  id: number;
  ref: string;
  status: LeadStatus;
  source: keyof typeof LEAD_SOURCE_LABEL;
  system_type: keyof typeof SYSTEM_TYPE_LABEL;
  requested_kw: number | null;
  recommended_kw: number | null;
  wants_subsidy: boolean;
  message: string | null;
  customer_id: number;
  name: string;
  phone: string;
  email: string | null;
  address: string;
  city: string;
  pincode: string;
  customer_kind: 'home' | 'business';
  assigned_to: number | null;
  assigned_name: string | null;
  first_contact_at: string | null;
  created_at: string;
  roof_area_sqft: number | null;
  monthly_bill_paise: number | null;
  grid_connection: keyof typeof GRID_LABEL | null;
  sanctioned_load_kw: number | null;
  grid_suitable: boolean | null;
  roof_type: keyof typeof ROOF_LABEL | null;
  shading: keyof typeof SHADING_LABEL | null;
  lost_reason: keyof typeof LEAD_CLOSE_LABEL | null;
  lost_note: string | null;
  sla_first_call_minutes: number;
}

interface Detail {
  lead: Lead;
  sizing: ReturnType<typeof recommendSize> | null;
  activities: ActivityItem[];
  surveys: { id: number; ref: string; status: keyof typeof SURVEY_STATUS_LABEL; recommended_kw: number | null; cable_distance_m: number | null; starts_at: string | null; technician: string }[];
  quotes: { id: number; ref: string; version: number; status: keyof typeof QUOTE_STATUS_LABEL; total_paise: number; capacity_kw: number; kind: string }[];
  jobs: { id: number; ref: string; status: string }[];
  otherEnquiries: { id: number; ref: string; status: LeadStatus; created_at: string }[];
}

export default function EnquiryDetail() {
  const { id } = useParams();
  const q = useQuery({ queryKey: ['lead', id], queryFn: () => api.get<Detail>(`/api/leads/${id}`) });
  const { can } = useSession();
  const [closing, setClosing] = useState(false);
  const qc = useQueryClient();
  const toast = useToast();
  useEffect(() => {
    if (q.data) document.title = `${q.data.lead.ref} ${q.data.lead.name} · Arka`;
  }, [q.data]);
  if (q.isLoading) return <div className="page"><SkeletonRows rows={8} /></div>;
  if (q.isError) return <div className="page"><ErrorBlock error={q.error} retry={() => q.refetch()} /></div>;
  const d = q.data!;
  const l = d.lead;
  const overdue = l.status === 'new' && !l.first_contact_at && Date.now() - new Date(l.created_at).getTime() > l.sla_first_call_minutes * 60_000;
  const writable = can('leads.write');
  return (
    <div className="page">
      <PageHead
        back={{ to: '/app/enquiries', label: 'Enquiries' }}
        title={l.name}
        actions={
          <>
            <a className="btn" href={`tel:${l.phone}`}>
              <Phone size={18} /> Call
            </a>
            <a className="btn" href={`https://wa.me/${l.phone.replace('+', '')}`} target="_blank" rel="noreferrer">
              <WhatsappLogo size={18} /> WhatsApp
            </a>
            {writable && l.status !== 'lost' && l.status !== 'won' && (
              <Button variant="ghost" icon={<XCircle size={18} />} onClick={() => setClosing(true)}>
                Close enquiry
              </Button>
            )}
            {writable && nextLabel(d) && (
              <a className="btn btn-primary" href="#next-step" onClick={() => setTimeout(() => document.getElementById('next-step')?.querySelector<HTMLElement>('input, select, textarea, a.btn, button')?.focus(), 50)}>
                {nextLabel(d)}
              </a>
            )}
            {writable && l.status === 'lost' && (
              <Button
                icon={<ArrowCounterClockwise size={18} />}
                onClick={async () => {
                  await api.post(`/api/leads/${l.id}/reopen`);
                  toast('Enquiry reopened.');
                  void qc.invalidateQueries({ queryKey: ['lead', id] });
                }}
              >
                Reopen
              </Button>
            )}
          </>
        }
      >
        <div className="row" style={{ marginTop: 8 }}>
          <span className="mono muted">{l.ref}</span>
          <Chip tone={LEAD_TONE[l.status]}>{LEAD_STATUS_LABEL[l.status]}</Chip>
          <span className="muted">
            via {LEAD_SOURCE_LABEL[l.source]}, {relativeTime(l.created_at)}
          </span>
        </div>
      </PageHead>
      {overdue && <Callout tone="bad">Nobody has called {l.name.split(' ')[0]} yet, and it’s been {relativeTime(l.created_at).replace(' ago', '')}. Call now and log it below.</Callout>}
      {l.status === 'lost' && (
        <Callout tone="warn">
          Closed: {l.lost_reason ? LEAD_CLOSE_LABEL[l.lost_reason] : ''}
          {l.lost_note ? `: ${l.lost_note}` : ''}. The history stays here.
        </Callout>
      )}
      <div className="split">
        <div className="stack">
          <div id="next-step" className="anchor-target">
            <NextStep detail={d} writable={writable} />
          </div>
          <Panel title="History">
            <div className="panel-body">
              {writable && <LogActivity leadId={l.id} />}
              <Timeline items={d.activities} />
            </div>
          </Panel>
        </div>
        <div className="stack">
          <Panel title="Customer">
            <div className="panel-body">
              <KV
                items={[
                  ['Phone', <a href={`tel:${l.phone}`}>{formatPhone(l.phone)}</a>],
                  ['Email', l.email],
                  ['Address', <>{l.address}, {l.city} {l.pincode} <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${l.address}, ${l.city} ${l.pincode}`)}`} target="_blank" rel="noreferrer" aria-label="Open in maps" style={{ display: 'inline-flex', verticalAlign: '-2px' }}><MapPin size={14} /></a></>],
                  ['For a', l.customer_kind === 'home' ? 'Home' : 'Business'],
                  ['Wants', <>{l.requested_kw ? formatKw(l.requested_kw) : 'Size not given'}, {SYSTEM_TYPE_LABEL[l.system_type]}{l.wants_subsidy ? ', with subsidy' : ''}</>],
                  ['Owner', <AssignPicker leadId={l.id} current={l.assigned_to} name={l.assigned_name} disabled={!writable} />],
                ]}
              />
              {l.message && <p style={{ marginTop: 12, padding: 12, background: 'var(--surface-2)', borderRadius: 8, whiteSpace: 'pre-wrap' }}>{l.message}</p>}
              <p style={{ marginTop: 12 }}>
                <Link to={`/app/customers/${l.customer_id}`}>Everything about this customer</Link>
              </p>
            </div>
          </Panel>
          {l.roof_area_sqft && (
            <Panel title="From the qualification call">
              <div className="panel-body">
                <KV
                  items={[
                    ['Shadow-free roof', `${l.roof_area_sqft} sq ft`],
                    ['Monthly bill', l.monthly_bill_paise ? formatINR(l.monthly_bill_paise) : null],
                    ['Grid', l.grid_connection ? `${GRID_LABEL[l.grid_connection]}${l.grid_suitable ? ', suitable' : ', not suitable'}` : null],
                    ['Roof', l.roof_type ? `${ROOF_LABEL[l.roof_type]}, ${SHADING_LABEL[l.shading ?? 'none'].toLowerCase()}` : null],
                    ['Suggested size', l.recommended_kw ? formatKw(l.recommended_kw) : null],
                  ]}
                />
              </div>
            </Panel>
          )}
          {d.otherEnquiries.length > 0 && (
            <Panel title="Earlier enquiries from this customer">
              <div className="panel-body tight">
                {d.otherEnquiries.map((o) => (
                  <p key={o.id}>
                    <Link to={`/app/enquiries/${o.id}`} className="mono">
                      {o.ref}
                    </Link>{' '}
                    <span className="muted">
                      {LEAD_STATUS_LABEL[o.status]}, {formatDate(o.created_at)}
                    </span>
                  </p>
                ))}
              </div>
            </Panel>
          )}
        </div>
      </div>
      <CloseDialog open={closing} onClose={() => setClosing(false)} leadId={l.id} />
    </div>
  );
}

function AssignPicker({ leadId, current, name, disabled }: { leadId: number; current: number | null; name: string | null; disabled: boolean }) {
  const people = useQuery({ queryKey: ['sales-team'], queryFn: () => api.get<{ people: { id: number; name: string }[] }>('/api/sales-team'), enabled: !disabled });
  const qc = useQueryClient();
  if (disabled) return <>{name ?? 'Unassigned'}</>;
  return (
    <select
      className="select"
      style={{ minHeight: 36, padding: '4px 30px 4px 8px' }}
      value={current ?? ''}
      aria-label="Assign to"
      onChange={async (e) => {
        if (!e.target.value) return;
        await api.post(`/api/leads/${leadId}/assign`, { assignedTo: Number(e.target.value) });
        void qc.invalidateQueries({ queryKey: ['lead'] });
      }}
    >
      <option value="">Unassigned</option>
      {people.data?.people.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </select>
  );
}

function LogActivity({ leadId }: { leadId: number }) {
  const form = useZodForm(activitySchema, { kind: 'call', body: '' });
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      noValidate
      className="stack"
      style={{ marginBottom: 18 }}
      onSubmit={form.handleSubmit(async (v) => {
        setError(null);
        try {
          await api.post(`/api/leads/${leadId}/activities`, v);
          form.reset({ kind: v.kind, body: '' });
          void qc.invalidateQueries({ queryKey: ['lead'] });
        } catch (e) {
          setError(applyServerError(form, e));
        }
      })}
    >
      <FormError message={error} />
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <select className="select" style={{ width: 'auto' }} aria-label="Kind" {...form.register('kind')}>
          <option value="call">Call</option>
          <option value="whatsapp">WhatsApp</option>
          <option value="note">Note</option>
        </select>
        <div style={{ flex: 1, minWidth: 200 }}>
          <TextField form={form as never} name="body" label={<span className="sr-only">What happened</span>} placeholder="What was said or agreed" />
        </div>
        <Button type="submit" busy={form.formState.isSubmitting}>
          Add
        </Button>
      </div>
    </form>
  );
}

/* ---------------------------------------------------------------- what to do next */

/** The header's yellow button names the one thing that moves this enquiry forward. */
function nextLabel(detail: Detail): string | null {
  const l = detail.lead;
  const survey = detail.surveys[0];
  const liveQuote = detail.quotes.find((q) => q.status === 'draft' || q.status === 'sent' || q.status === 'accepted');
  if (l.status === 'won' || l.status === 'lost') return null;
  if (l.status === 'new' || l.status === 'contacted') return 'Qualify the enquiry';
  if (l.status === 'qualified' && (!survey || survey.status === 'cancelled')) return 'Book a roof survey';
  if (survey && survey.status === 'submitted') return 'Review the survey';
  if (survey && survey.status !== 'approved') return null;
  if (liveQuote) return null;
  return 'Make the quote';
}

function NextStep({ detail, writable }: { detail: Detail; writable: boolean }) {
  const l = detail.lead;
  const survey = detail.surveys[0];
  const liveQuote = detail.quotes.find((q) => q.status === 'draft' || q.status === 'sent' || q.status === 'accepted');
  if (l.status === 'won' && detail.jobs[0])
    return (
      <Panel title="Won">
        <div className="panel-body">
          <Callout tone="good" action={<Link className="btn btn-primary" to={`/app/jobs/${detail.jobs[0].id}`}>Open {detail.jobs[0].ref}</Link>}>
            The customer accepted. It’s now job {detail.jobs[0].ref}.
          </Callout>
        </div>
      </Panel>
    );
  if (l.status === 'lost') return null;
  if (['new', 'contacted'].includes(l.status) || (l.status === 'qualified' && !survey)) {
    return l.status === 'qualified' ? <BookSurvey lead={l} writable={writable} /> : <Qualify lead={l} writable={writable} />;
  }
  if (survey && survey.status !== 'approved') {
    return (
      <Panel title="Roof survey">
        <div className="panel-body stack">
          <KV
            items={[
              ['Survey', <Link to={`/app/surveys/${survey.id}`} className="mono">{survey.ref}</Link>],
              ['Status', <Chip tone={survey.status === 'submitted' ? 'sun' : survey.status === 'rejected' ? 'warn' : 'info'}>{SURVEY_STATUS_LABEL[survey.status]}</Chip>],
              ['Technician', survey.technician],
              ['When', survey.starts_at ? formatDateTime(survey.starts_at) : '—'],
            ]}
          />
          <Callout>A quote can only be made once the survey is approved. That keeps quotes honest: they’re sized from a measured roof.</Callout>
          {survey.status === 'cancelled' && <BookSurvey lead={l} writable={writable} />}
          <Link className="btn btn-primary" to={`/app/surveys/${survey.id}`}>
            {survey.status === 'submitted' ? 'Review the survey' : 'Open the survey'}
          </Link>
        </div>
      </Panel>
    );
  }
  if (liveQuote)
    return (
      <Panel title="Quote">
        <div className="panel-body stack">
          <KV
            items={[
              ['Quote', <Link to={`/app/quotes/${liveQuote.id}`} className="mono">{liveQuote.ref} v{liveQuote.version}</Link>],
              ['Status', QUOTE_STATUS_LABEL[liveQuote.status]],
              ['System', formatKw(liveQuote.capacity_kw)],
              ['Total', <Money paise={liveQuote.total_paise} />],
            ]}
          />
          <Link className="btn btn-primary" to={`/app/quotes/${liveQuote.id}`}>
            Open the quote
          </Link>
        </div>
      </Panel>
    );
  return <MakeQuote lead={l} survey={survey} writable={writable} />;
}

function Qualify({ lead, writable }: { lead: Lead; writable: boolean }) {
  const form = useZodForm(qualificationSchema, {
    roofAreaSqft: (lead.roof_area_sqft ?? '') as never,
    monthlyBillRupees: (lead.monthly_bill_paise ? lead.monthly_bill_paise / 100 : '') as never,
    gridConnection: lead.grid_connection ?? 'single_phase',
    sanctionedLoadKw: (lead.sanctioned_load_kw ?? '') as never,
    roofType: lead.roof_type ?? 'rcc',
    shading: lead.shading ?? 'none',
    systemType: lead.system_type === 'not_sure' ? 'on_grid' : lead.system_type,
    gridSuitable: true,
    outcome: 'qualified',
    note: '',
  });
  const [error, setError] = useState<string | null>(null);
  const qc = useQueryClient();
  const toast = useToast();
  const w = form.watch();
  const sizing = useMemo(
    () =>
      recommendSize({
        monthlyBillPaise: Number(w.monthlyBillRupees) > 0 ? Number(w.monthlyBillRupees) * 100 : null,
        roofAreaSqft: Number(w.roofAreaSqft) > 0 ? Number(w.roofAreaSqft) : null,
        shading: w.shading as never,
        gridConnection: w.gridConnection as never,
        systemType: w.systemType as never,
      }),
    [w.monthlyBillRupees, w.roofAreaSqft, w.shading, w.gridConnection, w.systemType],
  );
  if (!writable) return <Panel title="Qualification call"><div className="panel-body"><p className="muted">Sales records the qualification call.</p></div></Panel>;
  return (
    <Panel title="Check the basics on the call">
      <form
        noValidate
        className="panel-body stack"
        onSubmit={form.handleSubmit(async (v) => {
          setError(null);
          try {
            const r = await api.post<{ recommendedKw: number | null }>(`/api/leads/${lead.id}/qualify`, { ...v, gridSuitable: String(v.gridSuitable) === 'true' || v.gridSuitable === true });
            toast(v.outcome === 'qualified' ? `Qualified. Suggested size ${r.recommendedKw ?? '—'} kW. Book a roof survey next.` : 'Marked not suitable. The enquiry stays on record.');
            void qc.invalidateQueries({ queryKey: ['lead'] });
          } catch (e) {
            setError(applyServerError(form, e));
          }
        })}
      >
        <FormError message={error} />
        <div className="form-grid">
          <TextField form={form as never} name="roofAreaSqft" label="Shadow-free roof space" inputMode="numeric" suffix="sq ft" hint="Ask for the open terrace area without water tanks or stairs." />
          <TextField form={form as never} name="monthlyBillRupees" label="Monthly electricity bill" inputMode="numeric" prefix="₹" hint="Last few months, on average." />
          <SelectField form={form as never} name="gridConnection" label="Grid connection" options={Object.entries(GRID_LABEL).map(([value, label]) => ({ value, label }))} />
          <TextField form={form as never} name="sanctionedLoadKw" label="Sanctioned load" optional inputMode="decimal" suffix="kW" hint="Printed on the electricity bill." />
          <SelectField form={form as never} name="roofType" label="Roof" options={Object.entries(ROOF_LABEL).map(([value, label]) => ({ value, label }))} />
          <SelectField form={form as never} name="shading" label="Shade on the roof" options={Object.entries(SHADING_LABEL).map(([value, label]) => ({ value, label }))} />
          <SelectField form={form as never} name="systemType" label="System" options={[{ value: 'on_grid', label: 'On-Grid' }, { value: 'off_grid', label: 'Off-Grid' }, { value: 'not_sure', label: 'Not sure yet' }]} />
          <SelectField form={form as never} name="gridSuitable" label="Is the grid connection suitable?" options={[{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }]} />
        </div>
        <div className="module" aria-live="polite">
          <div className="module-grid" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
            <div className="module-cell lit">
              <span className="k">Suggested size</span>
              <span className={`v${sizing.recommendedKw ? '' : ' v-empty'}`}>{sizing.recommendedKw ? `${sizing.recommendedKw} kW` : '—'}</span>
              <span className="s">
                {!sizing.recommendedKw ? 'Add the bill to size the system' : sizing.verdict === 'good' ? 'Looks good' : sizing.verdict === 'check' ? 'Check with a survey' : 'Not suitable'}
                {lead.requested_kw && sizing.recommendedKw && Number(lead.requested_kw) !== sizing.recommendedKw ? `; they asked for ${formatKw(lead.requested_kw)}` : ''}
              </span>
            </div>
            <div className="module-cell">
              <span className="k">Usage</span>
              <span className={`v${sizing.monthlyUnits ? '' : ' v-empty'}`}>{sizing.monthlyUnits || '—'}</span>
              <span className="s">{sizing.monthlyUnits ? 'Units a month' : 'Estimated from the bill'}</span>
            </div>
            <div className="module-cell">
              <span className="k">Subsidy</span>
              <span className={`v${sizing.recommendedKw ? '' : ' v-empty'}`}>{sizing.recommendedKw ? formatINR(subsidyFor(sizing.recommendedKw, w.systemType === 'off_grid' ? 'off_grid' : 'on_grid', lead.customer_kind)) : '—'}</span>
              <span className="s">{lead.customer_kind === 'home' ? 'PM Surya Ghar estimate' : 'Homes only'}</span>
            </div>
          </div>
        </div>
        {sizing.reasons.length > 0 && (
          <ul className="muted" style={{ margin: 0, paddingLeft: 18, fontSize: 14 }}>
            {sizing.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        )}
        <ChoiceField
          form={form as never}
          name="outcome"
          label="Does it look good?"
          options={[
            { value: 'qualified', label: 'Yes, send a technician', sub: 'Book a roof survey next' },
            { value: 'not_suitable', label: 'Not suitable', sub: 'Closes the enquiry with a reason' },
          ]}
        />
        {w.outcome === 'not_suitable' && <TextArea form={form as never} name="note" label="Why it’s not suitable" rows={2} />}
        <div className="form-actions">
          <Button type="submit" variant="primary" busy={form.formState.isSubmitting}>
            Save the call
          </Button>
        </div>
      </form>
    </Panel>
  );
}

function BookSurvey({ lead, writable }: { lead: Lead; writable: boolean }) {
  const tomorrow = new Date(Date.now() + 86_400_000);
  const local = `${new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(tomorrow)}T10:00`;
  const form = useZodForm(surveyScheduleSchema.safeExtend({ startsAt: localDateTime }) as unknown as typeof surveyScheduleSchema, { leadId: lead.id, technicianId: '' as never, startsAt: local, durationMinutes: 90 as never, notes: '' });
  const [error, setError] = useState<string | null>(null);
  const qc = useQueryClient();
  const toast = useToast();
  const startsAt = form.watch('startsAt') as string;
  const duration = Number(form.watch('durationMinutes')) || 90;
  const startIso = startsAt && !Number.isNaN(new Date(startsAt).getTime()) ? new Date(startsAt).toISOString() : null;
  const free = useQuery({
    queryKey: ['free', startIso, duration],
    queryFn: () => api.get<{ technicians: { id: number; name: string }[] }>(`/api/schedule/free?startsAt=${startIso}&endsAt=${new Date(new Date(startIso!).getTime() + duration * 60_000).toISOString()}`),
    enabled: !!startIso && writable,
  });
  if (!writable) return null;
  return (
    <Panel title="Send a technician to measure the roof">
      <form
        noValidate
        className="panel-body stack"
        onSubmit={form.handleSubmit(async (v) => {
          setError(null);
          try {
            await api.post('/api/surveys', { ...v, startsAt: new Date(v.startsAt as unknown as string).toISOString() });
            toast('Survey booked. The technician has it on their phone.');
            void qc.invalidateQueries({ queryKey: ['lead'] });
          } catch (e) {
            setError(applyServerError(form, e));
          }
        })}
      >
        <p className="muted">They’ll measure roof direction, tilt and cable distance, and take photos.</p>
        <FormError message={error} />
        <div className="form-grid">
          <div className="field">
            <label htmlFor="sv-start">Visit</label>
            <input id="sv-start" type="datetime-local" className="input" {...form.register('startsAt')} />
          </div>
          <SelectField form={form as never} name="durationMinutes" label="Allow" options={[{ value: 60, label: '1 hour' }, { value: 90, label: '1½ hours' }, { value: 120, label: '2 hours' }]} />
          <SelectField
            form={form as never}
            name="technicianId"
            label="Technician"
            className="span-2"
            placeholder={free.isLoading ? 'Checking who is free…' : 'Choose who is free then'}
            options={(free.data?.technicians ?? []).map((t) => ({ value: t.id, label: t.name }))}
            hint={free.data ? `${free.data.technicians.length} technicians are free at that time, least busy first.` : undefined}
          />
          <TextField form={form as never} name="notes" label="Note for the technician" optional className="span-2" placeholder="e.g. call before arriving, gate code" />
        </div>
        <div className="form-actions">
          <Button type="submit" variant="primary" busy={form.formState.isSubmitting}>
            Book the survey
          </Button>
        </div>
      </form>
    </Panel>
  );
}

function MakeQuote({ lead, survey, writable }: { lead: Lead; survey: Detail['surveys'][number] | undefined; writable: boolean }) {
  const kits = useQuery({ queryKey: ['kits'], queryFn: () => api.get<{ kits: { id: number; code: string; name: string; kind: string; capacity_kw: number | null; status: string; description: string }[] }>('/api/kits') });
  const kind = lead.system_type === 'off_grid' ? 'off_grid' : 'on_grid';
  const suggested = survey?.recommended_kw ?? lead.recommended_kw ?? 3;
  const [templateId, setTemplateId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nav = useNavigate();
  const options = (kits.data?.kits ?? []).filter((k) => k.status === 'active');
  const pick = templateId ?? options.find((k) => k.kind === kind && Number(k.capacity_kw) === Number(suggested))?.id ?? null;
  if (!writable) return null;
  return (
    <Panel title="Make the quote">
      <div className="panel-body stack">
        <Callout tone="good">
          Survey {survey?.ref} is approved: {formatKw(suggested)} suggested, {survey?.cable_distance_m} m cable run. The parts list will follow from the template and these measurements.
        </Callout>
        <div className="choice-grid" role="radiogroup" aria-label="Kit template">
          {options.map((k) => (
            <label key={k.id} className="choice">
              <input type="radio" name="tpl" checked={pick === k.id} onChange={() => setTemplateId(k.id)} />
              <strong>{k.name}</strong>
              <span>{k.kind === kind && Number(k.capacity_kw) === Number(suggested) ? 'Suggested' : k.kind === 'panel_set' ? 'Hardware only' : k.kind === 'service' ? 'Fitting only' : ' '}</span>
            </label>
          ))}
        </div>
        {error && <div className="form-error">{error}</div>}
        <div className="form-actions">
          <Button
            variant="primary"
            size="lg"
            disabled={!pick}
            busy={busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                const r = await api.post<{ id: number }>('/api/quotes', { leadId: lead.id, templateId: pick, capacityKw: suggested });
                nav(`/app/quotes/${r.id}`);
              } catch (e) {
                setError(e instanceof Error ? e.message : 'Couldn’t make the quote.');
              } finally {
                setBusy(false);
              }
            }}
          >
            Build the quote
          </Button>
        </div>
      </div>
    </Panel>
  );
}

function CloseDialog({ open, onClose, leadId }: { open: boolean; onClose: () => void; leadId: number }) {
  const form = useZodForm(leadCloseSchema, { reason: 'not_interested', note: '' });
  const [error, setError] = useState<string | null>(null);
  const qc = useQueryClient();
  const toast = useToast();
  return (
    <Dialog open={open} onClose={onClose} title="Close this enquiry" description="Closed enquiries stay on record with their reason and can be reopened.">
      <form
        noValidate
        className="stack"
        onSubmit={form.handleSubmit(async (v) => {
          setError(null);
          try {
            await api.post(`/api/leads/${leadId}/close`, v);
            toast('Enquiry closed. It stays on record.');
            void qc.invalidateQueries({ queryKey: ['lead'] });
            onClose();
          } catch (e) {
            setError(applyServerError(form, e));
          }
        })}
      >
        <FormError message={error} />
        <SelectField form={form as never} name="reason" label="Reason" options={LEAD_CLOSE_REASONS.map((r) => ({ value: r, label: LEAD_CLOSE_LABEL[r] }))} />
        <TextArea form={form as never} name="note" label="Note" optional rows={3} />
        <div className="form-actions">
          <Button onClick={onClose}>Keep it open</Button>
          <Button type="submit" variant="danger" busy={form.formState.isSubmitting}>
            Close enquiry
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
