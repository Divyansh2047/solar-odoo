import { useEffect } from 'react';
import { useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { SURVEY_STATUS_LABEL, formatDateTime, formatKw, type SurveyStatus } from '@arka/shared';
import { api, qs } from '../../lib/api';
import { useSession } from '../../lib/session';
import { Chip, Empty, ErrorBlock, PageHead, Panel, Seg, SkeletonRows, type Tone } from '../../components/ui';
import { DataTable } from '../../components/table';

export const SURVEY_TONE: Record<SurveyStatus, Tone> = { scheduled: 'info', submitted: 'sun', approved: 'good', rejected: 'warn', cancelled: 'neutral' };

interface Row {
  id: number;
  ref: string;
  status: SurveyStatus;
  recommended_kw: number | null;
  starts_at: string | null;
  technician: string;
  customer: string;
  city: string;
  address: string;
  lead_ref: string;
  requested_kw: number | null;
}

export default function Surveys() {
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? 'all';
  const { me } = useSession();
  useEffect(() => {
    document.title = 'Roof surveys · Arka';
  }, []);
  const q = useQuery({ queryKey: ['surveys', status], queryFn: () => api.get<{ surveys: Row[] }>(`/api/surveys${qs({ status })}`) });
  return (
    <div className="page">
      <PageHead
        title={me?.role === 'technician' ? 'My roof surveys' : 'Roof surveys'}
        lead="A technician records roof direction, tilt and cable distance with photos. Only an approved survey can become a quote."
      />
      <Seg
        label="Status"
        value={status}
        onChange={(v) => setParams(v === 'all' ? {} : { status: v })}
        options={[
          { value: 'all', label: 'All' },
          { value: 'scheduled', label: 'Booked' },
          { value: 'submitted', label: 'To approve' },
          { value: 'approved', label: 'Approved' },
          { value: 'rejected', label: 'Needs a revisit' },
        ]}
      />
      <Panel>
        {q.isLoading ? (
          <SkeletonRows />
        ) : q.isError ? (
          <ErrorBlock error={q.error} retry={() => q.refetch()} />
        ) : (
          <DataTable
            rows={q.data!.surveys}
            rowKey={(r) => r.id}
            to={(r) => `/app/surveys/${r.id}`}
            rowTone={(r) => (r.status === 'submitted' ? 'sun' : undefined)}
            empty={<Empty title="No surveys here">Surveys are booked from an enquiry after the qualification call.</Empty>}
            columns={[
              { header: 'Customer', cell: (r) => (<><span className="cell-main">{r.customer}</span><div className="cell-sub">{r.address}, {r.city}</div></>) },
              { header: 'Survey', cell: (r) => <span className="mono">{r.ref}</span> },
              { header: 'Visit', cell: (r) => (r.starts_at ? formatDateTime(r.starts_at) : '—') },
              { header: 'Technician', cell: (r) => r.technician },
              { header: 'Size', cell: (r) => (r.recommended_kw ? `${formatKw(r.recommended_kw)} measured` : r.requested_kw ? `${formatKw(r.requested_kw)} asked` : '—') },
              { header: 'Status', cell: (r) => <Chip tone={SURVEY_TONE[r.status]}>{SURVEY_STATUS_LABEL[r.status]}</Chip> },
            ]}
            card={(r) => ({
              title: r.customer,
              right: <Chip tone={SURVEY_TONE[r.status]}>{SURVEY_STATUS_LABEL[r.status]}</Chip>,
              meta: [r.city, r.starts_at ? formatDateTime(r.starts_at) : '', r.technician].filter(Boolean),
            })}
          />
        )}
      </Panel>
    </div>
  );
}
