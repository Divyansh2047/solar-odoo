import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { startDemo } from '../lib/demo';
import { ApiError } from '../lib/api';

/**
 * The judges' fastest path: one click, a private SunPower workspace with months of history.
 * `variant="primary"` is the sun-yellow button; `"quiet"` is an outlined one for dark backgrounds.
 */
export function DemoButton({ label = 'Open the live demo', variant = 'primary', className = '' }: { label?: string; variant?: 'primary' | 'quiet'; className?: string }) {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <span className={`demo-button ${className}`}>
      <button
        type="button"
        className={`btn ${variant === 'primary' ? 'btn-primary' : 'btn-outline'} btn-lg`}
        disabled={busy}
        aria-busy={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await startDemo((s) => setWait(s));
            await qc.invalidateQueries({ queryKey: ['session'] });
            nav('/app');
          } catch (e) {
            setError(e instanceof ApiError ? e.message : 'Couldn’t open the demo. Try again.');
          } finally {
            setBusy(false);
            setWait(null);
          }
        }}
      >
        {busy ? (wait ? `Preparing the demo… ${wait}s` : 'Opening your demo…') : label}
      </button>
      {error && (
        <span role="alert" className="demo-button__error">
          {error}
        </span>
      )}
    </span>
  );
}
