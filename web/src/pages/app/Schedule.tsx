import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CaretLeft, CaretRight, CheckCircle } from '@phosphor-icons/react';
import { VISIT_KIND_LABEL, addDays, formatDate, formatTime, isoDateInTz, localDateTime, visitSchema, type VisitKind } from '@arka/shared';
import { api, ApiError } from '../../lib/api';
import { useSession } from '../../lib/session';
import { Button, ErrorBlock, PageHead, Seg, SkeletonRows } from '../../components/ui';
import { Dialog, useToast } from '../../components/overlay';
import { applyServerError, FormError, useZodForm } from '../../components/form';

interface Visit {
  id: number;
  kind: VisitKind;
  starts_at: string;
  ends_at: string;
  status: string;
  customer: string;
  city: string;
  job_id: number | null;
  survey_id: number | null;
  ticket_id: number | null;
  job_ref: string | null;
  survey_ref: string | null;
  ticket_ref: string | null;
  capacity_kw: number | null;
  crew: { id: number; name: string }[];
}

/** One board for surveys, installations and service visits. The database refuses double bookings. */
export default function Schedule() {
  const { me, can } = useSession();
  const tz = me?.timezone ?? 'Asia/Kolkata';
  const today = isoDateInTz(new Date(), tz);
  const monday = useMemo(() => {
    const d = new Date(`${today}T12:00:00Z`);
    return addDays(today, -((d.getUTCDay() + 6) % 7));
  }, [today]);
  const [from, setFrom] = useState(monday);
  const [days, setDays] = useState(me?.role === 'technician' ? 3 : 7);
  const [edit, setEdit] = useState<Visit | null>(null);
  useEffect(() => {
    document.title = 'Schedule · Arka';
  }, []);
  const q = useQuery({ queryKey: ['schedule', from, days], queryFn: () => api.get<{ visits: Visit[]; technicians: { id: number; name: string }[] }>(`/api/schedule?from=${from}&days=${days}`) });
  const dates = Array.from({ length: days }, (_, i) => addDays(from, i));
  const techs = me?.role === 'technician' ? (q.data?.technicians ?? []).filter((t) => t.id === me.id) : (q.data?.technicians ?? []);
  const cell = (techId: number, day: string) => (q.data?.visits ?? []).filter((v) => v.crew.some((c) => c.id === techId) && isoDateInTz(new Date(v.starts_at), tz) === day);
  const load = (techId: number) => (q.data?.visits ?? []).filter((v) => v.crew.some((c) => c.id === techId)).length;
  return (
    <div className="page">
      <PageHead
        title={me?.role === 'technician' ? 'My schedule' : 'Schedule'}
        lead="Roof surveys, installations and service visits, by technician."
      />
      <div className="toolbar">
        <Button size="sm" aria-label="Previous" icon={<CaretLeft size={16} />} onClick={() => setFrom(addDays(from, -days))} />
        <Button size="sm" onClick={() => setFrom(monday)}>
          This week
        </Button>
        <Button size="sm" aria-label="Next" icon={<CaretRight size={16} />} onClick={() => setFrom(addDays(from, days))} />
        <b style={{ marginLeft: 8 }}>
          {formatDate(from)} to {formatDate(addDays(from, days - 1))}
        </b>
        <span style={{ flex: 1 }} />
        <Seg label="Days shown" value={String(days)} onChange={(v) => setDays(Number(v))} options={[{ value: '3', label: '3 days' }, { value: '7', label: 'Week' }]} />
      </div>
      <div className="legend">
        <span>
          <i style={{ background: 'var(--cell)' }} /> Roof survey
        </span>
        <span>
          <i style={{ background: 'var(--sun-strong)' }} /> Installation
        </span>
        <span>
          <i style={{ background: 'var(--bad)' }} /> Service visit
        </span>
      </div>
      {q.isLoading ? (
        <SkeletonRows rows={10} />
      ) : q.isError ? (
        <ErrorBlock error={q.error} retry={() => q.refetch()} />
      ) : (
        <>
        <Agenda
          dates={dates}
          today={today}
          visits={(day) => (q.data?.visits ?? []).filter((v) => isoDateInTz(new Date(v.starts_at), tz) === day)}
          techId={me?.role === 'technician' ? me.id : null}
          canEdit={(v) => can('schedule.write') && v.kind !== 'survey' && v.status === 'planned'}
          onEdit={setEdit}
        />
        <div className="board" style={{ ['--days' as string]: days }} role="grid" aria-label="Crew schedule">
          <div style={{ display: 'contents' }} role="row">
            <div className="bh" role="columnheader">
              Technician
            </div>
            {dates.map((d) => (
              <div key={d} className={`bh ${d === today ? 'today' : ''}`} role="columnheader" aria-current={d === today ? 'date' : undefined}>
                {new Date(`${d}T12:00:00Z`).toLocaleDateString('en-IN', { weekday: 'short' })} {formatDate(d).replace(/\s\d{4}$/, '')}
              </div>
            ))}
          </div>
          {techs.map((t) => (
            <div key={t.id} style={{ display: 'contents' }} role="row">
              <div className="tech" role="rowheader">
                {t.name}
                <span>{load(t.id)} {load(t.id) === 1 ? 'visit' : 'visits'}</span>
              </div>
              {dates.map((d) => {
                const sunday = new Date(`${d}T12:00:00Z`).getUTCDay() === 0;
                return (
                  <div key={d} className={`slot ${sunday ? 'weekend' : ''}`} role="gridcell">
                    {cell(t.id, d).map((v) => (
                      <VisitCard key={v.id} v={v} onEdit={can('schedule.write') && v.kind !== 'survey' && v.status === 'planned' ? () => setEdit(v) : undefined} />
                    ))}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        </>
      )}
      {edit && <MoveVisit visit={edit} technicians={q.data?.technicians ?? []} onClose={() => setEdit(null)} />}
    </div>
  );
}

function VisitCard({ v, onEdit, showCrew }: { v: Visit; onEdit?: () => void; showCrew?: boolean }) {
  const to = v.job_id ? `/app/jobs/${v.job_id}` : v.survey_id ? `/app/surveys/${v.survey_id}` : `/app/service/${v.ticket_id}`;
  const done = v.status === 'done';
  return (
    <div className={`visit ${v.kind} ${done ? 'done' : ''}`}>
      <Link to={to} className="visit-link" title={`${VISIT_KIND_LABEL[v.kind]}: ${v.customer}, ${v.city}`}>
        <span className="visit-time">
          {done && <CheckCircle size={14} weight="fill" aria-label="Done" />}
          {formatTime(v.starts_at)}
        </span>
        <b className="visit-kind">{VISIT_KIND_LABEL[v.kind]}</b>
        <span className="visit-who">{showCrew ? `${v.customer}, ${v.city}` : v.customer}</span>
        <span className="visit-ref">
          <span className="mono">{v.job_ref ?? v.survey_ref ?? v.ticket_ref}</span>
          {v.capacity_kw ? <span> {v.capacity_kw} kW</span> : null}
        </span>
        {showCrew && v.crew.length > 0 && <span className="visit-crew">{v.crew.map((c) => c.name).join(', ')}</span>}
      </Link>
      {onEdit && (
        <button className="link-btn visit-move" onClick={onEdit} aria-label={`Move or change the crew for ${v.customer}`}>
          Change
        </button>
      )}
    </div>
  );
}

/** Phones get the same week as a list of days: a 7-column grid can't be read at 390 px. */
function Agenda({ dates, today, visits, techId, canEdit, onEdit }: { dates: string[]; today: string; visits: (day: string) => Visit[]; techId: number | null; canEdit: (v: Visit) => boolean; onEdit: (v: Visit) => void }) {
  return (
    <div className="agenda" aria-label="Schedule by day">
      {dates.map((d) => {
        const list = visits(d).filter((v) => techId === null || v.crew.some((c) => c.id === techId));
        return (
          <section key={d} className={`agenda-day ${d === today ? 'today' : ''}`} aria-current={d === today ? 'date' : undefined}>
            <h3>
              {new Date(`${d}T12:00:00Z`).toLocaleDateString('en-IN', { weekday: 'long' })}, {formatDate(d).replace(/\s\d{4}$/, '')}
              <span>{list.length ? `${list.length} visit${list.length === 1 ? '' : 's'}` : 'Nothing booked'}</span>
            </h3>
            {list.map((v) => (
              <VisitCard key={v.id} v={v} showCrew onEdit={canEdit(v) ? () => onEdit(v) : undefined} />
            ))}
          </section>
        );
      })}
    </div>
  );
}

const toLocal = (iso: string) => {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

function MoveVisit({ visit, technicians, onClose }: { visit: Visit; technicians: { id: number; name: string }[]; onClose: () => void }) {
  const schema = visitSchema.safeExtend({ startsAt: localDateTime, endsAt: localDateTime }) as unknown as typeof visitSchema;
  const form = useZodForm(schema, { startsAt: toLocal(visit.starts_at), endsAt: toLocal(visit.ends_at), technicianIds: visit.crew.map((c) => c.id), notes: '' });
  const [error, setError] = useState<string | null>(null);
  const qc = useQueryClient();
  const toast = useToast();
  const crew = form.watch('technicianIds') as number[];
  return (
    <Dialog open onClose={onClose} title={`Move ${VISIT_KIND_LABEL[visit.kind].toLowerCase()} for ${visit.customer}`} description="If someone is already booked then, Arka says who and when.">
      <form
        noValidate
        className="stack"
        onSubmit={form.handleSubmit(async (v) => {
          setError(null);
          try {
            await api.put(`/api/visits/${visit.id}`, v);
            toast('Visit moved. The crew sees it on their phones.');
            void qc.invalidateQueries({ queryKey: ['schedule'] });
            onClose();
          } catch (e) {
            setError(e instanceof ApiError && e.code === 'double_booked' ? e.message : applyServerError(form, e));
          }
        })}
      >
        <FormError message={error} />
        <div className="form-grid">
          <div className="field">
            <label htmlFor="mv-s">Starts</label>
            <input id="mv-s" type="datetime-local" className="input" {...form.register('startsAt')} />
          </div>
          <div className="field">
            <label htmlFor="mv-e">Ends</label>
            <input id="mv-e" type="datetime-local" className="input" {...form.register('endsAt')} />
            {form.formState.errors.endsAt && <span className="field-error">{String(form.formState.errors.endsAt.message)}</span>}
          </div>
        </div>
        <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="field-label">Crew</legend>
          <div className="choice-grid">
            {technicians.map((t) => (
              <label key={t.id} className="check">
                <input type="checkbox" checked={crew.includes(t.id)} onChange={(e) => form.setValue('technicianIds', (e.target.checked ? [...crew, t.id] : crew.filter((x) => x !== t.id)) as never, { shouldValidate: true })} />
                {t.name}
              </label>
            ))}
          </div>
          {form.formState.errors.technicianIds && <span className="field-error">{String(form.formState.errors.technicianIds.message)}</span>}
        </fieldset>
        <div className="form-actions">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" busy={form.formState.isSubmitting}>
            Save
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
