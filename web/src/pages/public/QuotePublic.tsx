import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { quoteAcceptSchema, quoteDeclineSchema, formatDate, formatINR } from '@arka/shared';
import { api } from '../../lib/api';
import { PublicShell } from '../../layout/PublicShell';
import { Button, Callout, ErrorBlock, SkeletonRows } from '../../components/ui';
import { QuoteDocument, type QuoteData } from '../../components/QuoteDocument';
import { applyServerError, CheckField, FormError, TextArea, TextField, useZodForm } from '../../components/form';

/** The customer reads the quote and says yes (or no) online. */
export default function QuotePublic() {
  const { token = '' } = useParams();
  const q = useQuery({ queryKey: ['public-quote', token], queryFn: () => api.get<QuoteData>(`/api/public/quotes/${token}`), retry: false });
  useEffect(() => {
    if (q.data) document.title = `Your solar quote ${q.data.quote.ref}`;
  }, [q.data]);
  if (q.isLoading) return <PublicShell><SkeletonRows rows={8} /></PublicShell>;
  if (q.isError) return <PublicShell><ErrorBlock error={q.error} /></PublicShell>;
  const d = q.data!;
  return (
    <PublicShell company={d.quote.company_name} phone={d.quote.company_phone}>
      <div className="stack">
        <QuoteDocument data={d} footer={<Decision data={d} token={token} />} />
      </div>
    </PublicShell>
  );
}

function Decision({ data, token }: { data: QuoteData; token: string }) {
  const q = data.quote;
  const qc = useQueryClient();
  const [mode, setMode] = useState<'accept' | 'decline'>('accept');
  const acc = useZodForm(quoteAcceptSchema, { name: q.customer, agree: false as never });
  const dec = useZodForm(quoteDeclineSchema, { reason: '' });
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const expired = q.valid_until < new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
  if (q.status === 'accepted' || done) return <Callout tone="good">{done ?? `Accepted by ${q.accepted_name}. Thank you.`} {q.company_name} will confirm the advance and book your installation.</Callout>;
  if (q.status === 'rejected') return <Callout tone="warn">You declined this quote. Call {q.company_name} if you’d like a revised one.</Callout>;
  if (q.status === 'expired' || expired) return <Callout tone="warn">This quote expired on {formatDate(q.valid_until)}. Call {q.company_name} for a fresh one.</Callout>;
  return (
    <section className="panel panel-body stack no-print" aria-label="Your decision">
      <h2>Ready to go ahead?</h2>
      <p className="muted">
        Accepting confirms the order at {formatINR(q.total_paise)} including GST. An advance of {formatINR(Math.round((q.total_paise * q.advance_percent) / 100))} confirms it; the rest is due after installation.
      </p>
      {error && <FormError message={error} />}
      {mode === 'accept' ? (
        <form
          noValidate
          className="stack"
          onSubmit={acc.handleSubmit(async (v) => {
            setError(null);
            try {
              const r = await api.post<{ jobRef: string }>(`/api/public/quotes/${token}/accept`, v);
              setDone(`Accepted. Your order reference is ${r.jobRef}.`);
              void qc.invalidateQueries({ queryKey: ['public-quote'] });
            } catch (e) {
              setError(applyServerError(acc, e));
            }
          })}
        >
          <TextField form={acc as never} name="name" label="Your full name" />
          <CheckField form={acc as never} name="agree" label="I accept this quote, its total and the advance." />
          <div className="row">
            <Button type="submit" variant="primary" size="lg" busy={acc.formState.isSubmitting}>
              Accept the quote
            </Button>
            <button type="button" className="link-btn" onClick={() => setMode('decline')}>
              Not now
            </button>
          </div>
        </form>
      ) : (
        <form
          noValidate
          className="stack"
          onSubmit={dec.handleSubmit(async (v) => {
            setError(null);
            try {
              await api.post(`/api/public/quotes/${token}/decline`, v);
              void qc.invalidateQueries({ queryKey: ['public-quote'] });
            } catch (e) {
              setError(applyServerError(dec, e));
            }
          })}
        >
          <TextArea form={dec as never} name="reason" label="Tell us why, so we can do better" rows={3} />
          <div className="row">
            <Button type="submit" variant="danger" busy={dec.formState.isSubmitting}>
              Decline the quote
            </Button>
            <button type="button" className="link-btn" onClick={() => setMode('accept')}>
              Back
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
