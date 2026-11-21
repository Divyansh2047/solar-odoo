import * as THREE from 'three';
import { useMemo, useRef } from 'react';
import { Arrester, Block, COL, EarthPit, Inverter, Panel, RowStand, SwitchBox, UNIT } from '../../../three/parts';
import { PANEL_RISE, STAND_FRONT, TILT } from '../../../three/kit-layout';
import { ACDB, ARRESTER, CABLE_PATH, COMPASS, CREW, DCDB, HOUSE, INVERTER, PIN, PITS, ROOF_PANELS, ROOF_ROWS, TILT_GAUGE, clamp01, local, presence, smooth } from '../story';
import { useStory } from './ctx';

/* Everything that changes during the week. Each object's state is computed from t alone. */

const R = HOUSE.roof;
const installL = (t: number) => local(t, 5, -0.45, 0);
/** Installed amount of the roof kit: 1 in the hero, rewound for Monday, rebuilt on Friday. */
function installed(t: number, a: number, b: number) {
  return t < 1 ? 1 - smooth(0.25, 0.75, t) : smooth(a, b, installL(t));
}

export function RoofKit() {
  const panels = useRef<(THREE.Group | null)[]>([]);
  const stands = useRef<THREE.Group>(null);
  const equip = useRef<THREE.Group>(null);
  const ground = useRef<THREE.Group>(null);
  const screen = useRef<THREE.Group>(null);
  useStory((t) => {
    const L = installL(t);
    ROOF_PANELS.forEach((p, i) => {
      const g = panels.current[i];
      if (!g) return;
      const k = t < 1 ? 1 - smooth(0.25, 0.75, t) : smooth(0, 1, (L - 0.22 - i * 0.075) / 0.3);
      g.visible = k > 0.002;
      g.position.y = R + STAND_FRONT + PANEL_RISE / 2 + (1 - k) * 3.4;
      g.scale.setScalar(t < 1 ? Math.max(0.002, k) : 1);
    });
    if (stands.current) {
      const s = installed(t, 0, 0.22);
      stands.current.visible = s > 0.002;
      stands.current.scale.y = Math.max(0.002, s);
    }
    const e = installed(t, 0.05, 0.2) > 0.5;
    if (equip.current) equip.current.visible = e;
    if (ground.current) ground.current.visible = installed(t, 0.7, 0.8) > 0.5;
    if (screen.current) {
      const fault = presence(t, 6) > 0.5 && t < 5.94;
      const m = (screen.current.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial;
      m.emissive.set(fault ? '#ff3b2f' : '#3ccb8e');
      m.emissiveIntensity = fault ? 1.4 : 0.7;
    }
  });
  return (
    <group>
      <group ref={stands} position-y={R}>
        {ROOF_ROWS.map((r, i) => (
          <RowStand key={i} row={r} />
        ))}
      </group>
      {ROOF_PANELS.map((p, i) => (
        <group key={i} ref={(g) => void (panels.current[i] = g)} position={[p.x, R + STAND_FRONT + PANEL_RISE / 2, p.z]}>
          <Panel />
        </group>
      ))}
      <group ref={equip}>
        <Inverter b={INVERTER} />
        <SwitchBox b={DCDB} kind="dc" />
        <SwitchBox b={ACDB} kind="ac" />
        <Arrester x={ARRESTER.x} z={ARRESTER.z} y={R} height={2.8} />
        <group ref={screen}>
          <mesh position={[INVERTER.x, INVERTER.y + INVERTER.h * 0.68, INVERTER.z + INVERTER.d / 2 + 0.004]}>
            <planeGeometry args={[INVERTER.w * 0.46, INVERTER.h * 0.16]} />
            <meshStandardMaterial color="#10213a" emissive="#3ccb8e" emissiveIntensity={0.7} />
          </mesh>
        </group>
      </group>
      <group ref={ground}>
        {PITS.map((p, i) => (
          <EarthPit key={i} x={p.x} z={p.z} lit={1} />
        ))}
      </group>
    </group>
  );
}

export function EnquiryPin() {
  const g = useRef<THREE.Group>(null);
  const ring = useRef<THREE.Mesh>(null);
  useStory((t) => {
    const pr = presence(t, 1);
    const lp = local(t, 1, -0.5, -0.05);
    if (!g.current || !ring.current) return;
    g.current.visible = pr > 0.01;
    g.current.position.y = R + 2.4 + (1 - smooth(0, 1, lp)) * 5;
    g.current.scale.setScalar(Math.max(0.01, pr));
    ring.current.visible = pr > 0.01;
    ring.current.scale.setScalar(Math.max(0.01, smooth(0.5, 1, lp) * pr));
  });
  return (
    <group>
      <group ref={g} position={[PIN.x, R + 2.4, PIN.z]}>
        <mesh position-y={1.1} castShadow>
          <sphereGeometry args={[0.62, 24, 16]} />
          <meshStandardMaterial color={COL.sun} roughness={0.4} emissive={COL.sun} emissiveIntensity={0.25} />
        </mesh>
        <mesh position-y={1.1} scale={0.28}>
          <sphereGeometry args={[1, 16, 12]} />
          <meshStandardMaterial color="#0e1a2b" />
        </mesh>
        <mesh position-y={0.2} rotation-x={Math.PI} castShadow>
          <coneGeometry args={[0.42, 1.5, 24]} />
          <meshStandardMaterial color={COL.sun} roughness={0.4} />
        </mesh>
      </group>
      <mesh ref={ring} position={[PIN.x, R + 0.03, PIN.z]} rotation-x={-Math.PI / 2}>
        <ringGeometry args={[0.7, 0.95, 40]} />
        <meshBasicMaterial color={COL.sun} toneMapped={false} />
      </mesh>
    </group>
  );
}

function Person({ x, z, tablet = false }: { x: number; z: number; tablet?: boolean }) {
  return (
    <group position={[x, R, z]}>
      <mesh position-y={0.62} castShadow>
        <capsuleGeometry args={[0.2, 0.75, 6, 12]} />
        <meshStandardMaterial color="#2f5d8c" roughness={0.8} />
      </mesh>
      <mesh position-y={1.38} castShadow>
        <sphereGeometry args={[0.15, 16, 12]} />
        <meshStandardMaterial color="#a8774f" roughness={0.8} />
      </mesh>
      <mesh position-y={1.47}>
        <sphereGeometry args={[0.18, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color={COL.sun} roughness={0.5} />
      </mesh>
      {tablet && <Block b={{ x: 0.12, y: 0.95, z: 0.28, w: 0.32, h: 0.24, d: 0.03 }} color="#1b2533" />}
    </group>
  );
}

export function SurveyGear() {
  const g = useRef<THREE.Group>(null);
  const crew = useRef<THREE.Group>(null);
  const dashes = useRef<THREE.InstancedMesh>(null);
  const items = useMemo(() => {
    const out: THREE.Matrix4[] = [];
    for (let i = 1; i < CABLE_PATH.length; i++) {
      const a = new THREE.Vector3(...CABLE_PATH[i - 1]!);
      const b = new THREE.Vector3(...CABLE_PATH[i]!);
      const len = a.distanceTo(b);
      const dir = b.clone().sub(a).normalize();
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
      for (let s = 0; s < len; s += 0.55) {
        const l = Math.min(0.35, len - s);
        const c = a.clone().addScaledVector(dir, s + l / 2);
        out.push(new THREE.Matrix4().compose(c, q, new THREE.Vector3(0.09, 0.09, l)));
      }
    }
    return out;
  }, []);
  useStory((t) => {
    const pr = presence(t, 2);
    if (g.current) {
      g.current.visible = pr > 0.01;
      g.current.scale.setScalar(Math.max(0.01, 0.6 + 0.4 * pr));
    }
    if (crew.current) {
      const c = Math.max(pr, presence(t, 5));
      crew.current.visible = c > 0.5;
      crew.current.position.set(t > 4 ? 0 : -0.9, 0, t > 4 ? 0.6 : -1.6);
    }
    const m = dashes.current;
    if (m) {
      if (!m.userData.ready) {
        items.forEach((mx, i) => m.setMatrixAt(i, mx));
        m.instanceMatrix.needsUpdate = true;
        m.userData.ready = true;
      }
      m.count = pr > 0.01 ? Math.round(items.length * clamp01(local(t, 2, -0.45, 0) * 1.05)) : 0;
    }
  });
  const arc = useMemo(() => new THREE.TorusGeometry(1.25, 0.03, 6, 28, TILT), []);
  return (
    <group>
      <group ref={g} position={[0, 0, 0]}>
        <group position={[COMPASS.x, R + 0.04, COMPASS.z]}>
          <mesh rotation-x={-Math.PI / 2}>
            <ringGeometry args={[COMPASS.r - 0.1, COMPASS.r, 48]} />
            <meshBasicMaterial color="#ffffff" toneMapped={false} />
          </mesh>
          {[0, 1, 2, 3].map((i) => (
            <mesh key={i} geometry={UNIT} rotation-y={(i * Math.PI) / 2} position={[Math.sin((i * Math.PI) / 2) * COMPASS.r * 0.82, 0.01, Math.cos((i * Math.PI) / 2) * COMPASS.r * 0.82]} scale={[0.05, 0.02, 0.24]}>
              <meshBasicMaterial color={i === 2 ? '#c8372d' : '#ffffff'} toneMapped={false} />
            </mesh>
          ))}
          <mesh rotation-x={-Math.PI / 2} position-y={0.02}>
            <circleGeometry args={[0.6, 3]} />
            <meshBasicMaterial color={COL.sun} toneMapped={false} />
          </mesh>
        </group>
        <group position={[TILT_GAUGE.x, R + 0.05, TILT_GAUGE.z + 1.0]}>
          <mesh geometry={UNIT} position={[0, 0, -1.1]} scale={[0.06, 0.06, 2.2]}>
            <meshBasicMaterial color="#ffffff" toneMapped={false} />
          </mesh>
          <mesh geometry={UNIT} rotation-x={TILT} position={[0, Math.sin(TILT) * 1.1, -Math.cos(TILT) * 1.1]} scale={[0.07, 0.07, 2.2]}>
            <meshBasicMaterial color={COL.sun} toneMapped={false} />
          </mesh>
          <mesh geometry={arc} rotation={[0, Math.PI / 2, 0]}>
            <meshBasicMaterial color="#ffffff" toneMapped={false} />
          </mesh>
        </group>
      </group>
      <instancedMesh ref={dashes} args={[UNIT, undefined, items.length]} frustumCulled={false}>
        <meshBasicMaterial color={COL.sun} toneMapped={false} />
      </instancedMesh>
      <group ref={crew}>
        <Person x={CREW.x} z={CREW.z - 0.6} tablet />
      </group>
    </group>
  );
}

/** Wednesday: the parts list as an exploded kit floating above the roof. */
export const EXPLODED = {
  panels: Array.from({ length: 6 }, (_, i) => new THREE.Vector3(-1.6 + i * 1.28, R + 4.7, 0.2)),
  inverter: new THREE.Vector3(-3.6, R + 3.3, 1.4),
  coil: new THREE.Vector3(-1.0, R + 2.3, 3.4),
  rods: new THREE.Vector3(4.6, R + 2.2, 3.2),
};
export function ExplodedKit() {
  const parts = useRef<(THREE.Group | null)[]>([]);
  const root = useRef<THREE.Group>(null);
  useStory((t) => {
    const pr = presence(t, 3);
    const lp = local(t, 3, -0.55, -0.05);
    if (root.current) root.current.visible = pr > 0.01;
    parts.current.forEach((g, i) => {
      if (!g) return;
      const k = smooth(0, 1, (lp - i * 0.045) / 0.45) * pr;
      g.scale.setScalar(Math.max(0.001, k));
      g.position.y = (g.userData.y as number) - (1 - k) * 2.2;
    });
  });
  const reg = (i: number, y: number) => (g: THREE.Group | null) => {
    parts.current[i] = g;
    if (g) g.userData.y = y;
  };
  const E = EXPLODED;
  const stands = [0.2, 1.8, 3.4];
  return (
    <group ref={root}>
      {E.panels.map((p, i) => (
        <group key={i} ref={reg(i, p.y)} position={p.toArray()}>
          <group rotation-x={1.05}>
            <Panel />
          </group>
        </group>
      ))}
      <group ref={reg(6, E.inverter.y)} position={E.inverter.toArray()}>
        <Inverter b={{ x: 0, y: 0, z: 0, w: 0.5, h: 0.64, d: 0.2 }} />
        <SwitchBox b={{ x: 0.62, y: -0.1, z: 0, w: 0.34, h: 0.42, d: 0.14 }} kind="dc" />
        <SwitchBox b={{ x: 1.1, y: -0.1, z: 0, w: 0.34, h: 0.42, d: 0.14 }} kind="ac" />
      </group>
      {stands.map((x, i) => (
        <group key={x} ref={reg(7 + i, R + 2.0)} position={[x, R + 2.0, 2.6]}>
          <mesh geometry={UNIT} position={[0, 0, 0]} rotation-x={TILT} scale={[0.06, 0.06, 2.2]}>
            <meshStandardMaterial color={COL.gi} metalness={0.5} roughness={0.4} />
          </mesh>
          <mesh geometry={UNIT} position={[0, -0.5, 0.9]} scale={[0.06, 0.8, 0.06]}>
            <meshStandardMaterial color={COL.gi} metalness={0.5} roughness={0.4} />
          </mesh>
          <mesh geometry={UNIT} position={[0, -0.25, -0.9]} scale={[0.06, 1.3, 0.06]}>
            <meshStandardMaterial color={COL.gi} metalness={0.5} roughness={0.4} />
          </mesh>
        </group>
      ))}
      <group ref={reg(10, E.coil.y)} position={E.coil.toArray()}>
        <mesh rotation-x={-1.1} castShadow>
          <torusGeometry args={[0.5, 0.15, 12, 32]} />
          <meshStandardMaterial color="#20252c" roughness={0.6} />
        </mesh>
        <mesh rotation-x={-1.1} position={[1.25, 0, 0]} castShadow>
          <torusGeometry args={[0.5, 0.15, 12, 32]} />
          <meshStandardMaterial color="#a8322a" roughness={0.6} />
        </mesh>
      </group>
      <group ref={reg(11, E.rods.y)} position={E.rods.toArray()}>
        {[-0.3, 0, 0.3].map((x) => (
          <mesh key={x} position={[x, 0, 0]} castShadow>
            <cylinderGeometry args={[0.04, 0.04, 1.6, 10]} />
            <meshStandardMaterial color={COL.copper} metalness={0.7} roughness={0.35} />
          </mesh>
        ))}
      </group>
    </group>
  );
}
