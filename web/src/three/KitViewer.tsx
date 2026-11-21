import * as THREE from 'three';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type JSX, type RefObject } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { KitModel, type PickHandlers, type Tone } from './parts';
import { countOf, kitSummary, layoutKit, partAnchor, partCountLabel, partsPresent, type KitKind, type KitLayout, type KitPart } from './kit-layout';
import { LabelOverlay, LabelProjector, type LabelTone, type LabelTrack } from './labels';
import { SoftEnvironment } from './lighting';
import { GLBoundary, hasWebGL, useInView, usePrefersReducedMotion } from './support';
import KitSvg from './KitSvg';
import './kit-viewer.css';

export interface KitViewerLabel {
  part: KitPart;
  title: string;
  detail?: string;
  tone?: LabelTone;
}

export interface KitViewerProps {
  kind: KitKind;
  /** 2..10 typical (2 per kW); exactly this many are drawn. */
  panels: number;
  inverters: number;
  batteries: number;
  controllers: number;
  highlight?: KitPart | null;
  labels?: KitViewerLabel[];
  onPick?: (part: KitPart) => void;
  height?: number;
  autoRotate?: boolean;
  className?: string;
}

const rank = (p: KitPart, hot: KitPart | null) => (p === hot ? 0 : p === 'inverter' ? 1 : 2);

const AZ = 0.6; // camera azimuth from the south, towards the east
const EL = 0.5; // camera elevation

function KitScene({
  layout,
  hot,
  rotating,
  handlers,
  stage,
  overlay,
  labels,
}: {
  layout: KitLayout;
  hot: KitPart | null;
  rotating: boolean;
  handlers: PickHandlers;
  stage: RefObject<HTMLDivElement | null>;
  overlay: RefObject<HTMLDivElement | null>;
  labels: KitViewerLabel[];
}) {
  const group = useRef<THREE.Group>(null);
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  const invalidate = useThree((s) => s.invalidate);
  const drag = useRef({ on: false, x: 0, offset: 0, moved: 0 });
  const clock = useRef(0);
  const radius = Math.hypot(layout.w / 2, layout.d / 2, layout.top / 2) + 0.2;

  // Frame the kit: start from its bounding sphere, then refine so the projected box corners fill ~80%
  // of the view (with room for the turntable sway).
  useLayoutEffect(() => {
    camera.aspect = size.width / Math.max(1, size.height);
    const target = new THREE.Vector3(0, (layout.top - 1.4) / 2, 0);
    const dir = new THREE.Vector3(Math.sin(AZ) * Math.cos(EL), Math.sin(EL), Math.cos(AZ) * Math.cos(EL));
    const r = Math.max(layout.w, layout.d) * 0.58;
    const rx = rotating ? r : layout.w / 2;
    const rz = rotating ? r : layout.d / 2;
    const corners: THREE.Vector3[] = [];
    for (const x of [-rx, rx]) for (const z of [-rz, rz]) for (const y of [-1.4, layout.top]) corners.push(new THREE.Vector3(x, y, z));
    let dist = radius * 3;
    const v = new THREE.Vector3();
    for (let pass = 0; pass < 3; pass++) {
      camera.position.copy(target).addScaledVector(dir, dist);
      camera.near = Math.max(0.1, dist / 20);
      camera.far = dist * 4;
      camera.lookAt(target);
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld();
      // With labels on a wide stage, keep the model in the middle so the docked labels sit beside it.
      const fx = labels.length && camera.aspect > 1.4 ? 0.64 : 0.88;
      let m = 0;
      for (const c of corners) {
        v.copy(c).project(camera);
        m = Math.max(m, Math.abs(v.x) / fx, Math.abs(v.y) / 0.88);
      }
      dist *= m;
    }
    camera.position.copy(target).addScaledVector(dir, dist);
    camera.lookAt(target);
    camera.updateProjectionMatrix();
    invalidate();
  }, [camera, size, radius, rotating, layout.top, layout.w, layout.d, labels.length, invalidate]);

  // Mouse and pen can drag the turntable; touch keeps scrolling the page.
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const down = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      drag.current.on = true;
      drag.current.x = e.clientX;
    };
    const move = (e: PointerEvent) => {
      if (!drag.current.on) return;
      drag.current.offset += (e.clientX - drag.current.x) * 0.01;
      drag.current.x = e.clientX;
      invalidate();
    };
    const up = () => {
      drag.current.on = false;
    };
    el.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      el.removeEventListener('pointerdown', down);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [stage, invalidate]);

  useFrame((_, dt) => {
    if (rotating && !drag.current.on) clock.current += Math.min(dt, 0.05);
    const g = group.current;
    if (!g) return;
    g.rotation.y = (rotating ? Math.sin(clock.current * 0.3) * 0.55 : 0) + drag.current.offset;
    g.updateMatrixWorld();
  }, -1);

  const toneOf = useCallback((p: KitPart | null): Tone => (hot ? (p === hot ? 'hot' : 'dim') : 'normal'), [hot]);

  const tracks = useMemo<LabelTrack[]>(
    () =>
      labels.map((l, i) => {
        const a = partAnchor(layout, l.part);
        const local = new THREE.Vector3(...(a ?? [0, 0, 0]));
        const world = new THREE.Vector3();
        // The hovered or highlighted part's label first, then the inverter's, then the rest in order.
        const priority = () => (l.part === hotRef.current ? 0 : l.part === 'inverter' ? 1 : 2 + i);
        return { id: `kv-${i}`, priority, anchor: () => (a && group.current ? world.copy(local).applyMatrix4(group.current.matrixWorld) : null) };
      }),
    [labels, layout],
  );
  const hotRef = useRef(hot);
  hotRef.current = hot;

  const shadow = radius + 1.5;
  return (
    <>
      <hemisphereLight args={['#e4eef8', '#cdbfa6', 1.25]} />
      <directionalLight
        position={[radius * 0.9, radius * 2, radius * 1.3]}
        intensity={2.3}
        color="#fff3e0"
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
        shadow-camera-left={-shadow}
        shadow-camera-right={shadow}
        shadow-camera-top={shadow}
        shadow-camera-bottom={-shadow}
        shadow-camera-near={0.5}
        shadow-camera-far={radius * 6}
      />
      <SoftEnvironment intensity={0.35} />
      <group ref={group}>
        <KitModel layout={layout} toneOf={toneOf} handlers={handlers} />
      </group>
      <LabelProjector tracks={tracks} overlay={overlay} dock max={(w) => (w < 520 ? 1 : 2)} safe={(w, h) => ({ left: 8, top: 8, right: w - 8, bottom: h - 8 })} />
    </>
  );
}

export default function KitViewer({
  kind,
  panels,
  inverters,
  batteries,
  controllers,
  highlight = null,
  labels = [],
  onPick,
  height = 320,
  autoRotate = true,
  className = '',
}: KitViewerProps): JSX.Element {
  const counts = useMemo(() => ({ kind, panels, inverters, batteries, controllers }), [kind, panels, inverters, batteries, controllers]);
  const layout = useMemo(() => layoutKit(counts), [counts]);
  const present = useMemo(() => partsPresent(counts), [counts]);
  const [preview, setPreview] = useState<KitPart | null>(null);
  const [pinned, setPinned] = useState<KitPart | null>(null);
  const selected = highlight ?? pinned;
  const hot = preview ?? selected;
  const reduced = usePrefersReducedMotion();
  const stageRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const inView = useInView(stageRef);
  const [webgl] = useState(hasWebGL);
  const rotating = autoRotate && !reduced;

  const choose = useCallback(
    (p: KitPart) => {
      if (onPick) onPick(p);
      else setPinned((cur) => (cur === p ? null : p));
    },
    [onPick],
  );
  const handlers = useMemo<PickHandlers>(
    () => ({
      onOver: (p) => {
        setPreview(p);
        if (stageRef.current) stageRef.current.style.cursor = 'pointer';
      },
      onOut: () => {
        setPreview(null);
        if (stageRef.current) stageRef.current.style.cursor = '';
      },
      onPick: choose,
    }),
    [choose],
  );
  const shown = useMemo(() => labels.filter((l) => present.includes(l.part)), [labels, present]);
  const overlayLabels = useMemo(() => shown.map((l, i) => ({ id: `kv-${i}`, title: l.title, detail: l.detail, tone: l.tone })), [shown]);
  const svg = <KitSvg layout={layout} hot={hot} onPick={choose} />;

  return (
    <div className={`kitv ${className}`.trim()}>
      <div ref={stageRef} className="kitv-stage" style={{ height }} role="img" aria-label={[kitSummary(counts), ...shown.map((l) => `${l.title}${l.detail ? `, ${l.detail}` : ''}.`)].join(' ')}>
        {webgl ? (
          <GLBoundary fallback={svg}>
            <Canvas
              shadows
              dpr={[1, 2]}
              frameloop={!inView ? 'never' : rotating ? 'always' : 'demand'}
              camera={{ fov: 30, position: [8, 6, 10], near: 0.1, far: 200 }}
              gl={{ antialias: true, alpha: true, powerPreference: 'low-power' }}
              fallback={svg}
            >
              <KitScene layout={layout} hot={hot} rotating={rotating} handlers={handlers} stage={stageRef} overlay={overlayRef} labels={shown} />
            </Canvas>
            <LabelOverlay labels={overlayLabels} overlayRef={overlayRef} compact />
          </GLBoundary>
        ) : (
          <>
            {svg}
            {shown.length > 0 && (
              <ul className="kitv-taglist">
                {[...shown]
                  .sort((a, b) => rank(a.part, hot) - rank(b.part, hot))
                  .slice(0, 2)
                  .map((l, i) => (
                    <li key={i} className="k3-label" data-tone={l.tone ?? 'neutral'}>
                      <strong>{l.title}</strong>
                      {l.detail && <span>{l.detail}</span>}
                    </li>
                  ))}
              </ul>
            )}
          </>
        )}
        {present.length === 0 && <p className="kitv-empty">No parts on the roof for this job.</p>}
      </div>
      {present.length > 0 && (
        <div className="kitv-parts" role="group" aria-label="Parts in this system">
          {present.map((p) => (
            <button
              key={p}
              type="button"
              className="kitv-part"
              aria-pressed={selected === p}
              onClick={() => choose(p)}
              onMouseEnter={() => setPreview(p)}
              onMouseLeave={() => setPreview(null)}
              onFocus={() => setPreview(p)}
              onBlur={() => setPreview(null)}
            >
              <span className="kitv-swatch" data-part={p} aria-hidden="true" />
              {partCountLabel(p, countOf(counts, p))}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
