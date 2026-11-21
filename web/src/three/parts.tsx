import * as THREE from 'three';
import type { ReactNode } from 'react';
import type { ThreeEvent } from '@react-three/fiber';
import {
  PANEL_DEPTH,
  PANEL_GAP,
  PANEL_L,
  PANEL_RISE,
  PANEL_W,
  PARAPET_H,
  PARAPET_T,
  STAND_FRONT,
  TILT,
  panelHeightAt,
  type Box,
  type KitLayout,
  type KitPart,
  type PanelRow,
} from './kit-layout';
import { panelTexture } from './textures';

/* Procedural rooftop solar parts, shared by the kit viewer and the landing story. */

export type Tone = 'normal' | 'hot' | 'dim';

export const COL = {
  slab: '#d9d4ca',
  building: '#e2d6c2',
  parapet: '#efe6d6',
  gi: '#a9b2bc',
  alu: '#cfd7e0',
  sun: '#ffc233',
  inverter: '#f3f5f7',
  screen: '#10213a',
  box: '#dde2e8',
  battery: '#2c3748',
  good: '#0b7f57',
  bad: '#c8372d',
  copper: '#b8743a',
  pedestal: '#bdb6a9',
  earth: '#2f8a4c',
};

export const UNIT = new THREE.BoxGeometry(1, 1, 1);
const DIM = new THREE.Color('#eef1f4');

export function toned(base: string, tone: Tone = 'normal'): THREE.Color {
  const c = new THREE.Color(base);
  return tone === 'dim' ? c.lerp(DIM, 0.62) : c;
}

export interface PickHandlers {
  onOver?: (p: KitPart) => void;
  onOut?: (p: KitPart) => void;
  onPick?: (p: KitPart) => void;
}

export function PartGroup({ part, handlers, children }: { part: KitPart; handlers?: PickHandlers; children: ReactNode }) {
  if (!handlers) return <group>{children}</group>;
  return (
    <group
      onPointerOver={(e: ThreeEvent<PointerEvent>) => {
        e.stopPropagation();
        handlers.onOver?.(part);
      }}
      onPointerOut={(e: ThreeEvent<PointerEvent>) => {
        e.stopPropagation();
        handlers.onOut?.(part);
      }}
      onClick={(e: ThreeEvent<MouseEvent>) => {
        e.stopPropagation();
        if (e.delta > 6) return; // a drag, not a tap
        handlers.onPick?.(part);
      }}
    >
      {children}
    </group>
  );
}

/** Solid block from a Box (bottom-anchored). */
export function Block({ b, color, tone = 'normal', rough = 0.8, metal = 0, cast = true }: { b: Box; color: string; tone?: Tone; rough?: number; metal?: number; cast?: boolean }) {
  return (
    <mesh geometry={UNIT} position={[b.x, b.y + b.h / 2, b.z]} scale={[b.w, b.h, b.d]} castShadow={cast} receiveShadow>
      <meshStandardMaterial color={toned(color, tone)} roughness={rough} metalness={metal} emissive={tone === 'hot' ? COL.sun : '#000000'} emissiveIntensity={tone === 'hot' ? 0.22 : 0} />
    </mesh>
  );
}

function Outline({ b, show }: { b: Box; show: boolean }) {
  if (!show) return null;
  return (
    <mesh geometry={UNIT} position={[b.x, b.y + b.h / 2, b.z]} scale={[b.w + 0.1, b.h + 0.1, b.d + 0.1]}>
      <meshBasicMaterial color={COL.sun} side={THREE.BackSide} toneMapped={false} />
    </mesh>
  );
}

/** One module: aluminium frame + cell sheet, tilted towards +z. Origin = panel centre. */
export function Panel({ tone = 'normal' }: { tone?: Tone }) {
  return (
    <group rotation-x={TILT}>
      <mesh geometry={UNIT} scale={[PANEL_W, 0.04, PANEL_L]} castShadow receiveShadow>
        <meshStandardMaterial color={toned(COL.alu, tone)} metalness={0.6} roughness={0.35} />
      </mesh>
      <mesh position-y={0.027} rotation-x={-Math.PI / 2}>
        <planeGeometry args={[PANEL_W - 0.05, PANEL_L - 0.05]} />
        <meshStandardMaterial
          polygonOffset
          polygonOffsetFactor={-2}
          polygonOffsetUnits={-2}
          map={panelTexture()}
          color={tone === 'dim' ? '#a3acb8' : '#ffffff'}
          roughness={0.25}
          metalness={0.25}
          emissive={tone === 'hot' ? COL.sun : '#000000'}
          emissiveIntensity={tone === 'hot' ? 0.16 : 0}
        />
      </mesh>
      {tone === 'hot' && (
        <mesh geometry={UNIT} position-y={-0.012} scale={[PANEL_W + 0.16, 0.02, PANEL_L + 0.16]}>
          <meshBasicMaterial color={COL.sun} toneMapped={false} />
        </mesh>
      )}
    </group>
  );
}

/** Elevated GI structure under one row: legs on concrete pedestals, rafters along the slope, two purlins. */
export function RowStand({ row, tone = 'normal', scaleY = 1 }: { row: PanelRow; tone?: Tone; scaleY?: number }) {
  const zF = row.z + PANEL_DEPTH / 2 - 0.2;
  const zB = row.z - PANEL_DEPTH / 2 + 0.25;
  const hF = panelHeightAt(row.z, zF) - 0.05;
  const hB = panelHeightAt(row.z, zB) - 0.05;
  const legs: number[] = [];
  for (let i = 0; i <= row.n; i++) legs.push(Math.min(row.x1 - 0.12, Math.max(row.x0 + 0.12, row.x0 + i * (PANEL_W + PANEL_GAP) - PANEL_GAP / 2)));
  const len = Math.hypot(zF - zB, hB - hF) + 0.3;
  const color = toned(COL.gi, tone);
  const mat = <meshStandardMaterial color={color} metalness={0.5} roughness={0.45} />;
  const pedestal = <meshStandardMaterial color={toned(COL.pedestal, tone)} roughness={0.95} />;
  return (
    <group scale-y={scaleY}>
      {legs.map((x, i) => (
        <group key={i}>
          <mesh geometry={UNIT} position={[x, hF / 2, zF]} scale={[0.05, hF, 0.05]} castShadow>
            {mat}
          </mesh>
          <mesh geometry={UNIT} position={[x, hB / 2, zB]} scale={[0.05, hB, 0.05]} castShadow>
            {mat}
          </mesh>
          <mesh geometry={UNIT} position={[x, (hF + hB) / 2 + 0.02, (zF + zB) / 2]} rotation-x={TILT} scale={[0.05, 0.06, len]} castShadow>
            {mat}
          </mesh>
          {[zF, zB].map((z) => (
            <mesh key={z} geometry={UNIT} position={[x, 0.07, z]} scale={[0.3, 0.14, 0.3]} receiveShadow castShadow>
              {pedestal}
            </mesh>
          ))}
        </group>
      ))}
      {[0.22, 0.78].map((a) => (
        <mesh key={a} geometry={UNIT} position={[(row.x0 + row.x1) / 2, hF + (hB - hF) * a + 0.06, zF + (zB - zF) * a]} rotation-x={TILT} scale={[row.x1 - row.x0 + 0.1, 0.05, 0.05]} castShadow>
          {mat}
        </mesh>
      ))}
    </group>
  );
}

export function Inverter({ b, tone = 'normal' }: { b: Box; tone?: Tone }) {
  const front = b.z + b.d / 2 + 0.002;
  return (
    <group>
      <Block b={b} color={COL.inverter} tone={tone} rough={0.5} />
      <mesh position={[b.x, b.y + b.h * 0.68, front]}>
        <planeGeometry args={[b.w * 0.46, b.h * 0.16]} />
        <meshStandardMaterial color={COL.screen} roughness={0.3} emissive="#2a6fd6" emissiveIntensity={tone === 'dim' ? 0.05 : 0.25} />
      </mesh>
      <mesh geometry={UNIT} position={[b.x, b.y + b.h * 0.2, b.z]} scale={[b.w + 0.004, 0.035, b.d + 0.004]}>
        <meshStandardMaterial color={toned(COL.sun, tone)} roughness={0.6} />
      </mesh>
      <Outline b={b} show={tone === 'hot'} />
    </group>
  );
}

export function SwitchBox({ b, kind, tone = 'normal' }: { b: Box; kind: 'ac' | 'dc'; tone?: Tone }) {
  return (
    <group>
      <Block b={b} color={COL.box} tone={tone} rough={0.6} />
      <mesh position={[b.x, b.y + b.h * 0.58, b.z + b.d / 2 + 0.002]}>
        <planeGeometry args={[b.w * 0.6, b.h * 0.3]} />
        <meshStandardMaterial color={kind === 'dc' ? '#7a2a24' : '#3b4a5e'} roughness={0.4} />
      </mesh>
    </group>
  );
}

export function Controller({ b, tone = 'normal' }: { b: Box; tone?: Tone }) {
  return (
    <group>
      <Block b={b} color="#e9edf1" tone={tone} rough={0.55} />
      <mesh position={[b.x, b.y + b.h * 0.66, b.z + b.d / 2 + 0.002]}>
        <planeGeometry args={[b.w * 0.55, b.h * 0.2]} />
        <meshStandardMaterial color={COL.screen} emissive="#3ccb8e" emissiveIntensity={tone === 'dim' ? 0.03 : 0.2} />
      </mesh>
      <Outline b={b} show={tone === 'hot'} />
    </group>
  );
}

export function Battery({ b, tone = 'normal' }: { b: Box; tone?: Tone }) {
  return (
    <group>
      <Block b={b} color={COL.battery} tone={tone} rough={0.55} />
      <mesh geometry={UNIT} position={[b.x, b.y + b.h + 0.015, b.z]} scale={[b.w * 0.96, 0.03, b.d * 0.96]}>
        <meshStandardMaterial color={toned('#3d4a5e', tone)} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[b.x + s * b.w * 0.25, b.y + b.h + 0.06, b.z]}>
          <cylinderGeometry args={[0.035, 0.035, 0.07, 12]} />
          <meshStandardMaterial color={s < 0 ? COL.bad : '#1b1f25'} />
        </mesh>
      ))}
      <mesh position={[b.x, b.y + b.h * 0.78, b.z + b.d / 2 + 0.002]}>
        <planeGeometry args={[b.w * 0.5, 0.04]} />
        <meshStandardMaterial color="#123" emissive="#3ccb8e" emissiveIntensity={tone === 'dim' ? 0.05 : 0.6} />
      </mesh>
      <Outline b={b} show={tone === 'hot'} />
    </group>
  );
}

export function EarthPit({ x, z, y = 0, lit = 0 }: { x: number; z: number; y?: number; lit?: number }) {
  return (
    <group position={[x, y, z]}>
      <mesh geometry={UNIT} position-y={0.025} scale={[0.38, 0.05, 0.38]} receiveShadow>
        <meshStandardMaterial color="#8d8a84" roughness={0.9} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position-y={0.055}>
        <ringGeometry args={[0.1, 0.15, 24]} />
        <meshStandardMaterial color={COL.earth} emissive={COL.earth} emissiveIntensity={lit * 0.8} />
      </mesh>
      <mesh position-y={0.1}>
        <cylinderGeometry args={[0.02, 0.02, 0.1, 8]} />
        <meshStandardMaterial color={COL.copper} metalness={0.7} roughness={0.35} />
      </mesh>
    </group>
  );
}

export function Arrester({ x, z, y = 0, height = 2.6 }: { x: number; z: number; y?: number; height?: number }) {
  return (
    <group position={[x, y, z]}>
      <mesh position-y={height / 2} castShadow>
        <cylinderGeometry args={[0.03, 0.04, height, 8]} />
        <meshStandardMaterial color={COL.gi} metalness={0.6} roughness={0.4} />
      </mesh>
      {[-0.08, 0, 0.08].map((dx) => (
        <mesh key={dx} position={[dx, height + 0.12, 0]}>
          <coneGeometry args={[0.02, 0.24, 6]} />
          <meshStandardMaterial color={COL.copper} metalness={0.7} roughness={0.3} />
        </mesh>
      ))}
    </group>
  );
}

/** Flat RCC slab with a low parapet and a hint of the building below. */
export function Slab({ w, d, parapetH = PARAPET_H, base = 1.1 }: { w: number; d: number; parapetH?: number; base?: number }) {
  const T = PARAPET_T;
  const walls: Box[] = [
    { x: 0, y: 0, z: -d / 2 + T / 2, w, h: parapetH, d: T },
    { x: 0, y: 0, z: d / 2 - T / 2, w, h: parapetH, d: T },
    { x: -w / 2 + T / 2, y: 0, z: 0, w: T, h: parapetH, d: d - 2 * T },
    { x: w / 2 - T / 2, y: 0, z: 0, w: T, h: parapetH, d: d - 2 * T },
  ];
  return (
    <group>
      <mesh geometry={UNIT} position={[0, -0.14, 0]} scale={[w, 0.28, d]} receiveShadow>
        <meshStandardMaterial color={COL.slab} roughness={0.95} />
      </mesh>
      {base > 0 && (
        <mesh geometry={UNIT} position={[0, -0.28 - base / 2, 0]} scale={[w - 0.04, base, d - 0.04]} receiveShadow>
          <meshStandardMaterial color={COL.building} roughness={0.95} />
        </mesh>
      )}
      {walls.map((b, i) => (
        <Block key={i} b={b} color={COL.parapet} rough={0.92} />
      ))}
    </group>
  );
}

/** The whole kit from a layout, with per-part tone and pointer handlers. */
export function KitModel({ layout, toneOf, handlers }: { layout: KitLayout; toneOf: (p: KitPart | null) => Tone; handlers?: PickHandlers }) {
  const quiet = toneOf(null);
  const panelTone = toneOf('panel');
  return (
    <group>
      <Slab w={layout.w} d={layout.d} />
      <PartGroup part="panel" handlers={handlers}>
        {layout.rows.map((r, i) => (
          <RowStand key={i} row={r} tone={panelTone === 'hot' ? 'normal' : panelTone} />
        ))}
        {layout.panels.map((p, i) => (
          <group key={i} position={[p.x, STAND_FRONT + PANEL_RISE / 2, p.z]}>
            <Panel tone={panelTone} />
          </group>
        ))}
      </PartGroup>
      {layout.wall && <Block b={layout.wall} color={COL.parapet} tone={quiet} rough={0.9} />}
      {layout.dcdb && <SwitchBox b={layout.dcdb} kind="dc" tone={quiet} />}
      {layout.acdb && <SwitchBox b={layout.acdb} kind="ac" tone={quiet} />}
      <PartGroup part="inverter" handlers={handlers}>
        {layout.inverters.map((b, i) => (
          <Inverter key={i} b={b} tone={toneOf('inverter')} />
        ))}
      </PartGroup>
      <PartGroup part="controller" handlers={handlers}>
        {layout.controllers.map((b, i) => (
          <Controller key={i} b={b} tone={toneOf('controller')} />
        ))}
      </PartGroup>
      <PartGroup part="battery" handlers={handlers}>
        {layout.batteries.map((b, i) => (
          <Battery key={i} b={b} tone={toneOf('battery')} />
        ))}
      </PartGroup>
      {layout.pits.map((p, i) => (
        <EarthPit key={i} x={p.x} z={p.z} />
      ))}
      {layout.arrester && <Arrester x={layout.arrester.x} z={layout.arrester.z} />}
    </group>
  );
}

