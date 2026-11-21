import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Printer, CheckCircle, ArrowCounterClockwise } from '@phosphor-icons/react';
import { SUBSIDY_STATUS_LABEL, formatDate, formatDateTime, formatINR, formatKw, formatTime, portalTicketSchema, ticketReopenSchema, warrantyLeft, type SubsidyStatus } from '@arka/shared';
import { api, ApiError } from '../../lib/api';
import { PublicShell } from '../../layout/PublicShell';
import { Button, Callout, Chip, ErrorBlock, KV, Panel, SkeletonRows } from '../../components/ui';
import { WarrantyRuler } from '../../components/solar';
import { Kit3D } from '../../components/Kit3D';
import { applyServerError, FormError, SelectField, TextArea, TextField, useZodForm } from '../../components/form';

interface PortalData {
  customer: { id: number; name: string; city: string; phone: string };
  company: { name: string; phone: string | null; email: string | null; address: string | null };
  jobs: { id: number; ref: string; status: string; kind: 'on_grid' | 'off_grid' | 'panel_set' | 'service'; capacity_kw: number; delivered_on: string | null; installed_at: string | null; panels: number; batteries: number; battery_kwh: number; subsidy_status: SubsidyStatus | null; subsidy_paise: number | null }[];
  serials: { id: number; serial: string; status: string; warranty_start: string | null; warranty_end: string | null; job_id: number; product: string; category: string; warranty_months: number }[];
  reports: { job_id: number; started_at: string; finished_at: string; confirmed_kw: number; generation_kw: number; signed_by_name: string; signature_file_id: number; submitted_at: string; photo_ids: number[]; crew: string[] }[];
  tickets: { id: number; ref: string; status: string; coverage: string; description: string; resolution: string | null; created_at: string; resolved_at: string | null; closed_at: string | null; billed_paise: number; serial: string | null; product: string | null }[];
  quotes: { ref: string; version: number; status: string; total_paise: number; capacity_kw: number; public_token: string; valid_until: string }[];
  invoices: { number: string; status: string; total_paise: number; issued_on: string; public_token: string }[];
}

/**
 * "My solar": what was installed, every serial and its warranty, proof of the job, and complaints
 * (raise one, confirm a fix). The customer should have no doubt about what they have.
 */
export default function Portal() {
  const { token = '' } = useParams();
  const [params] = useSearchParams();
  const highlight = params.get('serial');
  const q = useQuery({ queryKey: ['portal', token], queryFn: () => api.get<PortalData>(`/api/public/portal/${token}`), retry: false });
  useEffect(() => {
    if (q.data) document.title = `${q.data.customer.name.split(' ')[0]}’s solar system`;
  }, [q.data]);
  if (q.isLoading) return <PublicShell><SkeletonRows rows={8} /></PublicShell>;
  if (q.isError) return <PublicShell><ErrorBlock error={q.error} /></PublicShell>;
  const d = q.data!;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
  const job = d.jobs.find((j) => j.installed_at) ?? d.jobs[0];
  const report = job ? d.reports.find((r) => r.job_id === job.id) : undefined;
  const serials = d.serials.filter((s) => s.status !== 'replaced');
  const inverter = serials.find((s) => s.category === 'inverter');
  const panels = serials.filter((s) => s.category === 'panel');
  const others = serials.filter((s) => s.category !== 'panel');
  return (
    <PublicShell company={d.company.name} phone={d.company.phone}>
      <div className="stack" style={{ gap: 24 }}>
        <section className="portal-hero">
          <div className="stack">
            <h1 style={{ fontSize: 'clamp(1.8rem, 1.3rem + 2vw, 2.8rem)' }}>Hello {d.customer.name.split(' ')[0]}, this is your solar system.</h1>
            {job ? (
              <p style={{ fontSize: 17 }}>
                {formatKw(job.capacity_kw)} {job.kind === 'off_grid' ? `off-grid with ${job.batteries} battery (${Math.round(job.battery_kwh * 10) / 10} kWh)` : 'on-grid'}, {job.panels} panels.{' '}
                {job.installed_at ? `Installed ${formatDate(job.installed_at)}.` : job.delivered_on ? `Delivered ${formatDate(job.delivered_on)}; installation next.` : 'Your order is being prepared.'}
              </p>
            ) : (
              <p className="muted">Your system details will appear here after installation.</p>
            )}
            {inverter?.warranty_end && (
              <Callout tone={inverter.warranty_end >= today ? 'good' : 'warn'}>
                Inverter warranty: {inverter.warranty_end >= today ? `covered until ${formatDate(inverter.warranty_end)} (${warrantyLeft(inverter.warranty_end, today)})` : `ended ${formatDate(inverter.warranty_end)}`}. Panels are covered until {panels[0]?.warranty_end ? formatDate(panels[0].warranty_end) : '—'}.
              </Callout>
            )}
          </div>
          {job && job.kind !== 'service' && (
            <Kit3D
              kind={job.kind}
              panels={job.panels}
              inverters={1}
              batteries={job.batteries}
              controllers={1}
              height={320}
              labels={[
                inverter && { part: 'inverter' as const, title: inverter.serial, detail: inverter.warranty_end ? `Until ${formatDate(inverter.warranty_end)}` : 'Starts on delivery', tone: inverter.warranty_end && inverter.warranty_end >= today ? ('good' as const) : ('neutral' as const) },
                panels[0] && { part: 'panel' as const, title: `${panels.length} panels`, detail: `Until ${formatDate(panels[0].warranty_end)}`, tone: 'good' as const },
              ].filter(Boolean) as never}
            />
          )}
        </section>

        <Panel title="Every part, with its warranty">
          <div className="panel-body unit-list">
            {others.map((s) => (
              <div key={s.id} className={`unit ${highlight === s.serial ? 'target' : ''}`}>
                <div className="unit-top">
                  <span>
                    <b>{s.product}</b> <span className="mono">{s.serial}</span>
                  </span>
                  {s.warranty_end ? <Chip tone={s.warranty_end >= today ? 'good' : 'bad'}>{s.warranty_end >= today ? `Covered, ${warrantyLeft(s.warranty_end, today)}` : 'Warranty ended'}</Chip> : <Chip>Starts on delivery</Chip>}
                </div>
                <WarrantyRuler start={s.warranty_start} end={s.warranty_end} today={today} label={s.product} />
              </div>
            ))}
            {panels.length > 0 && (
              <div className={`unit ${panels.some((p) => p.serial === highlight) ? 'target' : ''}`}>
                <div className="unit-top">
                  <b>{panels.length} solar panels</b>
                  {panels[0]!.warranty_end && <Chip tone="good">Covered until {formatDate(panels[0]!.warranty_end)}</Chip>}
                </div>
                <WarrantyRuler start={panels[0]!.warranty_start} end={panels[0]!.warranty_end} today={today} label="Solar panels" />
                <p className="mono muted" style={{ fontSize: 13 }}>
                  {panels.map((p) => p.serial).join(', ')}
                </p>
              </div>
            )}
            {!serials.length && <p className="muted">Serial numbers appear here once your kit is packed.</p>}
          </div>
        </Panel>

        {report && (
          <Panel title="Proof of installation" actions={<Button size="sm" icon={<Printer size={16} />} onClick={() => window.print()}>Print certificate</Button>}>
            <div className="panel-body stack">
              <KV
                items={[
                  ['Installed', `${formatDate(report.started_at)}, ${formatTime(report.started_at)} to ${formatTime(report.finished_at)}`],
                  ['System size', formatKw(report.confirmed_kw)],
                  ['Generating at handover', `${report.generation_kw} kW`],
                  ['Crew', report.crew.join(', ')],
                  ['Checked', 'Stands, panels, wiring boxes, earthing, power test'],
                  ['Accepted by', `${report.signed_by_name}, signed on screen ${formatDateTime(report.submitted_at)}`],
                ]}
              />
              <div className="thumbs">
                {report.photo_ids.map((p) => (
                  <a key={p} className="thumb" href={`/api/public/portal/${token}/files/${p}`} target="_blank" rel="noreferrer">
                    <img src={`/api/public/portal/${token}/files/${p}`} alt="Your finished roof" loading="lazy" />
                  </a>
                ))}
                <div className="thumb" style={{ background: '#fff' }}>
                  <img src={`/api/public/portal/${token}/files/${report.signature_file_id}`} alt={`Signature of ${report.signed_by_name}`} style={{ objectFit: 'contain' }} />
                </div>
              </div>
            </div>
          </Panel>
        )}

        <Complaints data={d} token={token} />

        {job?.subsidy_status && (
          <Panel title="Your subsidy">
            <div className="panel-body">
              <p>
                PM Surya Ghar: <b>{SUBSIDY_STATUS_LABEL[job.subsidy_status]}</b>. Expected {formatINR(job.subsidy_paise ?? 0)}, paid by the government straight to your bank account.
              </p>
            </div>
          </Panel>
        )}

        {(d.quotes.length > 0 || d.invoices.length > 0) && (
          <Panel title="Your documents">
            <div className="panel-body tight" style={{ display: 'grid', gap: 6 }}>
              {d.quotes.map((qq) => (
                <a key={`${qq.ref}${qq.version}`} href={`/q/${qq.public_token}`}>
                  Quote {qq.ref} v{qq.version}, {formatKw(qq.capacity_kw)}, {formatINR(qq.total_paise)}
                </a>
              ))}
              {d.invoices.map((i) => (
                <a key={i.number} href={`/i/${i.public_token}`}>
                  Invoice {i.number}, {formatINR(i.total_paise)}, {formatDate(i.issued_on)}
                </a>
              ))}
            </div>
          </Panel>
        )}
      </div>
    </PublicShell>
  );
}

function Complaints({ data, token }: { data: PortalData; token: string }) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [reopenId, setReopenId] = useState<number | null>(null);
  const form = useZodForm(portalTicketSchema, { serialUnitId: '' as never, description: '', phone: '' });
  const reopen = useZodForm(ticketReopenSchema, { reason: '' });
  const [sent, setSent] = useState<string | null>(null);
  const open = data.tickets.filter((t) => t.status !== 'closed');
  return (
    <Panel title="Something not working?">
      <div className="panel-body stack">
        {open.map((t) => (
          <div key={t.id} className="unit">
            <div className="unit-top">
              <b>
                Complaint <span className="mono">{t.ref}</span>
              </b>
              <Chip tone={t.status === 'resolved' ? 'sun' : 'warn'}>{t.status === 'resolved' ? 'Fixed: please confirm' : 'Being handled'}</Chip>
            </div>
            <p>{t.description}</p>
            {t.status === 'resolved' && (
              <>
                <p className="muted">
                  Our technician says: {t.resolution} {t.billed_paise ? `Billed ${formatINR(t.billed_paise)}.` : 'Covered: nothing to pay.'}
                </p>
                {reopenId === t.id ? (
                  <form
                    noValidate
                    className="stack"
                    onSubmit={reopen.handleSubmit(async (v) => {
                      await api.post(`/api/public/portal/${token}/tickets/${t.id}/reopen`, v);
                      setReopenId(null);
                      void qc.invalidateQueries({ queryKey: ['portal'] });
                    })}
                  >
                    <TextArea form={reopen as never} name="reason" label="What’s still wrong?" rows={2} />
                    <Button type="submit" variant="danger" busy={reopen.formState.isSubmitting}>
                      Tell the team
                    </Button>
                  </form>
                ) : (
                  <div className="row">
                    <Button
                      variant="primary"
                      icon={<CheckCircle size={18} />}
                      onClick={async () => {
                        try {
                          await api.post(`/api/public/portal/${token}/tickets/${t.id}/confirm`);
                          void qc.invalidateQueries({ queryKey: ['portal'] });
                        } catch (e) {
                          setError(e instanceof ApiError ? e.message : 'Failed.');
                        }
                      }}
                    >
                      Yes, it works now
                    </Button>
                    <Button icon={<ArrowCounterClockwise size={18} />} onClick={() => setReopenId(t.id)}>
                      Still not working
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>
        ))}
        {sent ? (
          <Callout tone="good">Complaint {sent} sent. Support will call you. You can follow it here.</Callout>
        ) : (
          <form
            noValidate
            className="stack"
            onSubmit={form.handleSubmit(async (v) => {
              setError(null);
              try {
                const r = await api.post<{ ref: string; coverage: string }>(`/api/public/portal/${token}/tickets`, v);
                setSent(`${r.ref} (${r.coverage === 'warranty' ? 'under warranty: free' : 'out of warranty'})`);
                void qc.invalidateQueries({ queryKey: ['portal'] });
              } catch (e) {
                setError(applyServerError(form, e));
              }
            })}
          >
            <FormError message={error} />
            <div className="form-grid">
              <SelectField
                form={form as never}
                name="serialUnitId"
                label="Which part?"
                placeholder="Not sure"
                options={data.serials.filter((s) => s.status === 'installed' && s.category !== 'panel').map((s) => ({ value: s.id, label: `${s.product} (${s.serial})` }))}
              />
              <TextField form={form as never} name="phone" label="Your mobile number, to confirm it’s you" type="tel" prefix="+91" />
            </div>
            <TextArea form={form as never} name="description" label="What’s wrong?" rows={3} placeholder="e.g. no power since this morning, display shows E-021" />
            <Button type="submit" busy={form.formState.isSubmitting}>
              Send complaint
            </Button>
          </form>
        )}
      </div>
    </Panel>
  );
}
