import type { ReactNode } from 'react';
import { INVOICE_STATUS_LABEL, PAYMENT_METHOD_LABEL, formatDate, formatINR, formatQty, type InvoiceStatus, type PaymentMethod } from '@arka/shared';

export interface InvoiceData {
  invoice: {
    id: number;
    number: string;
    kind: 'system' | 'service';
    status: InvoiceStatus;
    issued_on: string;
    due_on: string;
    subtotal_paise: number;
    discount_paise: number;
    tax_paise: number;
    total_paise: number;
    paid_paise: number;
    customer: string;
    address: string;
    city: string;
    pincode: string;
    phone: string;
    job_ref: string | null;
    ticket_ref: string | null;
    company_name: string;
    company_address: string | null;
    company_gstin: string | null;
    company_phone: string | null;
    public_token: string;
    void_reason: string | null;
  };
  lines: { id: number; description: string; hsn: string | null; qty: number; unit_price_paise: number; gst_rate_bp: number; amount_paise: number }[];
  payments: { ref: string; amount_paise: number; method: PaymentMethod; received_on: string; reference: string | null }[];
}

/** A GST tax invoice, readable on a phone and printable on A4. */
export function InvoiceDocument({ data, footer }: { data: InvoiceData; footer?: ReactNode }) {
  const i = data.invoice;
  const due = i.total_paise - i.paid_paise;
  // GST split for an intra-state supply: half CGST, half SGST
  const byRate = new Map<number, number>();
  for (const l of data.lines) byRate.set(l.gst_rate_bp, (byRate.get(l.gst_rate_bp) ?? 0) + l.amount_paise);
  return (
    <article className="doc">
      <header className="doc-head">
        <div>
          <p className="muted" style={{ fontWeight: 700 }}>
            {i.company_name}
          </p>
          <h1>Tax invoice</h1>
          <p className="muted">
            {i.company_address}
            {i.company_gstin ? ` GSTIN ${i.company_gstin}` : ''}
          </p>
        </div>
        <dl className="kv" style={{ alignSelf: 'start' }}>
          <dt>Invoice</dt>
          <dd className="mono">{i.number}</dd>
          <dt>Date</dt>
          <dd>{formatDate(i.issued_on)}</dd>
          <dt>Due</dt>
          <dd>{formatDate(i.due_on)}</dd>
          <dt>For</dt>
          <dd className="mono">{i.job_ref ?? i.ticket_ref}</dd>
          <dt>Status</dt>
          <dd>{INVOICE_STATUS_LABEL[i.status]}</dd>
        </dl>
      </header>
      <section>
        <p className="muted" style={{ fontSize: 13 }}>
          Billed to
        </p>
        <p style={{ fontWeight: 700 }}>{i.customer}</p>
        <p className="muted">
          {i.address}, {i.city} {i.pincode}
        </p>
      </section>
      {i.status === 'void' && <div className="form-error">Void: {i.void_reason}</div>}
      <table className="lines">
        <thead>
          <tr>
            <th>Item</th>
            <th className="hide-sm">HSN/SAC</th>
            <th className="r">Qty</th>
            <th className="r hide-sm">Rate</th>
            <th className="r hide-sm">GST</th>
            <th className="r">Amount</th>
          </tr>
        </thead>
        <tbody>
          {data.lines.map((l) => (
            <tr key={l.id}>
              <td>{l.description}</td>
              <td className="mono hide-sm">{l.hsn ?? '—'}</td>
              <td className="r num">{formatQty(l.qty)}</td>
              <td className="r num hide-sm">{formatINR(l.unit_price_paise)}</td>
              <td className="r num hide-sm">{l.gst_rate_bp / 100}%</td>
              <td className="r num">{formatINR(l.amount_paise)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <section className="totals">
        <div>
          <span>Taxable value</span>
          <span className="num">{formatINR(i.subtotal_paise - i.discount_paise)}</span>
        </div>
        {i.discount_paise > 0 && (
          <div className="muted">
            <span>after discount of</span>
            <span className="num">{formatINR(i.discount_paise)}</span>
          </div>
        )}
        {[...byRate].filter(([r]) => r > 0).map(([rate]) => (
          <div key={rate} className="muted">
            <span>
              CGST {rate / 200}% + SGST {rate / 200}%
            </span>
            <span />
          </div>
        ))}
        <div>
          <span>GST</span>
          <span className="num">{formatINR(i.tax_paise)}</span>
        </div>
        <div className="grand">
          <span>Total</span>
          <span className="num">{formatINR(i.total_paise)}</span>
        </div>
        <div>
          <span>Paid</span>
          <span className="num">{formatINR(i.paid_paise)}</span>
        </div>
        <div style={{ fontWeight: 800, color: due > 0 ? 'var(--warn)' : 'var(--good)' }}>
          <span>{due > 0 ? 'Balance due' : 'Paid in full'}</span>
          <span className="num">{due > 0 ? formatINR(due) : ''}</span>
        </div>
      </section>
      {data.payments.length > 0 && (
        <section>
          <h2 style={{ fontSize: 15, marginBottom: 6 }}>Payments received</h2>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14 }}>
            {data.payments.map((p) => (
              <li key={p.ref}>
                {formatDate(p.received_on)}: {formatINR(p.amount_paise)} by {PAYMENT_METHOD_LABEL[p.method]}
                {p.reference ? ` (${p.reference})` : ''}, receipt {p.ref}
              </li>
            ))}
          </ul>
        </section>
      )}
      {footer}
    </article>
  );
}
