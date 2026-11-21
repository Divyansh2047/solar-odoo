import * as THREE from 'three';
import { useLayoutEffect, useMemo, useRef, type ReactNode } from 'react';
import { Block, COL, Slab, UNIT } from '../../../three/parts';
import { PANEL_L, PANEL_RISE, PANEL_W, STAND_FRONT, TILT } from '../../../three/kit-layout';
import { HOUSE, LOT_Z, LOTS, METER, MUMTY, ROOF_PANELS, TANK, smooth } from '../story';
import { useStory } from './ctx';

/* The colony: ground, streets, trees, the neighbours (instanced) and our two-storey house. */

const FLOOR = 3.3;
const m4 = new THREE.Matrix4();
const q0 = new THREE.Quaternion();
const qTilt = new THREE.Quaternion().setFromEuler(new THREE.Euler(TILT, 0, 0));
const qFlat = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
const qEast = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 2, 0));
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const mat = (p: THREE.Vector3, s: THREE.Vector3, q = q0) => m4.clone().compose(p, q, s);

function rnd(seed: number) {
  const x = Math.sin(seed * 91.7 + 17.3) * 43758.5453;
  return x - Math.floor(x);
}

function Instances({ items, geometry = UNIT, children, cast = false, colors, onMesh }: { items: THREE.Matrix4[]; geometry?: THREE.BufferGeometry; children: ReactNode; cast?: boolean; colors?: THREE.Color[]; onMesh?: (m: THREE.InstancedMesh) => void }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    items.forEach((mx, i) => m.setMatrixAt(i, mx));
    colors?.forEach((c, i) => m.setColorAt(i, c));
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.computeBoundingSphere();
    onMesh?.(m);
  }, [items, colors, onMesh]);
  return (
    <instancedMesh ref={ref} args={[geometry, undefined, Math.max(1, items.length)]} castShadow={cast} receiveShadow frustumCulled={false}>
      {children}
    </instancedMesh>
  );
}

const roofOf = (floors: number) => floors * FLOOR;

export function Neighbours() {
  const data = useMemo(() => {
    const walls: THREE.Matrix4[] = [];
    const wallColors: THREE.Color[] = [];
    const slabs: THREE.Matrix4[] = [];
    const parapets: THREE.Matrix4[] = [];
    const tanks: THREE.Matrix4[] = [];
    const windows: THREE.Matrix4[] = [];
    for (const l of LOTS) {
      if (l.x === 0 && l.z === 0) continue;
      const H = roofOf(l.floors);
      walls.push(mat(V(l.x, H / 2 - 0.14, l.z), V(HOUSE.w, H - 0.28, HOUSE.d)));
      wallColors.push(new THREE.Color(l.color));
      slabs.push(mat(V(l.x, H - 0.14, l.z), V(HOUSE.w + 0.2, 0.28, HOUSE.d + 0.2)));
      const T = 0.15;
      parapets.push(mat(V(l.x, H + 0.45, l.z - HOUSE.d / 2 + T / 2), V(HOUSE.w, 0.9, T)));
      parapets.push(mat(V(l.x, H + 0.45, l.z + HOUSE.d / 2 - T / 2), V(HOUSE.w, 0.9, T)));
      parapets.push(mat(V(l.x - HOUSE.w / 2 + T / 2, H + 0.45, l.z), V(T, 0.9, HOUSE.d)));
      parapets.push(mat(V(l.x + HOUSE.w / 2 - T / 2, H + 0.45, l.z), V(T, 0.9, HOUSE.d)));
      if (l.tank) tanks.push(mat(V(l.x - 3, H + 0.55, l.z - 3.6), V(1.2, 1.1, 1.2)));
      for (let f = 0; f < l.floors; f++) {
        const y = f * FLOOR + 1.7;
        for (const dx of [-2.6, 2.4]) windows.push(mat(V(l.x + dx, y, l.z + HOUSE.d / 2 + 0.02), V(1.5, 1.25, 1)));
        for (const dz of [-3, 2.5]) windows.push(mat(V(l.x + HOUSE.w / 2 + 0.02, y, l.z + dz), V(1.5, 1.25, 1), qEast));
      }
    }
    return { walls, wallColors, slabs, parapets, tanks, windows };
  }, []);
  const plane = useMemo(() => new THREE.PlaneGeometry(1, 1), []);
  const cyl = useMemo(() => new THREE.CylinderGeometry(0.5, 0.5, 1, 16), []);
  return (
    <group>
      <Instances items={data.walls} colors={data.wallColors} cast>
        <meshStandardMaterial roughness={0.95} />
      </Instances>
      <Instances items={data.slabs}>
        <meshStandardMaterial color="#d6d0c4" roughness={0.95} />
      </Instances>
      <Instances items={data.parapets} cast>
        <meshStandardMaterial color="#efe7d9" roughness={0.95} />
      </Instances>
      <Instances items={data.tanks} geometry={cyl} cast>
        <meshStandardMaterial color="#23272d" roughness={0.6} />
      </Instances>
      <Instances items={data.windows} geometry={plane}>
        <meshStandardMaterial color="#5b6878" roughness={0.4} metalness={0.2} />
      </Instances>
    </group>
  );
}

/** Month-end overlays: roofs tinted by job profit, unfinished roofs outlined, finished roofs get panels. */
export function ProfitRoofs() {
  const fill = useRef<THREE.MeshBasicMaterial>(null);
  const ring = useRef<THREE.MeshStandardMaterial>(null);
  const pv = useRef<THREE.InstancedMesh | null>(null);
  const data = useMemo(() => {
    const tints: THREE.Matrix4[] = [];
    const tintColors: THREE.Color[] = [];
    const frames: THREE.Matrix4[] = [];
    const panels: THREE.Matrix4[] = [];
    for (const l of LOTS) {
      const H = roofOf(l.floors) + 0.04;
      if (l.status === 'unfinished') {
        const y = H + 1.0;
        frames.push(mat(V(l.x, y, l.z - HOUSE.d / 2), V(HOUSE.w + 0.4, 0.3, 0.4)));
        frames.push(mat(V(l.x, y, l.z + HOUSE.d / 2), V(HOUSE.w + 0.4, 0.3, 0.4)));
        frames.push(mat(V(l.x - HOUSE.w / 2, y, l.z), V(0.4, 0.3, HOUSE.d + 0.4)));
        frames.push(mat(V(l.x + HOUSE.w / 2, y, l.z), V(0.4, 0.3, HOUSE.d + 0.4)));
        continue;
      }
      tints.push(mat(V(l.x, H, l.z), V(HOUSE.w - 0.3, HOUSE.d - 0.3, 1), qFlat));
      tintColors.push(new THREE.Color(l.status === 'loss' ? '#d8463a' : '#1fa36d'));
      if (l.x === 0 && l.z === 0) continue;
      for (const p of ROOF_PANELS) panels.push(mat(V(l.x + p.x, H + STAND_FRONT + PANEL_RISE / 2, l.z + p.z), V(PANEL_W, 0.05, PANEL_L), qTilt));
    }
    return { tints, tintColors, frames, panels };
  }, []);
  const plane = useMemo(() => new THREE.PlaneGeometry(1, 1), []);
  useStory((t) => {
    const k = smooth(6.45, 6.85, t);
    if (fill.current) fill.current.opacity = 0.82 * k;
    if (ring.current) ring.current.opacity = k;
    if (pv.current) pv.current.visible = k > 0.5;
  });
  return (
    <group>
      <Instances items={data.tints} colors={data.tintColors} geometry={plane}>
        <meshBasicMaterial ref={fill} transparent opacity={0} depthWrite={false} toneMapped={false} />
      </Instances>
      <Instances items={data.frames}>
        <meshStandardMaterial ref={ring} color={COL.sun} emissive={COL.sun} emissiveIntensity={0.6} transparent opacity={0} />
      </Instances>
      <Instances items={data.panels} onMesh={(m) => (pv.current = m)}>
        <meshStandardMaterial color="#16233a" roughness={0.3} metalness={0.3} />
      </Instances>
    </group>
  );
}

export function Ground() {
  const trees = useMemo(() => {
    const trunks: THREE.Matrix4[] = [];
    const crowns: THREE.Matrix4[] = [];
    let n = 0;
    for (let j = -5; j <= 0; j++)
      for (let i = -5; i <= 4; i++) {
        n++;
        if (rnd(n) < 0.45 || (j === 0 && i >= -2 && i <= 1)) continue;
        const x = i * 15 + 7.5 + (rnd(n + 9) - 0.5) * 2;
        const z = j * LOT_Z + 8.2;
        const s = 1.4 + rnd(n + 4) * 1.1;
        trunks.push(mat(V(x, 1.2, z), V(0.35, 2.4, 0.35)));
        crowns.push(mat(V(x, 2.4 + s * 0.9, z), V(s * 1.15, s, s * 1.15)));
      }
    return { trunks, crowns };
  }, []);
  const ico = useMemo(() => new THREE.IcosahedronGeometry(1, 1), []);
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[900, 900]} />
        <meshStandardMaterial color="#d8cfbe" roughness={1} />
      </mesh>
      {[-5, -4, -3, -2, -1, 0].map((j) => (
        <mesh key={j} rotation-x={-Math.PI / 2} position={[0, 0.02, j * LOT_Z + 12]} receiveShadow>
          <planeGeometry args={[400, 6]} />
          <meshStandardMaterial color="#9fa3a6" roughness={0.9} />
        </mesh>
      ))}
      <Instances items={trees.trunks} cast>
        <meshStandardMaterial color="#7a5a3c" roughness={0.9} />
      </Instances>
      <Instances items={trees.crowns} geometry={ico} cast>
        <meshStandardMaterial color="#6f9a5b" roughness={0.85} flatShading />
      </Instances>
    </group>
  );
}

/** Our customer's house: two storeys, chajjas over the windows, stair room with a water tank, compound wall. */
export function HomeHouse() {
  const R = HOUSE.roof;
  const wall = '#f1e6d3';
  const glass = '#55657a';
  const W = HOUSE.w;
  const D = HOUSE.d;
  const winS = [-2.6, 2.4];
  const winE = [-3.2, 2.6];
  return (
    <group>
      <Block b={{ x: 0, y: 0, z: 0, w: W, h: R - 0.28, d: D }} color={wall} rough={0.95} />
      <Block b={{ x: 0, y: FLOOR - 0.14, z: 0, w: W + 0.12, h: 0.22, d: D + 0.12 }} color="#e2d5bf" rough={0.95} />
      {[0, 1].map((f) => (
        <group key={f}>
          {winS.map((x) => (
            <group key={x}>
              <mesh position={[x, f * FLOOR + 1.65, D / 2 + 0.02]}>
                <planeGeometry args={[1.5, 1.3]} />
                <meshStandardMaterial color={glass} roughness={0.35} metalness={0.2} />
              </mesh>
              <Block b={{ x, y: f * FLOOR + 2.45, z: D / 2 + 0.3, w: 1.9, h: 0.08, d: 0.6 }} color="#e7dcc8" />
            </group>
          ))}
          {winE.map((z) => (
            <group key={z}>
              <mesh position={[W / 2 + 0.02, f * FLOOR + 1.65, z]} rotation-y={Math.PI / 2}>
                <planeGeometry args={[1.5, 1.3]} />
                <meshStandardMaterial color={glass} roughness={0.35} metalness={0.2} />
              </mesh>
              <Block b={{ x: W / 2 + 0.3, y: f * FLOOR + 2.45, z, w: 0.6, h: 0.08, d: 1.9 }} color="#e7dcc8" />
            </group>
          ))}
        </group>
      ))}
      <mesh position={[-0.2, 1.1, D / 2 + 0.02]}>
        <planeGeometry args={[1.1, 2.2]} />
        <meshStandardMaterial color="#7a5235" roughness={0.7} />
      </mesh>
      <Block b={METER} color="#d9dee4" rough={0.6} />
      <group position-y={R}>
        <Slab w={W} d={D} parapetH={HOUSE.parapet} base={0} />
        <Block b={{ x: (MUMTY.x0 + MUMTY.x1) / 2, y: 0, z: (MUMTY.z0 + MUMTY.z1) / 2, w: MUMTY.x1 - MUMTY.x0, h: MUMTY.h, d: MUMTY.z1 - MUMTY.z0 }} color={wall} rough={0.95} />
        <Block b={{ x: (MUMTY.x0 + MUMTY.x1) / 2, y: MUMTY.h, z: (MUMTY.z0 + MUMTY.z1) / 2, w: MUMTY.x1 - MUMTY.x0 + 0.3, h: 0.16, d: MUMTY.z1 - MUMTY.z0 + 0.3 }} color="#d6d0c4" />
        <mesh position={[MUMTY.x1 + 0.01, 1.05, (MUMTY.z0 + MUMTY.z1) / 2]} rotation-y={Math.PI / 2}>
          <planeGeometry args={[0.95, 2.05]} />
          <meshStandardMaterial color="#5d6f61" roughness={0.6} />
        </mesh>
        <mesh position={[TANK.x, MUMTY.h + 0.16 + TANK.h / 2, TANK.z]} castShadow>
          <cylinderGeometry args={[TANK.r, TANK.r * 0.96, TANK.h, 24]} />
          <meshStandardMaterial color="#202429" roughness={0.55} />
        </mesh>
      </group>
      {[
        { x: -3.85, w: 5.3 },
        { x: 3.85, w: 5.3 },
      ].map((s) => (
        <Block key={s.x} b={{ x: s.x, y: 0, z: D / 2 + 2.6, w: s.w, h: 1.15, d: 0.2 }} color="#e9dfcd" />
      ))}
      {[-1, 1].map((s) => (
        <Block key={s} b={{ x: s * 6.4, y: 0, z: 1.3, w: 0.2, h: 1.15, d: D + 2.6 }} color="#e9dfcd" />
      ))}
    </group>
  );
}
