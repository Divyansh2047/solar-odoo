import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { PaperPlaneTilt, Printer, Prohibit, CurrencyInr, Copy } from '@phosphor-icons/react';
import { PAYMENT_METHODS, PAYMENT_METHOD_LABEL, formatINR, invoiceVoidSchema, paymentSchema, rupees } from '@arka/shared';
import { api, ApiError } from '../../lib/api';
import { useSession } from '../../lib/session';
import { Button, ErrorBlock, PageHead, SkeletonRows } from '../../components/ui';
import { InvoiceDocument, type InvoiceData } from '../../components/InvoiceDocument';
import { Dialog, useToast } from '../../components/overlay';
import { applyServerError, FormError, SelectField, TextArea, TextField, useZodForm } from '../../components/form';

export default function InvoiceDetail() {
  const { id } = useParams();
  const q = useQuery({ queryKey: ['invoice', id], queryFn: () => api.get<InvoiceData>(`/api/invoices/${id}`) });
  const { can } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [dlg, setDlg] = useState<null | 'void' | 'pay'>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (q.data) document.title = `${q.data.invoice.number} · Arka`;
  }, [q.data]);
  if (q.isLoading) return <div className="page"><SkeletonRows rows={8} /></div>;
  if (q.isError) return <div className="page"><ErrorBlock error={q.error} retry={() => q.refetch()} /></div>;
  const i = q.data!.invoice;
  const link = `${location.origin}/i/${i.public_token}`;
  const due = i.total_paise - i.paid_paise;
  return (
    <div className="page narrow">
      <PageHead
        back={{ to: '/app/money/invoices', label: 'Invoices' }}
        title={`Invoice ${i.number}`}
        actions={
          <>
            <Button icon={<Printer size={18} />} onClick={() => window.print()}>
              Print
            </Button>
            {i.status !== 'draft' && i.status !== 'void' && (
              <Button
                icon={<Copy size={18} />}
                onClick={async () => {
                  await navigator.clipboard?.writeText(link).catch(() => {});
                  toast('Invoice link copied.');
                }}
              >
                Copy link
              </Button>
            )}
            {can('invoices.write') && i.status === 'draft' && (
              <Button
                variant="primary"
                icon={<PaperPlaneTilt size={18} />}
                busy={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const r = await api.post<{ status: string; emailed: boolean }>(`/api/invoices/${i.id}/send`);
                    toast(r.emailed ? 'Invoice emailed to the customer.' : 'Invoice marked as sent. Share the link with the customer.');
                    void qc.invalidateQueries({ queryKey: ['invoice', id] });
                  } catch (e) {
                    toast(e instanceof ApiError ? e.message : 'Failed.', 'bad');
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Send to customer
              </Button>
            )}
            {can('payments.write') && i.kind === 'service' && ['sent', 'partially_paid'].includes(i.status) && due > 0 && (
              <Button variant="primary" icon={<CurrencyInr size={18} />} onClick={() => setDlg('pay')}>
                Record payment
              </Button>
            )}
            {can('invoices.write') && i.status !== 'void' && (
              <Button variant="danger" icon={<Prohibit size={18} />} onClick={() => setDlg('void')}>
                Void
              </Button>
            )}
          </>
        }
      />
      <InvoiceDocument data={q.data!} />
      {dlg === 'void' && <VoidDialog invoiceId={i.id} onClose={() => setDlg(null)} />}
      {dlg === 'pay' && <PayDialog invoiceId={i.id} due={due} onClose={() => setDlg(null)} />}
    </div>
  );
}

function VoidDialog({ invoiceId, onClose }: { invoiceId: number; onClose: () => void }) {
  const form = useZodForm(invoiceVoidSchema, { reason: '' });
  const [error, setError] = useState<string | null>(null);
  const qc = useQueryClient();
  return (
    <Dialog open onClose={onClose} title="Void this invoice" description="A void invoice stays on record with its reason. Its number is never reused.">
      <form
        noValidate
        className="stack"
        onSubmit={form.handleSubmit(async (v) => {
          setError(null);
          try {
            await api.post(`/api/invoices/${invoiceId}/void`, v);
            void qc.invalidateQueries({ queryKey: ['invoice'] });
            onClose();
          } catch (e) {
            setError(applyServerError(form, e));
          }
        })}
      >
        <FormError message={error} />
        <TextArea form={form as never} name="reason" label="Reason" rows={2} />
        <div className="form-actions">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="danger" busy={form.formState.isSubmitting}>
            Void invoice
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function PayDialog({ invoiceId, due, onClose }: { invoiceId: number; due: number; onClose: () => void }) {
  const schema = paymentSchema.safeExtend({ amountPaise: rupees() }) as unknown as typeof paymentSchema;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
  const form = useZodForm(schema, { amountPaise: (due / 100) as never, method: 'upi', reference: '', receivedOn: today, note: '' });
  const [error, setError] = useState<string | null>(null);
  const qc = useQueryClient();
  return (
    <Dialog open onClose={onClose} title="Record a payment" description={`${formatINR(due)} due.`}>
      <form
        noValidate
        className="stack"
        onSubmit={form.handleSubmit(async (v) => {
          setError(null);
          try {
            await api.post(`/api/invoices/${invoiceId}/payments`, v);
            void qc.invalidateQueries({ queryKey: ['invoice'] });
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
          <TextField form={form as never} name="reference" label="UTR or cheque number" optional />
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
