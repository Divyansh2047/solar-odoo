import * as THREE from 'three';
import { useMemo, useRef, type RefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import './labels.css';

/* Floating HTML labels anchored to points in a 3D scene. The labels are ordinary DOM (solid backing,
   real text); a projector inside the Canvas moves them every rendered frame, keeps them inside a safe
   rectangle, pushes overlapping labels apart and draws a short leader line to the anchor. */

export type LabelTone = 'good' | 'bad' | 'neutral';
export interface LabelContent {
  title: string;
  detail?: string;
  tone?: LabelTone;
}
export interface LabelTrack {
  id: string;
  /** World position of the anchor, or null to hide. */
  anchor: () => THREE.Vector3 | null;
  /** 0..1, default 1. */
  opacity?: () => number;
  /** Dynamic text; omit for labels whose text React renders. */
  content?: () => LabelContent | null;
  /** Lower is more important; used when space only allows a few labels. May change per frame. */
  priority?: number | (() => number);
}
export interface SafeRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface Slot {
  el: HTMLElement;
  title: HTMLElement | null;
  detail: HTMLElement | null;
  leader: SVGGElement | null;
  line: SVGLineElement | null;
  dot: SVGCircleElement | null;
  w: number;
  h: number;
  key: string;
}
interface Placed {
  s: Slot;
  ax: number;
  ay: number;
  op: number;
  pr: number;
  x: number;
  y: number;
}

const clamp = (v: number, a: number, b: number) => Math.min(Math.max(v, a), Math.max(a, b));
const SERIAL = /^[A-Z]{2,}[A-Z0-9-]*\d{3,}[A-Z0-9-]*$/;

function hide(s: Slot) {
  if (s.el.style.visibility !== 'hidden') {
    s.el.style.visibility = 'hidden';
    s.el.style.opacity = '0';
    if (s.leader) s.leader.style.visibility = 'hidden';
  }
}

export function LabelProjector({
  tracks,
  overlay,
  safe,
  max,
  dock = false,
}: {
  tracks: LabelTrack[];
  overlay: RefObject<HTMLDivElement | null>;
  safe?: (w: number, h: number) => SafeRect;
  max?: (w: number, h: number) => number;
  /** Dock labels against the left and right edges (keeps the model clear) instead of next to the anchor. */
  dock?: boolean;
}) {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const v = useMemo(() => new THREE.Vector3(), []);
  const slots = useRef(new Map<string, Slot>());
  const sizeKey = useRef('');

  useFrame(() => {
    const root = overlay.current;
    if (!root) return;
    const W = size.width;
    const H = size.height;
    const key = `${W}x${H}`;
    const resized = sizeKey.current !== key;
    sizeKey.current = key;
    const rect = safe ? safe(W, H) : { left: 8, top: 8, right: W - 8, bottom: H - 8 };
    const live: Placed[] = [];

    for (const t of tracks) {
      let s = slots.current.get(t.id);
      if (!s || !s.el.isConnected) {
        const el = root.querySelector<HTMLElement>(`[data-label="${t.id}"]`);
        if (!el) continue;
        const leader = root.querySelector<SVGGElement>(`[data-leader="${t.id}"]`);
        s = { el, title: el.querySelector('[data-title]'), detail: el.querySelector('[data-detail]'), leader, line: leader?.querySelector('line') ?? null, dot: leader?.querySelector('circle') ?? null, w: 0, h: 0, key: '' };
        slots.current.set(t.id, s);
      }
      const op = t.opacity ? t.opacity() : 1;
      const a = op > 0.02 ? t.anchor() : null;
      if (!a) {
        hide(s);
        continue;
      }
      v.copy(a).project(camera);
      const ax = (v.x * 0.5 + 0.5) * W;
      const ay = (-v.y * 0.5 + 0.5) * H;
      if (v.z > 1 || ax < rect.left - 2 || ax > rect.right + 2 || ay < rect.top - 2 || ay > rect.bottom + 2) {
        hide(s);
        continue;
      }
      const c = t.content?.();
      if (c) {
        const k = `${c.title}|${c.detail ?? ''}|${c.tone ?? ''}`;
        if (k !== s.key) {
          s.key = k;
          if (s.title) {
            s.title.textContent = c.title;
            s.title.classList.toggle('mono', SERIAL.test(c.title));
          }
          if (s.detail) {
            s.detail.textContent = c.detail ?? '';
            s.detail.hidden = !c.detail;
          }
          s.el.dataset.tone = c.tone ?? 'neutral';
          s.w = 0;
        }
      } else if (!t.content) {
        const k = s.el.textContent ?? '';
        if (k !== s.key) {
          s.key = k;
          s.w = 0;
        }
      }
      if (!s.w || resized) {
        s.w = s.el.offsetWidth;
        s.h = s.el.offsetHeight;
      }
      live.push({ s, ax, ay, op, pr: typeof t.priority === 'function' ? t.priority() : (t.priority ?? 5), x: 0, y: 0 });
    }

    live.sort((p, q) => p.pr - q.pr);
    const limit = max ? max(W, H) : 99;
    for (const extra of live.splice(limit)) hide(extra.s);

    const mid = (rect.left + rect.right) / 2;
    for (const L of live) {
      if (dock) {
        // Narrow stages have no side margins: dock to the top corners instead.
        L.x = L.ax < mid ? rect.left : rect.right - L.s.w;
        L.y = W < 520 ? rect.top : clamp(L.ay - L.s.h / 2, rect.top, rect.bottom - L.s.h);
        continue;
      }
      let x = L.ax + 16;
      if (x + L.s.w > rect.right) x = L.ax - 16 - L.s.w;
      L.x = clamp(x, rect.left, rect.right - L.s.w);
      let y = L.ay - L.s.h - 22;
      if (y < rect.top) y = L.ay + 22;
      L.y = clamp(y, rect.top, rect.bottom - L.s.h);
    }
    const gap = 6;
    for (let pass = 0; pass < 3; pass++) {
      live.sort((p, q) => p.y - q.y);
      for (let i = 1; i < live.length; i++) {
        const B = live[i]!;
        for (let j = 0; j < i; j++) {
          const A = live[j]!;
          const overlapX = A.x < B.x + B.s.w + gap && B.x < A.x + A.s.w + gap;
          const overlapY = A.y < B.y + B.s.h + gap && B.y < A.y + A.s.h + gap;
          if (!overlapX || !overlapY) continue;
          B.y = A.y + A.s.h + gap;
          if (B.y + B.s.h > rect.bottom) {
            B.y = rect.bottom - B.s.h;
            A.y = Math.max(rect.top, B.y - A.s.h - gap);
          }
        }
      }
    }

    for (const L of live) {
      const { s } = L;
      s.el.style.transform = `translate3d(${Math.round(L.x)}px, ${Math.round(L.y)}px, 0)`;
      s.el.style.opacity = String(L.op);
      s.el.style.visibility = 'visible';
      if (s.leader && s.line && s.dot) {
        const px = clamp(L.ax, L.x + 6, L.x + s.w - 6);
        const py = clamp(L.ay, L.y, L.y + s.h);
        s.line.setAttribute('x1', L.ax.toFixed(1));
        s.line.setAttribute('y1', L.ay.toFixed(1));
        s.line.setAttribute('x2', px.toFixed(1));
        s.line.setAttribute('y2', py.toFixed(1));
        s.dot.setAttribute('cx', L.ax.toFixed(1));
        s.dot.setAttribute('cy', L.ay.toFixed(1));
        s.leader.style.visibility = 'visible';
        s.leader.style.opacity = String(L.op);
      }
    }
  });
  return null;
}

export interface OverlayLabel {
  id: string;
  title: string;
  detail?: string;
  tone?: LabelTone;
}

/** The DOM half of the labels. Render it as a sibling of the Canvas inside a positioned container. */
export function LabelOverlay({ labels, overlayRef, decorative = false, compact = false }: { labels: OverlayLabel[]; overlayRef: RefObject<HTMLDivElement | null>; decorative?: boolean; compact?: boolean }) {
  return (
    <div className="k3-overlay" ref={overlayRef} aria-hidden={decorative || undefined} data-compact={compact || undefined}>
      <svg className="k3-leaders" aria-hidden="true">
        {labels.map((l) => (
          <g key={l.id} data-leader={l.id} style={{ visibility: 'hidden' }}>
            <line />
            <circle r={4} />
          </g>
        ))}
      </svg>
      {labels.map((l) => (
        <div key={l.id} className="k3-label" data-label={l.id} data-tone={l.tone ?? 'neutral'} style={{ visibility: 'hidden' }}>
          <strong data-title className={SERIAL.test(l.title) ? 'mono' : undefined}>
            {l.title}
          </strong>
          <span data-detail hidden={!l.detail}>
            {l.detail}
          </span>
        </div>
      ))}
    </div>
  );
}
