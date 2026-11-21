import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Barcode, Camera, CheckCircle, Printer, Truck, WarningOctagon, X, Package } from '@phosphor-icons/react';
import { CATEGORY_LABEL, PICK_STATUS_LABEL, deliverSchema, dispatchSchema, formatDate, formatDateTime, formatINR, formatKw, formatQty, type PickStatus, type ProductCategory } from '@arka/shared';
import { api, ApiError } from '../../lib/api';
import { useSession } from '../../lib/session';
import { Button, Callout, Chip, ErrorBlock, KV, PageHead, Panel, SkeletonRows } from '../../components/ui';
import { CameraScanner } from '../../components/media';
import { Dialog, useToast } from '../../components/overlay';
import { applyServerError, FormError, TextField, useZodForm } from '../../components/form';

interface Line {
  id: number;
  product_id: number;
  qty: number;
  sku: string;
  name: string;
  category: ProductCategory;
  tracking: 'serial' | 'quantity';
  uom: string;
  on_hand: number;
  unit_cost_paise: number | null;
  serials: { id: number; serial: string; status: string; scanned_at: string }[];
}

interface Detail {
  pick: {
    id: number;
    ref: string;
    status: PickStatus;
    job_id: number;
    job_ref: string;
    kind: string;
    capacity_kw: number;
    customer: string;
    address: string;
    city: string;
    phone: string;
    install_at: string | null;
    vehicle_no: string | null;
    driver_name: string | null;
    dispatched_at: string | null;
    goods_value_paise: number | null;
    dispatched_by_name: string | null;
    delivered_on: string | null;
    received_by: string | null;
  };
  lines: Line[];
  shortages: { name: string; need: number; available: number }[];
}

export default function PickList() {
  const { id } = useParams();
  const q = useQuery({ queryKey: ['pick', id], queryFn: () => api.get<Detail>(`/api/warehouse/pick/${id}`) });
  const { can } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [serial, setSerial] = useState('');
  const [flash, setFlash] = useState<{ ok: boolean; text: string } | null>(null);
  const [camera, setCamera] = useState(false);
  const [dlg, setDlg] = useState<null | 'dispatch' | 'deliver'>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (q.data) document.title = `${q.data.pick.ref} · Arka`;
  }, [q.data]);

  const scan = useCallback(
    async (raw: string) => {
      const s = raw.trim().toUpperCase();
      if (!s) return;
      try {
        const r = await api.post<{ serial: string; product: string }>(`/api/warehouse/pick/${id}/scan`, { serial: s });
        setFlash({ ok: true, text: `${r.serial}: ${r.product} scanned.` });
        navigator.vibrate?.(30);
        void qc.invalidateQueries({ queryKey: ['pick', id] });
      } catch (e) {
        setFlash({ ok: false, text: e instanceof ApiError ? e.message : 'That scan didn’t go through.' });
        navigator.vibrate?.([60, 40, 60]);
      }
      setSerial('');
      input.current?.focus();
    },
    [id, qc],
  );

  if (q.isLoading) return <div className="page"><SkeletonRows rows={8} /></div>;
  if (q.isError) return <div className="page"><ErrorBlock error={q.error} retry={() => q.refetch()} /></div>;
  const d = q.data!;
  const p = d.pick;
  const serialLines = d.lines.filter((l) => l.tracking === 'serial');
  const qtyLines = d.lines.filter((l) => l.tracking === 'quantity');
  const need = serialLines.reduce((s, l) => s + Number(l.qty), 0);
  const done = serialLines.reduce((s, l) => s + l.serials.length, 0);
  const complete = need === done && !d.shortages.length;
  const open = ['ready', 'packed', 'waiting_stock'].includes(p.status);
  const writable = can('dispatch.write');
  const estValue = d.lines.every((l) => l.unit_cost_paise !== null) ? d.lines.reduce((s, l) => s + Math.round(Number(l.qty) * (l.unit_cost_paise ?? 0)), 0) : null;
  const unscan = async (serialUnitId: number, serialNo: string) => {
    try {
      await api.post(`/api/warehouse/pick/${id}/unscan`, { serialUnitId });
      void qc.invalidateQueries({ queryKey: ['pick', id] });
      toast(
        <>
          {serialNo} taken off the list.{' '}
          <button className="link-btn" onClick={() => void scan(serialNo)}>
            Undo
          </button>
        </>,
        'info',
      );
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Couldn’t remove it.', 'bad');
    }
  };
  return (
    <div className="page">
      <PageHead
        back={{ to: '/app/warehouse', label: 'Warehouse' }}
        title={`Kit for ${p.customer}`}
        actions={
          <>
            <Button icon={<Printer size={18} />} onClick={() => window.print()}>
              Print pick list
            </Button>
            {writable && p.status === 'ready' && (
              <Button
                variant="primary"
                icon={<Package size={18} />}
                disabled={!complete}
                title={complete ? undefined : 'Scan every serial first'}
                busy={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await api.post(`/api/warehouse/pick/${id}/pack`);
                    toast('Packed. Every serial is recorded.');
                    void qc.invalidateQueries({ queryKey: ['pick', id] });
                  } catch (e) {
                    toast(e instanceof ApiError ? e.message : 'Couldn’t pack.', 'bad');
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Mark packed
              </Button>
            )}
            {writable && ['ready', 'packed'].includes(p.status) && (
              <Button variant={p.status === 'packed' ? 'primary' : 'secondary'} icon={<Truck size={18} />} disabled={!complete} title={complete ? undefined : 'Scan every serial first'} onClick={() => setDlg('dispatch')}>
                Dispatch
              </Button>
            )}
            {p.status === 'dispatched' && can('delivery.write') && (
              <Button variant="primary" icon={<CheckCircle size={18} />} onClick={() => setDlg('deliver')}>
                Mark delivered
              </Button>
            )}
          </>
        }
      >
        <div className="row" style={{ marginTop: 8 }}>
          <span className="mono muted">{p.ref}</span>
          <Chip tone={p.status === 'waiting_stock' ? 'warn' : p.status === 'delivered' ? 'good' : 'sun'}>{PICK_STATUS_LABEL[p.status]}</Chip>
          <Link to={`/app/jobs/${p.job_id}`} className="mono">
            {p.job_ref}
          </Link>
          <span className="muted">
            {formatKw(p.capacity_kw)} {p.kind === 'off_grid' ? 'Off-Grid' : 'On-Grid'}
            {p.install_at ? `, installing ${formatDate(p.install_at)}` : ''}
          </span>
        </div>
      </PageHead>

      {d.shortages.length > 0 && open && (
        <Callout tone="warn">
          Short of stock: {d.shortages.map((s) => `${s.name} (need ${formatQty(s.need)}, have ${formatQty(s.available)})`).join(', ')}. It moves to packing when the stock is received.
        </Callout>
      )}
      {p.status === 'dispatched' && (
        <Callout tone="info">
          Left {formatDateTime(p.dispatched_at)} on <b>{p.vehicle_no}</b> with {p.driver_name}: {done} serial-numbered units{p.goods_value_paise !== null ? `, ${formatINR(p.goods_value_paise)} of stock at cost` : ''}.
        </Callout>
      )}
      {p.status === 'delivered' && (
        <Callout tone="good">
          Delivered {formatDate(p.delivered_on)}, received by {p.received_by}. Warranty started for every serial.
        </Callout>
      )}

      <div className="split">
        <div className="stack">
          {open && writable && (
            <Panel title="Scan serial numbers">
              <div className="panel-body scan-panel">
                <form
                  className="scan-input"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void scan(serial);
                  }}
                >
                  <label htmlFor="scan" className="sr-only">
                    Serial number
                  </label>
                  <span className="scan-field">
                    <Barcode size={22} aria-hidden />
                    <input
                      id="scan"
                      ref={input}
                      className="input"
                      value={serial}
                      onChange={(e) => setSerial(e.target.value.toUpperCase())}
                      placeholder="Serial number"
                      autoComplete="off"
                      autoCapitalize="characters"
                      spellCheck={false}
                      autoFocus
                      inputMode="text"
                    />
                  </span>
                  <Button type="submit" variant="dark" size="lg">
                    Scan
                  </Button>
                  <Button size="lg" className="scan-camera-icon" aria-label="Use the camera" onClick={() => setCamera((c) => !c)} icon={<Camera size={20} />} />
                </form>
                <Button size="lg" block className="scan-camera" onClick={() => setCamera((c) => !c)} icon={<Camera size={20} />}>
                  {camera ? 'Close the camera' : 'Scan with the camera'}
                </Button>
                {camera && <CameraScanner onCode={(c) => void scan(c)} onClose={() => setCamera(false)} />}
                {flash && (
                  <div className={`scan-flash ${flash.ok ? 'ok' : 'err'}`} role="status" aria-live="assertive">
                    {flash.ok ? <CheckCircle size={20} weight="fill" /> : <WarningOctagon size={20} weight="fill" />}
                    {flash.text}
                  </div>
                )}
                <div>
                  <div className="row between" style={{ fontSize: 14, fontWeight: 700 }}>
                    <span>
                      {done} of {need} scanned
                    </span>
                    <span>{complete ? 'Complete' : `${need - done} to go`}</span>
                  </div>
                  <div className="progress" style={{ height: 10 }}>
                    <i style={{ width: `${need ? (done / need) * 100 : 0}%` }} />
                  </div>
                </div>
              </div>
            </Panel>
          )}
          <Panel title="Serial-numbered units">
            <div>
              {serialLines.map((l) => (
                <div key={l.id} className="pick-line">
                  <div>
                    <b>{l.name}</b>
                    <div className="cell-sub">
                      <span className="mono">{l.sku}</span>, {CATEGORY_LABEL[l.category]}
                    </div>
                  </div>
                  <span className="num" style={{ fontWeight: 800, color: l.serials.length === Number(l.qty) ? 'var(--good)' : 'var(--ink)' }}>
                    {l.serials.length} / {formatQty(l.qty)}
                  </span>
                  <div className="serials">
                    {l.serials.map((s) => (
                      <span key={s.id} className="serial-tag">
                        {s.serial}
                        {open && writable && (
                          <button aria-label={`Remove ${s.serial}`} onClick={() => void unscan(s.id, s.serial)}>
                            <X size={14} weight="bold" />
                          </button>
                        )}
                      </span>
                    ))}
                    {Array.from({ length: Math.max(0, Number(l.qty) - l.serials.length) }, (_, i) => (
                      <span key={i} className="serial-slot" aria-hidden />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        </div>
        <div className="stack">
          <Panel title="Counted items">
            <table className="table">
              <tbody>
                {qtyLines.map((l) => (
                  <tr key={l.id}>
                    <td>
                      {l.name}
                      <div className="cell-sub mono">{l.sku}</div>
                    </td>
                    <td className="r num" style={{ fontWeight: 700 }}>
                      {formatQty(l.qty, l.uom === 'unit' ? undefined : l.uom)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
          <Panel title="Delivery">
            <div className="panel-body">
              <KV
                items={[
                  ['Customer', p.customer],
                  ['Address', `${p.address}, ${p.city}`],
                  ['Phone', <a href={`tel:${p.phone}`}>{p.phone}</a>],
                  ['Stock value', p.goods_value_paise !== null || estValue !== null ? `${formatINR(p.goods_value_paise ?? estValue ?? 0)} at cost` : null],
                ]}
              />
            </div>
          </Panel>
        </div>
      </div>
      <DispatchDialog open={dlg === 'dispatch'} onClose={() => setDlg(null)} pickId={p.id} value={estValue} serials={done} />
      <DeliverPickDialog open={dlg === 'deliver'} onClose={() => setDlg(null)} pickId={p.id} customer={p.customer} />
    </div>
  );
}

function DispatchDialog({ open, onClose, pickId, value, serials }: { open: boolean; onClose: () => void; pickId: number; value: number | null; serials: number }) {
  const form = useZodForm(dispatchSchema, { vehicleNo: '', driverName: '', driverPhone: '' });
  const [error, setError] = useState<string | null>(null);
  const qc = useQueryClient();
  const toast = useToast();
  return (
    <Dialog open={open} onClose={onClose} title="Dispatch the kit" description={`${serials} serial-numbered units${value !== null ? `, about ${formatINR(value)} of stock at cost` : ''}. The stock comes off the books when you confirm.`}>
      <form
        noValidate
        className="stack"
        onSubmit={form.handleSubmit(async (v) => {
          setError(null);
          try {
            const r = await api.post<{ goodsValuePaise: number; serials: number }>(`/api/warehouse/pick/${pickId}/dispatch`, v);
            toast(`On the truck: ${r.serials} serials, ${formatINR(r.goodsValuePaise)} at cost.`);
            void qc.invalidateQueries({ queryKey: ['pick'] });
            void qc.invalidateQueries({ queryKey: ['warehouse'] });
            onClose();
          } catch (e) {
            setError(applyServerError(form, e));
          }
        })}
      >
        <FormError message={error} />
        <div className="form-grid">
          <TextField form={form as never} name="vehicleNo" label="Vehicle number" placeholder="GJ01AB1234" autoCapitalize="characters" className="mono" />
          <TextField form={form as never} name="driverName" label="Driver" />
          <TextField form={form as never} name="driverPhone" label="Driver’s mobile" optional type="tel" prefix="+91" />
        </div>
        <div className="form-actions">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" busy={form.formState.isSubmitting}>
            Dispatch now
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function DeliverPickDialog({ open, onClose, pickId, customer }: { open: boolean; onClose: () => void; pickId: number; customer: string }) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
  const form = useZodForm(deliverSchema, { deliveredOn: today, receivedBy: customer });
  const [error, setError] = useState<string | null>(null);
  const qc = useQueryClient();
  const toast = useToast();
  return (
    <Dialog open={open} onClose={onClose} title="Kit delivered" description="The warranty clock starts now for every serial on the truck.">
      <form
        noValidate
        className="stack"
        onSubmit={form.handleSubmit(async (v) => {
          setError(null);
          try {
            const r = await api.post<{ warranties: unknown[] }>(`/api/warehouse/pick/${pickId}/deliver`, v);
            toast(`Delivered. Warranty started for ${r.warranties.length} serials.`);
            void qc.invalidateQueries({ queryKey: ['pick'] });
            onClose();
          } catch (e) {
            setError(applyServerError(form, e));
          }
        })}
      >
        <FormError message={error} />
        <div className="form-grid">
          <TextField form={form as never} name="deliveredOn" label="Delivered on" type="date" max={today} />
          <TextField form={form as never} name="receivedBy" label="Received by" />
        </div>
        <div className="form-actions">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" busy={form.formState.isSubmitting}>
            Confirm delivery
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
