import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bell,
  CalendarBlank,
  ChartBar,
  ChatCircleDots,
  House,
  List,
  MagnifyingGlass,
  Moon,
  SignOut,
  Sun,
  Wrench,
  Package,
  Briefcase,
} from '@phosphor-icons/react';
import { initials, ROLE_LABEL, relativeTime } from '@arka/shared';
import { api } from '../lib/api';
import { connectLive, useLiveState } from '../lib/live';
import { useSession } from '../lib/session';
import { shownCompany, shownEmail } from '../lib/demo';
import { NAV, type NavCounts } from '../components/nav';
import { CommandPalette } from '../components/palette';
import { Button } from '../components/ui';

function useTheme(): [string, () => void] {
  const [t, set] = useState(() => document.documentElement.getAttribute('data-theme') ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
  return [
    t,
    () => {
      const next = t === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      try {
        localStorage.setItem('arka-theme', next);
      } catch {
        /* storage blocked */
      }
      set(next);
    },
  ];
}

export function AppShell() {
  const { me, can, refresh } = useSession();
  const qc = useQueryClient();
  const nav = useNavigate();
  const loc = useLocation();
  const live = useLiveState();
  const [palette, setPalette] = useState(false);
  const [railOpen, setRailOpen] = useState(false);
  const [bell, setBell] = useState(false);
  const [theme, toggleTheme] = useTheme();

  useEffect(() => connectLive(qc), [qc]);
  useEffect(() => setRailOpen(false), [loc.pathname]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = /input|textarea|select/i.test((e.target as HTMLElement)?.tagName ?? '');
      if ((e.key === 'k' && (e.ctrlKey || e.metaKey)) || (e.key === '/' && !typing)) {
        e.preventDefault();
        setPalette(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const counts = useQuery({ queryKey: ['nav'], queryFn: () => api.get<NavCounts>('/api/nav'), refetchInterval: 60_000 });
  const notes = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.get<{ notifications: { id: number; title: string; body: string | null; link: string | null; read_at: string | null; created_at: string }[]; unread: number }>('/api/notifications'),
    enabled: bell,
  });
  useEffect(() => {
    // the nav counts ride on every change event
    void qc.invalidateQueries({ queryKey: ['nav'] });
  }, [loc.pathname, qc]);

  if (!me) return null;
  const items = NAV.filter((n) => !n.cap || can(n.cap));
  const journey = items.filter((n) => n.journey);
  const office = items.filter((n) => !n.journey);
  const c = counts.data;

  const signOut = async () => {
    await api.post('/api/auth/logout');
    qc.setQueryData(['session'], { user: null });
    qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'session' });
    nav('/signin');
  };

  return (
    <div className="shell">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <aside className={`rail ${railOpen ? 'open' : ''}`} aria-label="Main navigation">
        <Link to="/app" className="brand" aria-label="Arka home">
          <span className="brand-mark" aria-hidden>
            <i />
            <i />
            <i />
            <i />
            <i />
            <i />
          </span>
          <span className="brand-name">Arka</span>
        </Link>
        <div className="workspace">
          <b title={me.companyName}>{shownCompany(me.companyName)}</b>
          <span>{ROLE_LABEL[me.role]}</span>
        </div>
        <nav>
          <NavLink to="/app" end className="nav-link">
            <House size={18} aria-hidden /> Today
          </NavLink>
          <div className="nav-title">Customer journey</div>
          <div className="journey">
            {journey.map((n) => {
              const cnt = c && n.count?.(c);
              return (
                <NavLink key={n.to} to={n.to} className="nav-link" title={n.hint}>
                  <span className="node" aria-hidden />
                  {n.label}
                  {cnt && (
                    <span className={`count ${cnt.hot ? 'hot' : ''}`} aria-label={`${cnt.n} waiting`}>
                      {cnt.n}
                    </span>
                  )}
                </NavLink>
              );
            })}
          </div>
          <div className="nav-title">Office</div>
          {office.map((n) => {
            const cnt = c && n.count?.(c);
            return (
              <NavLink key={n.to} to={n.to} className="nav-link" title={n.hint}>
                <span className="node" aria-hidden />
                {n.label}
                {cnt && <span className="count">{cnt.n}</span>}
              </NavLink>
            );
          })}
        </nav>
        <div className="rail-foot">
          <span className={`live ${live === 'live' ? 'on' : live === 'offline' ? 'off' : ''}`} aria-live="polite" title="Changes made by anyone in your team appear here without reloading.">
            {live === 'live' ? 'Live updates on' : live === 'offline' ? 'Offline' : 'Connecting…'}
          </span>
          <div className="me">
            <span className="avatar" aria-hidden>
              {initials(me.name)}
            </span>
            <span className="who">
              <b>{me.name}</b>
              <span title={shownEmail(me.email, me.companyKind === 'demo')}>{ROLE_LABEL[me.role]}</span>
            </span>
          </div>
          <button className="nav-link" onClick={signOut} style={{ border: 0, background: 'none', cursor: 'pointer', width: '100%' }}>
            <SignOut size={18} aria-hidden /> Sign out
          </button>
        </div>
      </aside>
      {railOpen && <div className="scrim" style={{ zIndex: 64 }} onClick={() => setRailOpen(false)} aria-hidden />}

      <div className="main">
        {me.companyKind === 'demo' && <DemoRibbon onSwitched={refresh} />}
        <header className="topbar">
          <button className="searchbox" onClick={() => setPalette(true)} aria-label="Search customers, serials and documents">
            <MagnifyingGlass size={18} aria-hidden />
            <span>Search name, phone, serial…</span>
            <kbd>Ctrl K</kbd>
          </button>
          <span className="spacer" />
          <Button variant="ghost" aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'} onClick={toggleTheme} icon={theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />} />
          <div style={{ position: 'relative' }}>
            <Button variant="ghost" aria-label={`Notifications${c?.unread ? `, ${c.unread} unread` : ''}`} aria-expanded={bell} onClick={() => setBell((b) => !b)} icon={<Bell size={20} />} />
            {!!c?.unread && (
              <span className="badge hot" style={{ position: 'absolute', top: 2, right: 0, pointerEvents: 'none' }} aria-hidden>
                {c.unread > 9 ? '9+' : c.unread}
              </span>
            )}
            {bell && (
              <div className="panel" style={{ position: 'absolute', right: 0, top: 46, width: 'min(380px, calc(100vw - 24px))', boxShadow: 'var(--shadow-float)', zIndex: 30 }}>
                <div className="panel-head">
                  <h3>Notifications</h3>
                  <button
                    className="link-btn"
                    onClick={async () => {
                      await api.post('/api/notifications/read', {});
                      void qc.invalidateQueries({ queryKey: ['notifications'] });
                      void qc.invalidateQueries({ queryKey: ['nav'] });
                    }}
                  >
                    Mark all read
                  </button>
                </div>
                <div className="panel-body tight" style={{ maxHeight: 420, overflow: 'auto', display: 'grid', gap: 4 }}>
                  {notes.isLoading && <p className="muted">Loading…</p>}
                  {notes.data?.notifications.length === 0 && <p className="muted">Nothing new.</p>}
                  {notes.data?.notifications.map((n) => (
                    <Link
                      key={n.id}
                      to={n.link ?? '/app'}
                      onClick={() => setBell(false)}
                      className="palette-item"
                      style={{ alignItems: 'flex-start', background: n.read_at ? undefined : 'var(--cell-soft)' }}
                    >
                      <span>
                        <span className="pi-main">{n.title}</span>
                        {n.body && <span className="pi-sub" style={{ display: 'block' }}>{n.body}</span>}
                        <span className="pi-sub">{relativeTime(n.created_at)}</span>
                      </span>
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </div>
        </header>
        <main id="main" tabIndex={-1}>
          <Outlet />
        </main>
      </div>

      <MobileTabs onMenu={() => setRailOpen(true)} onSearch={() => setPalette(true)} />
      <CommandPalette open={palette} onClose={() => setPalette(false)} />
    </div>
  );
}

function MobileTabs({ onMenu, onSearch }: { onMenu: () => void; onSearch: () => void }) {
  const { me, can } = useSession();
  if (!me) return null;
  const tabs: { to: string; label: string; icon: React.ReactNode }[] = [{ to: '/app', label: 'Today', icon: <House size={22} /> }];
  if (me.role === 'technician') {
    tabs.push({ to: '/app/schedule', label: 'Schedule', icon: <CalendarBlank size={22} /> }, { to: '/app/service', label: 'Service', icon: <Wrench size={22} /> });
  } else if (me.role === 'warehouse') {
    tabs.push({ to: '/app/warehouse', label: 'Warehouse', icon: <Package size={22} /> }, { to: '/app/catalog', label: 'Stock', icon: <List size={22} /> });
  } else if (me.role === 'support') {
    tabs.push({ to: '/app/service', label: 'Service', icon: <Wrench size={22} /> }, { to: '/app/schedule', label: 'Schedule', icon: <CalendarBlank size={22} /> });
  } else {
    if (can('leads.read')) tabs.push({ to: '/app/enquiries', label: 'Enquiries', icon: <ChatCircleDots size={22} /> });
    tabs.push({ to: '/app/jobs', label: 'Jobs', icon: <Briefcase size={22} /> });
    if (can('reports.read')) tabs.push({ to: '/app/reports', label: 'Month-end', icon: <ChartBar size={22} /> });
  }
  return (
    <nav className="tabbar" aria-label="Quick navigation">
      {tabs.slice(0, 3).map((t) => (
        <NavLink key={t.to} to={t.to} end={t.to === '/app'}>
          {t.icon}
          {t.label}
        </NavLink>
      ))}
      <button onClick={onSearch} aria-label="Search">
        <MagnifyingGlass size={22} />
        Search
      </button>
      <button onClick={onMenu} aria-label="Open the full menu">
        <List size={22} />
        Menu
      </button>
    </nav>
  );
}

function DemoRibbon({ onSwitched }: { onSwitched: () => Promise<void> }) {
  const { me } = useSession();
  const nav = useNavigate();
  const people = useQuery({ queryKey: ['demo-people'], queryFn: () => api.get<{ people: { id: number; name: string; role: keyof typeof ROLE_LABEL }[] }>('/api/auth/demo/people') });
  return (
    <div className="demo-ribbon" role="region" aria-label="Demo workspace">
      <span className="ribbon-long">Demo workspace: your own copy of SunPower, deleted after 24 hours.</span>
      <span className="ribbon-short">Demo, deleted in 24 h.</span>
      <label className="row" style={{ gap: 6 }}>
        <span className="ribbon-long">See it as</span>
        <select
          value={me?.id}
          onChange={async (e) => {
            await api.post('/api/auth/demo/switch', { userId: Number(e.target.value) });
            await onSwitched();
            nav('/app');
          }}
        >
          {people.data?.people.map((p) => (
            <option key={p.id} value={p.id}>
              {ROLE_LABEL[p.role]}: {p.name}
            </option>
          ))}
        </select>
      </label>
      <Link to="/signup" className="ribbon-link">
        Create your own workspace
      </Link>
    </div>
  );
}
