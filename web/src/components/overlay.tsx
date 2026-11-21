import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle, WarningOctagon, X, Info } from '@phosphor-icons/react';

/* ---------------- dialog (bottom sheet on phones) ---------------- */
export function Dialog({ open, onClose, title, description, children, wide, labelledBy }: { open: boolean; onClose: () => void; title: string; description?: ReactNode; children: ReactNode; wide?: boolean; labelledBy?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = labelledBy ?? `dlg-${title.replace(/\W+/g, '-').toLowerCase()}`;
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const el = ref.current;
    const focusables = () => Array.from(el?.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])') ?? []).filter((x) => !x.hasAttribute('disabled'));
    // focus the first field, not the close button
    window.setTimeout(() => (focusables().find((x) => x.matches('input, select, textarea')) ?? focusables()[1] ?? focusables()[0])?.focus(), 30);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab') {
        const f = focusables();
        if (!f.length) return;
        const first = f[0]!;
        const last = f[f.length - 1]!;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      prev?.focus?.();
    };
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <>
      <div className="scrim" onClick={onClose} aria-hidden />
      <div className={`dialog ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={titleId} ref={ref}>
        <div className="dialog-head">
          <div>
            <h2 id={titleId}>{title}</h2>
            {description && <p>{description}</p>}
          </div>
          <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Close">
            <X size={18} weight="bold" />
          </button>
        </div>
        <div className="dialog-body">{children}</div>
      </div>
    </>,
    document.body,
  );
}

/* ---------------- toasts ---------------- */
interface Toast {
  id: number;
  tone: 'good' | 'bad' | 'info';
  text: ReactNode;
}
const ToastCtx = createContext<(text: ReactNode, tone?: Toast['tone']) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((text: ReactNode, tone: Toast['tone'] = 'good') => {
    const id = Date.now() + Math.random();
    setItems((t) => [...t.slice(-3), { id, tone, text }]);
    window.setTimeout(() => setItems((t) => t.filter((x) => x.id !== id)), tone === 'bad' ? 8000 : 5000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.tone}`}>
            {t.tone === 'good' ? <CheckCircle size={18} weight="fill" /> : t.tone === 'bad' ? <WarningOctagon size={18} weight="fill" /> : <Info size={18} weight="fill" />}
            <div>{t.text}</div>
            <button aria-label="Dismiss" onClick={() => setItems((x) => x.filter((y) => y.id !== t.id))}>
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
