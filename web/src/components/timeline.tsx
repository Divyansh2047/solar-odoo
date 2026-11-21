import { formatDateTime, relativeTime } from '@arka/shared';

export interface ActivityItem {
  id: number;
  kind: 'note' | 'call' | 'whatsapp' | 'system';
  body: string;
  created_at: string;
  actor: string | null;
}

const KIND = { note: 'Note', call: 'Call', whatsapp: 'WhatsApp', system: '' } as const;

/** Everything that happened, newest first. Nothing about a customer is ever lost. */
export function Timeline({ items, empty = 'Nothing has happened yet.' }: { items: ActivityItem[]; empty?: string }) {
  if (!items.length) return <p className="muted">{empty}</p>;
  return (
    <ol className="timeline">
      {items.map((a) => (
        <li key={a.id}>
          <span className={`dot ${a.kind}`} aria-hidden />
          <div>
            <div className="body">
              {KIND[a.kind] && <b>{KIND[a.kind]}: </b>}
              {a.body}
            </div>
            <div className="meta" title={formatDateTime(a.created_at)}>
              {a.actor ?? 'Arka'}, {relativeTime(a.created_at)}
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}
