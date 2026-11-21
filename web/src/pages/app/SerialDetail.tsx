import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { Plus, Printer } from '@phosphor-icons/react';
import { SERIAL_STATUS_LABEL, formatDate, formatDateTime, type SerialStatus } from '@arka/shared';
import { api } from '../../lib/api';
import { useSession } from '../../lib/session';
import { Button, Chip, ErrorBlock, KV, PageHead, Panel, SkeletonRows } from '../../components/ui';
import { CoverageChip, WarrantyRuler } from '../../components/solar';
import { NewTicket } from './Service';

/** One serial number's whole life: purchase, job, customer, warranty, repairs. With a QR label. */
export default function SerialDetail() {
  const { id } = useParams();
  const { me, can } = useSession();
  const [ticket, setTicket] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ['serial', id],
    queryFn: () =>
      api.get<{
        serial: { id: number; serial: string; status: SerialStatus; product: string; sku: string; category: string; warranty_months: number; warranty_start: string | null; warranty_end: string | null; customer: string | null; customer_id: number | null; phone: string | null; address: string | null; city: string | null; job_ref: string | null; job_id: number | null; purchase_ref: string | null; received_on: string | null; supplier: string | null; replaced_by_serial: string | null; customer_portal?: string };
        moves: { direction: string; reason: string; created_at: string; job_ref: string | null; ticket_ref: string | null; purchase_ref: string | null }[];
        tickets: { id: number; ref: string; status: string; coverage: string; created_at: string; description: string }[];
      }>(`/api/serials/${id}`),
  });
  const s = q.data?.serial;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: me?.timezone ?? 'Asia/Kolkata' }).format(new Date());
  const qrText = useMemo(() => (s ? `${s.serial} ${s.product}` : ''), [s]);
  useEffect(() => {
    if (!qrText) return;
    void QRCode.toDataURL(qrText, { margin: 1, width: 240, color: { dark: '#0E1A2B', light: '#FFFFFF' } }).then(setQr);
    document.title = `${s?.serial} · Arka`;
  }, [qrText, s?.serial]);
  if (q.isLoading) return <div className="page"><SkeletonRows rows={6} /></div>;
  if (q.isError) return <div className="page"><ErrorBlock error={q.error} retry={() => q.refetch()} /></div>;
  const d = q.data!;
  const reason: Record<string, string> = { purchase: 'Received into stock', dispatch: 'Left on the truck', service_part: 'Fitted in a repair', adjustment: 'Stock count', return: 'Returned' };
  return (
    <div className="page narrow">
      <PageHead
        title={<span className="mono">{s!.serial}</span>}
        lead={`${s!.product}, ${SERIAL_STATUS_LABEL[s!.status].toLowerCase()}`}
        actions={
          <>
            <Button icon={<Printer size={18} />} onClick={() => window.print()}>
              Print label
            </Button>
            {can('tickets.write') && s!.customer_id && (
              <Button variant="primary" icon={<Plus size={18} />} onClick={() => setTicket(true)}>
                Open a complaint
              </Button>
            )}
          </>
        }
      />
      <div className="split">
        <Panel title="Warranty" actions={<CoverageChip end={s!.warranty_end} today={today} />}>
          <div className="panel-body stack">
            <WarrantyRuler start={s!.warranty_start} end={s!.warranty_end} today={today} years={s!.warranty_months > 60 ? 20 : 5} label={s!.product} />
            <KV
              items={[
                ['Started', s!.warranty_start ? `${formatDate(s!.warranty_start)}, on delivery` : 'Not yet delivered'],
                ['Ends', s!.warranty_end ? formatDate(s!.warranty_end) : `${s!.warranty_months} months after delivery`],
                ['Customer', s!.customer_id ? <Link to={`/app/customers/${s!.customer_id}`}>{s!.customer}</Link> : 'In stock'],
                ['Job', s!.job_id ? <Link className="mono" to={`/app/jobs/${s!.job_id}`}>{s!.job_ref}</Link> : null],
                ['Bought', s!.purchase_ref ? `${s!.purchase_ref} from ${s!.supplier}, ${formatDate(s!.received_on)}` : null],
                ['Replaced by', s!.replaced_by_serial ? <span className="mono">{s!.replaced_by_serial}</span> : null],
              ]}
            />
          </div>
        </Panel>
        <Panel title="Label">
          <div className="panel-body" style={{ display: 'grid', justifyItems: 'center', gap: 8 }}>
            {qr && <img src={qr} alt={`QR code for ${s!.serial}`} width={180} height={180} />}
            <span className="mono" style={{ fontWeight: 800, fontSize: 18 }}>
              {s!.serial}
            </span>
            <span className="muted">{s!.sku}</span>
          </div>
        </Panel>
      </div>
      <Panel title="Life of this unit">
        <ol className="timeline" style={{ padding: 20 }}>
          {d.moves.map((m, i) => (
            <li key={i}>
              <span className="dot" aria-hidden />
              <div>
                <div className="body">
                  {reason[m.reason] ?? m.reason} <span className="mono">{m.job_ref ?? m.ticket_ref ?? m.purchase_ref}</span>
                </div>
                <div className="meta">{formatDateTime(m.created_at)}</div>
              </div>
            </li>
          ))}
          {d.tickets.map((t) => (
            <li key={`t${t.id}`}>
              <span className="dot call" aria-hidden />
              <div>
                <div className="body">
                  Complaint{' '}
                  <Link className="mono" to={`/app/service/${t.id}`}>
                    {t.ref}
                  </Link>
                  : {t.description}
                </div>
                <div className="meta">
                  {formatDateTime(t.created_at)}, <Chip>{t.status}</Chip>
                </div>
              </div>
            </li>
          ))}
        </ol>
      </Panel>
      {ticket && s!.customer_id && <NewTicket customerId={s!.customer_id} customer={s!.customer!} serialUnitId={s!.id} onClose={() => setTicket(false)} />}
    </div>
  );
}
