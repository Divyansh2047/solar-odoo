import type { ReactNode } from 'react';
import { CATEGORY_LABEL, formatDate, formatINR, formatKw, formatQty, KIT_KIND_LABEL, type ProductCategory } from '@arka/shared';
import { Kit3D } from './Kit3D';

export interface QuoteData {
  quote: {
    id: number;
    ref: string;
    version: number;
    status: string;
    kind: 'on_grid' | 'off_grid' | 'panel_set' | 'service';
    capacity_kw: number;
    valid_until: string;
    subtotal_paise: number;
    discount_paise: number;
    tax_paise: number;
    total_paise: number;
    subsidy_paise: number;
    advance_percent: number;
    notes: string | null;
    created_at: string;
    sent_at: string | null;
    customer: string;
    phone: string;
    address: string;
    city: string;
    pincode: string;
    customer_kind: 'home' | 'business';
    template_name: string;
    survey_ref: string;
    azimuth_deg: number;
    tilt_deg: number;
    cable_distance_m: number;
    company_name: string;
    company_phone: string | null;
    company_email: string | null;
    company_address: string | null;
    company_gstin: string | null;
    accepted_name: string | null;
    public_token: string;
    job_id?: number | null;
    job_ref?: string | null;
  };
  lines: { id: number; description: string; qty: number; unit_price_paise: number; gst_rate_bp: number; amount_paise: number; sku: string; category: ProductCategory; uom: string; rule_explain?: string | null }[];
  generation: { annualUnits: number; monthlyUnits: number; factor: number; monthlySavingsPaise: number };
  paybackYears: number | null;
}

/** The quote as the customer reads it. Used inside the app, on the public link and in print. */
export function QuoteDocument({ data, footer, showRules }: { data: QuoteData; footer?: ReactNode; showRules?: boolean }) {
  const q = data.quote;
  const count = (cat: ProductCategory) => data.lines.filter((l) => l.category === cat).reduce((s, l) => s + Number(l.qty), 0);
  const net = q.total_paise - q.subsidy_paise;
  return (
    <article className="doc">
      <header className="doc-head">
        <div>
          <p className="muted" style={{ fontWeight: 700 }}>
            {q.company_name}
          </p>
          <h1>
            {formatKw(q.capacity_kw)} {KIT_KIND_LABEL[q.kind]}
          </h1>
          <p className="muted">
            For {q.customer}, {q.address}, {q.city} {q.pincode}
          </p>
        </div>
        <dl className="kv" style={{ alignSelf: 'start' }}>
          <dt>Quote</dt>
          <dd className="mono">
            {q.ref} v{q.version}
          </dd>
          <dt>Date</dt>
          <dd>{formatDate(q.sent_at ?? q.created_at)}</dd>
          <dt>Valid until</dt>
          <dd>{formatDate(q.valid_until)}</dd>
          <dt>Based on</dt>
          <dd>Roof survey {q.survey_ref}</dd>
        </dl>
      </header>

      <section className="savings" aria-label="What this system does for you">
        <div className="sunny">
          <span>Expected generation</span>
          <b>{data.generation.monthlyUnits} units/month</b>
          <span>{data.generation.annualUnits.toLocaleString('en-IN')} a year at this roof</span>
        </div>
        <div>
          <span>Saving on your bill</span>
          <b>{formatINR(data.generation.monthlySavingsPaise)}/month</b>
          <span>at ₹7.50 a unit</span>
        </div>
        <div>
          <span>{q.subsidy_paise ? 'Government subsidy (estimate)' : 'Subsidy'}</span>
          <b>{q.subsidy_paise ? formatINR(q.subsidy_paise) : 'Not applicable'}</b>
          <span>{q.subsidy_paise ? 'PM Surya Ghar, paid to your bank' : q.kind === 'off_grid' ? 'Off-grid systems don’t qualify' : 'Homes only'}</span>
        </div>
        <div>
          <span>Pays for itself in</span>
          <b>{data.paybackYears ? `${data.paybackYears} years` : '—'}</b>
          <span>after the subsidy</span>
        </div>
      </section>

      {q.kind !== 'service' && (
        <section aria-label="Your system in 3D" className="no-print">
          <Kit3D
            kind={q.kind}
            panels={count('panel')}
            inverters={count('inverter')}
            batteries={count('battery')}
            controllers={count('charge_controller')}
            height={300}
            labels={[
              { part: 'panel', title: `${count('panel')} panels`, detail: '20-year warranty' },
              { part: 'inverter', title: 'Inverter', detail: '2-year warranty' },
              ...(count('battery') ? [{ part: 'battery' as const, title: `${count('battery')} ${count('battery') === 1 ? 'battery' : 'batteries'}`, detail: '2-year warranty' }] : []),
            ]}
          />
        </section>
      )}

      <section aria-label="Parts list">
        <h2 style={{ marginBottom: 8 }}>Everything in the kit</h2>
        <table className="lines">
          <thead>
            <tr>
              <th>Item</th>
              <th className="r">Qty</th>
              <th className="r hide-sm">Rate</th>
              <th className="r hide-sm">GST</th>
              <th className="r">Amount</th>
            </tr>
          </thead>
          <tbody>
            {data.lines.map((l) => (
              <tr key={l.id}>
                <td>
                  {l.description}
                  <span className="muted" style={{ display: 'block', fontSize: 12 }}>
                    {CATEGORY_LABEL[l.category]}
                    {showRules && l.rule_explain ? `: ${l.rule_explain}` : ''}
                  </span>
                </td>
                <td className="r num">{formatQty(l.qty, l.uom === 'unit' ? undefined : l.uom)}</td>
                <td className="r num hide-sm">{formatINR(l.unit_price_paise)}</td>
                <td className="r num hide-sm">{l.gst_rate_bp / 100}%</td>
                <td className="r num">{formatINR(l.amount_paise)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="totals" aria-label="Totals">
        <div>
          <span>Subtotal</span>
          <span className="num">{formatINR(q.subtotal_paise)}</span>
        </div>
        {q.discount_paise > 0 && (
          <div>
            <span>Discount</span>
            <span className="num">−{formatINR(q.discount_paise)}</span>
          </div>
        )}
        <div>
          <span>GST</span>
          <span className="num">{formatINR(q.tax_paise)}</span>
        </div>
        <div className="grand">
          <span>Total</span>
          <span className="num">{formatINR(q.total_paise)}</span>
        </div>
        {q.subsidy_paise > 0 && (
          <div className="muted">
            <span>Your cost after the subsidy</span>
            <span className="num">{formatINR(net)}</span>
          </div>
        )}
        <div className="muted">
          <span>Advance to confirm ({q.advance_percent}%)</span>
          <span className="num">{formatINR(Math.round((q.total_paise * q.advance_percent) / 100))}</span>
        </div>
      </section>

      <section style={{ display: 'grid', gap: 6, fontSize: 14 }} className="muted">
        <p>
          Warranty starts on delivery: solar panels 20 years, inverter, battery and charge controller 2 years, installation workmanship 1 year. Every unit’s serial number is recorded and
          shown on your customer page.
        </p>
        {q.notes && <p style={{ whiteSpace: 'pre-wrap', color: 'var(--ink)' }}>{q.notes}</p>}
        <p>
          {q.company_name}
          {q.company_address ? `, ${q.company_address}` : ''}
          {q.company_gstin ? `. GSTIN ${q.company_gstin}` : ''}
          {q.company_phone ? `. ${q.company_phone}` : ''}
        </p>
      </section>
      {footer}
    </article>
  );
}
