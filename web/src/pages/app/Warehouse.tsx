import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash } from '@phosphor-icons/react';
import { PICK_STATUS_LABEL, formatDate, formatINR, formatINRShort, formatKw, formatQty, isoDateInTz, paiseToRupeesString, rupeesToPaise, type PickStatus } from '@arka/shared';
import { api, ApiError } from '../../lib/api';
import { useSession } from '../../lib/session';
import { Button, Chip, Empty, ErrorBlock, Money, PageHead, Panel, SkeletonRows, type Tone } from '../../components/ui';
import { Dialog, useToast } from '../../components/overlay';

const PICK_TONE: Record<PickStatus, Tone> = { waiting_stock: 'warn', ready: 'info', packed: 'sun', dispatched: 'sun', delivered: 'good', cancelled: 'neutral' };

interface Pick {
  id: number;
  ref: string;
  status: PickStatus;
  job_id: number;
  job_ref: string;
  kind: string;
  capacity_kw: number;
  customer: string;
  city: string;
  install_at: string | null;
  serials_needed: number;
  serials_scanned: number;
  est_value_paise: number | null;
  goods_value_paise: number | null;
  vehicle_no: string | null;
  dispatched_at: string | null;
}

export default function Warehouse() {
  const q = useQuery({
    queryKey: ['warehouse'],
    queryFn: () => api.get<{ picks: Pick[]; lowStock: { id: number; sku: string; name: string; on_hand: number; reorder_level: number; uom: string }[]; purchases: { id: number; ref: string; received_on: string; total_paise: number; supplier: string; lines: number }[]; onTruck: { v: number | null; n: number } }>('/api/warehouse'),
  });
  const { can } = useSession();
  const [receive, setReceive] = useState(false);
  useEffect(() => {
    document.title = 'Warehouse · Arka';
  }, []);
  if (q.isLoading) return <div className="page"><SkeletonRows rows={8} /></div>;
  if (q.isError) return <div className="page"><ErrorBlock error={q.error} retry={() => q.refetch()} /></div>;
  const d = q.data!;
  const by = (s: PickStatus[]) => d.picks.filter((p) => s.includes(p.status));
  return (
    <div className="page">
      <PageHead
        title="What needs packing, and what’s on the trucks?"
        lead="A pick list is made the moment an order is confirmed. Every inverter, battery, charge controller and panel is scanned before it leaves."
        actions={
          can('stock.write') && (
            <Button variant="primary" icon={<Plus size={18} />} onClick={() => setReceive(true)}>
              Receive stock
            </Button>
          )
        }
      />
      <section className="module" aria-label="Warehouse now">
        <div className="module-grid">
          <div className="module-cell lit">
            <span className="k">To scan and pack</span>
            <span className="v">{by(['ready']).length}</span>
            <span className="s">{by(['packed']).length} packed, waiting for the truck</span>
          </div>
          <div className={`module-cell ${by(['waiting_stock']).length ? 'alert' : ''}`}>
            <span className="k">Short of stock</span>
            <span className="v">{by(['waiting_stock']).length}</span>
            <span className="s">move to packing when the stock is received</span>
          </div>
          <div className="module-cell">
            <span className="k">On the trucks now</span>
            <span className="v">{d.onTruck.v === null || d.onTruck.n === 0 ? d.onTruck.n : formatINRShort(d.onTruck.v)}</span>
            <span className="s">{d.onTruck.n === 0 ? 'nothing out for delivery' : d.onTruck.v === null ? 'kits out for delivery' : `${d.onTruck.n} kits, at cost`}</span>
          </div>
          <div className={`module-cell ${d.lowStock.length ? 'alert' : ''}`}>
            <span className="k">At reorder level</span>
            <span className="v">{d.lowStock.length}</span>
            <span className="s">products</span>
          </div>
        </div>
      </section>
      <div className="split">
        <div className="stack">
          <PickGroup title="Packed: load and dispatch" picks={by(['packed'])} empty="Nothing packed and waiting." />
          <PickGroup title="Ready to scan and pack" picks={by(['ready'])} empty="Nothing waiting to be packed." />
          <PickGroup title="Short of stock" picks={by(['waiting_stock'])} empty="No pick list is short." />
          <PickGroup title="On the truck" picks={by(['dispatched'])} empty="No kit is out right now." />
          <PickGroup title="Delivered this week" picks={by(['delivered'])} empty="No deliveries in the last 7 days." />
        </div>
        <div className="stack">
          <Panel title="At or below reorder level" actions={<Link to="/app/catalog">All stock</Link>}>
            <div className="panel-body tight">
              {!d.lowStock.length ? (
                <p className="muted">Stock is healthy.</p>
              ) : (
                <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
                  {d.lowStock.map((p) => (
                    <li key={p.id} className="row between">
                      <Link className="quiet-link" to={`/app/catalog/${p.id}`}>{p.name}</Link>
                      <span className="num" style={{ color: p.on_hand <= 0 ? 'var(--bad)' : 'var(--warn)', fontWeight: 700 }}>
                        {formatQty(p.on_hand, p.uom === 'unit' ? undefined : p.uom)} <span className="muted" style={{ fontWeight: 400 }}>/ {formatQty(p.reorder_level)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Panel>
          <Panel title="Recent stock received">
            <div className="panel-body tight">
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
                {d.purchases.map((p) => (
                  <li key={p.id} className="row between">
                    <span>
                      <span className="mono">{p.ref}</span> <span className="muted">{p.supplier}</span>
                    </span>
                    <span className="muted num" style={{ fontSize: 13 }}>
                      {formatDate(p.received_on)}, <Money paise={p.total_paise} short />
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </Panel>
        </div>
      </div>
      <ReceiveDialog open={receive} onClose={() => setReceive(false)} />
    </div>
  );
}

/** Install date, in red with the days it has slipped when the kit still hasn't reached the roof. */
function InstallDay({ at, delivered }: { at: string; delivered: boolean }) {
  const { me } = useSession();
  const tz = me?.timezone ?? 'Asia/Kolkata';
  const day = isoDateInTz(new Date(at), tz);
  const today = isoDateInTz(new Date(), tz);
  const late = !delivered && day < today ? Math.round((Date.parse(today) - Date.parse(day)) / 864e5) : 0;
  return late ? (
    <span className="late">
      Install {formatDate(at)}, {late} {late === 1 ? 'day' : 'days'} late
    </span>
  ) : (
    <span>Install {formatDate(at)}</span>
  );
}

function PickGroup({ title, picks, empty }: { title: string; picks: Pick[]; empty: string }) {
  if (!picks.length) return null;
  return (
    <Panel title={title} actions={<span className="badge">{picks.length}</span>}>
      <ul style={{ listStyle: 'none', margin: 0, padding: 12, display: 'grid', gap: 8 }}>
        {picks.map((p) => (
          <li key={p.id}>
            <Link to={`/app/warehouse/pick/${p.id}`} className="card-row" style={{ display: 'grid' }}>
              <div className="card-row-top">
                <span className="cell-main">
                  {p.customer} <span className="muted" style={{ fontWeight: 400 }}>{p.city}</span>
                </span>
                <Chip tone={PICK_TONE[p.status]}>{PICK_STATUS_LABEL[p.status]}</Chip>
              </div>
              <div className="card-row-meta">
                <span>{formatKw(p.capacity_kw)} {p.kind === 'off_grid' ? 'Off-Grid' : 'On-Grid'}</span>
                {p.install_at && <InstallDay at={p.install_at} delivered={p.status === 'delivered'} />}
                {p.status === 'dispatched' ? <span>On {p.vehicle_no}{p.goods_value_paise !== null ? `, ${formatINR(p.goods_value_paise)} at cost` : ''}</span> : p.est_value_paise !== null && p.status !== 'delivered' ? <span>Stock {formatINRShort(p.est_value_paise)}</span> : null}
              </div>
              <div className="card-row-meta">
                <span className="ref-chip">{p.ref}</span>
                <span className="ref-chip">{p.job_ref}</span>
              </div>
              {['ready', 'packed', 'waiting_stock'].includes(p.status) && (
                <div style={{ display: 'grid', gap: 4 }}>
                  <div className="progress">
                    <i style={{ width: `${p.serials_needed ? (p.serials_scanned / p.serials_needed) * 100 : 0}%` }} />
                  </div>
                  <span className="muted" style={{ fontSize: 12 }}>
                    {p.serials_scanned} of {p.serials_needed} serials scanned
                  </span>
                </div>
              )}
            </Link>
          </li>
        ))}
      </ul>
      {!picks.length && <Empty title={empty} />}
    </Panel>
  );
}

interface ReceiveLine {
  key: number;
  productId: string;
  qty: string;
  cost: string;
  serials: string;
}

function ReceiveDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const products = useQuery({ queryKey: ['products'], queryFn: () => api.get<{ products: { id: number; sku: string; name: string; tracking: string; unit_cost_paise: number | null; uom: string }[] }>('/api/products'), enabled: open });
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
  const [supplier, setSupplier] = useState('');
  const [invoice, setInvoice] = useState('');
  const [date, setDate] = useState(today);
  const [lines, setLines] = useState<ReceiveLine[]>([{ key: 1, productId: '', qty: '', cost: '', serials: '' }]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  const toast = useToast();
  const stocked = (products.data?.products ?? []).filter((p) => p.tracking !== 'none');
  const product = (id: string) => stocked.find((p) => String(p.id) === id);
  const set = (i: number, patch: Partial<ReceiveLine>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const submit = async () => {
    setError(null);
    setErrors({});
    setBusy(true);
    try {
      const body = {
        supplierName: supplier,
        supplierInvoice: invoice || undefined,
        receivedOn: date,
        lines: lines.map((l) => ({
          productId: Number(l.productId) || undefined,
          qty: Number(l.qty) || undefined,
          unitCostPaise: rupeesToPaise(l.cost) ?? undefined,
          serials: product(l.productId)?.tracking === 'serial' ? l.serials.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean) : undefined,
        })),
      };
      const r = await api.post<{ ref: string; readied: string[] }>('/api/purchases', body);
      toast(r.readied.length ? `Received ${r.ref}. ${r.readied.length} short pick list${r.readied.length === 1 ? ' is' : 's are'} now ready: ${r.readied.join(', ')}.` : `Received ${r.ref}. Stock updated.`);
      void qc.invalidateQueries({ queryKey: ['warehouse'] });
      void qc.invalidateQueries({ queryKey: ['products'] });
      setLines([{ key: Date.now(), productId: '', qty: '', cost: '', serials: '' }]);
      onClose();
    } catch (e) {
      if (e instanceof ApiError) {
        setErrors(e.fields ?? {});
        setError(e.message);
      } else setError('Couldn’t save.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onClose={onClose} wide title="Receive stock" description="Every serial-numbered unit needs its serial here. Scan them one after another into the box; a scanner adds a new line after each.">
      {error && <div className="form-error">{error}</div>}
      <div className="form-grid cols-3">
        <div className="field">
          <label htmlFor="rc-sup">Supplier</label>
          <input id="rc-sup" className="input" value={supplier} onChange={(e) => setSupplier(e.target.value)} aria-invalid={!!errors.supplierName} />
          {errors.supplierName && <span className="field-error">{errors.supplierName}</span>}
        </div>
        <div className="field">
          <label htmlFor="rc-inv">
            Supplier invoice <span className="opt">(optional)</span>
          </label>
          <input id="rc-inv" className="input" value={invoice} onChange={(e) => setInvoice(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="rc-date">Received on</label>
          <input id="rc-date" type="date" className="input" value={date} max={today} onChange={(e) => setDate(e.target.value)} />
        </div>
      </div>
      <div style={{ display: 'grid', gap: 12 }}>
        {lines.map((l, i) => {
          const p = product(l.productId);
          const n = l.serials.split(/[\s,;]+/).filter(Boolean).length;
          return (
            <div key={l.key} className="panel" style={{ padding: 12, display: 'grid', gap: 8 }}>
              <div className="form-grid cols-3" style={{ alignItems: 'end' }}>
                <div className="field">
                  <label htmlFor={`rc-p${i}`}>Product</label>
                  <select
                    id={`rc-p${i}`}
                    className="select"
                    value={l.productId}
                    onChange={(e) => {
                      const pp = product(e.target.value);
                      set(i, { productId: e.target.value, cost: pp && pp.unit_cost_paise !== null ? paiseToRupeesString(pp.unit_cost_paise) : l.cost });
                    }}
                    aria-invalid={!!errors[`lines.${i}.productId`]}
                  >
                    <option value="">Choose…</option>
                    {stocked.map((pp) => (
                      <option key={pp.id} value={pp.id}>
                        {pp.sku}: {pp.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor={`rc-q${i}`}>Quantity {p && p.uom !== 'unit' ? `(${p.uom})` : ''}</label>
                  <input id={`rc-q${i}`} className="input num" inputMode="decimal" value={l.qty} onChange={(e) => set(i, { qty: e.target.value })} aria-invalid={!!errors[`lines.${i}.qty`]} />
                </div>
                <div className="field">
                  <label htmlFor={`rc-c${i}`}>Cost per unit</label>
                  <div className="input-affix">
                    <span className="affix">₹</span>
                    <input id={`rc-c${i}`} className="input num" inputMode="decimal" value={l.cost} onChange={(e) => set(i, { cost: e.target.value })} aria-invalid={rupeesToPaise(l.cost || 'x') === null && !!l.cost} />
                  </div>
                </div>
              </div>
              {p?.tracking === 'serial' && (
                <div className="field">
                  <label htmlFor={`rc-s${i}`}>
                    Serial numbers ({n} of {Number(l.qty) || 0})
                  </label>
                  <textarea id={`rc-s${i}`} className="textarea mono" rows={3} value={l.serials} onChange={(e) => set(i, { serials: e.target.value.toUpperCase() })} placeholder="Scan or type, one per line" aria-invalid={!!errors[`lines.${i}.serials`] || (n > 0 && n !== Number(l.qty))} />
                  {(errors[`lines.${i}.serials`] || (n > 0 && n !== Number(l.qty))) && <span className="field-error">{errors[`lines.${i}.serials`] ?? `Enter exactly ${Number(l.qty) || 0} serials`}</span>}
                </div>
              )}
              {lines.length > 1 && (
                <Button size="sm" variant="ghost" icon={<Trash size={16} />} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>
                  Remove line
                </Button>
              )}
            </div>
          );
        })}
      </div>
      <Button size="sm" icon={<Plus size={16} />} onClick={() => setLines((ls) => [...ls, { key: Date.now(), productId: '', qty: '', cost: '', serials: '' }])}>
        Add a line
      </Button>
      <div className="form-actions">
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" busy={busy} onClick={submit}>
          Receive into stock
        </Button>
      </div>
    </Dialog>
  );
}
