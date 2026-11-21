import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DownloadSimple } from '@phosphor-icons/react';
import { formatDate, formatINR, formatKw, formatPercent, relativeTime, type Period } from '@arka/shared';
import { api } from '../../lib/api';
import { useSession } from '../../lib/session';
import { Button, Chip, Empty, PageHead, Panel, ProfitAmount, Seg, SkeletonRows } from '../../components/ui';
import { DataTable } from '../../components/table';
import { ProfitBars } from '../../components/charts';
import { UnfinishedList, type UnfinishedJob } from './Home';

interface ProfitRow {
  id: number;
  ref: string;
  customer: string;
  city: string;
  capacity_kw: number;
  status: string;
  installed_at: string;
  revenue_paise: number;
  parts_paise: number;
  labour_paise: number;
  expenses_paise: number;
  warranty_paise: number;
  warranty_tickets: number;
  profit_paise: number;
}

/** The director's month-end: which jobs made money, which lost it, and what is still unfinished. */
export default function Reports() {
  const [period, setPeriod] = useState<Period | 'all'>('month');
  const { can } = useSession();
  useEffect(() => {
    document.title = 'Month-end · Arka';
  }, []);
  const profit = useQuery({ queryKey: ['profit', period], queryFn: () => api.get<{ jobs: ProfitRow[] }>(`/api/reports/profit${period === 'all' ? '' : `?period=${period}`}`) });
  const unfinished = useQuery({ queryKey: ['unfinished'], queryFn: () => api.get<{ jobs: UnfinishedJob[] }>('/api/reports/unfinished') });
  const rows = [...(profit.data?.jobs ?? [])].sort((a, b) => a.profit_paise - b.profit_paise);
  const total = rows.reduce((s, r) => ({ revenue: s.revenue + r.revenue_paise, profit: s.profit + r.profit_paise }), { revenue: 0, profit: 0 });
  const losses = rows.filter((r) => r.profit_paise < 0);
  return (
    <div className="page">
      <PageHead
        title="Month-end report"
        lead="Profit per job: revenue without GST, less parts, crew, expenses and free repairs."
        actions={
          <a className="btn" href={`/api/reports/profit.csv${period === 'all' ? '' : `?period=${period}`}`} download>
            <DownloadSimple size={18} /> Download CSV
          </a>
        }
      />
      <Seg
        label="Installed"
        value={period}
        onChange={setPeriod}
        options={[
          { value: 'today', label: 'Today' },
          { value: 'week', label: 'This week' },
          { value: 'month', label: 'This month' },
          { value: 'all', label: 'Last 500 jobs' },
        ]}
      />
      <div className="dash-grid">
        <Panel title={`${rows.length} installed jobs`} actions={<span className="muted" style={{ fontSize: 14 }}>{formatINR(total.profit)} profit on {formatINR(total.revenue)}, {losses.length} lost money</span>}>
          <div className="panel-body">{profit.isLoading ? <SkeletonRows /> : rows.length ? <ProfitBars rows={rows} limit={15} /> : <Empty title="Nothing installed in this period" />}</div>
        </Panel>
        <div className="stack sticky-col">
        <Panel
          title={unfinished.data ? `${unfinished.data.jobs.length} jobs not closed yet` : 'Not closed yet'}
          actions={unfinished.data && unfinished.data.jobs.length > 5 ? <a href="#unfinished">See all</a> : undefined}
        >
          {unfinished.isLoading ? <SkeletonRows rows={4} /> : <UnfinishedList jobs={(unfinished.data?.jobs ?? []).slice(0, 5)} />}
        </Panel>
        <Panel title="Why the losses happened">
          <div className="panel-body stack">
            {!losses.length && <p className="muted">No job lost money in this period.</p>}
            {losses.slice(0, 6).map((r) => {
              const causes = [
                r.warranty_paise > 0 && `free repairs ${formatINR(r.warranty_paise)}`,
                r.expenses_paise > r.revenue_paise * 0.05 && `expenses ${formatINR(r.expenses_paise)}`,
                r.parts_paise > r.revenue_paise * 0.8 && `parts alone were ${Math.round((r.parts_paise / r.revenue_paise) * 100)}% of what the customer paid, so the price was too low for this kit`,
              ].filter(Boolean);
              return (
                <div key={r.id}>
                  <Link to={`/app/jobs/${r.id}`}>
                    <b>{r.customer}</b>
                  </Link>{' '}
                  <ProfitAmount paise={r.profit_paise} />
                  <p className="muted" style={{ fontSize: 14 }}>
                    {causes.length ? `${String(causes.join('; ')).charAt(0).toUpperCase()}${String(causes.join('; ')).slice(1)}` : 'Thin margin across the board'}.
                  </p>
                </div>
              );
            })}
          </div>
        </Panel>
        </div>
      </div>
      <Panel title="Every job, line by line">
        {profit.isLoading ? (
          <SkeletonRows />
        ) : (
          <DataTable
            rows={rows}
            rowKey={(r) => r.id}
            to={(r) => `/app/jobs/${r.id}`}
            rowTone={(r) => (r.profit_paise < 0 ? 'hot' : undefined)}
            empty={<Empty title="Nothing installed in this period" />}
            columns={[
              { header: 'Job', cell: (r) => (<><span className="cell-main">{r.customer}</span><div className="cell-sub"><span className="mono">{r.ref}</span>, {formatKw(r.capacity_kw)}, {formatDate(r.installed_at)}</div></>) },
              { header: 'Revenue', className: 'r', cell: (r) => formatINR(r.revenue_paise) },
              { header: 'Parts', className: 'r', cell: (r) => formatINR(r.parts_paise) },
              { header: 'Crew', className: 'r', cell: (r) => formatINR(r.labour_paise) },
              { header: 'Expenses', className: 'r', cell: (r) => formatINR(r.expenses_paise) },
              { header: 'Free repairs', className: 'r', cell: (r) => (r.warranty_paise ? <span style={{ color: 'var(--bad)' }}>{formatINR(r.warranty_paise)}</span> : '—') },
              { header: 'Profit', className: 'r', cell: (r) => <ProfitAmount paise={r.profit_paise} /> },
              { header: 'Margin', className: 'r', cell: (r) => formatPercent(r.profit_paise, r.revenue_paise) },
            ]}
            card={(r) => ({ title: r.customer, right: <ProfitAmount paise={r.profit_paise} />, meta: [r.ref, formatKw(r.capacity_kw), `revenue ${formatINR(r.revenue_paise)}`] })}
          />
        )}
      </Panel>
      <div className="dash-grid">
        <div id="unfinished" className="anchor-target">
          <Panel title="Everything not closed yet, oldest first">{unfinished.isLoading ? <SkeletonRows /> : <UnfinishedList jobs={unfinished.data?.jobs ?? []} />}</Panel>
        </div>
        {can('reports.share') && <ShareLinks />}
      </div>
    </div>
  );
}

function ShareLinks() {
  const q = useQuery({ queryKey: ['share-links'], queryFn: () => api.get<{ links: { id: number; period: string; expires_at: string; revoked_at: string | null; created_at: string; created_by: string }[] }>('/api/reports/share') });
  const qc = useQueryClient();
  return (
    <Panel title="Shared report links">
      <div className="panel-body tight" style={{ display: 'grid', gap: 8 }}>
        {!q.data?.links.length && <p className="muted">None yet. Create one from Today with “Share these numbers”.</p>}
        {q.data?.links.map((l) => {
          const live = !l.revoked_at && new Date(l.expires_at) > new Date();
          return (
            <div key={l.id} className="row between">
              <span>
                {l.period === 'month' ? 'This month' : l.period === 'week' ? 'This week' : 'Today'}
                <span className="muted" style={{ display: 'block', fontSize: 13 }}>
                  by {l.created_by}, {relativeTime(l.created_at)}; {live ? `expires ${formatDate(l.expires_at)}` : l.revoked_at ? 'turned off' : 'expired'}
                </span>
              </span>
              {live ? (
                <Button
                  size="sm"
                  variant="danger"
                  onClick={async () => {
                    await api.post(`/api/reports/share/${l.id}/revoke`);
                    void qc.invalidateQueries({ queryKey: ['share-links'] });
                  }}
                >
                  Turn off
                </Button>
              ) : (
                <Chip>Off</Chip>
              )}
            </div>
          );
        })}
      </div>
    </Panel>
  );
}
