import { Component, lazy, Suspense, type ReactNode } from 'react';
import type { KitViewerProps } from '../three/KitViewer';

const KitViewer = lazy(() => import('../three/KitViewer'));

class Boundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/** The job's real kit in 3D, loaded only when shown (three.js stays out of the main bundle). */
export function Kit3D(props: KitViewerProps) {
  const h = props.height ?? 320;
  const fallback = <div className="skeleton" role="status" style={{ height: h, borderRadius: 12 }} aria-label="Loading the 3D view" />;
  return (
    <Boundary fallback={<p className="muted">The 3D view isn’t available on this device.</p>}>
      <Suspense fallback={fallback}>
        <KitViewer {...props} />
      </Suspense>
    </Boundary>
  );
}
