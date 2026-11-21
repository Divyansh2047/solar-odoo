import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CloudCheck } from '@phosphor-icons/react';
import { formatKw, installReportSchema, localDateTime } from '@arka/shared';
import { api } from '../../lib/api';
import { useSession } from '../../lib/session';
import { Button, Callout, ErrorBlock, PageHead, SkeletonRows } from '../../components/ui';
import { PhotoInput, SignaturePad } from '../../components/media';
import { useToast } from '../../components/overlay';
import { applyServerError, FormError, TextArea, TextField, useZodForm } from '../../components/form';

interface JobLite {
  job: { id: number; ref: string; status: string; customer: string; capacity_kw: number; address: string; city: string };
  visits: { kind: string; status: string; starts_at: string; crew: { id: number; name: string }[] }[];
}

const installFormSchema = installReportSchema.safeExtend({ startedAt: localDateTime, finishedAt: localDateTime }) as unknown as typeof installReportSchema;

const toLocalInput = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

/**
 * On the roof: a phone form. Keeps a draft on the device so a weak signal on a rooftop never loses
 * the crew's work; submits when they tap the button.
 */
export default function InstallReport() {
  const { id } = useParams();
  const q = useQuery({ queryKey: ['job', id], queryFn: () => api.get<JobLite>(`/api/jobs/${id}`) });
  useEffect(() => {
    document.title = 'Installation report · Arka';
  }, []);
  if (q.isLoading) return <div className="page narrow"><SkeletonRows rows={6} /></div>;
  if (q.isError) return <div className="page narrow"><ErrorBlock error={q.error} retry={() => q.refetch()} /></div>;
  return <Form data={q.data!} />;
}

function Form({ data }: { data: JobLite }) {
  const j = data.job;
  const { me } = useSession();
  const visit = data.visits.find((v) => v.kind === 'installation' && v.status !== 'cancelled');
  const draftKey = `arka-install-draft-${j.id}`;
  const saved = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem(draftKey) ?? 'null') as Record<string, unknown> | null;
    } catch {
      return null;
    }
  }, [draftKey]);
  const morning = new Date();
  morning.setHours(9, 30, 0, 0);
  const form = useZodForm(installFormSchema, {
    startedAt: toLocalInput(visit && new Date(visit.starts_at) < new Date() ? new Date(visit.starts_at) : morning) as never,
    finishedAt: toLocalInput(new Date()) as never,
    confirmedKw: j.capacity_kw as never,
    sizeMismatchReason: '',
    generationKw: '' as never,
    checklist: { structure: false, panels: false, wiring: false, earthing: false, generation: false } as never,
    photoIds: [],
    signatureFileId: undefined as never,
    signedByName: j.customer,
    crewIds: (visit?.crew.map((c) => c.id) ?? (me ? [me.id] : [])) as never,
    notes: '',
    ...(saved ?? {}),
  });
  const [error, setError] = useState<string | null>(null);
  const qc = useQueryClient();
  const nav = useNavigate();
  const toast = useToast();
  const w = form.watch();

  // keep a local draft so a weak signal on the roof never loses work
  useEffect(() => {
    const t = window.setTimeout(() => {
      try {
        localStorage.setItem(draftKey, JSON.stringify(w));
      } catch {
        /* storage full or blocked */
      }
    }, 400);
    return () => clearTimeout(t);
  }, [w, draftKey]);

  if (j.status !== 'delivered') {
    return (
      <div className="page narrow">
        <PageHead back={{ to: `/app/jobs/${j.id}`, label: j.ref }} title="Installation report" />
        <Callout tone="warn">
          {j.status === 'installed' || j.status === 'closed' ? 'This job already has its installation report.' : 'Mark the kit as delivered first; the report comes after delivery.'}{' '}
          <Link to={`/app/jobs/${j.id}`}>Back to the job</Link>
        </Callout>
      </div>
    );
  }
  const err = (path: string) => {
    const parts = path.split('.');
    let cur: unknown = form.formState.errors;
    for (const p of parts) cur = (cur as Record<string, unknown> | undefined)?.[p];
    return (cur as { message?: string } | undefined)?.message;
  };
  const sizeDiffers = Number(w.confirmedKw) && Math.round(Number(w.confirmedKw) * 10) !== Math.round(j.capacity_kw * 10);
  const checks: [string, string][] = [
    ['structure', 'Stands mounted and bolted'],
    ['panels', 'Panels laid and clamped'],
    ['wiring', 'Wiring boxes connected'],
    ['earthing', 'Earthing finished'],
    ['generation', 'Power is being generated'],
  ];
  return (
    <div className="page narrow">
      <PageHead back={{ to: `/app/jobs/${j.id}`, label: j.ref }} title={`Installation at ${j.customer}`} lead={`${formatKw(j.capacity_kw)}, ${j.address}, ${j.city}`} />
      {saved && (
        <Callout tone="good">
          <CloudCheck size={16} /> Your earlier draft was restored from this phone.
        </Callout>
      )}
      <form
        noValidate
        className="field-form"
        onSubmit={form.handleSubmit(async (v) => {
          setError(null);
          try {
            const r = await api.post<{ invoiceNumber: string }>(`/api/jobs/${j.id}/install-report`, {
              ...v,
              startedAt: new Date(v.startedAt as unknown as string).toISOString(),
              finishedAt: new Date(v.finishedAt as unknown as string).toISOString(),
            });
            localStorage.removeItem(draftKey);
            toast(`Signed off. Invoice ${r.invoiceNumber} drafted for accounts.`);
            void qc.invalidateQueries({ queryKey: ['job'] });
            void qc.invalidateQueries({ queryKey: ['myday'] });
            nav(`/app/jobs/${j.id}`);
          } catch (e) {
            setError(applyServerError(form, e));
          }
        }, () => setError('Some steps are missing. They’re marked below.'))}
      >
        <FormError message={error} />
        <section className="panel panel-body field-step">
          <h2>
            <span className="step-n">1</span> Time on the roof
          </h2>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="ir-start">Started</label>
              <input id="ir-start" type="datetime-local" className="input" {...form.register('startedAt')} aria-invalid={!!err('startedAt')} />
              {err('startedAt') && <span className="field-error">{err('startedAt')}</span>}
            </div>
            <div className="field">
              <label htmlFor="ir-end">Finished</label>
              <input id="ir-end" type="datetime-local" className="input" {...form.register('finishedAt')} aria-invalid={!!err('finishedAt')} />
              {err('finishedAt') && <span className="field-error">{err('finishedAt')}</span>}
            </div>
          </div>
          <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="field-label">Who was on the roof</legend>
            <div className="choice-grid">
              {(visit?.crew ?? []).map((c) => (
                <label key={c.id} className="check">
                  <input
                    type="checkbox"
                    checked={(w.crewIds as number[]).includes(c.id)}
                    onChange={(e) => form.setValue('crewIds', (e.target.checked ? [...(w.crewIds as number[]), c.id] : (w.crewIds as number[]).filter((x) => x !== c.id)) as never, { shouldValidate: true })}
                  />
                  {c.name}
                </label>
              ))}
            </div>
            {err('crewIds') && <span className="field-error">{err('crewIds')}</span>}
          </fieldset>
        </section>

        <section className="panel panel-body field-step">
          <h2>
            <span className="step-n">2</span> Size and test
          </h2>
          <div className="form-grid">
            <TextField form={form as never} name="confirmedKw" label="System size installed" inputMode="decimal" suffix="kW" hint={`The order says ${formatKw(j.capacity_kw)}.`} />
            <TextField form={form as never} name="generationKw" label="Generating now" inputMode="decimal" suffix="kW" hint="Read it from the inverter display." />
          </div>
          {sizeDiffers ? <TextArea form={form as never} name="sizeMismatchReason" label="Why the size is different" rows={2} /> : null}
          <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="field-label">Done and checked</legend>
            <div style={{ display: 'grid', gap: 6 }}>
              {checks.map(([k, label]) => (
                <label key={k} className="check" aria-invalid={!!err(`checklist.${k}`)}>
                  <input type="checkbox" {...form.register(`checklist.${k}` as never)} />
                  {label}
                </label>
              ))}
            </div>
            {checks.map(([k]) => err(`checklist.${k}`)).filter(Boolean)[0] && <span className="field-error">Tick every step once it’s done.</span>}
          </fieldset>
        </section>

        <section className="panel panel-body field-step">
          <h2>
            <span className="step-n">3</span> Photos of the finished roof
          </h2>
          <PhotoInput purpose="install_photo" value={(w.photoIds as number[]) ?? []} onChange={(ids) => form.setValue('photoIds', ids as never, { shouldValidate: true })} min={2} error={err('photoIds')} />
        </section>

        <section className="panel panel-body field-step">
          <h2>
            <span className="step-n">4</span> Homeowner signs to accept
          </h2>
          <p className="muted">Hand the phone to {j.customer.split(' ')[0]}. Signing confirms the system was installed and is working.</p>
          <TextField form={form as never} name="signedByName" label="Name of the person signing" />
          <SignaturePad value={(w.signatureFileId as number) ?? null} onChange={(fid) => form.setValue('signatureFileId', (fid ?? undefined) as never, { shouldValidate: true })} error={err('signatureFileId') ? 'Ask the homeowner to sign.' : undefined} />
          <TextArea form={form as never} name="notes" label="Notes" optional rows={2} />
        </section>

        <div className="sticky-submit">
          <Button type="submit" variant="primary" size="lg" block busy={form.formState.isSubmitting}>
            Submit and sign off
          </Button>
        </div>
      </form>
    </div>
  );
}
