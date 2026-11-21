import type { MouseEvent, ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';

export interface Column<T> {
  header: ReactNode;
  cell: (row: T) => ReactNode;
  className?: string;
  width?: string | number;
}

/**
 * A table on desktop, cards on phones (every table, not just list pages). Rows are links when `to`
 * is given, so they work with the keyboard and middle-click.
 */
export function DataTable<T>({
  rows,
  columns,
  rowKey,
  to,
  card,
  empty,
  rowTone,
  caption,
}: {
  rows: T[];
  columns: Column<T>[];
  rowKey: (r: T) => string | number;
  to?: (r: T) => string;
  card: (r: T) => { title: ReactNode; right?: ReactNode; meta?: ReactNode[]; extra?: ReactNode };
  empty?: ReactNode;
  rowTone?: (r: T) => 'hot' | 'sun' | undefined;
  caption?: string;
}) {
  const nav = useNavigate();
  if (!rows.length) return <>{empty}</>;
  // the whole row opens the record; the first cell stays a real link for keyboards and new tabs
  const rowClick = (href: string | undefined) => (e: MouseEvent<HTMLTableRowElement>) => {
    if (!href || e.defaultPrevented) return;
    if ((e.target as HTMLElement).closest('a, button, input, select, textarea, label')) return;
    if (e.metaKey || e.ctrlKey) window.open(href, '_blank');
    else nav(href);
  };
  return (
    <>
      <div className="table-wrap responsive">
        <table className="table">
          {caption && <caption className="sr-only">{caption}</caption>}
          <thead>
            <tr>
              {columns.map((c, i) => (
                <th key={i} className={c.className} style={c.width ? { width: c.width } : undefined} scope="col">
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const tone = rowTone?.(r);
              const href = to?.(r);
              return (
                <tr key={rowKey(r)} className={`${href ? 'clickable' : ''} ${tone ? `row-${tone}` : ''}`} onClick={rowClick(href)}>
                  {columns.map((c, i) => (
                    <td key={i} className={c.className}>
                      {i === 0 && href ? (
                        <Link to={href} className="row-link" style={{ color: 'inherit', textDecoration: 'none' }}>
                          {c.cell(r)}
                        </Link>
                      ) : (
                        c.cell(r)
                      )}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="cards">
        {rows.map((r) => {
          const c = card(r);
          const href = to?.(r);
          const body = (
            <>
              <div className="card-row-top">
                <span className="cell-main">{c.title}</span>
                {c.right}
              </div>
              {c.meta && (
                <div className="card-row-meta">
                  {c.meta.filter(Boolean).map((m, i) => (
                    <span key={i}>{m}</span>
                  ))}
                </div>
              )}
              {c.extra}
            </>
          );
          return href ? (
            <Link key={rowKey(r)} to={href} className={`card-row ${rowTone?.(r) === 'hot' ? 'hot' : ''}`}>
              {body}
            </Link>
          ) : (
            <div key={rowKey(r)} className={`card-row ${rowTone?.(r) === 'hot' ? 'hot' : ''}`}>
              {body}
            </div>
          );
        })}
      </div>
    </>
  );
}
