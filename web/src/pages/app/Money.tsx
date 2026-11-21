import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { durationWords,
  INVOICE_STATUS_LABEL,
  PAYMENT_METHOD_LABEL,
  SUBSIDY_STATUS_LABEL,
  formatDate,
  formatINR,
  formatKw,
  payrunSchema,
  type InvoiceStatus,
  type PaymentMethod,
  type SubsidyStatus,
} from '@arka/shared';
import { api } from '../../lib/api';
import { useSession } from '../../lib/session';
import { Button, Chip, Empty, ErrorBlock, Money as M, PageHead, Panel, Seg, SkeletonRows, type Tone } from '../../components/ui';
import { DataTable } from '../../components/table';
import { Dialog, useToast } from '../../components/overlay';
import { applyServerError, FormError, TextField, useZodForm } from '../../components/form';
import { SubsidyDialog } from './JobDetail';

const INV_TONE: Record<InvoiceStatus, Tone> = { draft: 'warn', sent: 'info', partially_paid: 'sun', paid: 'good', void: 'neutral' };
type Tab = 'invoices' | 'payments' | 'subsidy' | 'payroll';

export default function Money() {
  const { tab = 'invoices' } = useParams();
  const nav = useNavigate();
  const { can } = useSession();
  useEffect(() => {
    document.title = 'Money · Arka';
  }, []);
  return (
    <div className="page">
      <PageHead title="Money" lead="Invoices, payments, customers’ subsidy paperwork and technicians’ pay." />
      <Seg
        label="Section"
        variant="tabs"
        value={tab as Tab}
        onChange={(v) => nav(`/app/money/${v}`)}
        options={[
          { value: 'invoices', label: 'Invoices' },
          { value: 'payments', label: 'Payments' },
          { value: 'subsidy', label: 'Subsidy' },
          ...(can('payroll.read') ? [{ value: 'payroll' as Tab, label: 'Technician pay' }] : []),
        ]}
      />
      {tab === 'invoices' && <Invoices />}
      {tab === 'payments' && <Payments />}
      {tab === 'subsidy' && <Subsidy />}
      {tab === 'payroll' && <Payroll />}
    </div>
  );
}

function Invoices() {
  const [status, setStatus] = useState('all');
  const q = useQuery({
    queryKey: ['invoices', status],
    queryFn: () =>
      api.get<{
        invoices: { id: number; number: string; kind: 'system' | 'service'; status: InvoiceStatus; issued_on: string; due_on: string; total_paise: number; paid_paise: number; customer: string; city: string; job_ref: string | null; ticket_ref: string | null }[];
        totals: { status: InvoiceStatus; n: number; v: number }[];
      }>(`/api/invoices${status === 'all' ? '' : `?status=${status}`}`),
  });
  const t = (s: InvoiceStatus) => q.data?.totals.find((x) => x.status === s);
  return (
    <>
      <div className="toolbar">
        <Seg
          label="Status"
          value={status}
          onChange={setStatus}
          options={[
            { value: 'all', label: 'All' },
            { value: 'draft', label: 'To send', count: t('draft')?.n ?? 0 },
            { value: 'sent', label: 'Sent' },
            { value: 'partially_paid', label: 'Part paid' },
            { value: 'paid', label: 'Paid' },
          ]}
        />
      </div>
      <Panel>
        {q.isLoading ? (
          <SkeletonRows />
        ) : q.isError ? (
          <ErrorBlock error={q.error} retry={() => q.refetch()} />
        ) : (
          <DataTable
            rows={q.data!.invoices}
            rowKey={(r) => r.id}
            to={(r) => `/app/money/invoices/${r.id}`}
            rowTone={(r) => (r.status === 'draft' ? 'sun' : undefined)}
            empty={<Empty title="No invoices here">A system invoice is drafted when the crew signs off; a service invoice when a billable repair is done.</Empty>}
            columns={[
              { header: 'Invoice', cell: (r) => <span className="mono cell-main">{r.number}</span> },
              { header: 'Customer', cell: (r) => (<>{r.customer}<div className="cell-sub">{r.kind === 'system' ? `System ${r.job_ref}` : `Repair ${r.ticket_ref}`}</div></>) },
              { header: 'Issued', className: 'nowrap', cell: (r) => formatDate(r.issued_on) },
              { header: 'Total', className: 'r', cell: (r) => <M paise={r.total_paise} /> },
              { header: 'Balance', className: 'r', cell: (r) => (r.total_paise - r.paid_paise > 0 && r.status !== 'void' ? <M paise={r.total_paise - r.paid_paise} /> : <span className="muted">—</span>) },
              { header: 'Status', cell: (r) => <Chip tone={INV_TONE[r.status]}>{INVOICE_STATUS_LABEL[r.status]}</Chip> },
            ]}
            card={(r) => ({ title: r.customer, right: <Chip tone={INV_TONE[r.status]}>{INVOICE_STATUS_LABEL[r.status]}</Chip>, meta: [r.number, formatDate(r.issued_on)], extra: r.status !== 'void' && r.total_paise - r.paid_paise > 0 && r.paid_paise > 0 ? <span>Balance <M paise={r.total_paise - r.paid_paise} /> of <M paise={r.total_paise} /></span> : <M paise={r.total_paise} /> })}
          />
        )}
      </Panel>
    </>
  );
}

function Payments() {
  const q = useQuery({ queryKey: ['payments'], queryFn: () => api.get<{ payments: { id: number; ref: string; amount_paise: number; method: PaymentMethod; reference: string | null; received_on: string; customer: string; job_ref: string | null; job_id: number | null; invoice_number: string | null }[] }>('/api/payments') });
  return (
    <Panel>
      {q.isLoading ? (
        <SkeletonRows />
      ) : (
        <DataTable
          rows={q.data?.payments ?? []}
          rowKey={(r) => r.id}
          to={(r) => (r.job_id ? `/app/jobs/${r.job_id}` : '/app/money/invoices')}
          empty={<Empty title="No payments yet" />}
          columns={[
            { header: 'Received', className: 'nowrap', cell: (r) => formatDate(r.received_on) },
            { header: 'Customer', cell: (r) => (<>{r.customer}<div className="cell-sub mono">{r.job_ref ?? r.invoice_number}</div></>) },
            { header: 'By', cell: (r) => (<>{PAYMENT_METHOD_LABEL[r.method]}<div className="cell-sub">{r.reference}</div></>) },
            { header: 'Receipt', cell: (r) => <span className="mono">{r.ref}</span> },
            { header: 'Amount', className: 'r', cell: (r) => <M paise={r.amount_paise} /> },
          ]}
          card={(r) => ({ title: r.customer, right: <M paise={r.amount_paise} />, meta: [formatDate(r.received_on), PAYMENT_METHOD_LABEL[r.method], r.ref] })}
        />
      )}
    </Panel>
  );
}

function Subsidy() {
  const q = useQuery({
    queryKey: ['subsidy'],
    queryFn: () =>
      api.get<{ cases: { id: number; job_id: number; job_ref: string; capacity_kw: number; customer: string; city: string; status: SubsidyStatus; expected_paise: number; application_no: string | null; days_in_stage: number; docs_bill: boolean; docs_id: boolean; docs_bank: boolean; docs_photo: boolean; disbursed_paise: number | null; disbursed_on: string | null; stage_changed_at: string }[] }>('/api/subsidy'),
  });
  const { can } = useSession();
  const [edit, setEdit] = useState<null | NonNullable<typeof q.data>['cases'][number]>(null);
  const tone = (s: SubsidyStatus): Tone => (s === 'disbursed' ? 'good' : s === 'rejected' ? 'bad' : s === 'not_started' ? 'warn' : 'info');
  return (
    <Panel>
      {q.isLoading ? (
        <SkeletonRows />
      ) : (
        <DataTable
          rows={q.data?.cases ?? []}
          rowKey={(r) => r.id}
          empty={<Empty title="No subsidy cases">On-grid homes under PM Surya Ghar get a case when the quote is accepted.</Empty>}
          columns={[
            { header: 'Customer', cell: (r) => (<><Link to={`/app/jobs/${r.job_id}`} className="cell-main">{r.customer}</Link><div className="cell-sub"><span className="mono">{r.job_ref}</span>, {formatKw(r.capacity_kw)}</div></>) },
            { header: 'Stage', cell: (r) => <Chip tone={tone(r.status)}>{SUBSIDY_STATUS_LABEL[r.status]}</Chip> },
            { header: 'Documents', cell: (r) => `${[r.docs_bill, r.docs_id, r.docs_bank, r.docs_photo].filter(Boolean).length} of 4` },
            { header: 'Application', cell: (r) => <span className="mono">{r.application_no ?? '—'}</span> },
            { header: 'In this stage', className: 'r', cell: (r) => (r.status === 'disbursed' ? <span className="muted">done</span> : <span style={{ color: r.days_in_stage > 20 ? 'var(--bad)' : undefined }}>{durationWords(r.days_in_stage)}</span>) },
            { header: 'Amount', className: 'r', cell: (r) => <M paise={r.disbursed_paise ?? r.expected_paise} /> },
            { header: '', cell: (r) => can('subsidy.write') && r.status !== 'disbursed' && <Button size="sm" onClick={() => setEdit(r)}>Update</Button> },
          ]}
          card={(r) => ({
            title: r.customer,
            right: <Chip tone={tone(r.status)}>{SUBSIDY_STATUS_LABEL[r.status]}</Chip>,
            meta: [r.job_ref, formatINR(r.expected_paise), `${durationWords(r.days_in_stage)} in this stage`],
            extra: can('subsidy.write') && r.status !== 'disbursed' ? <Button size="sm" onClick={() => setEdit(r)}>Update</Button> : undefined,
          })}
        />
      )}
      {edit && <SubsidyDialog open onClose={() => setEdit(null)} jobId={edit.job_id} current={edit as never} />}
    </Panel>
  );
}

function Payroll() {
  const q = useQuery({
    queryKey: ['payroll'],
    queryFn: () =>
      api.get<{
        unpaid: { id: number; name: string; hourly_cost_paise: number; hours: number; amount_paise: number; entries: number; first_day: string | null; last_day: string | null }[];
        runs: { id: number; ref: string; period_start: string; period_end: string; status: 'draft' | 'paid'; total_paise: number; paid_at: string | null; people: number }[];
      }>('/api/payroll'),
  });
  const { can } = useSession();
  const [create, setCreate] = useState(false);
  const qc = useQueryClient();
  const toast = useToast();
  const due = (q.data?.unpaid ?? []).reduce((s, u) => s + Number(u.amount_paise), 0);
  return (
    <div className="split">
      <Panel title="Unpaid hours" actions={can('payroll.write') && due > 0 && <Button variant="primary" size="sm" onClick={() => setCreate(true)}>Create pay run</Button>}>
        {q.isLoading ? (
          <SkeletonRows />
        ) : (
          <DataTable
            rows={q.data?.unpaid ?? []}
            rowKey={(r) => r.id}
            empty={<Empty title="Nobody to pay right now" />}
            columns={[
              { header: 'Technician', cell: (r) => (<><span className="cell-main">{r.name}</span><div className="cell-sub">{formatINR(r.hourly_cost_paise)} an hour</div></>) },
              { header: 'Hours', className: 'r', cell: (r) => `${Math.round(Number(r.hours) * 10) / 10} h` },
              { header: 'Days', cell: (r) => (r.first_day ? `${formatDate(r.first_day)} to ${formatDate(r.last_day)}` : '—') },
              { header: 'To pay', className: 'r', cell: (r) => <M paise={Number(r.amount_paise)} /> },
            ]}
            card={(r) => ({ title: r.name, right: <M paise={Number(r.amount_paise)} />, meta: [`${Math.round(Number(r.hours))} h`] })}
          />
        )}
        <div className="panel-foot">
          <b>Total due: {formatINR(due)}</b>
        </div>
      </Panel>
      <Panel title="Pay runs">
        <div className="panel-body tight" style={{ display: 'grid', gap: 8 }}>
          {q.data?.runs.length === 0 && <p className="muted">No pay runs yet.</p>}
          {q.data?.runs.map((r) => (
            <div key={r.id} className="row between">
              <span>
                <span className="mono">{r.ref}</span>
                <span className="muted" style={{ display: 'block', fontSize: 13 }}>
                  {formatDate(r.period_start)} to {formatDate(r.period_end)}, {r.people} people
                </span>
              </span>
              <span className="row">
                <M paise={r.total_paise} />
                {r.status === 'paid' ? (
                  <Chip tone="good">Paid</Chip>
                ) : (
                  can('payroll.write') && (
                    <Button
                      size="sm"
                      onClick={async () => {
                        await api.post(`/api/payroll/runs/${r.id}/paid`);
                        toast(`${r.ref} marked paid.`);
                        void qc.invalidateQueries({ queryKey: ['payroll'] });
                      }}
                    >
                      Mark paid
                    </Button>
                  )
                )}
              </span>
            </div>
          ))}
        </div>
      </Panel>
      {create && <PayrunDialog onClose={() => setCreate(false)} />}
    </div>
  );
}

function PayrunDialog({ onClose }: { onClose: () => void }) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
  const form = useZodForm(payrunSchema, { periodStart: `${today.slice(0, 7)}-01`, periodEnd: today });
  const [error, setError] = useState<string | null>(null);
  const qc = useQueryClient();
  const toast = useToast();
  return (
    <Dialog open onClose={onClose} title="Create a pay run" description="Collects every unpaid hour in the period, at each technician’s rate.">
      <form
        noValidate
        className="stack"
        onSubmit={form.handleSubmit(async (v) => {
          setError(null);
          try {
            const r = await api.post<{ ref: string; totalPaise: number; people: number }>('/api/payroll/runs', v);
            toast(`${r.ref}: ${formatINR(r.totalPaise)} for ${r.people} technicians.`);
            void qc.invalidateQueries({ queryKey: ['payroll'] });
            onClose();
          } catch (e) {
            setError(applyServerError(form, e));
          }
        })}
      >
        <FormError message={error} />
        <div className="form-grid">
          <TextField form={form as never} name="periodStart" label="From" type="date" />
          <TextField form={form as never} name="periodEnd" label="To" type="date" />
        </div>
        <div className="form-actions">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" busy={form.formState.isSubmitting}>
            Create
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
