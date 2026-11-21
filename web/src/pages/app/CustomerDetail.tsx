import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowSquareOut, ArrowsClockwise, Phone, Plus } from '@phosphor-icons/react';
import { JOB_STATUS_LABEL, LEAD_STATUS_LABEL, TICKET_STATUS_LABEL, formatDate, formatKw, formatPhone, warrantyLeft, type JobStatus, type LeadStatus, type TicketStatus } from '@arka/shared';
import { api, ApiError } from '../../lib/api';
import { useSession } from '../../lib/session';
import { Button, Chip, ErrorBlock, KV, Money, PageHead, Panel, SkeletonRows } from '../../components/ui';
import { Timeline, type ActivityItem } from '../../components/timeline';
import { Dialog, useToast } from '../../components/overlay';
import { NewTicket } from './Service';

export default function CustomerDetail() {
  const { id } = useParams();
  const { can, me } = useSession();
  const [ticket, setTicket] = useState(false);
  const [relink, setRelink] = useState(false);
  const q = useQuery({
    queryKey: ['customer', id],
    queryFn: () =>
      api.get<{
        customer: { id: number; name: string; phone: string; email: string | null; address: string; city: string; pincode: string; kind: string; portal_token?: string; created_at: string };
        leads: { id: number; ref: string; status: LeadStatus; created_at: string }[];
        jobs: { id: number; ref: string; status: JobStatus; kind: string; capacity_kw: number; total_paise: number; installed_at: string | null }[];
        serials: { id: number; serial: string; status: string; warranty_end: string | null; product: string; category: string; job_ref: string | null }[];
        tickets: { id: number; ref: string; status: TicketStatus; coverage: string; created_at: string; description: string }[];
        activities: ActivityItem[];
      }>(`/api/customers/${id}`),
  });
  useEffect(() => {
    if (q.data) document.title = `${q.data.customer.name} · Arka`;
  }, [q.data]);
  if (q.isLoading) return <div className="page"><SkeletonRows rows={8} /></div>;
  if (q.isError) return <div className="page"><ErrorBlock error={q.error} retry={() => q.refetch()} /></div>;
  const d = q.data!;
  const c = d.customer;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: me?.timezone ?? 'Asia/Kolkata' }).format(new Date());
  return (
    <div className="page">
      <PageHead
        title={c.name}
        lead={`${c.address}, ${c.city} ${c.pincode}`}
        actions={
          <>
            <a className="btn" href={`tel:${c.phone}`}>
              <Phone size={18} /> {formatPhone(c.phone)}
            </a>
            {c.portal_token && (
              <a className="btn" href={`/my/${c.portal_token}`} target="_blank" rel="noreferrer">
                <ArrowSquareOut size={18} /> Their page
              </a>
            )}
            {c.portal_token && can('customers.write') && (
              <Button variant="ghost" icon={<ArrowsClockwise size={18} />} onClick={() => setRelink(true)}>
                New link
              </Button>
            )}
            {can('tickets.write') && (
              <Button variant="primary" icon={<Plus size={18} />} onClick={() => setTicket(true)}>
                Open a complaint
              </Button>
            )}
          </>
        }
      />
      <div className="split">
        <div className="stack">
          <Panel title="Installed units">
            <div className="panel-body tight" style={{ display: 'grid', gap: 6 }}>
              {!d.serials.length && <p className="muted">Nothing installed yet.</p>}
              {d.serials.map((s) => (
                <div key={s.id} className="unit-row">
                  <span>
                    <Link className="mono" to={`/app/serials/${s.id}`}>
                      {s.serial}
                    </Link>
                    <span className="muted">{s.product}</span>
                  </span>
                  {s.warranty_end && <Chip tone={s.warranty_end >= today ? 'good' : 'bad'}>{warrantyLeft(s.warranty_end, today)}</Chip>}
                </div>
              ))}
            </div>
          </Panel>
          <Panel title="History">
            <div className="panel-body">
              <Timeline items={d.activities} />
            </div>
          </Panel>
        </div>
        <div className="stack">
          <Panel title="Jobs">
            <div className="panel-body tight" style={{ display: 'grid', gap: 8 }}>
              {d.jobs.map((j) => (
                <Link key={j.id} to={`/app/jobs/${j.id}`} className="row between">
                  <span>
                    <span className="mono">{j.ref}</span> {formatKw(j.capacity_kw)}
                  </span>
                  <span className="muted">
                    {JOB_STATUS_LABEL[j.status]}, <Money paise={j.total_paise} short />
                  </span>
                </Link>
              ))}
              {!d.jobs.length && <p className="muted">No jobs yet.</p>}
            </div>
          </Panel>
          <Panel title="Complaints">
            <div className="panel-body tight" style={{ display: 'grid', gap: 8 }}>
              {d.tickets.map((t) => (
                <Link key={t.id} to={`/app/service/${t.id}`} className="row between">
                  <span className="mono">{t.ref}</span>
                  <span className="muted">
                    {TICKET_STATUS_LABEL[t.status]}, {formatDate(t.created_at)}
                  </span>
                </Link>
              ))}
              {!d.tickets.length && <p className="muted">None.</p>}
            </div>
          </Panel>
          <Panel title="Enquiries">
            <div className="panel-body tight" style={{ display: 'grid', gap: 8 }}>
              {d.leads.map((l) => (
                <Link key={l.id} to={`/app/enquiries/${l.id}`} className="row between">
                  <span className="mono">{l.ref}</span>
                  <span className="muted">
                    {LEAD_STATUS_LABEL[l.status]}, {formatDate(l.created_at)}
                  </span>
                </Link>
              ))}
            </div>
          </Panel>
          <Panel title="Contact">
            <div className="panel-body">
              <KV items={[['Email', c.email], ['For a', c.kind === 'home' ? 'Home' : 'Business'], ['Customer since', formatDate(c.created_at)]]} />
            </div>
          </Panel>
        </div>
      </div>
      {ticket && <NewTicket customerId={c.id} customer={c.name} onClose={() => setTicket(false)} />}
      <NewLinkDialog open={relink} onClose={() => setRelink(false)} customerId={c.id} name={c.name} />
    </div>
  );
}

/** A forwarded or leaked link can be switched off: the old address stops working at once. */
function NewLinkDialog({ open, onClose, customerId, name }: { open: boolean; onClose: () => void; customerId: number; name: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function go() {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/customers/${customerId}/new-link`, {});
      await qc.invalidateQueries({ queryKey: ['customer', String(customerId)] });
      toast(`New link made. The old link for ${name} no longer opens.`);
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'That didn’t work. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open={open} onClose={onClose} title="Make a new customer link?" description={`The link ${name} has now stops working straight away. Use this if it was forwarded to someone who shouldn’t have it, then send them the new one.`}>
      {error && <p className="field-error" role="alert">{error}</p>}
      <div className="form-actions">
        <Button onClick={onClose}>Keep the current link</Button>
        <Button variant="danger" busy={busy} onClick={go}>
          Make a new link
        </Button>
      </div>
    </Dialog>
  );
}
