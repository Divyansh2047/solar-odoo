import * as THREE from 'three';

/* Procedural textures drawn on a 2D canvas. Nothing is fetched (the CSP allows no CDN). */

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let panelTex: THREE.CanvasTexture | null = null;

/** A 6 × 12 half-cut module: dark cells, thin gaps, silver busbars. Portrait; top of the texture = upper edge. */
export function panelTexture(): THREE.Texture {
  if (panelTex) return panelTex;
  const cols = 6;
  const rows = 12;
  const cell = 40;
  const gap = 3;
  const mid = 8;
  const W = cols * cell + (cols + 1) * gap;
  const H = rows * cell + (rows + 1) * gap + mid;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#2a3a55';
  ctx.fillRect(0, 0, W, H);
  const rand = rng(11);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = gap + c * (cell + gap);
      const y = gap + r * (cell + gap) + (r >= rows / 2 ? mid : 0);
      const v = rand();
      const g = ctx.createLinearGradient(x, y, x + cell, y + cell);
      g.addColorStop(0, `rgb(${18 + v * 6}, ${30 + v * 8}, ${58 + v * 12})`);
      g.addColorStop(1, `rgb(${11 + v * 5}, ${20 + v * 6}, ${40 + v * 10})`);
      ctx.fillStyle = g;
      ctx.fillRect(x, y, cell, cell);
      ctx.fillStyle = 'rgba(150, 165, 190, 0.10)';
      for (let fy = y + 3; fy < y + cell; fy += 4) ctx.fillRect(x, fy, cell, 1);
      ctx.fillStyle = 'rgba(205, 214, 228, 0.62)';
      for (let b = 1; b <= 4; b++) ctx.fillRect(Math.round(x + (cell * b) / 5), y, 1, cell);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  panelTex = tex;
  return tex;
}

let glowTex: THREE.CanvasTexture | null = null;

/** Soft radial glow for the sun's halo. */
export function glowTexture(): THREE.Texture {
  if (glowTex) return glowTex;
  const s = 128;
  const canvas = document.createElement('canvas');
  canvas.width = s;
  canvas.height = s;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255, 244, 214, 1)');
  g.addColorStop(0.25, 'rgba(255, 226, 150, 0.55)');
  g.addColorStop(1, 'rgba(255, 210, 120, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  glowTex = new THREE.CanvasTexture(canvas);
  glowTex.colorSpace = THREE.SRGBColorSpace;
  return glowTex;
}
