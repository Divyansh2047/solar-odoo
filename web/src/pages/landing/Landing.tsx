import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { DemoButton } from '../../components/DemoButton';
import { GLBoundary, hasWebGL, usePrefersReducedMotion } from '../../three/support';
import type { SafeRect } from '../../three/labels';
import type { StoryClock } from './scene/ctx';
import StorySvg from './StorySvg';
import { COUNTS, KWP, LAST, clock, energyTodayKwh, generationKw, local, overcast, sunHour } from './story';
import { DAYS, FEATURES, Facts, Signature, WarrantyRuler, WeekStrip } from './content';
import './landing.css';

const StoryStage = lazy(() => import('./StoryStage'));

const NARROW = '(max-width: 819px)';
function useNarrow() {
  const [n, setN] = useState(() => typeof window !== 'undefined' && window.matchMedia(NARROW).matches);
  useEffect(() => {
    const mq = window.matchMedia(NARROW);
    const on = () => setN(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return n;
}

function CellGlyph() {
  return (
    <svg className="lp-glyph" viewBox="0 0 11 16" aria-hidden="true">
      {[0, 1, 2].flatMap((r) =>
        [0, 1].map((c) => <rect key={`${r}${c}`} x={c * 6} y={r * 5.5} width={5} height={4.5} rx={0.8} className={r === 0 && c === 1 ? 'lit' : undefined} />),
      )}
    </svg>
  );
}

export default function Landing() {
  const reduced = usePrefersReducedMotion();
  const narrow = useNarrow();
  const [webgl] = useState(hasWebGL);
  const [step, setStep] = useState(0);
  const clockRef = useRef<StoryClock>({ t: 0, reduced });
  const safe = useRef<SafeRect | null>(null);
  const invalidate = useRef<(() => void) | null>(null);
  const flow = useRef<HTMLDivElement>(null);
  const steps = useRef<HTMLOListElement>(null);
  const anchors = useRef<number[]>([]);
  const kw = useRef<HTMLSpanElement>(null);
  const at = useRef<HTMLSpanElement>(null);
  const today = useRef<HTMLSpanElement>(null);
  const sign = useRef<SVGPathElement>(null);
  clockRef.current.reduced = reduced;

  const update = useCallback(() => {
    const vh = window.innerHeight;
    const line = window.scrollY + vh * (window.innerWidth < 820 ? 0.68 : 0.5);
    const a = anchors.current;
    let t = 0;
    if (a.length > 1) {
      if (line >= a[a.length - 1]!) t = a.length - 1;
      else
        for (let i = 0; i < a.length - 1; i++) {
          if (line < a[i + 1]!) {
            t = i + Math.max(0, (line - a[i]!) / (a[i + 1]! - a[i]!));
            break;
          }
        }
    }
    t = Math.min(LAST, Math.max(0, t));
    if (clockRef.current.reduced) t = Math.round(t);
    clockRef.current.t = t;
    invalidate.current?.();
    const hour = sunHour(t);
    if (kw.current) kw.current.textContent = generationKw(hour, overcast(t)).toFixed(2);
    if (at.current) at.current.textContent = clock(hour);
    if (today.current) today.current.textContent = energyTodayKwh(hour).toFixed(1);
    if (sign.current) sign.current.style.strokeDashoffset = String(1 - local(t, 5, -0.35, 0));
    setStep(Math.round(t));
  }, []);

  const measure = useCallback(() => {
    const root = flow.current;
    if (!root) return;
    const vh = window.innerHeight;
    const W = window.innerWidth;
    const lineAt0 = vh * (W < 820 ? 0.68 : 0.5);
    const els = Array.from(root.querySelectorAll<HTMLElement>('[data-anchor]'));
    anchors.current = [lineAt0, ...els.map((el) => el.getBoundingClientRect().top + window.scrollY + el.offsetHeight / 2)];
    const col = steps.current?.getBoundingClientRect();
    safe.current =
      W < 820 || !col
        ? { left: 12, top: 12, right: W - 12, bottom: Math.round(vh * 0.46) }
        : { left: Math.round(col.right + 28), top: 16, right: W - 16, bottom: vh - 16 };
    update();
  }, [update]);

  useLayoutEffect(() => {
    measure();
    const ro = new ResizeObserver(measure);
    if (flow.current) ro.observe(flow.current);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', update, { passive: true });
    document.fonts?.ready.then(measure).catch(() => undefined);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', update);
    };
  }, [measure, update]);

  useEffect(() => {
    update();
  }, [reduced, update]);

  const onReady = useCallback(
    (inv: () => void) => {
      invalidate.current = inv;
      update();
    },
    [update],
  );

  const ctas = (
    <div className="lp-ctas">
      <DemoButton />
      <Link to="/signup" className="btn btn-outline btn-lg">
        Create your workspace
      </Link>
    </div>
  );
  const fallback = <StorySvg step={step} narrow={narrow} />;

  return (
    <div className="lp">
      <a className="skip-link" href="#lp-week">
        Skip to the story
      </a>
      <header className="lp-top lp-daylight">
        <Link to="/" className="lp-mark" aria-label="Arka, home">
          <CellGlyph />
          <span>Arka</span>
        </Link>
        <Link to="/signin" className="lp-signin">
          Sign in
        </Link>
      </header>
      <main>
        <div className="lp-story" data-reduced={reduced || undefined}>
          <div className="lp-stage" aria-hidden="true">
            {webgl ? (
              <GLBoundary fallback={fallback}>
                <Suspense fallback={<div className="lp-stage-wait" />}>
                  <StoryStage clock={clockRef} safe={safe} onReady={onReady} />
                </Suspense>
              </GLBoundary>
            ) : (
              fallback
            )}
          </div>
          <div className="lp-flow" ref={flow}>
            <section className="lp-hero lp-daylight" aria-labelledby="lp-title">
              <div className="lp-hero-text">
                <h1 id="lp-title">From the first enquiry to the twentieth year.</h1>
                <p className="lp-sub">Arka runs a rooftop solar company end to end: enquiries, roof surveys, quotes, kits, dispatch with serial numbers, installation sign-off, warranty and service.</p>
                {ctas}
              </div>
              <aside className="lp-meter" aria-label="Generation on this roof right now">
                <p className="lp-meter-head">
                  <span className="lp-meter-dot" aria-hidden="true" />
                  Kulkarni rooftop, {KWP.toFixed(2)} kWp
                </p>
                <p className="lp-meter-now">
                  <span className="mono" ref={kw}>
                    {generationKw(sunHour(0)).toFixed(2)}
                  </span>{' '}
                  kW now
                </p>
                <p className="lp-meter-sub">
                  at <span className="mono" ref={at}>{clock(sunHour(0))}</span>, <span className="mono" ref={today}>{energyTodayKwh(sunHour(0)).toFixed(1)}</span> kWh so far today
                </p>
              </aside>
            </section>
            <section className="lp-week" id="lp-week" aria-labelledby="lp-week-title">
              <div className="lp-intro">
                <div className="lp-card">
                  <h2 id="lp-week-title">A week at SunPower</h2>
                  <p>SunPower Solutions fits about 40 rooftop systems a month with 15 technicians. This is one customer’s week, from her first message to month-end, and what Arka does on each day.</p>
                </div>
              </div>
              <ol className="lp-steps" ref={steps}>
                {DAYS.map((d, i) => (
                  <li className="lp-step" key={d.day}>
                    <article className="lp-card" data-anchor={i + 1} aria-labelledby={`lp-day-${i}`}>
                      <p className="lp-day">
                        <WeekStrip at={i} />
                        <span className="lp-day-name">{d.day}</span>
                        {d.date && <span className="lp-day-date">{d.date}</span>}
                      </p>
                      <h3 id={`lp-day-${i}`}>{d.title}</h3>
                      <p>{d.body}</p>
                      {d.facts && <Facts rows={d.facts} />}
                      {d.extra === 'ruler' && <WarrantyRuler />}
                      {d.extra === 'sign' && <Signature pathRef={sign} />}
                      {d.extra === 'legend' && (
                        <ul className="lp-legend">
                          <li>
                            <span className="sw good" aria-hidden="true" />
                            {COUNTS.profit} made money
                          </li>
                          <li>
                            <span className="sw bad" aria-hidden="true" />
                            {COUNTS.loss} lost money
                          </li>
                          <li>
                            <span className="sw open" aria-hidden="true" />
                            {COUNTS.unfinished} unfinished
                          </li>
                        </ul>
                      )}
                    </article>
                  </li>
                ))}
              </ol>
            </section>
          </div>
        </div>

        <section className="lp-inside" aria-labelledby="lp-inside-title">
          <div className="lp-wrap">
            <div className="lp-inside-head">
              <h2 id="lp-inside-title">What’s inside</h2>
              <p>One system for the whole job, with each part doing work that used to live on paper, in WhatsApp or in someone’s head.</p>
            </div>
            <ul className="lp-module">
              {FEATURES.map((f) => (
                <li key={f.title} className="lp-cell" data-lit={f.lit || undefined}>
                  <h3>{f.title}</h3>
                  <p>{f.body}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="lp-close" aria-labelledby="lp-close-title">
          <div className="lp-wrap lp-close-inner">
            <div>
              <h2 id="lp-close-title">Open SunPower’s month and look around.</h2>
              <p>The demo is a private workspace with enquiries, jobs, serials, tickets and profit already in it. Nothing you change there touches anyone else.</p>
            </div>
            {ctas}
          </div>
        </section>
      </main>
      <footer className="lp-foot">
        <div className="lp-wrap">
          <p>Built for the Odoo hackathon final. © 2026 Arka.</p>
          <Link to="/signin">Sign in</Link>
        </div>
      </footer>
    </div>
  );
}
