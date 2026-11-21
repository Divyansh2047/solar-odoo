/* Isometric drawing helpers for the SVG fallbacks (no three.js). Same axes as the 3D scenes:
   x = east, y = up, z = south. The viewer stands south-east, above. */

export type Pt = [number, number];
export type V3 = [number, number, number];

const C30 = Math.cos(Math.PI / 6);

export function iso(x: number, y: number, z: number, s = 40): Pt {
  return [(x - z) * C30 * s, ((x + z) * 0.5 - y) * s];
}

export function poly(points: Pt[]): string {
  return points.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
}

export function lerp3(a: V3, b: V3, t: number): V3 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** Multiply a hex colour's channels (0..1 darkens, >1 lightens). */
export function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(v * f)));
  const r = ch((n >> 16) & 255);
  const g = ch((n >> 8) & 255);
  const b = ch(n & 255);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

export interface Faces {
  top: string;
  south: string;
  east: string;
}

/** The three visible faces of an axis-aligned box. */
export function isoBox(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, s = 40): Faces {
  const P = (x: number, y: number, z: number) => iso(x, y, z, s);
  return {
    top: poly([P(x0, y1, z0), P(x1, y1, z0), P(x1, y1, z1), P(x0, y1, z1)]),
    south: poly([P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1)]),
    east: poly([P(x1, y0, z0), P(x1, y0, z1), P(x1, y1, z1), P(x1, y1, z0)]),
  };
}
