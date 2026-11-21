import { iso, isoBox, lerp3, shade, type V3 } from './iso';
import { PANEL_DEPTH, PANEL_GAP, PANEL_RISE, PANEL_W, PARAPET_H, PARAPET_T, STAND_FRONT, panelHeightAt, type Box, type KitLayout, type KitPart, type PanelRow } from './kit-layout';

/* Static isometric drawing of a kit, used when WebGL is unavailable. Same layout, same counts as the 3D. */

const S = 40;
const SUN = '#ffc233';
const P = (v: V3) => iso(v[0], v[1], v[2], S);
const pt = (v: V3) => P(v).map((n) => n.toFixed(1)).join(',');

export function SvgBox({ b, color, hot, line }: { b: Box; color: string; hot?: boolean; line?: string }) {
  const f = isoBox(b.x - b.w / 2, b.x + b.w / 2, b.y, b.y + b.h, b.z - b.d / 2, b.z + b.d / 2, S);
  const stroke = hot ? SUN : (line ?? shade(color, 0.72));
  const sw = hot ? 2.5 : 0.7;
  return (
    <g strokeLinejoin="round">
      <polygon points={f.east} fill={shade(color, 0.8)} stroke={stroke} strokeWidth={sw} />
      <polygon points={f.south} fill={shade(color, 0.93)} stroke={stroke} strokeWidth={sw} />
      <polygon points={f.top} fill={shade(color, 1.05)} stroke={stroke} strokeWidth={sw} />
    </g>
  );
}

/** A face patch on the south side of a box (screen, stripe). u/v in 0..1 of the face. */
function FacePatch({ b, u0, u1, v0, v1, fill }: { b: Box; u0: number; u1: number; v0: number; v1: number; fill: string }) {
  const z = b.z + b.d / 2;
  const X = (u: number) => b.x - b.w / 2 + b.w * u;
  const Y = (v: number) => b.y + b.h * v;
  return <polygon points={[pt([X(u0), Y(v0), z]), pt([X(u1), Y(v0), z]), pt([X(u1), Y(v1), z]), pt([X(u0), Y(v1), z])].join(' ')} fill={fill} />;
}

export function SvgPanel({ x, z, lift = 0, hot }: { x: number; z: number; lift?: number; hot?: boolean }) {
  const x0 = x - PANEL_W / 2;
  const x1 = x + PANEL_W / 2;
  const zF = z + PANEL_DEPTH / 2;
  const zB = z - PANEL_DEPTH / 2;
  const yF = STAND_FRONT + lift;
  const yB = yF + PANEL_RISE;
  const FL: V3 = [x0, yF, zF];
  const FR: V3 = [x1, yF, zF];
  const BR: V3 = [x1, yB, zB];
  const BL: V3 = [x0, yB, zB];
  let d = '';
  for (let i = 1; i < 6; i++) d += `M${pt(lerp3(FL, FR, i / 6))}L${pt(lerp3(BL, BR, i / 6))}`;
  for (let j = 1; j < 12; j++) d += `M${pt(lerp3(FL, BL, j / 12))}L${pt(lerp3(FR, BR, j / 12))}`;
  return (
    <g>
      <polygon points={[pt(FL), pt(FR), pt(BR), pt(BL)].join(' ')} fill="#15233c" stroke={hot ? SUN : '#c9d2dc'} strokeWidth={hot ? 3 : 1.3} strokeLinejoin="round" />
      <path d={d} stroke="#3a5684" strokeWidth={0.6} fill="none" />
    </g>
  );
}

export function SvgStand({ row }: { row: PanelRow }) {
  const zF = row.z + PANEL_DEPTH / 2 - 0.2;
  const zB = row.z - PANEL_DEPTH / 2 + 0.25;
  const hF = panelHeightAt(row.z, zF);
  const hB = panelHeightAt(row.z, zB);
  let d = '';
  for (let i = 0; i <= row.n; i++) {
    const x = Math.min(row.x1 - 0.12, Math.max(row.x0 + 0.12, row.x0 + i * (PANEL_W + PANEL_GAP) - PANEL_GAP / 2));
    d += `M${pt([x, 0, zF])}L${pt([x, hF, zF])}M${pt([x, 0, zB])}L${pt([x, hB, zB])}`;
  }
  return <path d={d} stroke="#8d97a3" strokeWidth={2.2} strokeLinecap="round" fill="none" />;
}

/** Slab, parapet and building block. Returns [behind, inFront] so content can sit between. */
export function svgRoof(w: number, d: number, base = 1.1, wallColor = '#efe6d6') {
  const T = PARAPET_T;
  const H = PARAPET_H;
  const box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, c: string, key: string) => {
    const f = isoBox(x0, x1, y0, y1, z0, z1, S);
    return (
      <g key={key} stroke={shade(c, 0.78)} strokeWidth={0.6} strokeLinejoin="round">
        <polygon points={f.east} fill={shade(c, 0.8)} />
        <polygon points={f.south} fill={shade(c, 0.92)} />
        <polygon points={f.top} fill={shade(c, 1.03)} />
      </g>
    );
  };
  const behind = [
    box(-w / 2 + 0.02, w / 2 - 0.02, -0.28 - base, -0.28, -d / 2 + 0.02, d / 2 - 0.02, '#e2d6c2', 'b'),
    box(-w / 2, w / 2, -0.28, 0, -d / 2, d / 2, '#d9d4ca', 's'),
    box(-w / 2, w / 2, 0, H, -d / 2, -d / 2 + T, wallColor, 'n'),
    box(-w / 2, -w / 2 + T, 0, H, -d / 2 + T, d / 2 - T, wallColor, 'w'),
  ];
  const front = [box(w / 2 - T, w / 2, 0, H, -d / 2 + T, d / 2 - T, wallColor, 'e'), box(-w / 2, w / 2, 0, H, d / 2 - T, d / 2, wallColor, 'f')];
  return [behind, front] as const;
}

export function svgBounds(points: V3[], pad = 18) {
  const ps = points.map(P);
  const xs = ps.map((p) => p[0]);
  const ys = ps.map((p) => p[1]);
  const minX = Math.min(...xs) - pad;
  const minY = Math.min(...ys) - pad;
  return `${minX.toFixed(0)} ${minY.toFixed(0)} ${(Math.max(...xs) - minX + pad).toFixed(0)} ${(Math.max(...ys) - minY + pad).toFixed(0)}`;
}

export default function KitSvg({ layout, hot, onPick }: { layout: KitLayout; hot: KitPart | null; onPick?: (p: KitPart) => void }) {
  const { w, d } = layout;
  const [behind, front] = svgRoof(w, d);
  const viewBox = svgBounds([
    [-w / 2, -1.4, -d / 2],
    [w / 2, -1.4, -d / 2],
    [w / 2, -1.4, d / 2],
    [-w / 2, -1.4, d / 2],
    [-w / 2, layout.top + 0.4, -d / 2],
    [w / 2, layout.top + 0.4, -d / 2],
    [-w / 2, layout.top + 0.4, d / 2],
  ]);
  const op = (p: KitPart | null) => (hot && p !== hot ? 0.4 : 1);
  const pick = (p: KitPart) => (onPick ? { onClick: () => onPick(p), style: { cursor: 'pointer' } } : {});
  const a = layout.arrester;
  return (
    <svg className="kitv-svg" viewBox={viewBox} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      {behind}
      {a && (
        <g opacity={op(null)}>
          <path d={`M${pt([a.x, 0, a.z])}L${pt([a.x, 2.6, a.z])}`} stroke="#8d97a3" strokeWidth={2.5} />
          <path d={`M${pt([a.x - 0.08, 2.6, a.z])}L${pt([a.x, 2.85, a.z])}L${pt([a.x + 0.08, 2.6, a.z])}`} stroke="#b8743a" strokeWidth={2} fill="none" />
        </g>
      )}
      {layout.wall && (
        <g opacity={op(null)}>
          <SvgBox b={layout.wall} color="#efe6d6" />
          {layout.dcdb && <SvgBox b={layout.dcdb} color="#dde2e8" />}
          {layout.acdb && <SvgBox b={layout.acdb} color="#dde2e8" />}
        </g>
      )}
      {layout.inverters.map((b, i) => (
        <g key={`i${i}`} opacity={op('inverter')} {...pick('inverter')}>
          <SvgBox b={b} color="#f3f5f7" hot={hot === 'inverter'} />
          <FacePatch b={b} u0={0.27} u1={0.73} v0={0.6} v1={0.76} fill="#10213a" />
          <FacePatch b={b} u0={0} u1={1} v0={0.18} v1={0.23} fill={SUN} />
        </g>
      ))}
      {layout.controllers.map((b, i) => (
        <g key={`c${i}`} opacity={op('controller')} {...pick('controller')}>
          <SvgBox b={b} color="#e9edf1" hot={hot === 'controller'} />
          <FacePatch b={b} u0={0.22} u1={0.78} v0={0.56} v1={0.76} fill="#10213a" />
        </g>
      ))}
      {layout.batteries.map((b, i) => (
        <g key={`b${i}`} opacity={op('battery')} {...pick('battery')}>
          <SvgBox b={b} color="#2c3748" hot={hot === 'battery'} />
          <FacePatch b={b} u0={0.25} u1={0.75} v0={0.76} v1={0.8} fill="#3ccb8e" />
        </g>
      ))}
      <g opacity={op('panel')} {...pick('panel')}>
        {layout.rows.map((r, i) => (
          <g key={i}>
            <SvgStand row={r} />
            {layout.panels
              .filter((p) => p.row === i)
              .map((p, j) => (
                <SvgPanel key={j} x={p.x} z={p.z} hot={hot === 'panel'} />
              ))}
          </g>
        ))}
      </g>
      {layout.pits.map((p, i) => (
        <g key={`p${i}`} opacity={op(null)}>
          <polygon points={isoBox(p.x - 0.19, p.x + 0.19, 0, 0.05, p.z - 0.19, p.z + 0.19, S).top} fill="#9a968f" stroke="#2f8a4c" strokeWidth={2} />
        </g>
      ))}
      {front}
    </svg>
  );
}
