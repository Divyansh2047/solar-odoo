import { useEffect } from 'react';
import { useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { KIT_KIND_LABEL, QUOTE_STATUS_LABEL, formatDate, formatKw, relativeTime, type QuoteStatus } from '@arka/shared';
import { api, qs } from '../../lib/api';
import { Chip, Empty, ErrorBlock, Money, PageHead, Panel, Seg, SkeletonRows, type Tone } from '../../components/ui';
import { DataTable } from '../../components/table';

export const QUOTE_TONE: Record<QuoteStatus, Tone> = { draft: 'neutral', sent: 'sun', accepted: 'good', rejected: 'bad', expired: 'warn', superseded: 'neutral' };

interface Row {
  id: number;
  ref: string;
  version: number;
  status: QuoteStatus;
  kind: keyof typeof KIT_KIND_LABEL;
  capacity_kw: number;
  total_paise: number;
  subsidy_paise: number;
  valid_until: string;
  sent_at: string | null;
  created_at: string;
  customer: string;
  city: string;
}

export default function Quotes() {
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? 'all';
  useEffect(() => {
    document.title = 'Quotes · Arka';
  }, []);
  const q = useQuery({ queryKey: ['quotes', status], queryFn: () => api.get<{ quotes: Row[] }>(`/api/quotes${qs({ status })}`) });
  return (
    <div className="page">
      <PageHead title="Which quotes are with customers?" lead="Quotes are built from a kit template and an approved roof survey, so the parts list is never typed by hand." />
      <Seg
        label="Status"
        value={status}
        onChange={(v) => setParams(v === 'all' ? {} : { status: v })}
        options={[
          { value: 'all', label: 'All' },
          { value: 'draft', label: 'Drafts' },
          { value: 'sent', label: 'With customer' },
          { value: 'accepted', label: 'Accepted' },
          { value: 'rejected', label: 'Declined' },
          { value: 'expired', label: 'Expired' },
        ]}
      />
      <Panel>
        {q.isLoading ? (
          <SkeletonRows />
        ) : q.isError ? (
          <ErrorBlock error={q.error} retry={() => q.refetch()} />
        ) : (
          <DataTable
            rows={q.data!.quotes}
            rowKey={(r) => r.id}
            to={(r) => `/app/quotes/${r.id}`}
            empty={<Empty title="No quotes here">Make one from an enquiry once its roof survey is approved.</Empty>}
            columns={[
              { header: 'Customer', cell: (r) => (<><span className="cell-main">{r.customer}</span><div className="cell-sub">{r.city}</div></>) },
              { header: 'Quote', cell: (r) => <span className="mono">{r.ref} v{r.version}</span> },
              { header: 'System', cell: (r) => `${formatKw(r.capacity_kw)} ${KIT_KIND_LABEL[r.kind]}` },
              { header: 'Total', className: 'r', cell: (r) => <Money paise={r.total_paise} /> },
              { header: 'Subsidy', className: 'r', cell: (r) => (r.subsidy_paise ? <Money paise={r.subsidy_paise} /> : <span className="muted">—</span>) },
              { header: 'Status', cell: (r) => <Chip tone={QUOTE_TONE[r.status]}>{QUOTE_STATUS_LABEL[r.status]}</Chip> },
              { header: 'Sent', className: 'nowrap', cell: (r) => (r.sent_at ? relativeTime(r.sent_at) : <span className="muted">Not yet</span>) },
              { header: 'Valid until', className: 'nowrap', cell: (r) => formatDate(r.valid_until) },
            ]}
            card={(r) => ({ title: r.customer, right: <Chip tone={QUOTE_TONE[r.status]}>{QUOTE_STATUS_LABEL[r.status]}</Chip>, meta: [`${formatKw(r.capacity_kw)} ${KIT_KIND_LABEL[r.kind]}`, `${r.ref} v${r.version}`], extra: <Money paise={r.total_paise} /> })}
          />
        )}
      </Panel>
    </div>
  );
}
