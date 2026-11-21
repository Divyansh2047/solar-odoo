import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CATEGORY_LABEL, SERIAL_STATUS_LABEL, formatDate, formatDateTime, formatINR, formatQty, stockAdjustSchema, type SerialStatus } from '@arka/shared';
import { api } from '../../lib/api';
import { useSession } from '../../lib/session';
import { Button, ErrorBlock, KV, PageHead, Panel, SkeletonRows } from '../../components/ui';
import { Dialog, useToast } from '../../components/overlay';
import { applyServerError, FormError, TextField, useZodForm } from '../../components/form';
import { ProductDialog, type Product } from './Catalog';

export default function ProductDetail() {
  const { id } = useParams();
  const q = useQuery({
    queryKey: ['stock', id],
    queryFn: () =>
      api.get<{
        product: Product;
        moves: { id: number; direction: 'in' | 'out'; qty: number; unit_cost_paise: number | null; reason: string; created_at: string; job_ref: string | null; job_id: number | null; ticket_ref: string | null; purchase_ref: string | null; serial: string | null; note: string | null }[];
        serials: { id: number; serial: string; status: SerialStatus; warranty_end: string | null; customer: string | null; job_ref: string | null }[];
      }>(`/api/stock/${id}`),
  });
  const { can } = useSession();
  const [dlg, setDlg] = useState<null | 'edit' | 'count'>(null);
  useEffect(() => {
    if (q.data) document.title = `${q.data.product.name} · Arka`;
  }, [q.data]);
  if (q.isLoading) return <div className="page"><SkeletonRows rows={8} /></div>;
  if (q.isError) return <div className="page"><ErrorBlock error={q.error} retry={() => q.refetch()} /></div>;
  const { product: p, moves, serials } = q.data!;
  const reason: Record<string, string> = { purchase: 'Received', dispatch: 'Dispatched', service_part: 'Used in a repair', adjustment: 'Stock count', return: 'Returned' };
  return (
    <div className="page">
      <PageHead
        back={{ to: '/app/catalog', label: 'Catalogue' }}
        title={p.name}
        actions={
          can('catalog.write') && (
            <>
              {p.tracking === 'quantity' && <Button onClick={() => setDlg('count')}>Count stock</Button>}
              <Button variant="primary" onClick={() => setDlg('edit')}>
                Edit
              </Button>
            </>
          )
        }
      >
        <p className="muted" style={{ marginTop: 6 }}>
          <span className="mono">{p.sku}</span>, {CATEGORY_LABEL[p.category]}
        </p>
      </PageHead>
      <div className="split">
        <div className="stack">
          <Panel title="Stock movements">
            <table className="table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>What</th>
                  <th className="r">Qty</th>
                  <th className="r">At cost</th>
                </tr>
              </thead>
              <tbody>
                {moves.map((m) => (
                  <tr key={m.id}>
                    <td className="nowrap">{formatDateTime(m.created_at)}</td>
                    <td>
                      {reason[m.reason] ?? m.reason}{' '}
                      {m.job_id ? (
                        <Link to={`/app/jobs/${m.job_id}`} className="mono">
                          {m.job_ref}
                        </Link>
                      ) : (
                        <span className="mono">{m.ticket_ref ?? m.purchase_ref}</span>
                      )}
                      {m.serial && <div className="cell-sub mono">{m.serial}</div>}
                      {m.note && <div className="cell-sub">{m.note}</div>}
                    </td>
                    <td className="r num" style={{ color: m.direction === 'in' ? 'var(--good)' : 'var(--bad)', fontWeight: 700 }}>
                      {m.direction === 'in' ? '+' : '−'}
                      {formatQty(m.qty)}
                    </td>
                    <td className="r num">{m.unit_cost_paise === null ? '—' : formatINR(Math.round(m.qty * m.unit_cost_paise))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        </div>
        <div className="stack">
          <Panel title="Now">
            <div className="panel-body">
              <KV
                items={[
                  ['On hand', p.tracking === 'none' ? 'Not stocked' : formatQty(p.on_hand, p.uom === 'unit' ? undefined : p.uom)],
                  ['Reorder at', formatQty(p.reorder_level)],
                  ['Average cost', p.unit_cost_paise === null ? null : formatINR(p.unit_cost_paise)],
                  ['Price', `${formatINR(p.sale_price_paise)} + ${p.gst_rate_bp / 100}% GST`],
                  ['Warranty', p.warranty_months ? `${p.warranty_months} months from delivery` : null],
                  ['HSN/SAC', p.hsn],
                ]}
              />
            </div>
          </Panel>
          {p.tracking === 'serial' && (
            <Panel title="Serial numbers">
              <div className="panel-body tight" style={{ display: 'grid', gap: 6, maxHeight: 520, overflow: 'auto' }}>
                {serials.map((s) => (
                  <div key={s.id} className="row between" style={{ fontSize: 14 }}>
                    <Link className="mono" to={`/app/serials/${s.id}`}>
                      {s.serial}
                    </Link>
                    <span className="muted">
                      {SERIAL_STATUS_LABEL[s.status]}
                      {s.customer ? `: ${s.customer}` : ''}
                      {s.warranty_end ? `, to ${formatDate(s.warranty_end)}` : ''}
                    </span>
                  </div>
                ))}
              </div>
            </Panel>
          )}
        </div>
      </div>
      {dlg === 'edit' && <ProductDialog product={p} onClose={() => setDlg(null)} />}
      {dlg === 'count' && <CountDialog product={p} onClose={() => setDlg(null)} />}
    </div>
  );
}

function CountDialog({ product, onClose }: { product: Product; onClose: () => void }) {
  const form = useZodForm(stockAdjustSchema, { productId: product.id, countedQty: product.on_hand as never, reason: '' });
  const [error, setError] = useState<string | null>(null);
  const qc = useQueryClient();
  const toast = useToast();
  return (
    <Dialog open onClose={onClose} title={`Count ${product.name}`} description={`The system says ${formatQty(product.on_hand)}. The difference is posted to the stock ledger.`}>
      <form
        noValidate
        className="stack"
        onSubmit={form.handleSubmit(async (v) => {
          setError(null);
          try {
            const r = await api.post<{ delta: number }>('/api/stock/adjust', v);
            toast(r.delta === 0 ? 'Count matches. Nothing changed.' : `Adjusted by ${r.delta > 0 ? '+' : ''}${r.delta}.`);
            void qc.invalidateQueries({ queryKey: ['stock'] });
            void qc.invalidateQueries({ queryKey: ['products'] });
            onClose();
          } catch (e) {
            setError(applyServerError(form, e));
          }
        })}
      >
        <FormError message={error} />
        <TextField form={form as never} name="countedQty" label="Counted on the shelf" inputMode="decimal" />
        <TextField form={form as never} name="reason" label="Reason" placeholder="Monthly count, damaged reel…" />
        <div className="form-actions">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" busy={form.formState.isSubmitting}>
            Save count
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
