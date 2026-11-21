import { useId, useState } from 'react';
import { Link } from 'react-router';
import { formatDate, formatINR, formatPercent } from '@arka/shared';

/**
 * Single-series weekly bars (one axis, one hue). Hover or focus a bar for its value; the same data
 * is available as a table for screen readers.
 */
export function WeeklyBars({ data, format, label, unit }: { data: { week: string; value: number }[]; format: (v: number) => string; label: string; unit?: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 640;
  const H = 180;
  const pad = { l: 4, r: 52, t: 12, b: 26 };
  const max = Math.max(1, ...data.map((d) => d.value));
  const bw = (W - pad.l - pad.r) / data.length;
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / max);
  const grid = [0.5, 1].map((f) => max * f);
  return (
    <figure className="chart" aria-label={`${label}, last ${data.length} weeks`} style={{ margin: 0 }}>
      <svg viewBox={`0 0 ${W} ${H}`} role="group" aria-label={`${label}: focus a bar for its value`} onMouseLeave={() => setHover(null)}>
        {grid.map((g) => (
          <g key={g}>
            <line x1={pad.l} x2={W - pad.r} y1={y(g)} y2={y(g)} stroke="var(--chart-grid)" strokeWidth={1} />
            <text x={W - 2} y={y(g) + 4} textAnchor="end" fontSize={11} fill="var(--chart-axis)">
              {format(g)}
            </text>
          </g>
        ))}
        <line x1={pad.l} x2={W - pad.r} y1={y(0)} y2={y(0)} stroke="var(--chart-axis)" strokeWidth={1} />
        {data.map((d, i) => {
          const x = pad.l + i * bw;
          const h = y(0) - y(d.value);
          const last = i === data.length - 1;
          return (
            <g key={d.week}>
              <rect
                x={x + 2}
                y={pad.t}
                width={bw - 4}
                height={H - pad.t - pad.b}
                fill="transparent"
                tabIndex={0}
                role="button"
                aria-label={`Week of ${formatDate(d.week)}: ${format(d.value)}`}
                onMouseEnter={() => setHover(i)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
              />
              {d.value > 0 && <path d={roundedTop(x + bw * 0.22, y(d.value), bw * 0.56, h, 4)} fill="var(--chart-1)" opacity={hover === null || hover === i ? 1 : 0.4} pointerEvents="none" />}
              {(i % 2 === 1 || last) && (
                <text x={x + bw / 2} y={H - 8} textAnchor="middle" fontSize={11} fill={last ? 'var(--ink)' : 'var(--chart-axis)'} fontWeight={last ? 700 : 400}>
                  {last ? 'This wk' : formatDate(d.week).replace(/\s\d{4}$/, '')}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {hover !== null && data[hover] && (
        <div className="tip" style={{ left: `${((pad.l + hover * bw + bw / 2) / W) * 100}%`, top: `${(y(data[hover].value) / H) * 100}%` }}>
          <span>Week of {formatDate(data[hover].week)}</span>
          <b>
            {format(data[hover].value)}
            {unit ? ` ${unit}` : ''}
          </b>
        </div>
      )}
      <table className="sr-only">
        <caption>{label}</caption>
        <tbody>
          {data.map((d) => (
            <tr key={d.week}>
              <th scope="row">Week of {formatDate(d.week)}</th>
              <td>{format(d.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

function roundedTop(x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, h, w / 2);
  return `M${x},${y + h} V${y + rr} Q${x},${y} ${x + rr},${y} H${x + w - rr} Q${x + w},${y} ${x + w},${y + rr} V${y + h} Z`;
}

export interface ProfitRow {
  id: number;
  ref: string;
  customer: string;
  capacity_kw: number;
  profit_paise: number;
  revenue_paise: number;
  warranty_paise: number;
}

/**
 * Profit per job as diverging bars around zero: losses (left, red) and profits (right, green). Polarity
 * is also carried by the sign, the word, and the side of the zero line, never colour alone.
 */
export function ProfitBars({ rows, limit = 12 }: { rows: ProfitRow[]; limit?: number }) {
  const shown = rows.slice(0, limit);
  const maxPos = Math.max(1, ...shown.map((r) => r.profit_paise));
  const maxNeg = Math.max(0, ...shown.map((r) => -r.profit_paise));
  const zero = (maxNeg / (maxNeg + maxPos)) * 100;
  return (
    <div className="profit-list" role="list">
      {shown.map((r) => {
        const pct = r.profit_paise >= 0 ? (r.profit_paise / (maxNeg + maxPos)) * 100 : (-r.profit_paise / (maxNeg + maxPos)) * 100;
        const margin = formatPercent(r.profit_paise, r.revenue_paise);
        return (
          <Link key={r.id} to={`/app/jobs/${r.id}`} className="profit-row" role="listitem" aria-label={`${r.ref}, ${r.customer}: ${r.profit_paise < 0 ? 'loss' : 'profit'} ${formatINR(Math.abs(r.profit_paise))}, margin ${margin}`}>
            <span className="who">
              <b>{r.customer}</b>
              {r.customer !== `Job ${r.ref}` && <span className="mono">{r.ref}</span>}
              <span>
                {' '}
                {r.capacity_kw} kW{r.warranty_paise ? ', warranty repair' : ''}
              </span>
            </span>
            <span className="pbar" style={{ ['--zero' as string]: `${zero}%` }} aria-hidden>
              <i className={r.profit_paise < 0 ? 'neg' : ''} style={r.profit_paise < 0 ? { right: `${100 - zero}%`, width: `${pct}%` } : { left: `${zero}%`, width: `${pct}%` }} />
            </span>
            <span className="amt" style={{ color: r.profit_paise < 0 ? 'var(--bad)' : 'var(--ink)' }}>
              {formatINR(r.profit_paise, { sign: true })}
              <span className="muted" style={{ display: 'block', fontSize: 12, fontWeight: 600 }}>
                {margin} margin
              </span>
            </span>
          </Link>
        );
      })}
    </div>
  );
}

/**
 * A twelve-week trend line for a KPI: one series, no axes, the last week marked. Decorative next to
 * the number it accompanies, so it is hidden from screen readers (the number carries the meaning).
 */
export function Sparkline({ values }: { values: number[] }) {
  const gid = `spark-${useId().replace(/[^a-z0-9]/gi, '')}`;
  const W = 112;
  const H = 34;
  const p = 3;
  const max = Math.max(1, ...values);
  const x = (i: number) => p + (i * (W - 2 * p)) / Math.max(1, values.length - 1);
  const y = (v: number) => H - p - ((H - 2 * p) * v) / max;
  const pts = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  const last = values.length - 1;
  return (
    <svg className="spark" viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden focusable="false">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--chart-1)" stopOpacity={0.18} />
          <stop offset="1" stopColor="var(--chart-1)" stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={`M${pts[0]} L${pts.slice(1).join(' L')} L${x(last).toFixed(1)},${H - p} L${x(0).toFixed(1)},${H - p} Z`} fill={`url(#${gid})`} />
      <polyline points={pts.join(' ')} fill="none" stroke="var(--chart-1)" strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(last)} cy={y(values[last] ?? 0)} r={3} fill="var(--chart-1)" stroke="var(--surface)" strokeWidth={1.5} />
    </svg>
  );
}
