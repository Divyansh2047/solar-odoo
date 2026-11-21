import { forwardRef, useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { ApiError } from '../lib/api';
import { Link } from 'react-router';
import { ArrowLeft, Info, CheckCircle, Warning, WarningOctagon } from '@phosphor-icons/react';
import { formatINR, formatINRShort } from '@arka/shared';

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger' | 'dark';
  size?: 'sm' | 'md' | 'lg';
  busy?: boolean;
  block?: boolean;
  icon?: ReactNode;
};

export const Button = forwardRef<HTMLButtonElement, BtnProps>(function Button(
  { variant = 'secondary', size = 'md', busy, block, icon, children, className = '', disabled, type = 'button', ...rest },
  ref,
) {
  const cls = ['btn', variant !== 'secondary' && `btn-${variant}`, size !== 'md' && `btn-${size}`, block && 'btn-block', !children && 'btn-icon', className].filter(Boolean).join(' ');
  return (
    <button ref={ref} type={type} className={cls} disabled={disabled || busy} aria-busy={busy || undefined} {...rest}>
      {busy ? <span className="spin" aria-hidden /> : icon}
      {children}
    </button>
  );
});

export function PageHead({ title, lead, back, actions, children }: { title: ReactNode; lead?: ReactNode; back?: { to: string; label: string }; actions?: ReactNode; children?: ReactNode }) {
  return (
    <div className="page-head">
      <div style={{ minWidth: 0 }}>
        {back && (
          <Link className="crumb" to={back.to}>
            <ArrowLeft size={14} weight="bold" aria-hidden /> {back.label}
          </Link>
        )}
        <h1>{title}</h1>
        {lead && <p className="lead">{lead}</p>}
        {children}
      </div>
      {actions && <div className="actions">{actions}</div>}
    </div>
  );
}

export function Panel({ title, actions, children, className = '', foot, id }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; foot?: ReactNode; id?: string }) {
  return (
    <section className={`panel ${className}`} id={id} aria-labelledby={id && title ? `${id}-title` : undefined}>
      {(title || actions) && (
        <div className="panel-head">
          {title && <h2 id={id ? `${id}-title` : undefined}>{title}</h2>}
          {actions && <div className="row">{actions}</div>}
        </div>
      )}
      {children}
      {foot && <div className="panel-foot">{foot}</div>}
    </section>
  );
}

export type Tone = 'good' | 'bad' | 'warn' | 'info' | 'neutral' | 'sun';

export function Chip({ tone = 'neutral', children, plain, title }: { tone?: Tone; children: ReactNode; plain?: boolean; title?: string }) {
  return (
    <span className={`chip ${tone === 'neutral' ? '' : tone} ${plain ? 'plain' : ''}`} title={title}>
      {children}
    </span>
  );
}

export function Callout({ tone = 'info', children, action }: { tone?: 'info' | 'good' | 'bad' | 'warn'; children: ReactNode; action?: ReactNode }) {
  const Icon = tone === 'good' ? CheckCircle : tone === 'bad' ? WarningOctagon : tone === 'warn' ? Warning : Info;
  return (
    <div className={`callout ${tone === 'info' ? '' : tone}`} role={tone === 'bad' ? 'alert' : undefined}>
      <Icon size={18} weight="bold" aria-hidden />
      <div style={{ minWidth: 0 }}>{children}</div>
      {action && <div className="callout-action">{action}</div>}
    </div>
  );
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="cells" aria-hidden>
        <i />
        <i />
        <i />
        <i />
        <i />
        <i />
      </div>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function Skeleton({ h = 16, w = '100%', r }: { h?: number; w?: number | string; r?: number }) {
  return <div className="skeleton" style={{ height: h, width: w, borderRadius: r }} aria-hidden />;
}

export function SkeletonRows({ rows = 6 }: { rows?: number }) {
  return (
    <div style={{ display: 'grid', gap: 12, padding: 20 }} role="status" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 0.8fr 0.6fr', gap: 16 }}>
          <Skeleton h={18} />
          <Skeleton h={18} />
          <Skeleton h={18} />
          <Skeleton h={18} />
        </div>
      ))}
    </div>
  );
}

/** A record that isn't there gets a way back, not a retry; a network failure gets a retry. */
export function ErrorBlock({ error, retry }: { error: unknown; retry?: () => void }) {
  const status = error instanceof ApiError ? error.status : 0;
  const missing = status === 404;
  const forbidden = status === 403;
  const msg = error instanceof Error ? error.message : 'Something went wrong.';
  return (
    <div className="error-block" role="alert">
      <h3>{missing ? 'We couldn’t find that' : forbidden ? 'This isn’t part of your work' : 'That didn’t load'}</h3>
      <p className="muted">{missing ? 'It may have been removed, or the link is from another workspace.' : forbidden ? 'Ask your director if you need to see it.' : msg}</p>
      <div className="row">
        {retry && !missing && !forbidden && (
          <Button size="sm" variant="primary" onClick={retry}>
            Try again
          </Button>
        )}
        <Button size="sm" onClick={() => (history.length > 1 ? history.back() : location.assign('/app'))}>
          Go back
        </Button>
      </div>
    </div>
  );
}

export function Money({ paise, short, sign, className = '' }: { paise: number | null | undefined; short?: boolean; sign?: boolean; className?: string }) {
  if (paise === null || paise === undefined) return <span className="muted">—</span>;
  const n = Number(paise);
  return <span className={`num ${className}`}>{short ? formatINRShort(n) : formatINR(n, { sign })}</span>;
}

/** Profit / loss: sign and word as well as colour. */
export function ProfitAmount({ paise }: { paise: number }) {
  const tone = paise < 0 ? 'var(--bad)' : 'var(--good)';
  return (
    <span className="num" style={{ color: tone, fontWeight: 800 }}>
      {formatINR(paise, { sign: true })}
      <span className="sr-only">{paise < 0 ? ' loss' : ' profit'}</span>
    </span>
  );
}

/**
 * A row of choices. `variant="tabs"` is for switching between sections of a page (underlined);
 * the default pill style is for filters. On a narrow screen the row scrolls sideways, fades only
 * when something is really cut off, and keeps the chosen option in view.
 */
export function Seg<T extends string>({ value, onChange, options, label, variant }: { value: T; onChange: (v: T) => void; options: { value: T; label: string; count?: number }[]; label: string; variant?: 'tabs' }) {
  const ref = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setOverflow(el.scrollWidth - el.clientWidth > 2 && el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
    check();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(check) : null;
    ro?.observe(el);
    el.addEventListener('scroll', check, { passive: true });
    return () => {
      ro?.disconnect();
      el.removeEventListener('scroll', check);
    };
  }, [options.length]);
  useEffect(() => {
    const el = ref.current;
    const on = el?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (el && on && el.scrollWidth > el.clientWidth) el.scrollTo({ left: Math.max(0, on.offsetLeft - 16), behavior: 'instant' as ScrollBehavior });
  }, [value]);
  return (
    <div ref={ref} className={`seg${variant === 'tabs' ? ' seg-tabs' : ''}${overflow ? ' overflowing' : ''}`} role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
          {o.label}
          {o.count !== undefined && (
            <span className="badge" style={{ marginLeft: 6 }}>
              {o.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

export function KV({ items }: { items: [ReactNode, ReactNode][] }) {
  return (
    <dl className="kv">
      {items.map(([k, v], i) => (
        <div key={i} style={{ display: 'contents' }}>
          <dt>{k}</dt>
          <dd>{v ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Ref({ children }: { children: ReactNode }) {
  return <span className="mono">{children}</span>;
}
