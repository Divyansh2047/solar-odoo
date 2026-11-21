import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { JOB_STATUS_LABEL, KIT_KIND_LABEL, formatDate, formatINR, formatKw, type JobStatus, type JobStage } from '@arka/shared';
import { api, qs } from '../../lib/api';
import { Chip, Empty, ErrorBlock, Money, PageHead, Panel, Seg, SkeletonRows, type Tone } from '../../components/ui';
import { DataTable } from '../../components/table';
import { CellStrip } from '../../components/solar';

export const JOB_TONE: Record<JobStatus, Tone> = {
  awaiting_advance: 'warn',
  confirmed: 'info',
  packed: 'info',
  dispatched: 'sun',
  delivered: 'sun',
  installed: 'good',
  closed: 'neutral',
  cancelled: 'neutral',
};

interface Row {
  id: number;
  ref: string;
  status: JobStatus;
  kind: keyof typeof KIT_KIND_LABEL;
  capacity_kw: number;
  total_paise: number;
  paid_paise: number;
  customer: string;
  city: string;
  install_at: string | null;
  stages: Record<JobStage, 'done' | 'todo' | 'na'>;
}

export default function Jobs() {
  const [params, setParams] = useSearchParams();
  const open = params.get('open') ?? '1';
  const status = params.get('status') ?? 'all';
  const [q, setQ] = useState('');
  useEffect(() => {
    document.title = 'Jobs · Arka';
  }, []);
  const list = useQuery({
    queryKey: ['jobs', open, status, q],
    queryFn: () => api.get<{ jobs: Row[] }>(`/api/jobs${qs({ open: status === 'all' ? open : null, status, q: q.trim().length >= 2 ? q.trim() : null })}`),
    placeholderData: (p) => p,
  });
  return (
    <div className="page">
      <PageHead title="Where is every order?" lead="Each strip is one order: a cell lights up as each step is done, from advance paid to closed." />
      <div className="toolbar">
        <Seg
          label="Show"
          value={status !== 'all' ? status : open === '1' ? 'open' : 'all'}
          onChange={(v) => setParams(v === 'open' ? {} : v === 'all' ? { open: '0' } : { status: v })}
          options={[
            { value: 'open', label: 'Open' },
            { value: 'awaiting_advance', label: 'Waiting for advance' },
            { value: 'dispatched', label: 'On the truck' },
            { value: 'delivered', label: 'Delivered' },
            { value: 'installed', label: 'Installed' },
            { value: 'all', label: 'All' },
          ]}
        />
        <input className="input" type="search" placeholder="Customer, city or JOB-…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search jobs" />
      </div>
      <Panel>
        {list.isLoading ? (
          <SkeletonRows />
        ) : list.isError ? (
          <ErrorBlock error={list.error} retry={() => list.refetch()} />
        ) : (
          <DataTable
            rows={list.data!.jobs}
            rowKey={(r) => r.id}
            to={(r) => `/app/jobs/${r.id}`}
            empty={<Empty title="No jobs here">A job is created when a customer accepts a quote.</Empty>}
            columns={[
              { header: 'Customer', cell: (r) => (<><span className="cell-main">{r.customer}</span><div className="cell-sub">{r.city}</div></>) },
              { header: 'Job', cell: (r) => <span className="mono">{r.ref}</span> },
              { header: 'System', cell: (r) => `${formatKw(r.capacity_kw)} ${r.kind === 'off_grid' ? 'Off-Grid' : r.kind === 'on_grid' ? 'On-Grid' : KIT_KIND_LABEL[r.kind]}` },
              { header: 'Progress', cell: (r) => <CellStrip stages={r.stages} /> },
              { header: 'Status', cell: (r) => <Chip tone={JOB_TONE[r.status]}>{JOB_STATUS_LABEL[r.status]}</Chip> },
              { header: 'Install', className: 'nowrap', cell: (r) => (r.install_at ? formatDate(r.install_at) : <span className="muted">—</span>) },
              {
                header: 'Paid',
                className: 'r',
                cell: (r) => (
                  <>
                    <Money paise={r.paid_paise} />
                    <div className="cell-sub">of <Money paise={r.total_paise} /></div>
                  </>
                ),
              },
            ]}
            card={(r) => ({
              title: r.customer,
              right: <Chip tone={JOB_TONE[r.status]}>{JOB_STATUS_LABEL[r.status]}</Chip>,
              meta: [r.ref, formatKw(r.capacity_kw), r.city, r.install_at ? `Install ${formatDate(r.install_at)}` : null, `Paid ${formatINR(r.paid_paise)} of ${formatINR(r.total_paise)}`],
              extra: <CellStrip stages={r.stages} />,
            })}
          />
        )}
      </Panel>
    </div>
  );
}
