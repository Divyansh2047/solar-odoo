import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle } from '@phosphor-icons/react';
import { PM_SURYA_GHAR, publicEnquirySchema, recommendSize, subsidyFor, formatINR } from '@arka/shared';
import { api } from '../../lib/api';
import { PublicShell } from '../../layout/PublicShell';
import { Button, Callout, ErrorBlock, SkeletonRows } from '../../components/ui';
import { applyServerError, CheckField, ChoiceField, FormError, TextArea, TextField, useZodForm } from '../../components/form';

/**
 * The installer's website enquiry form (scene 1). It can be embedded in their own site. The enquiry
 * lands with sales the moment it is sent, and can never vanish.
 */
export default function Enquire() {
  const { key = '' } = useParams();
  const co = useQuery({ queryKey: ['enquire', key], queryFn: () => api.get<{ company: string; phone: string | null }>(`/api/public/enquiry/${key}`), retry: false });
  const [done, setDone] = useState<string | null>(null);
  const form = useZodForm(publicEnquirySchema, {
    name: '',
    phone: '',
    email: '',
    address: '',
    city: '',
    pincode: '',
    customerKind: 'home',
    systemType: 'on_grid',
    requestedKw: '' as never,
    wantsSubsidy: true,
    monthlyBillRupees: '' as never,
    message: '',
    consent: false as never,
    website: '',
  });
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (co.data) document.title = `Get a solar quote from ${co.data.company}`;
  }, [co.data]);
  const bill = Number(form.watch('monthlyBillRupees'));
  const kind = form.watch('customerKind');
  const sys = form.watch('systemType');
  const guess = bill >= 100 ? recommendSize({ monthlyBillPaise: bill * 100 }) : null;
  if (co.isLoading) return <PublicShell><SkeletonRows rows={6} /></PublicShell>;
  if (co.isError) return <PublicShell><ErrorBlock error={co.error} /></PublicShell>;
  return (
    <PublicShell company={co.data!.company} phone={co.data!.phone}>
      <div className="split" style={{ alignItems: 'start' }}>
        <div className="stack">
          <h1 style={{ fontSize: 'clamp(1.8rem, 1.3rem + 2vw, 2.6rem)' }}>Get a rooftop solar quote</h1>
          <p className="muted" style={{ maxWidth: '52ch' }}>
            Tell us about your home or business. Someone from {co.data!.company} calls you back to check your roof, your bill and your grid connection, then a technician visits to measure the
            roof before we quote.
          </p>
          {done ? (
            <Callout tone="good">
              <b>Thank you. Your enquiry {done} has reached our team.</b> We’ll call you soon. Keep this number if you call us.
            </Callout>
          ) : (
            <form
              noValidate
              className="panel panel-body stack"
              onSubmit={form.handleSubmit(async (v) => {
                setError(null);
                try {
                  const r = await api.post<{ ref: string }>(`/api/public/enquiry/${key}`, v);
                  setDone(r.ref);
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                } catch (e) {
                  setError(applyServerError(form, e));
                }
              })}
            >
              <FormError message={error} />
              <ChoiceField
                form={form as never}
                name="customerKind"
                label="Solar for"
                options={[
                  { value: 'home', label: 'My home', sub: 'Eligible for the subsidy' },
                  { value: 'business', label: 'My business', sub: 'Shop, office or factory' },
                ]}
              />
              <div className="form-grid">
                <TextField form={form as never} name="name" label="Your name" autoComplete="name" />
                <TextField form={form as never} name="phone" label="Mobile" type="tel" autoComplete="tel" inputMode="tel" prefix="+91" placeholder="98250 12345" />
                <TextField form={form as never} name="address" label="Address" autoComplete="street-address" className="span-2" placeholder="House number, society, area" />
                <TextField form={form as never} name="city" label="City" autoComplete="address-level2" />
                <TextField form={form as never} name="pincode" label="PIN code" autoComplete="postal-code" inputMode="numeric" maxLength={6} />
                <TextField form={form as never} name="monthlyBillRupees" label="Monthly electricity bill" optional inputMode="numeric" prefix="₹" />
                <TextField form={form as never} name="requestedKw" label="Size you have in mind" optional inputMode="decimal" suffix="kW" />
                <TextField form={form as never} name="email" label="Email" optional type="email" autoComplete="email" className="span-2" />
              </div>
              <ChoiceField
                form={form as never}
                name="systemType"
                label="System"
                options={[
                  { value: 'on_grid', label: 'On-Grid', sub: 'Lowest cost, exports to the grid' },
                  { value: 'off_grid', label: 'Off-Grid', sub: 'With battery backup' },
                  { value: 'not_sure', label: 'Not sure', sub: 'We’ll advise' },
                ]}
              />
              {kind === 'home' && sys !== 'off_grid' && <CheckField form={form as never} name="wantsSubsidy" label="I want the PM Surya Ghar subsidy" hint="Up to ₹78,000 for homes, paid to your bank after installation." />}
              <TextArea form={form as never} name="message" label="Anything else" optional rows={3} />
              <div aria-hidden style={{ position: 'absolute', left: '-10000px' }}>
                <label>
                  Leave this empty
                  <input tabIndex={-1} autoComplete="off" {...form.register('website')} />
                </label>
              </div>
              <CheckField form={form as never} name="consent" label={`${co.data!.company} may call or WhatsApp me about this enquiry.`} />
              <Button type="submit" variant="primary" size="lg" busy={form.formState.isSubmitting}>
                Send enquiry
              </Button>
            </form>
          )}
        </div>
        <aside className="stack">
          <section className="module" aria-label="A rough idea">
            <div className="module-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <div className="module-cell lit">
                <span className="k">A system around</span>
                {guess?.recommendedKw ? <span className="v">{guess.recommendedKw} kW</span> : <span className="v v-hint">Enter your monthly bill</span>}
                <span className="s">{guess?.monthlyUnits ? `for about ${guess.monthlyUnits} units a month` : 'we size it from what you use'}</span>
              </div>
              <div className="module-cell">
                <span className="k">Subsidy, up to</span>
                {kind !== 'home' ? <span className="v v-hint">Homes only</span> : <span className="v">{formatINR(guess?.recommendedKw ? subsidyFor(guess.recommendedKw, sys === 'off_grid' ? 'off_grid' : 'on_grid', kind) : PM_SURYA_GHAR.capPaise)}</span>}
                <span className="s">{kind === 'home' ? 'PM Surya Ghar, on-grid homes' : 'PM Surya Ghar covers homes'}</span>
              </div>
            </div>
          </section>
          <ol className="steps" aria-label="What happens next">
            {['We call you to check the basics.', 'A technician measures your roof.', 'You get a quote with the exact parts list.', 'Advance paid: we pack, deliver and install.', 'Warranty starts on delivery; your serials are on your own page.'].map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ol>
          <p className="muted row" style={{ fontSize: 13, gap: 6, alignItems: 'center' }}>
            <CheckCircle size={16} aria-hidden style={{ flex: 'none' }} /> Your details are used only for this enquiry.
          </p>
        </aside>
      </div>
    </PublicShell>
  );
}
