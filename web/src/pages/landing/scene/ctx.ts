import { createContext, useContext } from 'react';
import { useFrame } from '@react-three/fiber';

/** Scroll progress t (0 hero .. 7 month-end), written by the page, read by every scene object per frame. */
export interface StoryClock {
  t: number;
  reduced: boolean;
}
export const ClockContext = createContext<{ current: StoryClock }>({ current: { t: 0, reduced: false } });

/** Run fn(t) on every rendered frame. Scene state is a pure function of t. */
export function useStory(fn: (t: number, dt: number, elapsed: number) => void, priority = 0) {
  const clock = useContext(ClockContext);
  useFrame((s, dt) => fn(clock.current.t, dt, clock.current.reduced ? 0 : s.clock.elapsedTime), priority);
}

export function useClock() {
  return useContext(ClockContext);
}
