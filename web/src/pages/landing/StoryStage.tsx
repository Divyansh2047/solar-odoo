import * as THREE from 'three';
import { useEffect, useMemo, useRef } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { LabelOverlay, LabelProjector, type LabelTrack, type OverlayLabel, type SafeRect } from '../../three/labels';
import { SoftEnvironment } from '../../three/lighting';
import { glowTexture } from '../../three/textures';
import { useInView } from '../../three/support';
import { ClockContext, useClock, useStory, type StoryClock } from './scene/ctx';
import { Ground, HomeHouse, Neighbours, ProfitRoofs } from './scene/town';
import { EXPLODED, EnquiryPin, ExplodedKit, RoofKit, SurveyGear } from './scene/props';
import { CARTONS, Rain, Truck, scansAt } from './scene/street';
import {
  CABLE_ORDER_M,
  CABLE_RUN_M,
  COMPASS,
  CREW,
  DATES,
  ENQUIRY,
  HOUSE,
  INVERTER,
  LABELLED_LOTS,
  METER,
  PANEL_COUNT,
  PANEL_WATTS,
  PIN,
  SERIALS,
  SURVEY,
  TEST_HOUR,
  TEST_KW,
  TICKET,
  TILT_GAUGE,
  CUSTOMER,
  SIGNED_AT,
  clock as clockText,
  keyed,
  overcast,
  rupees,
  smooth,
  sunElevation,
  sunHour,
  type Lot,
} from './story';

/* The landing stage: one daylight scene whose every state is a function of scroll progress t. */

type V3 = [number, number, number];
interface Cam {
  p: V3;
  q: V3;
  fov: number;
  ox: number; // wide screens: shift the subject right, away from the text column
  oyw: number; // wide screens: vertical shift (+ = down)
  oy: number; // narrow screens: shift the subject up (+ = down), away from the text
  zn: number; // narrow screens: extra distance, since the scene only gets the top of the screen
}
const CAMS: Cam[] = [
  { p: [4, 11, 23.5], q: [0.6, 7.5, 0], fov: 40, ox: 0.2, oyw: 0.1, oy: -0.12, zn: 1.3 },
  { p: [15, 15.5, 21], q: [0.6, 7.6, 0.4], fov: 40, ox: 0.2, oyw: 0, oy: -0.25, zn: 1.25 },
  { p: [10.5, 14.5, 16.5], q: [-0.8, 7.0, 2.6], fov: 42, ox: 0.2, oyw: 0, oy: -0.25, zn: 1.3 },
  { p: [14, 12.5, 22], q: [0.7, 9.6, 1], fov: 42, ox: 0.2, oyw: 0, oy: -0.25, zn: 1.2 },
  { p: [16, 4.6, 29], q: [1.6, 3.2, 9.5], fov: 42, ox: 0.2, oyw: 0, oy: -0.25, zn: 1.15 },
  { p: [13, 13.5, 17.5], q: [1.2, 7.6, 1.4], fov: 40, ox: 0.2, oyw: 0, oy: -0.25, zn: 1.25 },
  { p: [5.2, 10.4, 9], q: [-3.2, 8.1, -2.6], fov: 42, ox: 0.2, oyw: 0, oy: -0.25, zn: 1.3 },
  { p: [34, 112, 64], q: [-8, 0, -42], fov: 40, ox: 0.18, oyw: 0, oy: -0.2, zn: 1 },
];
const series = (f: (c: Cam) => number) => CAMS.map(f);
const PX = [0, 1, 2].map((i) => series((c) => c.p[i]!));
const QX = [0, 1, 2].map((i) => series((c) => c.q[i]!));
const FOV = series((c) => c.fov);
const OX = series((c) => c.ox);
const OY = series((c) => c.oy);
const OYW = series((c) => c.oyw);
const ZN = series((c) => c.zn);
const FOG_FAR = [380, 380, 380, 380, 380, 380, 260, 900];

const narrowW = (w: number) => w < 820;
function applyCam(cam: THREE.PerspectiveCamera, t: number, W: number, H: number) {
  const P = new THREE.Vector3(...(PX.map((s) => keyed(s, t)) as V3));
  const Q = new THREE.Vector3(...(QX.map((s) => keyed(s, t)) as V3));
  const aspect = W / Math.max(1, H);
  const fit = (aspect >= 1.25 ? 1 : 1 + (1.25 - aspect) * 1.25) * (narrowW(W) ? keyed(ZN, t) : 1);
  cam.position.copy(P.sub(Q).multiplyScalar(fit).add(Q));
  cam.fov = keyed(FOV, t);
  cam.aspect = aspect;
  cam.lookAt(Q);
  const n = narrowW(W);
  const ox = n ? 0 : keyed(OX, t);
  const oy = n ? keyed(OY, t) : keyed(OYW, t);
  cam.setViewOffset(W, H, -ox * W, -oy * H, W, H);
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld();
}

function Rig({ onReady }: { onReady?: (invalidate: () => void) => void }) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  const invalidate = useThree((s) => s.invalidate);
  const clock = useClock();
  useEffect(() => onReady?.(invalidate), [invalidate, onReady]);
  useStory((t) => {
    applyCam(camera, t, size.width, size.height);
    const raining = t > 5.4 && t < 6.65;
    if (raining && !clock.current.reduced) invalidate();
  }, -2);
  return null;
}

/** The sun's path, fitted to the hero framing at the current screen shape, then fixed in the world. */
function useSunPath() {
  const size = useThree((s) => s.size);
  return useMemo(() => {
    const cam = new THREE.PerspectiveCamera();
    applyCam(cam, 0, size.width, size.height);
    const n = narrowW(size.width);
    const v = new THREE.Vector3();
    return (hour: number, out: THREE.Vector3) => {
      const th = (Math.PI * (hour - 6)) / 12;
      const x = n ? 0.22 + 0.62 * Math.cos(th) : 0.34 + 0.6 * Math.cos(th);
      const y = n ? 0.5 + 0.34 * Math.sin(th) : 0.08 + 0.78 * Math.sin(th);
      v.set(x, y, 0.5).unproject(cam).sub(cam.position).normalize();
      return out.copy(cam.position).addScaledVector(v, 420);
    };
  }, [size.width, size.height]);
}

const SKY_VERT = /* glsl */ `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const SKY_FRAG = /* glsl */ `uniform vec3 top; uniform vec3 horizon; uniform vec3 ground; varying vec3 vDir;
void main(){ float h = vDir.y; vec3 c = h > 0.0 ? mix(horizon, top, pow(clamp(h * 1.6, 0.0, 1.0), 0.7)) : mix(horizon, ground, clamp(-h * 8.0, 0.0, 1.0));
gl_FragColor = vec4(c, 1.0);
#include <colorspace_fragment>
}`;

const C = (hex: string) => new THREE.Color(hex);
const NOON_TOP = C('#7fb2e3');
const WARM_TOP = C('#93b4d8');
const NOON_HOR = C('#d7e6f2');
const WARM_HOR = C('#f7d8ae');
const GREY_TOP = C('#7d8894');
const GREY_HOR = C('#a9b1ba');

function Atmosphere() {
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const dome = useRef<THREE.Mesh>(null);
  const light = useRef<THREE.DirectionalLight>(null);
  const hemi = useRef<THREE.HemisphereLight>(null);
  const sun = useRef<THREE.Group>(null);
  const dots = useRef<THREE.InstancedMesh>(null);
  const halo = useRef<THREE.SpriteMaterial>(null);
  const path = useSunPath();
  const uniforms = useMemo(() => ({ top: { value: new THREE.Color() }, horizon: { value: new THREE.Color() }, ground: { value: C('#d8cfbe') } }), []);
  const fog = useMemo(() => new THREE.Fog('#d7e6f2', 60, 380), []);
  const tmp = useMemo(() => ({ v: new THREE.Vector3(), m: new THREE.Matrix4(), c: new THREE.Color() }), []);
  useEffect(() => {
    scene.fog = fog;
    return () => {
      scene.fog = null;
    };
  }, [scene, fog]);
  useEffect(() => {
    const m = dots.current;
    if (!m) return;
    for (let i = 0; i < 49; i++) m.setMatrixAt(i, tmp.m.makeTranslation(path(6 + (12 * i) / 48, tmp.v)));
    m.instanceMatrix.needsUpdate = true;
  }, [path, tmp]);
  useStory((t) => {
    const hour = sunHour(t);
    const cloud = overcast(t);
    const elDeg = (sunElevation(hour) * 180) / Math.PI;
    const warm = 1 - smooth(10, 45, elDeg);
    const top = uniforms.top.value.copy(NOON_TOP).lerp(WARM_TOP, warm).lerp(GREY_TOP, cloud);
    const hor = uniforms.horizon.value.copy(NOON_HOR).lerp(WARM_HOR, warm).lerp(GREY_HOR, cloud);
    fog.color.copy(hor);
    fog.far = keyed(FOG_FAR, t);
    fog.near = fog.far * 0.18;
    if (dome.current) dome.current.position.copy(camera.position);
    const th = (Math.PI * (hour - 6)) / 12;
    if (light.current) {
      light.current.color.copy(tmp.c.set('#fff4e4').lerp(C('#ffc98c'), warm));
      light.current.intensity = (2.9 * (1 - 0.72 * cloud) * smooth(-2, 10, elDeg)) + 0.2;
      light.current.position.set(Math.cos(th) * 34, 10 + Math.sin(sunElevation(hour)) * 40, 30);
    }
    if (hemi.current) {
      hemi.current.color.copy(top);
      hemi.current.intensity = 1.05 + 0.5 * cloud;
    }
    if (sun.current) {
      path(hour, sun.current.position);
      sun.current.visible = cloud < 0.6;
    }
    if (halo.current) halo.current.opacity = 1 - cloud;
    if (dots.current) dots.current.visible = t < 0.55;
  }, -1);
  return (
    <>
      <mesh ref={dome} scale={1500} renderOrder={-1} frustumCulled={false}>
        <sphereGeometry args={[1, 32, 16]} />
        <shaderMaterial vertexShader={SKY_VERT} fragmentShader={SKY_FRAG} uniforms={uniforms} side={THREE.BackSide} depthWrite={false} fog={false} toneMapped={false} />
      </mesh>
      <hemisphereLight ref={hemi} args={['#cfe0ee', '#cdbfa6', 1.05]} />
      <directionalLight
        ref={light}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.03}
        shadow-camera-left={-20}
        shadow-camera-right={20}
        shadow-camera-top={20}
        shadow-camera-bottom={-20}
        shadow-camera-near={1}
        shadow-camera-far={140}
      />
      <group ref={sun}>
        <mesh>
          <sphereGeometry args={[9, 24, 16]} />
          <meshBasicMaterial color="#fff3cf" fog={false} toneMapped={false} />
        </mesh>
        <sprite scale={70}>
          <spriteMaterial ref={halo} map={glowTexture()} transparent depthWrite={false} fog={false} toneMapped={false} />
        </sprite>
      </group>
      <instancedMesh ref={dots} args={[undefined, undefined, 49]} frustumCulled={false}>
        <sphereGeometry args={[1.5, 8, 6]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.85} fog={false} toneMapped={false} />
      </instancedMesh>
    </>
  );
}

/* ---------- labels ---------- */

const R = HOUSE.roof;
const win = (t: number, a: number, b: number) => smooth(a - 0.04, a, t) * (1 - smooth(b, b + 0.04, t));
const lotAnchor = (l: Lot) => new THREE.Vector3(l.x, (l.floors * 3.3) + 1.3, l.z);
const STATIC: (OverlayLabel & { at: THREE.Vector3; from: number; to: number; pr: number })[] = [
  { id: 'enq', title: ENQUIRY.ref, detail: `${ENQUIRY.need}. With sales at ${ENQUIRY.at}.`, at: new THREE.Vector3(PIN.x, R + 4.4, PIN.z), from: 0.85, to: 1.3, pr: 1 },
  { id: 'dir', title: `Faces ${SURVEY.facing}°, south`, detail: 'Measured on the roof', at: new THREE.Vector3(COMPASS.x, R + 0.1, COMPASS.z), from: 1.85, to: 2.3, pr: 1 },
  { id: 'tilt', title: `Tilt ${SURVEY.tilt}°`, detail: 'Stand angle', at: new THREE.Vector3(TILT_GAUGE.x, R + 0.8, TILT_GAUGE.z), from: 1.85, to: 2.3, pr: 2 },
  { id: 'run', title: `Cable run ${CABLE_RUN_M} m`, detail: 'DC box to the meter', at: new THREE.Vector3(METER.x, METER.y + METER.h, METER.z), from: 1.9, to: 2.3, pr: 3 },
  { id: 'kp', title: `${PANEL_COUNT} panels, ${PANEL_WATTS} W`, detail: 'Each with its own serial', at: EXPLODED.panels[2]!.clone().add(new THREE.Vector3(0.6, 1.2, 0)), from: 2.9, to: 3.3, pr: 1 },
  { id: 'ki', title: 'Inverter, 3 kW', detail: 'With AC and DC switch boxes', at: EXPLODED.inverter.clone().add(new THREE.Vector3(0, 0.75, 0)), from: 2.92, to: 3.3, pr: 2 },
  { id: 'kc', title: `Cable, ${CABLE_ORDER_M} m`, detail: `${CABLE_RUN_M} m run plus 10%`, at: EXPLODED.coil.clone(), from: 2.94, to: 3.3, pr: 3 },
  { id: 'ke', title: '3 earthing kits', detail: 'And a lightning arrester', at: EXPLODED.rods.clone().add(new THREE.Vector3(0, 0.8, 0)), from: 2.96, to: 3.3, pr: 4 },
  { id: 'del', title: `Delivered ${DATES.thu}`, detail: 'Warranty clocks started by themselves', tone: 'good', at: new THREE.Vector3(0, 1.4, HOUSE.d / 2 + 2.6), from: 3.92, to: 4.3, pr: 1 },
  { id: 'test', title: `Power test ${TEST_KW.toFixed(2)} kW`, detail: `At ${clockText(TEST_HOUR)}, earthing checked`, tone: 'good', at: new THREE.Vector3(INVERTER.x, INVERTER.y + INVERTER.h + 0.05, INVERTER.z), from: 5.0, to: 5.3, pr: 2 },
  { id: 'sign', title: `Signed by ${CUSTOMER}`, detail: `${SIGNED_AT}, on the crew's tablet`, tone: 'good', at: new THREE.Vector3(CREW.x, R + 1.7, CREW.z), from: 4.98, to: 5.3, pr: 1 },
  { id: 'fault', title: `${TICKET.code}, ${TICKET.fault}`, detail: `Inverter ${SERIALS.inverter}`, tone: 'bad', at: new THREE.Vector3(INVERTER.x, INVERTER.y + INVERTER.h + 0.05, INVERTER.z), from: 5.66, to: 5.9, pr: 1 },
  { id: 'cover', title: `Covered until ${DATES.inverterUntil}`, detail: `${TICKET.ref}: the repair bills ₹0`, tone: 'good', at: new THREE.Vector3(INVERTER.x, INVERTER.y + INVERTER.h + 0.05, INVERTER.z), from: 5.98, to: 6.3, pr: 1 },
  ...(['lossA', 'lossB', 'open'] as const).map((k, i) => {
    const l = LABELLED_LOTS[k];
    return { id: k, title: l.status === 'unfinished' ? `${l.ref}, unfinished` : `${l.ref}  ${rupees(l.profit)}`, detail: l.note, tone: l.status === 'loss' ? ('bad' as const) : ('neutral' as const), at: lotAnchor(l), from: 6.88, to: 7.6, pr: i + 1 };
  }),
];

function useTracks(clock: { current: StoryClock }): LabelTrack[] {
  return useMemo(() => {
    const T = () => clock.current.t;
    const tracks: LabelTrack[] = STATIC.map((s) => ({ id: s.id, priority: s.pr, anchor: () => s.at, opacity: () => win(T(), s.from, s.to) }));
    const invAt = CARTONS.inverter.clone().add(new THREE.Vector3(0, 0.55, 0));
    const pnlAt = CARTONS.panels.clone().add(new THREE.Vector3(0, 0.4, 0));
    tracks.push({
      id: 'scan-i',
      priority: 2,
      anchor: () => invAt,
      opacity: () => win(T(), 3.62, 4.3),
      content: () => {
        const n = scansAt(T());
        return { title: SERIALS.inverter, detail: n >= 1 ? 'Inverter, scanned' : 'Inverter, not scanned yet', tone: n >= 1 ? 'good' : 'neutral' };
      },
    });
    tracks.push({
      id: 'scan-p',
      priority: 3,
      anchor: () => pnlAt,
      opacity: () => win(T(), 3.62, 4.3),
      content: () => {
        const n = Math.max(0, scansAt(T()) - 1);
        return { title: `${n} of ${PANEL_COUNT} panel serials scanned`, detail: n === PANEL_COUNT ? 'All 7 scanned. The truck can leave.' : `${SERIALS.panelFirst} onwards`, tone: n === PANEL_COUNT ? 'good' : 'neutral' };
      },
    });
    return tracks;
  }, [clock]);
}
const DYNAMIC_LABELS: OverlayLabel[] = [
  { id: 'scan-i', title: SERIALS.inverter },
  { id: 'scan-p', title: `0 of ${PANEL_COUNT} panel serials scanned` },
];
const STAGE_LABELS: OverlayLabel[] = [...STATIC.map(({ id, title, detail, tone }) => ({ id, title, detail, tone })), ...DYNAMIC_LABELS];

/* ---------- the stage ---------- */

export interface StoryStageProps {
  clock: { current: StoryClock };
  safe: { current: SafeRect | null };
  onReady?: (invalidate: () => void) => void;
}

export default function StoryStage({ clock, safe, onReady }: StoryStageProps) {
  const wrap = useRef<HTMLDivElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const inView = useInView(wrap, '0px');
  const tracks = useTracks(clock);
  return (
    <div className="lp-canvas" ref={wrap}>
      <ClockContext.Provider value={clock}>
        <Canvas
          shadows
          dpr={[1, 1.75]}
          frameloop={inView ? 'demand' : 'never'}
          camera={{ fov: 40, near: 0.5, far: 4000, position: [9, 9, 35] }}
          gl={{ antialias: true, powerPreference: 'high-performance' }}
          onCreated={({ gl }) => {
            gl.toneMapping = THREE.NeutralToneMapping;
            gl.toneMappingExposure = 1.0;
          }}
        >
          <ClockContext.Provider value={clock}>
            <Rig onReady={onReady} />
            <Atmosphere />
            <SoftEnvironment intensity={0.3} />
            <Ground />
            <Neighbours />
            <HomeHouse />
            <RoofKit />
            <ProfitRoofs />
            <EnquiryPin />
            <SurveyGear />
            <ExplodedKit />
            <Truck />
            <Rain />
            <LabelProjector
              tracks={tracks}
              overlay={overlay}
              safe={(w, h) => safe.current ?? { left: 12, top: 12, right: w - 12, bottom: h - 12 }}
              max={(w) => (narrowW(w) ? 2 : 4)}
            />
          </ClockContext.Provider>
        </Canvas>
      </ClockContext.Provider>
      <LabelOverlay labels={STAGE_LABELS} overlayRef={overlay} decorative />
    </div>
  );
}

