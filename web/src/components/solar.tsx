import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { JOB_STAGES, JOB_STAGE_LABEL, addMonths, formatDate, warrantyLeft, type JobStage } from '@arka/shared';

type StageState = Record<JobStage, 'done' | 'todo' | 'na'>;

/** Eight small cells, like a strip of solar cells, that fill with sun as a job moves on. */
export function CellStrip({ stages, large }: { stages: StageState; large?: boolean }) {
  const done = JOB_STAGES.filter((s) => stages[s] === 'done').length;
  const total = JOB_STAGES.filter((s) => stages[s] !== 'na').length;
  const next = JOB_STAGES.find((s) => stages[s] === 'todo');
  return (
    <span
      className={`cellstrip ${large ? 'lg' : ''}`}
      role="img"
      aria-label={`${done} of ${total} stages done${next ? `; next: ${JOB_STAGE_LABEL[next]}` : ''}`}
      title={JOB_STAGES.map((s) => `${JOB_STAGE_LABEL[s]}: ${stages[s] === 'done' ? 'done' : stages[s] === 'na' ? 'not needed' : 'to do'}`).join('\n')}
    >
      {JOB_STAGES.map((s) => (
        <i key={s} className={stages[s] === 'done' ? 'done' : stages[s] === 'na' ? 'na' : ''} />
      ))}
    </span>
  );
}

/** The full stage band on the job page, with dates. */
export function Stages({ stages, dates }: { stages: StageState; dates: Partial<Record<JobStage, string | null>> }) {
  const next = JOB_STAGES.find((s) => stages[s] === 'todo');
  return (
    <ol className="stages" aria-label="Job progress" style={{ listStyle: 'none', margin: 0 }}>
      {JOB_STAGES.map((s) => (
        <li key={s} className={`stage ${stages[s] === 'done' ? 'done' : ''} ${stages[s] === 'na' ? 'na' : ''} ${s === next ? 'next' : ''}`} aria-current={s === next ? 'step' : undefined}>
          <b>{JOB_STAGE_LABEL[s]}</b>
          <small>{stages[s] === 'done' ? (dates[s] ? formatDate(dates[s]!) : 'Done') : stages[s] === 'na' ? 'Not needed' : s === next ? 'Next' : '—'}</small>
        </li>
      ))}
    </ol>
  );
}

/**
 * A warranty as a ruler: the scale runs from delivery to the longest warranty (20 years for panels),
 * each part's cover is a band, and "today" is a mark. Words say the same thing for screen readers.
 */
export function WarrantyRuler({ start, end, today, years = 20, label }: { start: string | null; end: string | null; today: string; years?: number; label?: string }) {
  if (!start || !end) return <p className="muted">Warranty starts when the kit is delivered.</p>;
  const ms = (d: string) => new Date(`${d.slice(0, 10)}T00:00:00Z`).getTime();
  // the scale is never shorter than the cover itself, so the band can't run off the end
  const coverYears = Math.ceil((ms(end) - ms(start)) / (365.25 * 864e5) - 0.01);
  const scaleYears = Math.max(years, coverYears, Math.ceil((ms(today) - ms(start)) / (365.25 * 864e5)));
  const span = ms(addMonths(start, scaleYears * 12)) - ms(start);
  const pos = (d: string) => Math.max(0, Math.min(100, ((ms(d) - ms(start)) / span) * 100));
  const step = scaleYears <= 6 ? 1 : scaleYears <= 12 ? 2 : 5;
  const ticks = Array.from({ length: Math.floor(scaleYears / step) + 1 }, (_, i) => i * step);
  if (ticks[ticks.length - 1] !== scaleYears) ticks.push(scaleYears);
  const covered = end >= today;
  const todayAt = pos(today);
  const startLabel = new Date(ms(start)).toLocaleDateString('en-IN', { month: 'short', year: 'numeric', timeZone: 'UTC' });
  const status = covered ? `Covered until ${formatDate(end)}` : `Warranty ended ${formatDate(end)}`;
  const words = `${label ? `${label}: ` : ''}${status} (${warrantyLeft(end, today)}).`;
  return (
    <div className="ruler-wrap">
      <div className="ruler" role="img" aria-label={words} style={{ ['--years' as string]: scaleYears }}>
        <div className="ruler-track" />
        <div className={`ruler-band ${covered ? '' : 'expired'}`} style={{ left: 0, width: `${pos(end)}%` }} />
        <div className={`ruler-today ${todayAt > 82 ? 'flip' : ''}`} style={{ left: `calc(${todayAt}% - 1px)` }}>
          <span>Today</span>
        </div>
        <div className="ruler-scale" aria-hidden>
          {ticks.map((t, i) => (
            <span key={t} className={i === 0 ? 'first' : i === ticks.length - 1 ? 'last' : ''} style={{ left: `${(t / scaleYears) * 100}%` }}>
              {t === 0 ? startLabel : `+${t} yr`}
            </span>
          ))}
        </div>
      </div>
      <p className={`ruler-caption ${covered ? 'good' : 'bad'}`} aria-hidden>
        {status}, {warrantyLeft(end, today)}
      </p>
    </div>
  );
}

export function CoverageChip({ end, today }: { end: string | null | undefined; today: string }) {
  if (!end) return <span className="chip">Not started</span>;
  return end >= today ? <span className="chip good">Covered until {formatDate(end)}</span> : <span className="chip bad">Expired {formatDate(end)}</span>;
}

/** One cell of the dashboard module. */
export function ModuleCell({ k, v, s, tone, to }: { k: string; v: ReactNode; s?: ReactNode; tone?: 'lit' | 'alert' | 'good'; to?: string }) {
  const inner = (
    <>
      <span className="k">{k}</span>
      <span className="v">{v}</span>
      {s && <span className="s">{s}</span>}
    </>
  );
  return to ? (
    <Link className={`module-cell ${tone ?? ''}`} to={to}>
      {inner}
    </Link>
  ) : (
    <div className={`module-cell ${tone ?? ''}`}>{inner}</div>
  );
}
