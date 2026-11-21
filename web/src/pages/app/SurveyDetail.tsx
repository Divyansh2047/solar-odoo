import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Compass, Phone, MapPin } from '@phosphor-icons/react';
import {
  ROOF_LABEL,
  SHADING_LABEL,
  STRUCTURE_LABEL,
  SURVEY_STATUS_LABEL,
  compass,
  estimateGeneration,
  formatDateTime,
  formatINR,
  formatKw,
  surveySubmitSchema,
  type SurveyStatus,
} from '@arka/shared';
import { api } from '../../lib/api';
import { useSession } from '../../lib/session';
import { Button, Callout, Chip, ErrorBlock, KV, PageHead, Panel, SkeletonRows } from '../../components/ui';
import { PhotoInput } from '../../components/media';
import { useToast } from '../../components/overlay';
import { applyServerError, FormError, SelectField, TextArea, TextField, useZodForm } from '../../components/form';
import { SURVEY_TONE } from './Surveys';

interface Survey {
  id: number;
  ref: string;
  status: SurveyStatus;
  lead_id: number;
  lead_ref: string;
  technician_id: number;
  technician: string;
  reviewer: string | null;
  starts_at: string | null;
  customer: string;
  phone: string;
  address: string;
  city: string;
  pincode: string;
  requested_kw: number | null;
  system_type: string;
  azimuth_deg: number | null;
  tilt_deg: number | null;
  usable_area_sqft: number | null;
  cable_distance_m: number | null;
  structure_type: keyof typeof STRUCTURE_LABEL | null;
  roof_type: keyof typeof ROOF_LABEL | null;
  shading: keyof typeof SHADING_LABEL | null;
  earthing_possible: boolean | null;
  recommended_kw: number | null;
  shading_notes: string | null;
  notes: string | null;
  review_note: string | null;
  submitted_at: string | null;
  reviewed_at: string | null;
}

export default function SurveyDetail() {
  const { id } = useParams();
  const q = useQuery({ queryKey: ['survey', id], queryFn: () => api.get<{ survey: Survey; photoIds: number[]; generation: ReturnType<typeof estimateGeneration> | null }>(`/api/surveys/${id}`) });
  const { can, me } = useSession();
  useEffect(() => {
    if (q.data) document.title = `${q.data.survey.ref} · Arka`;
  }, [q.data]);
  if (q.isLoading) return <div className="page"><SkeletonRows rows={8} /></div>;
  if (q.isError) return <div className="page"><ErrorBlock error={q.error} retry={() => q.refetch()} /></div>;
  const { survey: s, photoIds, generation } = q.data!;
  const canSubmit = can('surveys.submit') && (me?.role !== 'technician' || me.id === s.technician_id) && (s.status === 'scheduled' || s.status === 'rejected');
  return (
    <div className="page narrow">
      <PageHead back={{ to: '/app/surveys', label: 'Roof surveys' }} title={`Roof survey for ${s.customer}`}>
        <div className="row" style={{ marginTop: 8 }}>
          <span className="mono muted">{s.ref}</span>
          <Chip tone={SURVEY_TONE[s.status]}>{SURVEY_STATUS_LABEL[s.status]}</Chip>
          <span className="muted">
            {s.starts_at ? formatDateTime(s.starts_at) : ''} with {s.technician}
          </span>
        </div>
      </PageHead>
      <Panel>
        <div className="panel-body row between">
          <span>
            <MapPin size={16} style={{ verticalAlign: '-3px' }} /> {s.address}, {s.city} {s.pincode}
          </span>
          <span className="row">
            <a className="btn btn-sm" href={`tel:${s.phone}`}>
              <Phone size={16} /> Call customer
            </a>
            <Link className="btn btn-sm" to={`/app/enquiries/${s.lead_id}`}>
              Enquiry {s.lead_ref}
            </Link>
          </span>
        </div>
      </Panel>
      {s.status === 'rejected' && s.review_note && <Callout tone="warn">Sent back by {s.reviewer}: {s.review_note}</Callout>}
      {canSubmit ? <SubmitForm survey={s} /> : <Summary survey={s} photoIds={photoIds} generation={generation} />}
    </div>
  );
}

function Summary({ survey: s, photoIds, generation }: { survey: Survey; photoIds: number[]; generation: ReturnType<typeof estimateGeneration> | null }) {
  const { can } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (s.status === 'scheduled') return <Callout>The technician hasn’t submitted measurements yet.</Callout>;
  if (s.status === 'cancelled') return <Callout tone="warn">This survey was cancelled.</Callout>;
  const review = async (decision: 'approve' | 'reject') => {
    setBusy(decision);
    setError(null);
    try {
      await api.post(`/api/surveys/${s.id}/review`, { decision, note: note || undefined });
      toast(decision === 'approve' ? 'Survey approved. You can now make the quote.' : 'Sent back to the technician with your note.');
      void qc.invalidateQueries({ queryKey: ['survey'] });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed.');
    } finally {
      setBusy(null);
    }
  };
  return (
    <>
      <Panel title="Measurements">
        <div className="panel-body stack">
          <div className="module">
            <div className="module-grid">
              <div className="module-cell">
                <span className="k">Roof faces</span>
                <span className="v">{compass(s.azimuth_deg)}</span>
                <span className="s">{s.azimuth_deg}° from north</span>
              </div>
              <div className="module-cell">
                <span className="k">Tilt</span>
                <span className="v">{s.tilt_deg}°</span>
                <span className="s">{STRUCTURE_LABEL[s.structure_type ?? 'flush']}</span>
              </div>
              <div className="module-cell">
                <span className="k">Cable run</span>
                <span className="v">{s.cable_distance_m} m</span>
                <span className="s">roof to inverter</span>
              </div>
              <div className="module-cell lit">
                <span className="k">Recommended</span>
                <span className="v">{formatKw(s.recommended_kw)}</span>
                <span className="s">{s.usable_area_sqft} sq ft usable</span>
              </div>
            </div>
          </div>
          {generation && (
            <p>
              At this direction and tilt a {formatKw(s.recommended_kw)} system should make about <b>{generation.monthlyUnits} units a month</b> ({Math.round(generation.factor * 100)}% of an ideal south-facing roof), saving roughly{' '}
              <b>{formatINR(generation.monthlySavingsPaise)}</b> a month.
            </p>
          )}
          <KV
            items={[
              ['Roof', s.roof_type ? ROOF_LABEL[s.roof_type] : null],
              ['Shade', s.shading ? SHADING_LABEL[s.shading] : null],
              ['Earthing pits possible', s.earthing_possible ? 'Yes' : 'No'],
              ['Shade notes', s.shading_notes],
              ['Notes', s.notes],
              ['Submitted', s.submitted_at ? formatDateTime(s.submitted_at) : null],
              ['Reviewed', s.reviewed_at ? `${formatDateTime(s.reviewed_at)} by ${s.reviewer}` : null],
            ]}
          />
          {photoIds.length > 0 && (
            <div className="thumbs">
              {photoIds.map((p) => (
                <a key={p} className="thumb" href={`/api/files/${p}`} target="_blank" rel="noreferrer">
                  <img src={`/api/files/${p}`} alt="Roof photo from the survey" loading="lazy" />
                </a>
              ))}
            </div>
          )}
        </div>
      </Panel>
      {s.status === 'submitted' && can('surveys.review') && (
        <Panel title="Approve or send back">
          <div className="panel-body stack">
            {error && <div className="form-error">{error}</div>}
            <div className="field">
              <label htmlFor="rv-note">Note for the technician (needed to send back)</label>
              <textarea id="rv-note" className="textarea" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. measure the west parapet again" />
            </div>
            <div className="form-actions">
              <Button variant="danger" busy={busy === 'reject'} onClick={() => review('reject')}>
                Send back for a revisit
              </Button>
              <Button variant="primary" busy={busy === 'approve'} onClick={() => review('approve')}>
                Approve survey
              </Button>
            </div>
          </div>
        </Panel>
      )}
      {s.status === 'approved' && (
        <Callout tone="good" action={<Link className="btn btn-primary" to={`/app/enquiries/${s.lead_id}`}>Make the quote</Link>}>
          Approved. The quote will size its cables from this {s.cable_distance_m} m run.
        </Callout>
      )}
    </>
  );
}

function SubmitForm({ survey: s }: { survey: Survey }) {
  const form = useZodForm(surveySubmitSchema, {
    azimuthDeg: (s.azimuth_deg ?? 180) as never,
    tiltDeg: (s.tilt_deg ?? 15) as never,
    usableAreaSqft: (s.usable_area_sqft ?? '') as never,
    cableDistanceM: (s.cable_distance_m ?? '') as never,
    structureType: s.structure_type ?? 'elevated_low',
    roofType: s.roof_type ?? 'rcc',
    shading: s.shading ?? 'none',
    earthingPossible: true,
    recommendedKw: (s.recommended_kw ?? s.requested_kw ?? 3) as never,
    shadingNotes: s.shading_notes ?? '',
    notes: s.notes ?? '',
    photoIds: [],
  });
  const [error, setError] = useState<string | null>(null);
  const [compassMsg, setCompassMsg] = useState<string | null>(null);
  const qc = useQueryClient();
  const toast = useToast();
  const w = form.watch();
  const gen = useMemo(
    () => estimateGeneration({ capacityKw: Number(w.recommendedKw) || 1, azimuthDeg: Number(w.azimuthDeg), tiltDeg: Number(w.tiltDeg), shading: w.shading as never }),
    [w.recommendedKw, w.azimuthDeg, w.tiltDeg, w.shading],
  );
  const photoError = (form.formState.errors.photoIds as { message?: string } | undefined)?.message;

  const useCompass = () => {
    setCompassMsg(null);
    const D = window.DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> };
    const listen = () => {
      const handler = (e: DeviceOrientationEvent & { webkitCompassHeading?: number }) => {
        const heading = e.webkitCompassHeading ?? (e.absolute && e.alpha !== null ? (360 - e.alpha) % 360 : null);
        if (heading === null || heading === undefined) return;
        form.setValue('azimuthDeg', Math.round(heading) as never, { shouldValidate: true });
        setCompassMsg(`Set from your phone: ${Math.round(heading)}° (${compass(heading)}). Hold the phone flat, pointing the way the panels will face.`);
        window.removeEventListener('deviceorientationabsolute', handler as EventListener);
        window.removeEventListener('deviceorientation', handler as EventListener);
      };
      window.addEventListener('deviceorientationabsolute', handler as EventListener);
      window.addEventListener('deviceorientation', handler as EventListener);
      window.setTimeout(() => setCompassMsg((m) => m ?? 'No compass reading from this device. Type the direction instead.'), 2500);
    };
    if (D?.requestPermission) void D.requestPermission().then((r) => (r === 'granted' ? listen() : setCompassMsg('Compass permission was not given.')));
    else listen();
  };

  return (
    <form
      noValidate
      className="field-form"
      onSubmit={form.handleSubmit(async (v) => {
        setError(null);
        try {
          await api.post(`/api/surveys/${s.id}/submit`, v);
          toast('Survey sent for approval. Thank you.');
          void qc.invalidateQueries({ queryKey: ['survey'] });
          void qc.invalidateQueries({ queryKey: ['myday'] });
        } catch (e) {
          setError(applyServerError(form, e));
        }
      })}
    >
      <FormError message={error} />
      <section className="panel panel-body field-step">
        <h2>
          <span className="step-n">1</span> Which way does the roof face?
        </h2>
        <div className="seg" role="group" aria-label="Quick direction">
          {[['N', 0], ['NE', 45], ['E', 90], ['SE', 135], ['S', 180], ['SW', 225], ['W', 270], ['NW', 315]].map(([l, deg]) => (
            <button key={l} type="button" aria-pressed={Number(w.azimuthDeg) === deg} onClick={() => form.setValue('azimuthDeg', deg as never, { shouldValidate: true })}>
              {l}
            </button>
          ))}
        </div>
        <div className="form-grid">
          <TextField form={form as never} name="azimuthDeg" label="Direction the panels will face" inputMode="numeric" suffix="°" hint={`${compass(Number(w.azimuthDeg))}. South (180°) is best in India.`} />
          <div className="field" style={{ alignContent: 'end' }}>
            <Button onClick={useCompass} icon={<Compass size={18} />}>
              Use my phone’s compass
            </Button>
          </div>
        </div>
        {compassMsg && <p className="field-hint">{compassMsg}</p>}
      </section>
      <section className="panel panel-body field-step">
        <h2>
          <span className="step-n">2</span> Tilt, space and cable distance
        </h2>
        <div className="form-grid">
          <TextField form={form as never} name="tiltDeg" label="Tilt" inputMode="decimal" suffix="°" hint="15–25° is typical on an elevated stand." />
          <TextField form={form as never} name="usableAreaSqft" label="Usable shadow-free area" inputMode="numeric" suffix="sq ft" />
          <TextField form={form as never} name="cableDistanceM" label="Cable distance, roof to inverter" inputMode="decimal" suffix="m" hint="This sizes the DC cable in the quote." />
          <SelectField form={form as never} name="structureType" label="Mounting" options={Object.entries(STRUCTURE_LABEL).map(([value, label]) => ({ value, label }))} />
        </div>
      </section>
      <section className="panel panel-body field-step">
        <h2>
          <span className="step-n">3</span> Roof condition
        </h2>
        <div className="form-grid">
          <SelectField form={form as never} name="roofType" label="Roof" options={Object.entries(ROOF_LABEL).map(([value, label]) => ({ value, label }))} />
          <SelectField form={form as never} name="shading" label="Shade" options={Object.entries(SHADING_LABEL).map(([value, label]) => ({ value, label }))} />
          <SelectField form={form as never} name="earthingPossible" label="Can earthing pits be dug?" options={[{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }]} />
          <TextField form={form as never} name="shadingNotes" label="What causes shade" optional />
        </div>
      </section>
      <section className="panel panel-body field-step">
        <h2>
          <span className="step-n">4</span> Photos of the roof
        </h2>
        <PhotoInput purpose="survey_photo" value={(w.photoIds as number[]) ?? []} onChange={(ids) => form.setValue('photoIds', ids as never, { shouldValidate: true })} min={1} error={photoError} />
      </section>
      <section className="panel panel-body field-step">
        <h2>
          <span className="step-n">5</span> Your recommendation
        </h2>
        <SelectField form={form as never} name="recommendedKw" label="System size" options={[1, 2, 3, 4, 5].map((k) => ({ value: k, label: `${k} kW` }))} />
        <p className="field-hint" aria-live="polite">
          Expected generation here: about <b>{gen.monthlyUnits} units a month</b>, {Math.round(gen.factor * 100)}% of an ideal roof.
        </p>
        <TextArea form={form as never} name="notes" label="Notes for sales" optional rows={3} />
      </section>
      <div className="sticky-submit">
        <Button type="submit" variant="primary" size="lg" block busy={form.formState.isSubmitting}>
          Send for approval
        </Button>
      </div>
    </form>
  );
}
