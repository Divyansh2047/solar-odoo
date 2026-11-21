import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { formatPhone, initials } from '@arka/shared';

/** Frame for pages customers see: the installer's name first, Arka small. */
export function PublicShell({ company, children, phone }: { company?: string; phone?: string | null; children: ReactNode }) {
  return (
    <div className="public">
      <header className="public-top">
        <span className="public-brand">
          {company && (
            <span className="public-mark" aria-hidden>
              {initials(company)}
            </span>
          )}
          {company ?? ' '}
        </span>
        {phone && (
          <a href={`tel:${phone}`} className="btn btn-sm">
            Call {formatPhone(phone)}
          </a>
        )}
      </header>
      <main className="public-main" id="main">
        {children}
      </main>
      <footer className="public-foot">
        Runs on{' '}
        <Link to="/" style={{ fontWeight: 700 }}>
          Arka
        </Link>
        , operations software for rooftop solar installers.
      </footer>
    </div>
  );
}
