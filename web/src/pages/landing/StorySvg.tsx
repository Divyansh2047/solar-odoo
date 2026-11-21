import { iso, isoBox, poly, shade } from '../../three/iso';
import { SvgBox, SvgPanel, SvgStand } from '../../three/KitSvg';
import { CABLE_PATH, COMPASS, HOURS, HOUSE, INVERTER, LOTS, LOT_X, LOT_Z, MUMTY, PIN, ROOF_PANELS, ROOF_ROWS, TANK } from './story';

/* Static isometric drawing of the story, used when WebGL is unavailable. One state per day; no motion. */

const S = 40;
const R = HOUSE.roof;
const P = (x: number, y: number, z: number) => iso(x, y, z, S);
const pt = (x: number, y: number, z: number) => P(x, y, z).map((n) => n.toFixed(1)).join(',');

function Box({ x0, x1, y0, y1, z0, z1, c, line }: { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number; c: string; line?: string }) {
  const f = isoBox(x0, x1, y0, y1, z0, z1, S);
  return (
    <g stroke={line ?? shade(c, 0.8)} strokeWidth={line ? 6 : 0.8} strokeLinejoin="round">
      <polygon points={f.east} fill={shade(c, 0.82)} />
      <polygon points={f.south} fill={shade(c, 0.93)} />
      <polygon points={f.top} fill={shade(c, 1.03)} />
    </g>
  );
}

function House({ x = 0, z = 0, floors = 2, color = '#f1e6d3', roof, roofLine }: { x?: number; z?: number; floors?: number; color?: string; roof?: string; roofLine?: string }) {
  const H = floors * 3.3;
  const w = HOUSE.w / 2;
  const d = HOUSE.d / 2;
  const wins: string[] = [];
  for (let f = 0; f < floors; f++) {
    const y0 = f * 3.3 + 1.0;
    for (const dx of [-2.6, 2.4]) wins.push(poly([P(x + dx - 0.75, y0, z + d), P(x + dx + 0.75, y0, z + d), P(x + dx + 0.75, y0 + 1.3, z + d), P(x + dx - 0.75, y0 + 1.3, z + d)]));
    for (const dz of [-3.2, 2.6]) wins.push(poly([P(x + w, y0, z + dz - 0.75), P(x + w, y0, z + dz + 0.75), P(x + w, y0 + 1.3, z + dz + 0.75), P(x + w, y0 + 1.3, z + dz - 0.75)]));
  }
  return (
    <g>
      <Box x0={x - w} x1={x + w} y0={0} y1={H} z0={z - d} z1={z + d} c={color} />
      {wins.map((p, i) => (
        <polygon key={i} points={p} fill="#5b6878" />
      ))}
      <polygon points={isoBox(x - w + 0.15, x + w - 0.15, H, H, z - d + 0.15, z + d - 0.15, S).top} fill={roof ?? '#d9d4ca'} stroke={roofLine} strokeWidth={roofLine ? 24 : 0} />
      <Box x0={x - w} x1={x + w} y0={H} y1={H + 0.9} z0={z - d} z1={z - d + 0.15} c="#efe7d9" />
      <Box x0={x - w} x1={x - w + 0.15} y0={H} y1={H + 0.9} z0={z - d} z1={z + d} c="#efe7d9" />
      <Box x0={x + w - 0.15} x1={x + w} y0={H} y1={H + 0.9} z0={z - d} z1={z + d} c="#efe7d9" />
      <Box x0={x - w} x1={x + w} y0={H} y1={H + 0.9} z0={z + d - 0.15} z1={z + d} c="#efe7d9" />
    </g>
  );
}

function Panels({ lift = 0 }: { lift?: number }) {
  return (
    <g transform={`translate(0 ${-R * S})`}>
      {lift === 0 && ROOF_ROWS.map((r, i) => <SvgStand key={i} row={r} />)}
      {ROOF_PANELS.map((p, i) => (
        <SvgPanel key={i} x={p.x} z={p.z} lift={lift} />
      ))}
    </g>
  );
}

function Colony({ cx, cy, k }: { cx: number; cy: number; k: number }) {
  const lots = [...LOTS].sort((a, b) => a.x + a.z - (b.x + b.z));
  const [mx, my] = P(-7.5, 0, -44);
  return (
    <g transform={`translate(${cx} ${cy}) scale(${k}) translate(${-mx} ${-my})`}>
      {lots.map((l) => (
        <House
          key={l.id}
          x={l.x}
          z={l.z}
          floors={l.floors}
          color={l.color}
          roof={l.status === 'profit' ? '#1fa36d' : l.status === 'loss' ? '#d8463a' : '#d9d4ca'}
          roofLine={l.status === 'unfinished' ? '#ffc233' : undefined}
        />
      ))}
    </g>
  );
}

export default function StorySvg({ step, narrow }: { step: number; narrow: boolean }) {
  const W = narrow ? 1900 : 3600;
  const H = narrow ? 3420 : 2250;
  const minX = narrow ? -W * 0.5 : -W * 0.62;
  const minY = narrow ? -1250 : -1500;
  const horizon = minY + H * (narrow ? 0.3 : 0.45);
  const hour = HOURS[Math.min(7, Math.max(0, step))]!;
  const th = (Math.PI * (hour - 6)) / 12;
  const arc = narrow ? { cx: minX + W * 0.6, cy: horizon, rx: W * 0.3, ry: H * 0.2 } : { cx: minX + W * 0.66, cy: horizon, rx: W * 0.27, ry: H * 0.37 };
  const sun = [arc.cx + arc.rx * Math.cos(th), arc.cy - arc.ry * Math.sin(th)];
  const rain = step === 6;
  const colony = step >= 7;
  const panels = step === 0 || step >= 5;
  const cable = CABLE_PATH.map(([x, y, z]) => pt(x, y, z)).join(' ');
  const compass = Array.from({ length: 24 }, (_, i) => pt(COMPASS.x + Math.cos((i / 24) * Math.PI * 2) * COMPASS.r, R + 0.02, COMPASS.z + Math.sin((i / 24) * Math.PI * 2) * COMPASS.r)).join(' ');
  return (
    <svg className="lp-svg" viewBox={`${minX} ${minY} ${W} ${H}`} preserveAspectRatio={narrow ? 'xMidYMin slice' : 'xMaxYMid slice'}>
      <defs>
        <linearGradient id="lp-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={rain ? '#7d8894' : '#8fbbe6'} />
          <stop offset="1" stopColor={rain ? '#a9b1ba' : '#f3dcb8'} />
        </linearGradient>
        <pattern id="lp-rain" width="40" height="80" patternUnits="userSpaceOnUse" patternTransform="rotate(12)">
          <line x1="10" y1="0" x2="10" y2="34" stroke="#eef3f8" strokeWidth="3" strokeLinecap="round" />
        </pattern>
      </defs>
      <rect x={minX} y={minY} width={W} height={H} fill="#d8cfbe" />
      <rect x={minX} y={minY} width={W} height={horizon - minY} fill="url(#lp-sky)" />
      {!rain && (
        <g>
          <path d={`M${arc.cx + arc.rx} ${arc.cy}A${arc.rx} ${arc.ry} 0 0 0 ${arc.cx - arc.rx} ${arc.cy}`} fill="none" stroke="#ffffff" strokeWidth="5" strokeDasharray="2 18" strokeLinecap="round" />
          <circle cx={sun[0]} cy={sun[1]} r={70} fill="#ffe7a3" opacity={0.45} />
          <circle cx={sun[0]} cy={sun[1]} r={34} fill="#fff3cf" />
        </g>
      )}
      {colony ? (
        <Colony cx={narrow ? 0 : minX + W * 0.66} cy={narrow ? minY + H * 0.24 : minY + H * 0.55} k={narrow ? 0.16 : 0.3} />
      ) : (
        <g>
          <polygon points={poly([P(-22, 0, 9), P(30, 0, 9), P(30, 0, 15), P(-22, 0, 15)])} fill="#a3a7ab" />
          <House x={-LOT_X} z={-LOT_Z} floors={1} color="#e8dccb" />
          <House x={0} z={-LOT_Z} floors={3} color="#dfe5e3" />
          <House x={-LOT_X} z={0} floors={2} color="#ece0c2" />
          <House x={LOT_X} z={-LOT_Z} floors={2} color="#e4ddd0" />
          <House />
          <Box x0={MUMTY.x0} x1={MUMTY.x1} y0={R} y1={R + MUMTY.h} z0={MUMTY.z0} z1={MUMTY.z1} c="#f1e6d3" />
          <Box x0={TANK.x - TANK.r} x1={TANK.x + TANK.r} y0={R + MUMTY.h} y1={R + MUMTY.h + TANK.h} z0={TANK.z - TANK.r} z1={TANK.z + TANK.r} c="#2a2e34" />
          {(step === 0 || step >= 5) && <SvgBox b={INVERTER} color="#f3f5f7" />}
          {rain && <circle cx={P(INVERTER.x, INVERTER.y + 0.45, INVERTER.z + 0.11)[0]} cy={P(INVERTER.x, INVERTER.y + 0.45, INVERTER.z + 0.11)[1]} r={9} fill="#c8372d" />}
          {panels && <Panels />}
          {step === 3 && <Panels lift={3.6} />}
          {step === 1 && (
            <g transform={`translate(${P(PIN.x, R + 3.2, PIN.z).join(' ')})`}>
              <path d="M0 70 L-26 10 A30 30 0 1 1 26 10 Z" fill="#ffc233" stroke="#0e1a2b" strokeWidth="3" />
              <circle cx="0" cy="-8" r="11" fill="#0e1a2b" />
            </g>
          )}
          {step === 2 && (
            <g>
              <polygon points={compass} fill="none" stroke="#ffffff" strokeWidth="6" />
              <polyline points={cable} fill="none" stroke="#ffc233" strokeWidth="7" strokeDasharray="16 10" />
            </g>
          )}
          <House x={LOT_X} z={0} floors={1} color="#dbe2d2" />
          {step === 4 && (
            <g>
              <Box x0={-0.5} x1={3.7} y0={0.4} y1={1.1} z0={11.2} z1={13.2} c="#e9edf1" />
              <Box x0={0.2} x1={2.5} y0={1.1} y1={1.5} z0={11.6} z1={12.8} c="#c49a6c" />
              <Box x0={3.8} x1={5.6} y0={0.4} y1={2.5} z0={11.2} z1={13.2} c="#ffc233" />
            </g>
          )}
        </g>
      )}
      {rain && <rect x={minX} y={minY} width={W} height={H} fill="url(#lp-rain)" opacity={0.6} />}
    </svg>
  );
}
