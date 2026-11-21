import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from '@phosphor-icons/react';
import {
  CATEGORY_LABEL,
  KIT_KIND_LABEL,
  PRODUCT_CATEGORIES,
  QTY_RULE_LABEL,
  UOM_LABEL,
  UOMS,
  formatQty,
  paiseToRupeesString,
  productSchema,
  rupees,
  type ProductCategory,
} from '@arka/shared';
import { api } from '../../lib/api';
import { useSession } from '../../lib/session';
import { Button, Chip, Empty, ErrorBlock, Money, PageHead, Panel, Seg, SkeletonRows } from '../../components/ui';
import { DataTable } from '../../components/table';
import { Dialog, useToast } from '../../components/overlay';
import { applyServerError, FormError, SelectField, TextField, useZodForm } from '../../components/form';

export interface Product {
  id: number;
  sku: string;
  name: string;
  category: ProductCategory;
  tracking: 'serial' | 'quantity' | 'none';
  uom: keyof typeof UOM_LABEL;
  unit_cost_paise: number | null;
  sale_price_paise: number;
  gst_rate_bp: number;
  warranty_months: number | null;
  capacity_w: number | null;
  hsn: string | null;
  reorder_level: number;
  on_hand: number;
  promised: number;
  status: string;
}

export default function Catalog() {
  const [tab, setTab] = useState<'stock' | 'kits'>('stock');
  const { can } = useSession();
  const [edit, setEdit] = useState<Product | 'new' | null>(null);
  useEffect(() => {
    document.title = 'Catalogue · Arka';
  }, []);
  return (
    <div className="page">
      <PageHead
        title="Catalogue"
        lead="Products, prices, stock and kit templates."
        actions={
          can('catalog.write') &&
          tab === 'stock' && (
            <Button variant="primary" icon={<Plus size={18} />} onClick={() => setEdit('new')}>
              Add product
            </Button>
          )
        }
      />
      <Seg label="Section"
        variant="tabs" value={tab} onChange={setTab} options={[{ value: 'stock', label: 'Products and stock' }, { value: 'kits', label: 'Kit templates' }]} />
      {tab === 'stock' ? <Stock onEdit={can('catalog.write') ? setEdit : undefined} /> : <Kits />}
      {edit && <ProductDialog product={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function Stock({ onEdit }: { onEdit?: (p: Product) => void }) {
  const q = useQuery({ queryKey: ['products'], queryFn: () => api.get<{ products: Product[] }>('/api/products') });
  if (q.isLoading) return <SkeletonRows />;
  if (q.isError) return <ErrorBlock error={q.error} retry={() => q.refetch()} />;
  return (
    <Panel>
      <DataTable
        rows={q.data!.products}
        rowKey={(r) => r.id}
        to={(r) => `/app/catalog/${r.id}`}
        rowTone={(r) => (r.tracking !== 'none' && r.on_hand <= r.reorder_level ? 'hot' : undefined)}
        empty={<Empty title="No products yet" />}
        columns={[
          { header: 'Product', cell: (r) => (<><span className="cell-main">{r.name}</span><div className="cell-sub"><span className="mono">{r.sku}</span>, {CATEGORY_LABEL[r.category]}</div></>) },
          { header: 'Tracked by', cell: (r) => (r.tracking === 'serial' ? `Serial, ${r.warranty_months! >= 12 ? `${r.warranty_months! / 12} yr` : `${r.warranty_months} mo`} warranty` : r.tracking === 'quantity' ? 'Quantity' : 'Service') },
          { header: 'On hand', className: 'r', cell: (r) => (r.tracking === 'none' ? '—' : <span style={{ color: r.on_hand <= r.reorder_level ? 'var(--bad)' : undefined, fontWeight: 700 }}>{formatQty(r.on_hand, r.uom === 'unit' ? undefined : r.uom)}</span>) },
          { header: 'Promised', className: 'r', cell: (r) => (r.tracking === 'none' ? '—' : formatQty(Number(r.promised))) },
          { header: 'Cost', className: 'r', cell: (r) => <Money paise={r.unit_cost_paise} /> },
          { header: 'Price', className: 'r', cell: (r) => <Money paise={r.sale_price_paise} /> },
          { header: 'GST', className: 'r', cell: (r) => `${r.gst_rate_bp / 100}%` },
          ...(onEdit ? [{ header: '', cell: (r: Product) => <Button size="sm" onClick={(e) => (e.preventDefault(), onEdit(r))}>Edit</Button> }] : []),
        ]}
        card={(r) => ({ title: r.name, right: r.tracking === 'none' ? <Chip plain>Service</Chip> : <b className="num">{formatQty(r.on_hand, r.uom === 'unit' ? undefined : r.uom)} on hand</b>, meta: [r.sku, CATEGORY_LABEL[r.category], r.tracking !== 'none' && Number(r.promised) > 0 ? `${formatQty(Number(r.promised))} promised` : null], extra: <Money paise={r.sale_price_paise} /> })}
      />
    </Panel>
  );
}

function Kits() {
  const q = useQuery({
    queryKey: ['kits'],
    queryFn: () => api.get<{ kits: { id: number; code: string; name: string; kind: keyof typeof KIT_KIND_LABEL; capacity_kw: number | null; description: string; lines: { product_id: number; sku: string; name: string; qty_rule: keyof typeof QTY_RULE_LABEL; qty: number; uom: string; sale_price_paise: number }[] }[] }>('/api/kits'),
  });
  if (q.isLoading) return <SkeletonRows />;
  return (
    <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))' }}>
      {q.data?.kits.map((k) => (
        <Panel key={k.id} title={k.name} actions={<span className="mono muted">{k.code}</span>}>
          <div className="panel-body stack">
            <p className="muted" style={{ fontSize: 14 }}>
              {k.description}
            </p>
            <table className="table">
              <tbody>
                {k.lines.map((l) => (
                  <tr key={l.product_id}>
                    <td style={{ paddingLeft: 0 }}>
                      {l.name}
                      <div className="cell-sub">{QTY_RULE_LABEL[l.qty_rule]}</div>
                    </td>
                    <td className="r num" style={{ paddingRight: 0 }}>
                      {l.qty_rule === 'cable_run' ? `${l.qty} × run` : l.qty_rule === 'per_kw' ? `${l.qty} / kW` : l.qty_rule === 'per_panel' ? `${l.qty} / panel` : formatQty(l.qty)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      ))}
    </div>
  );
}

export function ProductDialog({ product, onClose }: { product: Product | null; onClose: () => void }) {
  const schema = productSchema.safeExtend({ unitCostPaise: rupees('Enter the cost'), salePricePaise: rupees('Enter the price') }) as unknown as typeof productSchema;
  const form = useZodForm(schema, {
    sku: product?.sku ?? '',
    name: product?.name ?? '',
    category: product?.category ?? 'accessory',
    tracking: product?.tracking ?? 'quantity',
    uom: product?.uom ?? 'unit',
    unitCostPaise: (product && product.unit_cost_paise !== null ? paiseToRupeesString(product.unit_cost_paise) : '') as never,
    salePricePaise: (product ? paiseToRupeesString(product.sale_price_paise) : '') as never,
    gstRateBp: (product?.gst_rate_bp ?? 500) as never,
    warrantyMonths: (product?.warranty_months ?? '') as never,
    capacityW: (product?.capacity_w ?? '') as never,
    hsn: product?.hsn ?? '',
    reorderLevel: (product?.reorder_level ?? 0) as never,
  });
  const [error, setError] = useState<string | null>(null);
  const qc = useQueryClient();
  const toast = useToast();
  const tracking = form.watch('tracking');
  return (
    <Dialog open onClose={onClose} wide title={product ? `Edit ${product.name}` : 'Add a product'} description="Price changes apply to new quotes; quotes already sent keep their prices.">
      <form
        noValidate
        className="stack"
        onSubmit={form.handleSubmit(async (v) => {
          setError(null);
          try {
            if (product) await api.put(`/api/products/${product.id}`, v);
            else await api.post('/api/products', v);
            toast(product ? 'Product saved.' : 'Product added.');
            void qc.invalidateQueries({ queryKey: ['products'] });
            onClose();
          } catch (e) {
            setError(applyServerError(form, e));
          }
        })}
      >
        <FormError message={error} />
        <div className="form-grid cols-3">
          <TextField form={form as never} name="sku" label="SKU" className="mono" autoCapitalize="characters" />
          <TextField form={form as never} name="name" label="Name" className="span-2" />
          <SelectField form={form as never} name="category" label="Category" options={PRODUCT_CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABEL[c] }))} />
          <SelectField form={form as never} name="tracking" label="Tracked by" options={[{ value: 'serial', label: 'Serial number' }, { value: 'quantity', label: 'Quantity' }, { value: 'none', label: 'Not stocked (service)' }]} />
          <SelectField form={form as never} name="uom" label="Unit" options={UOMS.map((u) => ({ value: u, label: UOM_LABEL[u] }))} />
          <TextField form={form as never} name="unitCostPaise" label="Cost" prefix="₹" inputMode="decimal" />
          <TextField form={form as never} name="salePricePaise" label="Price" prefix="₹" inputMode="decimal" />
          <SelectField form={form as never} name="gstRateBp" label="GST" options={[0, 500, 1200, 1800, 2800].map((r) => ({ value: r, label: `${r / 100}%` }))} />
          {tracking === 'serial' && <TextField form={form as never} name="warrantyMonths" label="Warranty" suffix="months" inputMode="numeric" hint="240 = 20 years" />}
          <TextField form={form as never} name="capacityW" label="Capacity" optional suffix="W or Wh" inputMode="numeric" />
          <TextField form={form as never} name="hsn" label="HSN/SAC" optional inputMode="numeric" />
          {tracking !== 'none' && <TextField form={form as never} name="reorderLevel" label="Reorder at" optional inputMode="decimal" />}
        </div>
        <div className="form-actions">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" busy={form.formState.isSubmitting}>
            {product ? 'Save product' : 'Add product'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
