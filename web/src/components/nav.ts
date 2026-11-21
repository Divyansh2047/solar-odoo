import type { Capability } from '@arka/shared';

export interface NavItem {
  to: string;
  label: string;
  hint: string;
  cap?: Capability;
  journey?: boolean;
  count?: (n: NavCounts) => { n: number; hot?: boolean } | null;
}

export interface NavCounts {
  leads_new: number;
  leads_overdue: number;
  surveys_review: number;
  surveys_open: number;
  quotes_open: number;
  jobs_open: number;
  picks_ready: number;
  picks_short: number;
  tickets_open: number;
  tickets_urgent: number;
  invoices_draft: number;
  unread: number;
  public_key: string;
}

/** The customer's journey, in order, hangs on one wire; back-office pages sit below it. */
export const NAV: NavItem[] = [
  { to: '/app/enquiries', label: 'Enquiries', hint: 'Web form, WhatsApp and calls in one list', cap: 'leads.read', journey: true, count: (n) => (n.leads_new ? { n: n.leads_new, hot: n.leads_overdue > 0 } : null) },
  { to: '/app/surveys', label: 'Roof surveys', hint: 'Direction, tilt and cable distance', cap: 'surveys.read', journey: true, count: (n) => (n.surveys_review ? { n: n.surveys_review, hot: true } : n.surveys_open ? { n: n.surveys_open } : null) },
  { to: '/app/quotes', label: 'Quotes', hint: 'From templates, with subsidy and payback', cap: 'quotes.read', journey: true, count: (n) => (n.quotes_open ? { n: n.quotes_open } : null) },
  { to: '/app/jobs', label: 'Jobs', hint: 'Every order from advance to close', cap: 'jobs.read', journey: true, count: (n) => (n.jobs_open ? { n: n.jobs_open } : null) },
  { to: '/app/warehouse', label: 'Warehouse', hint: 'Pick lists, serial scanning, dispatch', cap: 'stock.read', journey: true, count: (n) => (n.picks_ready ? { n: n.picks_ready, hot: true } : n.picks_short ? { n: n.picks_short } : null) },
  { to: '/app/schedule', label: 'Schedule', hint: 'Crew visits for the week', cap: 'schedule.read', journey: true },
  { to: '/app/service', label: 'Service', hint: 'Complaints, warranty and repairs', cap: 'tickets.read', journey: true, count: (n) => (n.tickets_open ? { n: n.tickets_open, hot: n.tickets_urgent > 0 } : null) },
  { to: '/app/money', label: 'Money', hint: 'Invoices, payments, subsidy, pay', cap: 'invoices.read', count: (n) => (n.invoices_draft ? { n: n.invoices_draft } : null) },
  { to: '/app/reports', label: 'Month-end', hint: 'Profit per job and what is unfinished', cap: 'reports.read' },
  { to: '/app/catalog', label: 'Catalogue', hint: 'Products, prices and kit templates', cap: 'stock.read' },
  { to: '/app/settings', label: 'Team and settings', hint: 'People, roles, company details' },
];
