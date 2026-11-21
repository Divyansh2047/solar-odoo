import { useEffect } from 'react';
import { useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Printer } from '@phosphor-icons/react';
import { api } from '../../lib/api';
import { PublicShell } from '../../layout/PublicShell';
import { Button, ErrorBlock, SkeletonRows } from '../../components/ui';
import { InvoiceDocument, type InvoiceData } from '../../components/InvoiceDocument';

export default function InvoicePublic() {
  const { token = '' } = useParams();
  const q = useQuery({ queryKey: ['public-invoice', token], queryFn: () => api.get<InvoiceData>(`/api/public/invoices/${token}`), retry: false });
  useEffect(() => {
    if (q.data) document.title = `Invoice ${q.data.invoice.number}`;
  }, [q.data]);
  if (q.isLoading) return <PublicShell><SkeletonRows rows={8} /></PublicShell>;
  if (q.isError) return <PublicShell><ErrorBlock error={q.error} /></PublicShell>;
  return (
    <PublicShell company={q.data!.invoice.company_name} phone={q.data!.invoice.company_phone}>
      <div className="stack">
        <div className="row no-print" style={{ justifyContent: 'flex-end' }}>
          <Button icon={<Printer size={18} />} onClick={() => window.print()}>
            Print or save as PDF
          </Button>
        </div>
        <InvoiceDocument data={q.data!} />
      </div>
    </PublicShell>
  );
}
