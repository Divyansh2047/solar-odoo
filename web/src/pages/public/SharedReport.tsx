import { useEffect } from 'react';
import { useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { formatDate } from '@arka/shared';
import { api } from '../../lib/api';
import { PublicShell } from '../../layout/PublicShell';
import { ErrorBlock, SkeletonRows } from '../../components/ui';
import { DashboardBody } from '../app/Home';

/** The director's numbers, shared read-only through an expiring link. */
export default function SharedReport() {
  const { token = '' } = useParams();
  const q = useQuery({ queryKey: ['shared', token], queryFn: () => api.get<Parameters<typeof DashboardBody>[0]['data'] & { company: string; expiresAt: string }>(`/api/public/report/${token}`), retry: false });
  useEffect(() => {
    if (q.data) document.title = `${q.data.company}: ${q.data.period.label}`;
  }, [q.data]);
  if (q.isLoading) return <PublicShell><SkeletonRows rows={8} /></PublicShell>;
  if (q.isError) return <PublicShell><ErrorBlock error={q.error} /></PublicShell>;
  const d = q.data!;
  return (
    <PublicShell company={d.company}>
      <div className="stack" style={{ gap: 24 }}>
        <div>
          <h1>How {d.company} is doing: {d.period.label.toLowerCase()}</h1>
          <p className="muted">
            Shared read-only. This link stops working on {formatDate(d.expiresAt)}.
          </p>
        </div>
        <DashboardBody data={d} shared />
      </div>
    </PublicShell>
  );
}
