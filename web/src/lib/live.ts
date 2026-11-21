import { useEffect, useState } from 'react';
import type { QueryClient } from '@tanstack/react-query';

/** Topic (from the server) → query keys to refresh. Several screens can listen to one topic. */
const TOPIC_KEYS: Record<string, string[]> = {
  leads: ['leads', 'lead', 'customer', 'search'],
  surveys: ['surveys', 'survey', 'lead', 'myday'],
  quotes: ['quotes', 'quote', 'lead'],
  jobs: ['jobs', 'job', 'unfinished', 'customer'],
  payments: ['job', 'payments', 'invoices'],
  stock: ['products', 'stock', 'warehouse', 'pick'],
  dispatch: ['warehouse', 'pick', 'job', 'jobs'],
  schedule: ['schedule', 'myday', 'job'],
  installs: ['job', 'jobs'],
  tickets: ['tickets', 'ticket', 'customer', 'myday', 'search'],
  invoices: ['invoices', 'invoice', 'job'],
  subsidy: ['subsidy', 'job'],
  payroll: ['payroll'],
  catalog: ['products', 'kits'],
  team: ['team', 'technicians'],
  notifications: ['notifications'],
  dashboard: ['dashboard', 'trend', 'profit', 'unfinished', 'nav'],
};

export type LiveState = 'connecting' | 'live' | 'offline';
let state: LiveState = 'connecting';
const listeners = new Set<(s: LiveState) => void>();
const setState = (s: LiveState) => {
  state = s;
  listeners.forEach((l) => l(s));
};

/** Open one event stream per tab; refresh affected queries (coalesced) when the server says so. */
export function connectLive(qc: QueryClient): () => void {
  let es: EventSource | null = null;
  let pending = new Set<string>();
  let timer: number | null = null;
  let closed = false;
  const flush = () => {
    timer = null;
    const keys = pending;
    pending = new Set();
    keys.forEach((k) => void qc.invalidateQueries({ queryKey: [k] }));
  };
  const open = () => {
    if (closed) return;
    es = new EventSource('/api/events');
    es.addEventListener('hello', () => setState('live'));
    es.addEventListener('change', (ev) => {
      try {
        const { topics } = JSON.parse((ev as MessageEvent).data) as { topics: string[] };
        for (const t of topics) for (const k of TOPIC_KEYS[t] ?? []) pending.add(k);
        if (!timer) timer = window.setTimeout(flush, 150);
      } catch {
        /* ignore */
      }
    });
    es.onerror = () => setState(navigator.onLine ? 'connecting' : 'offline');
  };
  open();
  return () => {
    closed = true;
    es?.close();
    if (timer) clearTimeout(timer);
    setState('connecting');
  };
}

export function useLiveState(): LiveState {
  const [s, set] = useState(state);
  useEffect(() => {
    listeners.add(set);
    return () => void listeners.delete(set);
  }, []);
  return s;
}
