import type { Role } from './enums.js';

/**
 * What each role may do. Checked on the server for every request and mirrored in the UI
 * to hide what a person can't use. The server is the authority; the UI only reflects it.
 */
export const CAPABILITIES = {
  'leads.read': ['owner', 'sales', 'support'],
  'leads.write': ['owner', 'sales'],
  'surveys.read': ['owner', 'sales', 'technician'],
  'surveys.schedule': ['owner', 'sales'],
  'surveys.submit': ['owner', 'technician'],
  'surveys.review': ['owner', 'sales'],
  'quotes.read': ['owner', 'sales', 'accounts'],
  'quotes.write': ['owner', 'sales'],
  'jobs.read': ['owner', 'sales', 'technician', 'warehouse', 'support', 'accounts'],
  'jobs.write': ['owner', 'sales'],
  'payments.write': ['owner', 'sales', 'accounts'],
  'stock.read': ['owner', 'sales', 'technician', 'warehouse', 'support', 'accounts'],
  'stock.write': ['owner', 'warehouse'],
  'dispatch.write': ['owner', 'warehouse'],
  'delivery.write': ['owner', 'warehouse', 'technician'],
  'schedule.read': ['owner', 'sales', 'technician', 'warehouse', 'support'],
  'schedule.write': ['owner', 'sales'],
  'install.write': ['owner', 'technician'],
  'tickets.read': ['owner', 'sales', 'technician', 'support', 'accounts'],
  'tickets.write': ['owner', 'support', 'technician'],
  'invoices.read': ['owner', 'accounts', 'sales'],
  'invoices.write': ['owner', 'accounts'],
  'subsidy.write': ['owner', 'accounts', 'sales'],
  'payroll.read': ['owner', 'accounts'],
  'payroll.write': ['owner', 'accounts'],
  'expenses.write': ['owner', 'accounts', 'technician'],
  'reports.read': ['owner', 'accounts'],
  'reports.share': ['owner'],
  'catalog.write': ['owner', 'warehouse'],
  'team.manage': ['owner'],
  'settings.manage': ['owner'],
  'customers.read': ['owner', 'sales', 'technician', 'warehouse', 'support', 'accounts'],
  'customers.write': ['owner', 'sales', 'support'],
} as const satisfies Record<string, readonly Role[]>;

export type Capability = keyof typeof CAPABILITIES;

export function can(role: Role | null | undefined, cap: Capability): boolean {
  if (!role) return false;
  return (CAPABILITIES[cap] as readonly Role[]).includes(role);
}
