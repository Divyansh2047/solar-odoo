import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { PaperPlaneTilt, Printer, Copy, WhatsappLogo, Plus, Trash, ArrowsClockwise, Handshake } from '@phosphor-icons/react';
import { QUOTE_STATUS_LABEL, formatINR, lineAmount, paiseToRupeesString, rupeesToPaise, taxOn, quoteAcceptSchema, quoteDeclineSchema, type QuoteStatus } from '@arka/shared';
import { api, ApiError } from '../../lib/api';
import { useSession } from '../../lib/session';
import { Button, Callout, Chip, ErrorBlock, PageHead, Panel, SkeletonRows } from '../../components/ui';
import { QuoteDocument, type QuoteData } from '../../components/QuoteDocument';
import { Dialog, useToast } from '../../components/overlay';
import { applyServerError, FormError, TextArea, TextField, useZodForm } from '../../components/form';
import { QUOTE_TONE } from './Quotes';

type Detail = QuoteData & { versions: { id: number; version: number; status: QuoteStatus; total_paise: number }[] };

export default function QuoteDetail() {
  const { id } = useParams();
  const q = useQuery({ queryKey: ['quote', id], queryFn: () => api.get<Detail>(`/api/quotes/${id}`) });
  const { can } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const nav = useNavigate();
  const [accept, setAccept] = useState(false);
  const [decline, setDecline] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    if (q.data) document.title = `${q.data.quote.ref} v${q.data.quote.version} · Arka`;
  }, [q.data]);
  if (q.isLoading) return <div className="page"><SkeletonRows rows={8} /></div>;
  if (q.isError) return <div className="page"><ErrorBlock error={q.error} retry={() => q.refetch()} /></div>;
  const d = q.data!;
  const quote = d.quote;
  const status = quote.status as QuoteStatus;
  const link = `${location.origin}/q/${quote.public_token}`;
  const writable = can('quotes.write');
  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'That didn’t work.', 'bad');
    } finally {
      setBusy(null);
    }
  };
  const share = `Hello ${quote.customer.split(' ')[0]}, here is your solar quote from ${quote.company_name}: ${link}`;
  return (
    <div className="page">
      <PageHead
        back={{ to: '/app/quotes', label: 'Quotes' }}
        title={`Quote for ${quote.customer}`}
        actions={
          <>
            <Button icon={<Printer size={18} />} onClick={() => window.print()}>
              Print
            </Button>
            {writable && status === 'draft' && (
              <Button
                variant="primary"
                icon={<PaperPlaneTilt size={18} />}
                busy={busy === 'send'}
                onClick={() =>
                  run('send', async () => {
                    const r = await api.post<{ emailed: boolean }>(`/api/quotes/${quote.id}/send`);
                    toast(r.emailed ? 'Quote sent by email. Share it on WhatsApp too.' : 'Quote ready to share. Copy the link or send it on WhatsApp.');
                    void qc.invalidateQueries({ queryKey: ['quote', id] });
                  })
                }
              >
                Send to customer
              </Button>
            )}
            {writable && status === 'sent' && (
              <Button variant="primary" icon={<Handshake size={18} />} onClick={() => setAccept(true)}>
                Customer said yes
              </Button>
            )}
            {writable && ['sent', 'rejected', 'expired'].includes(status) && (
              <Button
                icon={<ArrowsClockwise size={18} />}
                busy={busy === 'revise'}
                onClick={() =>
                  run('revise', async () => {
                    const r = await api.post<{ id: number; version: number }>(`/api/quotes/${quote.id}/revise`);
                    toast(`Version ${r.version} started as a draft.`);
                    nav(`/app/quotes/${r.id}`);
                  })
                }
              >
                Revise
              </Button>
            )}
          </>
        }
      >
        <div className="row" style={{ marginTop: 8 }}>
          <span className="mono muted">
            {quote.ref} v{quote.version}
          </span>
          <Chip tone={QUOTE_TONE[status]}>{QUOTE_STATUS_LABEL[status]}</Chip>
          {d.versions.length > 1 && (
            <span className="muted">
              Versions:{' '}
              {d.versions.map((v, i) => (
                <span key={v.id}>
                  {i > 0 && ', '}
                  {v.id === quote.id ? <b>v{v.version}</b> : <Link to={`/app/quotes/${v.id}`}>v{v.version}</Link>}
                </span>
              ))}
            </span>
          )}
        </div>
      </PageHead>

      {status === 'accepted' && quote.job_id && (
        <Callout tone="good" action={<Link className="btn btn-primary" to={`/app/jobs/${quote.job_id}`}>Open {quote.job_ref}</Link>}>
          Accepted by {quote.accepted_name}. It’s now job {quote.job_ref}.
        </Callout>
      )}
      {status === 'sent' && (
        <Panel>
          <div className="panel-body row between share-row">
            <span className="share-text">
              <b>Waiting for {quote.customer.split(' ')[0]}.</b> Their link opens the quote and lets them accept it.
            </span>
            <span className="row btn-row">
              <Button
                size="sm"
                icon={<Copy size={16} />}
                onClick={async () => {
                  await navigator.clipboard?.writeText(link).catch(() => {});
                  toast('Quote link copied.');
                }}
              >
                Copy link
              </Button>
              <a className="btn btn-sm" href={`https://wa.me/${quote.phone.replace('+', '')}?text=${encodeURIComponent(share)}`} target="_blank" rel="noreferrer">
                <WhatsappLogo size={16} /> Send on WhatsApp
              </a>
              {writable && (
                <Button size="sm" variant="danger" onClick={() => setDecline(true)}>
                  Mark declined
                </Button>
              )}
            </span>
          </div>
        </Panel>
      )}

      {status === 'draft' && writable ? (
        <div className="split">
          <LineEditor data={d} />
          <QuoteDocument data={d} showRules />
        </div>
      ) : (
        <QuoteDocument data={d} showRules={writable} />
      )}

      <AcceptDialog open={accept} onClose={() => setAccept(false)} quoteId={quote.id} customer={quote.customer} />
      <DeclineDialog open={decline} onClose={() => setDecline(false)} quoteId={quote.id} />
    </div>
  );
}

interface EditLine {
  key: string;
  productId: number;
  description: string;
  qty: string;
  unit: string;
  gst: number;
}

function LineEditor({ data }: { data: Detail }) {
  const q = data.quote;
  const products = useQuery({ queryKey: ['products'], queryFn: () => api.get<{ products: { id: number; sku: string; name: string; sale_price_paise: number; gst_rate_bp: number; status: string }[] }>('/api/products') });
  const [lines, setLines] = useState<EditLine[]>(() =>
    data.lines.map((l) => ({ key: String(l.id), productId: (l as unknown as { product_id: number }).product_id, description: l.description, qty: String(Number(l.qty)), unit: paiseToRupeesString(l.unit_price_paise), gst: l.gst_rate_bp })),
  );
  const [discount, setDiscount] = useState(paiseToRupeesString(q.discount_paise));
  const [advance, setAdvance] = useState(String(q.advance_percent));
  const [validUntil, setValidUntil] = useState(q.valid_until);
  const [notes, setNotes] = useState(q.notes ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  const toast = useToast();
  const parsed = lines.map((l) => ({ ...l, q: Number(l.qty), p: rupeesToPaise(l.unit) }));
  const bad = parsed.some((l) => !(l.q > 0) || l.p === null);
  const subtotal = parsed.reduce((s, l) => s + (l.p !== null && l.q > 0 ? lineAmount(l.q, l.p) : 0), 0);
  const disc = rupeesToPaise(discount || '0') ?? 0;
  const ratio = subtotal ? disc / subtotal : 0;
  const tax = parsed.reduce((s, l) => s + (l.p !== null && l.q > 0 ? taxOn(Math.round(lineAmount(l.q, l.p) * (1 - ratio)), l.gst) : 0), 0);
  const dirty = true;
  const save = async () => {
    setError(null);
    setBusy(true);
    try {
      await api.put(`/api/quotes/${q.id}`, {
        lines: parsed.map((l) => ({ productId: l.productId, description: l.description, qty: l.q, unitPricePaise: l.p })),
        discountPaise: disc,
        advancePercent: Number(advance),
        validUntil,
        notes: notes || undefined,
      });
      toast('Quote saved. Totals recalculated.');
      void qc.invalidateQueries({ queryKey: ['quote'] });
    } catch (e) {
      setError(e instanceof ApiError ? (Object.values(e.fields)[0] ?? e.message) : 'Couldn’t save.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Panel title="Adjust the draft" className="no-print">
      <div className="panel-body stack">
        <p className="muted" style={{ fontSize: 14 }}>
          The parts list came from <b>{q.template_name}</b> and the survey. Change quantities or prices if needed; GST and totals are recalculated on save.
        </p>
        {error && <div className="form-error">{error}</div>}
        <div style={{ display: 'grid', gap: 8 }}>
          {lines.map((l, i) => (
            <div key={l.key} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 72px 104px 36px', gap: 6, alignItems: 'center' }}>
              <span style={{ fontSize: 14, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={l.description}>
                {l.description}
              </span>
              <input className="input num" aria-label={`Quantity of ${l.description}`} inputMode="decimal" value={l.qty} aria-invalid={!(Number(l.qty) > 0)} onChange={(e) => setLines((x) => x.map((y, j) => (j === i ? { ...y, qty: e.target.value } : y)))} />
              <input className="input num" aria-label={`Rate of ${l.description} in rupees`} inputMode="decimal" value={l.unit} aria-invalid={rupeesToPaise(l.unit) === null} onChange={(e) => setLines((x) => x.map((y, j) => (j === i ? { ...y, unit: e.target.value } : y)))} />
              <Button variant="ghost" size="sm" aria-label={`Remove ${l.description}`} onClick={() => setLines((x) => x.filter((_, j) => j !== i))} icon={<Trash size={16} />} />
            </div>
          ))}
        </div>
        <div className="row">
          <select
            className="select"
            aria-label="Add a product"
            value=""
            onChange={(e) => {
              const p = products.data?.products.find((x) => x.id === Number(e.target.value));
              if (p) setLines((x) => [...x, { key: `n${Date.now()}`, productId: p.id, description: p.name, qty: '1', unit: paiseToRupeesString(p.sale_price_paise), gst: p.gst_rate_bp }]);
            }}
          >
            <option value="">Add a product…</option>
            {products.data?.products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.sku}: {p.name}
              </option>
            ))}
          </select>
          <Plus size={18} aria-hidden />
        </div>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="q-disc">Discount</label>
            <div className="input-affix">
              <span className="affix">₹</span>
              <input id="q-disc" className="input num" inputMode="decimal" value={discount} onChange={(e) => setDiscount(e.target.value)} aria-invalid={rupeesToPaise(discount || '0') === null || disc > subtotal} />
            </div>
            {disc > subtotal && <span className="field-error">More than the subtotal</span>}
          </div>
          <div className="field">
            <label htmlFor="q-adv">Advance to confirm</label>
            <div className="input-affix">
              <input id="q-adv" className="input num" inputMode="numeric" value={advance} onChange={(e) => setAdvance(e.target.value)} />
              <span className="affix">%</span>
            </div>
          </div>
          <div className="field">
            <label htmlFor="q-valid">Valid until</label>
            <input id="q-valid" type="date" className="input" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
          </div>
          <div className="field">
            <span className="field-label">New total</span>
            <span className="stat-value">{formatINR(subtotal - disc + tax)}</span>
          </div>
          <div className="field span-2">
            <label htmlFor="q-notes">Note on the quote</label>
            <textarea id="q-notes" className="textarea" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
        <div className="form-actions">
          <Button variant="dark" busy={busy} disabled={bad || !dirty || disc > subtotal || !lines.length} onClick={save}>
            Save changes
          </Button>
        </div>
        {bad && <p className="field-error">Every line needs a quantity above 0 and a rate in rupees.</p>}
      </div>
    </Panel>
  );
}

function AcceptDialog({ open, onClose, quoteId, customer }: { open: boolean; onClose: () => void; quoteId: number; customer: string }) {
  const form = useZodForm(quoteAcceptSchema, { name: customer, agree: false as never });
  const [error, setError] = useState<string | null>(null);
  const nav = useNavigate();
  const toast = useToast();
  return (
    <Dialog open={open} onClose={onClose} title="Record the customer’s yes" description="Use this when the customer accepts on the phone or in person. It creates the job; the warehouse and crew are told once the advance arrives.">
      <form
        noValidate
        className="stack"
        onSubmit={form.handleSubmit(async (v) => {
          setError(null);
          try {
            const r = await api.post<{ jobId: number; jobRef: string }>(`/api/quotes/${quoteId}/accept`, v);
            toast(`Accepted. Job ${r.jobRef} created; collect the advance to confirm it.`);
            nav(`/app/jobs/${r.jobId}`);
          } catch (e) {
            setError(applyServerError(form, e));
          }
        })}
      >
        <FormError message={error} />
        <TextField form={form as never} name="name" label="Accepted by" />
        <label className="check">
          <input type="checkbox" {...form.register('agree')} />
          <span>The customer agreed to this quote, its total and the advance.</span>
        </label>
        {form.formState.errors.agree && <span className="field-error">{String(form.formState.errors.agree.message)}</span>}
        <div className="form-actions">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" busy={form.formState.isSubmitting}>
            Accept and create the job
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function DeclineDialog({ open, onClose, quoteId }: { open: boolean; onClose: () => void; quoteId: number }) {
  const form = useZodForm(quoteDeclineSchema, { reason: '' });
  const [error, setError] = useState<string | null>(null);
  const qc = useQueryClient();
  return (
    <Dialog open={open} onClose={onClose} title="Mark the quote declined">
      <form
        noValidate
        className="stack"
        onSubmit={form.handleSubmit(async (v) => {
          setError(null);
          try {
            await api.post(`/api/quotes/${quoteId}/decline`, v);
            void qc.invalidateQueries({ queryKey: ['quote'] });
            onClose();
          } catch (e) {
            setError(applyServerError(form, e));
          }
        })}
      >
        <FormError message={error} />
        <TextArea form={form as never} name="reason" label="Why" rows={3} />
        <div className="form-actions">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="danger" busy={form.formState.isSubmitting}>
            Mark declined
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
