import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { MagnifyingGlass } from '@phosphor-icons/react';
import { formatDate, formatPhone } from '@arka/shared';
import { api } from '../lib/api';
import { useSession } from '../lib/session';
import { NAV } from './nav';

interface SearchResult {
  customers: { id: number; name: string; phone: string; city: string; jobs: number; open_tickets: number }[];
  serials: { id: number; serial: string; product: string; customer: string | null; customer_id: number | null; covered: boolean | null; warranty_end: string | null; job_ref: string | null; status: string }[];
  documents: { kind: string; id: number; ref: string; status: string }[];
  ms: number;
}

const DOC_PATH: Record<string, string> = { job: 'jobs', ticket: 'service', enquiry: 'enquiries', quote: 'quotes', invoice: 'money/invoices' };

/**
 * One box for everything (Ctrl K or /): a customer's name or phone, part of a serial number, a
 * document reference, or a page. Built for the support call in the rain: find it in two seconds.
 */
export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const nav = useNavigate();
  const { can } = useSession();
  const input = useRef<HTMLInputElement>(null);
  const term = q.trim();
  const search = useQuery({
    queryKey: ['search', term],
    queryFn: () => api.get<SearchResult>(`/api/search?q=${encodeURIComponent(term)}`),
    enabled: open && term.length >= 2 && can('customers.read'),
    staleTime: 10_000,
  });
  useEffect(() => {
    if (open) {
      setQ('');
      setSel(0);
      window.setTimeout(() => input.current?.focus(), 20);
    }
  }, [open]);

  const items = useMemo(() => {
    const out: { group: string; key: string; main: string; sub?: string; right?: React.ReactNode; go: string }[] = [];
    const r = search.data;
    if (r && term.length >= 2) {
      for (const s of r.serials)
        out.push({
          group: 'Serial numbers',
          key: `s${s.id}`,
          main: s.serial,
          sub: `${s.product}${s.customer ? `, ${s.customer}` : ''}${s.job_ref ? `, ${s.job_ref}` : ''}`,
          right: s.warranty_end ? <span className={`chip ${s.covered ? 'good' : 'bad'}`}>{s.covered ? `Covered to ${formatDate(s.warranty_end)}` : 'Out of warranty'}</span> : <span className="chip">{s.status.replace('_', ' ')}</span>,
          go: `/app/serials/${s.id}`,
        });
      for (const c of r.customers)
        out.push({
          group: 'Customers',
          key: `c${c.id}`,
          main: c.name,
          sub: `${formatPhone(c.phone)}, ${c.city}`,
          right: c.open_tickets ? <span className="chip warn">{c.open_tickets} open</span> : c.jobs ? <span className="chip plain">{c.jobs} job{c.jobs === 1 ? '' : 's'}</span> : undefined,
          go: `/app/customers/${c.id}`,
        });
      for (const d of r.documents) out.push({ group: 'Documents', key: `d${d.kind}${d.id}`, main: d.ref, sub: `${d.kind}, ${d.status.replace('_', ' ')}`, go: `/app/${DOC_PATH[d.kind]}/${d.id}` });
    }
    const pages = NAV.filter((n) => !n.cap || can(n.cap)).filter((n) => !term || n.label.toLowerCase().includes(term.toLowerCase()));
    for (const p of pages.slice(0, term ? 4 : 9)) out.push({ group: 'Go to', key: `p${p.to}`, main: p.label, sub: p.hint, go: p.to });
    return out;
  }, [search.data, term, can]);

  if (!open) return null;
  const choose = (i: number) => {
    const it = items[i];
    if (!it) return;
    onClose();
    nav(it.go);
  };
  let lastGroup = '';
  return (
    <>
      <div className="scrim" onClick={onClose} aria-hidden />
      <div className="palette" role="dialog" aria-modal="true" aria-label="Search">
        <div className="palette-input">
          <MagnifyingGlass size={20} aria-hidden />
          <input
            ref={input}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setSel(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose();
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSel((s) => Math.min(items.length - 1, s + 1));
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSel((s) => Math.max(0, s - 1));
              }
              if (e.key === 'Enter') choose(sel);
            }}
            placeholder="Name, phone, serial or reference…"
            aria-label="Search customers, serial numbers and documents"
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-activedescendant={items[sel] ? `pi-${items[sel]!.key}` : undefined}
            autoComplete="off"
            spellCheck={false}
          />
          {search.isFetching && <span className="muted" style={{ fontSize: 12 }}>Searching…</span>}
        </div>
        <div className="palette-results" id="palette-list" role="listbox">
          {term.length >= 2 && search.data && !search.data.customers.length && !search.data.serials.length && !search.data.documents.length && (
            <p className="muted" style={{ padding: 12 }}>
              Nothing matches “{term}”. Try the last digits of the phone or serial.
            </p>
          )}
          {items.map((it, i) => {
            const header = it.group !== lastGroup ? <div className="palette-group">{it.group}</div> : null;
            lastGroup = it.group;
            return (
              <div key={it.key}>
                {header}
                <button id={`pi-${it.key}`} role="option" aria-selected={i === sel} className="palette-item" onMouseEnter={() => setSel(i)} onClick={() => choose(i)}>
                  <span>
                    <span className={`pi-main ${it.group === 'Serial numbers' || it.group === 'Documents' ? 'mono' : ''}`}>{it.main}</span>
                    {it.sub && <span className="pi-sub" style={{ display: 'block' }}>{it.sub}</span>}
                  </span>
                  {it.right && <span className="pi-right">{it.right}</span>}
                </button>
              </div>
            );
          })}
        </div>
        <div className="palette-foot">
          <span>
            <kbd>↑</kbd> <kbd>↓</kbd> to move, <kbd>Enter</kbd> to open
          </span>
          {search.data && <span>Found in {search.data.ms} ms</span>}
        </div>
      </div>
    </>
  );
}
