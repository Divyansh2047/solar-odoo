import { crc32, deflateSync } from 'node:zlib';

/**
 * Tiny PNG painter for demo data: an illustrated rooftop with panels, and a signature. Real photos
 * can't ship with the repo, and these make the demo's proof-of-work screens look complete.
 */
class Canvas {
  readonly px: Uint8Array;
  constructor(
    readonly w: number,
    readonly h: number,
    bg: [number, number, number, number] = [255, 255, 255, 255],
  ) {
    this.px = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) this.px.set(bg, i * 4);
  }
  set(x: number, y: number, c: [number, number, number, number?]) {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 4;
    const a = (c[3] ?? 255) / 255;
    this.px[i] = Math.round(this.px[i]! * (1 - a) + c[0] * a);
    this.px[i + 1] = Math.round(this.px[i + 1]! * (1 - a) + c[1] * a);
    this.px[i + 2] = Math.round(this.px[i + 2]! * (1 - a) + c[2] * a);
    this.px[i + 3] = Math.max(this.px[i + 3]!, Math.round(a * 255));
  }
  /** Fill a convex quad (clockwise points). */
  quad(p: [number, number][], c: [number, number, number, number?]) {
    const ys = p.map((q) => q[1]);
    const y0 = Math.max(0, Math.floor(Math.min(...ys)));
    const y1 = Math.min(this.h - 1, Math.ceil(Math.max(...ys)));
    for (let y = y0; y <= y1; y++) {
      const xs: number[] = [];
      for (let i = 0; i < p.length; i++) {
        const [ax, ay] = p[i]!;
        const [bx, by] = p[(i + 1) % p.length]!;
        if ((ay <= y && by > y) || (by <= y && ay > y)) xs.push(ax + ((y - ay) / (by - ay)) * (bx - ax));
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) for (let x = Math.ceil(xs[k]!); x <= Math.floor(xs[k + 1]!); x++) this.set(x, y, c);
    }
  }
  line(x0: number, y0: number, x1: number, y1: number, c: [number, number, number, number?], width = 1) {
    const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0));
    for (let i = 0; i <= n; i++) {
      const x = x0 + ((x1 - x0) * i) / n;
      const y = y0 + ((y1 - y0) * i) / n;
      for (let dx = -width / 2; dx <= width / 2; dx += 0.5) for (let dy = -width / 2; dy <= width / 2; dy += 0.5) this.set(x + dx, y + dy, c);
    }
  }
  png(): Buffer {
    const raw = Buffer.alloc((this.w * 4 + 1) * this.h);
    for (let y = 0; y < this.h; y++) {
      raw[y * (this.w * 4 + 1)] = 0;
      Buffer.from(this.px.buffer, y * this.w * 4, this.w * 4).copy(raw, y * (this.w * 4 + 1) + 1);
    }
    const chunk = (type: string, data: Buffer) => {
      const len = Buffer.alloc(4);
      len.writeUInt32BE(data.length);
      const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
      const crc = Buffer.alloc(4);
      crc.writeUInt32BE(crc32(td) >>> 0);
      return Buffer.concat([len, td, crc]);
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(this.w, 0);
    ihdr.writeUInt32BE(this.h, 4);
    ihdr[8] = 8;
    ihdr[9] = 6;
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
  }
}

/** A rooftop with `rows × cols` panels, seen from a corner of the terrace. */
export function roofPhoto(seed: number, rows = 2, cols = 3): Buffer {
  const w = 480;
  const h = 320;
  const c = new Canvas(w, h, [200, 222, 240, 255]);
  // sky gradient
  for (let y = 0; y < 150; y++) for (let x = 0; x < w; x++) c.set(x, y, [150 + y * 0.4, 190 + y * 0.2, 235, 255]);
  // distant buildings
  const rand = mulberry(seed);
  for (let i = 0; i < 9; i++) {
    const bx = i * 56 + rand() * 20;
    const bh = 30 + rand() * 50;
    c.quad([[bx, 150 - bh], [bx + 50, 150 - bh], [bx + 50, 150], [bx, 150]], [214 - i * 3, 205, 192, 255]);
  }
  // terrace floor
  c.quad([[0, 150], [w, 150], [w, h], [0, h]], [181, 176, 166, 255]);
  c.quad([[0, 150], [w, 150], [w, 162], [0, 162]], [226, 220, 208, 255]); // parapet
  // water tank
  c.quad([[392, 96], [446, 96], [446, 156], [392, 156]], [40, 44, 52, 255]);
  // panels in perspective
  const ox = 70;
  const oy = 290;
  for (let r = 0; r < rows; r++) {
    for (let k = 0; k < cols; k++) {
      const x = ox + k * 92 + r * 28;
      const y = oy - r * 62;
      const tl: [number, number] = [x + 18, y - 52];
      const tr: [number, number] = [x + 104, y - 52];
      const br: [number, number] = [x + 86, y];
      const bl: [number, number] = [x, y];
      c.quad([tl, tr, br, bl], [16, 30, 56, 255]);
      // cell lines
      for (let i = 1; i < 6; i++) {
        const t = i / 6;
        c.line(tl[0] + (tr[0] - tl[0]) * t, tl[1], bl[0] + (br[0] - bl[0]) * t, bl[1], [120, 140, 170, 160]);
      }
      for (let j = 1; j < 4; j++) {
        const t = j / 4;
        c.line(tl[0] + (bl[0] - tl[0]) * t, tl[1] + (bl[1] - tl[1]) * t, tr[0] + (br[0] - tr[0]) * t, tr[1] + (br[1] - tr[1]) * t, [120, 140, 170, 160]);
      }
      c.line(tl[0], tl[1], tr[0], tr[1], [210, 216, 224, 255], 2);
      c.line(bl[0], bl[1], br[0], br[1], [210, 216, 224, 255], 2);
      // stand legs
      c.line(bl[0] + 6, bl[1], bl[0] + 6, bl[1] + 14, [120, 124, 130, 255], 3);
      c.line(br[0] - 6, br[1], br[0] - 6, br[1] + 14, [120, 124, 130, 255], 3);
    }
  }
  // sun glint
  for (let i = 0; i < 400; i++) {
    const a = rand() * Math.PI * 2;
    const d = rand() * 26;
    c.set(60 + Math.cos(a) * d, 40 + Math.sin(a) * d, [255, 236, 170, 200]);
  }
  return c.png();
}

/** A handwriting-like signature for demo sign-offs. */
export function signature(seed: number): Buffer {
  const c = new Canvas(420, 140, [255, 255, 255, 0]);
  const rand = mulberry(seed);
  let x = 30;
  let y = 80;
  for (let i = 0; i < 220; i++) {
    const nx = x + 1.6 + rand() * 0.6;
    const ny = 80 + Math.sin(i / (5 + rand() * 2)) * (22 + rand() * 6) * Math.sin(i / 40);
    c.line(x, y, nx, ny, [14, 26, 43, 255], 2);
    x = nx;
    y = ny;
  }
  c.line(40, 112, 360, 104, [14, 26, 43, 255], 2);
  return c.png();
}

function mulberry(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
