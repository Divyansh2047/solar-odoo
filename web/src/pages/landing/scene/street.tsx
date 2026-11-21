import * as THREE from 'three';
import { useMemo, useRef } from 'react';
import { Block, COL, UNIT } from '../../../three/parts';
import { SCANS_TOTAL, clamp01, local, presence, smooth } from '../story';
import { useStory } from './ctx';

/* Street level: Thursday's delivery truck and the monsoon rain. */

export const TRUCK = { x: 1.6, z: 12.2, bed: 1.1 };
export const CARTONS = {
  inverter: new THREE.Vector3(TRUCK.x + 1.25, TRUCK.bed, TRUCK.z),
  panels: new THREE.Vector3(TRUCK.x - 0.9, TRUCK.bed, TRUCK.z),
};
export const scansAt = (t: number) => Math.min(SCANS_TOTAL, Math.floor(clamp01(local(t, 4, -0.45, -0.05) / 0.75) * (SCANS_TOTAL + 0.999)));

export function Truck() {
  const g = useRef<THREE.Group>(null);
  const invBand = useRef<THREE.MeshStandardMaterial>(null);
  const pnlBand = useRef<THREE.MeshStandardMaterial>(null);
  useStory((t) => {
    if (g.current) g.current.visible = presence(t, 4) > 0.01 || (t > 3.4 && t < 4.6);
    const n = scansAt(t);
    invBand.current?.color.set(n >= 1 ? '#1fa36d' : '#f4f6f8');
    pnlBand.current?.color.set(n >= SCANS_TOTAL ? '#1fa36d' : '#f4f6f8');
  });
  const { x, z, bed } = TRUCK;
  return (
    <group ref={g}>
      <Block b={{ x: x + 3.1, y: 0.55, z, w: 1.8, h: 2.0, d: 2.1 }} color={COL.sun} rough={0.5} />
      <mesh position={[x + 4.01, 1.95, z]} rotation-y={Math.PI / 2}>
        <planeGeometry args={[1.8, 0.75]} />
        <meshStandardMaterial color="#2a3a4f" roughness={0.2} metalness={0.4} />
      </mesh>
      <Block b={{ x: x + 0.1, y: 0.55, z, w: 4.2, h: 0.55, d: 2.1 }} color="#e9edf1" rough={0.6} />
      {[
        { x: x - 2.0, w: 0.08, d: 2.1 },
        { x: x + 0.1, w: 4.2, d: 0.08, dz: 1.01 },
        { x: x + 0.1, w: 4.2, d: 0.08, dz: -1.01 },
      ].map((s, i) => (
        <Block key={i} b={{ x: s.x, y: bed, z: z + (s.dz ?? 0), w: s.w, h: 0.5, d: s.d }} color="#dfe4ea" rough={0.6} />
      ))}
      {[x - 1.2, x + 1.2, x + 3.2].flatMap((wx) => [-1, 1].map((s) => [wx, s] as const)).map(([wx, s], i) => (
        <mesh key={i} position={[wx, 0.45, z + s * 1.0]} rotation-x={Math.PI / 2}>
          <cylinderGeometry args={[0.45, 0.45, 0.3, 20]} />
          <meshStandardMaterial color="#1d2127" roughness={0.8} />
        </mesh>
      ))}
      <Block b={{ x: CARTONS.panels.x, y: bed, z, w: 2.35, h: 0.36, d: 1.2 }} color="#c49a6c" rough={0.9} />
      <mesh geometry={UNIT} position={[CARTONS.panels.x, bed + 0.37, z]} scale={[0.5, 0.02, 1.21]}>
        <meshStandardMaterial ref={pnlBand} color="#f4f6f8" />
      </mesh>
      <Block b={{ x: CARTONS.inverter.x, y: bed, z, w: 0.7, h: 0.5, d: 0.55 }} color="#c49a6c" rough={0.9} />
      <mesh geometry={UNIT} position={[CARTONS.inverter.x, bed + 0.51, z]} scale={[0.25, 0.02, 0.56]}>
        <meshStandardMaterial ref={invBand} color="#f4f6f8" />
      </mesh>
    </group>
  );
}

export function Rain() {
  const N = 1400;
  const lines = useRef<THREE.LineSegments>(null);
  const matRef = useRef<THREE.LineBasicMaterial>(null);
  const seed = useMemo(() => {
    const a = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      a[i * 3] = (Math.random() - 0.5) * 70;
      a[i * 3 + 1] = Math.random() * 34;
      a[i * 3 + 2] = (Math.random() - 0.5) * 60 + 4;
    }
    return a;
  }, []);
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 6), 3));
    return g;
  }, []);
  useStory((t, _dt, elapsed) => {
    const k = smooth(5.45, 5.75, t) * (1 - smooth(6.3, 6.6, t));
    const l = lines.current;
    if (!l || !matRef.current) return;
    l.visible = k > 0.01;
    if (!l.visible) return;
    matRef.current.opacity = 0.6 * k;
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    const fall = elapsed * 22;
    for (let i = 0; i < N; i++) {
      const x = seed[i * 3]!;
      const y = (((seed[i * 3 + 1]! - fall) % 34) + 34) % 34;
      const z = seed[i * 3 + 2]!;
      arr.set([x, y, z, x - 0.12, y + 0.8, z - 0.05], i * 6);
    }
    pos.needsUpdate = true;
  });
  return (
    <lineSegments ref={lines} geometry={geo} frustumCulled={false}>
      <lineBasicMaterial ref={matRef} color="#e8eef6" transparent opacity={0} />
    </lineSegments>
  );
}
