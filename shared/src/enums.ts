/** Every fixed set in the product, with the words people see. The database CHECKs use the same values. */

export const ROLES = ['owner', 'sales', 'technician', 'warehouse', 'support', 'accounts'] as const;
export type Role = (typeof ROLES)[number];
export const ROLE_LABEL: Record<Role, string> = {
  owner: 'Director',
  sales: 'Sales',
  technician: 'Technician',
  warehouse: 'Warehouse',
  support: 'Support',
  accounts: 'Accounts',
};

export const LEAD_SOURCES = ['web_form', 'whatsapp', 'call', 'walk_in', 'referral'] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];
export const LEAD_SOURCE_LABEL: Record<LeadSource, string> = {
  web_form: 'Web form',
  whatsapp: 'WhatsApp',
  call: 'Phone call',
  walk_in: 'Walk-in',
  referral: 'Referral',
};

export const LEAD_STATUSES = ['new', 'contacted', 'qualified', 'survey', 'quoted', 'won', 'lost'] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];
export const LEAD_STATUS_LABEL: Record<LeadStatus, string> = {
  new: 'New',
  contacted: 'Called',
  qualified: 'Qualified',
  survey: 'Survey',
  quoted: 'Quoted',
  won: 'Won',
  lost: 'Closed',
};

export const SYSTEM_TYPES = ['on_grid', 'off_grid', 'not_sure'] as const;
export type SystemType = (typeof SYSTEM_TYPES)[number];
export const SYSTEM_TYPE_LABEL: Record<SystemType, string> = { on_grid: 'On-Grid', off_grid: 'Off-Grid', not_sure: 'Not sure yet' };

export const KIT_KINDS = ['on_grid', 'off_grid', 'panel_set', 'service'] as const;
export type KitKind = (typeof KIT_KINDS)[number];
export const KIT_KIND_LABEL: Record<KitKind, string> = {
  on_grid: 'On-Grid system',
  off_grid: 'Off-Grid system',
  panel_set: 'Solar panel set',
  service: 'Installation service',
};

export const GRID_CONNECTIONS = ['single_phase', 'three_phase', 'none'] as const;
export type GridConnection = (typeof GRID_CONNECTIONS)[number];
export const GRID_LABEL: Record<GridConnection, string> = { single_phase: 'Single phase', three_phase: 'Three phase', none: 'No grid connection' };

export const ROOF_TYPES = ['rcc', 'metal_sheet', 'tiled', 'other'] as const;
export type RoofType = (typeof ROOF_TYPES)[number];
export const ROOF_LABEL: Record<RoofType, string> = { rcc: 'RCC (concrete)', metal_sheet: 'Metal sheet', tiled: 'Tiled', other: 'Other' };

export const SHADINGS = ['none', 'partial', 'heavy'] as const;
export const SHADING_LABEL = { none: 'No shade', partial: 'Some shade', heavy: 'Heavy shade' } as const;

export const CUSTOMER_KINDS = ['home', 'business'] as const;
export type CustomerKind = (typeof CUSTOMER_KINDS)[number];

export const SURVEY_STATUSES = ['scheduled', 'submitted', 'approved', 'rejected', 'cancelled'] as const;
export type SurveyStatus = (typeof SURVEY_STATUSES)[number];
export const SURVEY_STATUS_LABEL: Record<SurveyStatus, string> = {
  scheduled: 'Scheduled',
  submitted: 'Waiting for approval',
  approved: 'Approved',
  rejected: 'Needs a revisit',
  cancelled: 'Cancelled',
};

export const STRUCTURE_TYPES = ['flush', 'elevated_low', 'elevated_high'] as const;
export const STRUCTURE_LABEL = { flush: 'Flush mount', elevated_low: 'Elevated (up to 1 m)', elevated_high: 'Elevated (above 1 m)' } as const;

export const PRODUCT_CATEGORIES = [
  'panel',
  'inverter',
  'battery',
  'charge_controller',
  'structure',
  'cable',
  'wiring_box',
  'switchgear',
  'earthing',
  'connector',
  'accessory',
  'service',
] as const;
export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];
export const CATEGORY_LABEL: Record<ProductCategory, string> = {
  panel: 'Solar panel',
  inverter: 'Inverter',
  battery: 'Battery',
  charge_controller: 'Charge controller',
  structure: 'Mounting structure',
  cable: 'Cable',
  wiring_box: 'Wiring box',
  switchgear: 'Switch / breaker',
  earthing: 'Safety earthing',
  connector: 'Connector',
  accessory: 'Accessory',
  service: 'Service',
};

export const TRACKING = ['serial', 'quantity', 'none'] as const;
export type Tracking = (typeof TRACKING)[number];
export const UOMS = ['unit', 'm', 'set', 'kit', 'job'] as const;
export type Uom = (typeof UOMS)[number];
export const UOM_LABEL: Record<Uom, string> = { unit: 'unit', m: 'm', set: 'set', kit: 'kit', job: 'job' };

export const QTY_RULES = ['fixed', 'per_kw', 'per_panel', 'cable_run'] as const;
export const QTY_RULE_LABEL = { fixed: 'Fixed', per_kw: 'Per kW', per_panel: 'Per panel', cable_run: 'Cable run (from survey)' } as const;

export const QUOTE_STATUSES = ['draft', 'sent', 'accepted', 'rejected', 'expired', 'superseded'] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];
export const QUOTE_STATUS_LABEL: Record<QuoteStatus, string> = {
  draft: 'Draft',
  sent: 'Sent',
  accepted: 'Accepted',
  rejected: 'Declined',
  expired: 'Expired',
  superseded: 'Replaced',
};

export const JOB_STATUSES = ['awaiting_advance', 'confirmed', 'packed', 'dispatched', 'delivered', 'installed', 'closed', 'cancelled'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];
export const JOB_STATUS_LABEL: Record<JobStatus, string> = {
  awaiting_advance: 'Waiting for advance',
  confirmed: 'Confirmed',
  packed: 'Packed',
  dispatched: 'On the truck',
  delivered: 'Delivered',
  installed: 'Installed',
  closed: 'Closed',
  cancelled: 'Cancelled',
};

/** The eight cells of the job strip, in order. */
export const JOB_STAGES = ['paid', 'packed', 'dispatched', 'delivered', 'installed', 'invoiced', 'subsidy', 'closed'] as const;
export type JobStage = (typeof JOB_STAGES)[number];
export const JOB_STAGE_LABEL: Record<JobStage, string> = {
  paid: 'Advance paid',
  packed: 'Packed',
  dispatched: 'Dispatched',
  delivered: 'Delivered',
  installed: 'Installed and signed',
  invoiced: 'Invoice sent',
  subsidy: 'Subsidy received',
  closed: 'Closed',
};

/** Which cells of the job strip are lit. `subsidy` is 'na' when the job has no subsidy. */
export function jobStageState(j: {
  confirmed_at?: unknown;
  packed_at?: unknown;
  dispatched_at?: unknown;
  delivered_on?: unknown;
  installed_at?: unknown;
  invoice_sent: boolean;
  subsidy_status?: string | null;
  closed_at?: unknown;
}): Record<JobStage, 'done' | 'todo' | 'na'> {
  return {
    paid: j.confirmed_at ? 'done' : 'todo',
    packed: j.packed_at ? 'done' : 'todo',
    dispatched: j.dispatched_at ? 'done' : 'todo',
    delivered: j.delivered_on ? 'done' : 'todo',
    installed: j.installed_at ? 'done' : 'todo',
    invoiced: j.invoice_sent ? 'done' : 'todo',
    subsidy: !j.subsidy_status ? 'na' : j.subsidy_status === 'disbursed' ? 'done' : 'todo',
    closed: j.closed_at ? 'done' : 'todo',
  };
}

export const PAYMENT_METHODS = ['upi', 'bank_transfer', 'cash', 'cheque', 'card'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  upi: 'UPI',
  bank_transfer: 'Bank transfer',
  cash: 'Cash',
  cheque: 'Cheque',
  card: 'Card',
};

export const PICK_STATUSES = ['waiting_stock', 'ready', 'packed', 'dispatched', 'delivered', 'cancelled'] as const;
export type PickStatus = (typeof PICK_STATUSES)[number];
export const PICK_STATUS_LABEL: Record<PickStatus, string> = {
  waiting_stock: 'Short of stock',
  ready: 'Ready to pack',
  packed: 'Packed',
  dispatched: 'On the truck',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};

export const SERIAL_STATUSES = ['in_stock', 'allocated', 'dispatched', 'installed', 'faulty', 'replaced', 'scrapped'] as const;
export type SerialStatus = (typeof SERIAL_STATUSES)[number];
export const SERIAL_STATUS_LABEL: Record<SerialStatus, string> = {
  in_stock: 'In stock',
  allocated: 'Scanned for a job',
  dispatched: 'On the truck',
  installed: 'With customer',
  faulty: 'Faulty',
  replaced: 'Replaced',
  scrapped: 'Scrapped',
};

export const VISIT_KINDS = ['survey', 'installation', 'service'] as const;
export type VisitKind = (typeof VISIT_KINDS)[number];
export const VISIT_KIND_LABEL: Record<VisitKind, string> = { survey: 'Roof survey', installation: 'Installation', service: 'Service visit' };
export const VISIT_STATUSES = ['planned', 'in_progress', 'done', 'cancelled'] as const;
export type VisitStatus = (typeof VISIT_STATUSES)[number];

export const TICKET_STATUSES = ['open', 'assigned', 'in_progress', 'resolved', 'closed'] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];
export const TICKET_STATUS_LABEL: Record<TicketStatus, string> = {
  open: 'Open',
  assigned: 'Assigned',
  in_progress: 'Being fixed',
  resolved: 'Waiting for customer',
  closed: 'Closed',
};
export const TICKET_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export type TicketPriority = (typeof TICKET_PRIORITIES)[number];
export const TICKET_PRIORITY_LABEL: Record<TicketPriority, string> = { low: 'Low', normal: 'Normal', high: 'High', urgent: 'Urgent' };
export const TICKET_CHANNELS = ['call', 'whatsapp', 'portal', 'email', 'visit'] as const;
export const TICKET_CHANNEL_LABEL = { call: 'Phone call', whatsapp: 'WhatsApp', portal: 'Customer page', email: 'Email', visit: 'Site visit' } as const;
export const COVERAGES = ['warranty', 'paid', 'goodwill'] as const;
export type Coverage = (typeof COVERAGES)[number];
export const COVERAGE_LABEL: Record<Coverage, string> = { warranty: 'Under warranty', paid: 'Billable', goodwill: 'Free (goodwill)' };
export const CONFIRM_METHODS = ['portal', 'phone', 'on_site'] as const;
export const CONFIRM_METHOD_LABEL = { portal: 'On the customer page', phone: 'On the phone', on_site: 'On site' } as const;

export const INVOICE_STATUSES = ['draft', 'sent', 'partially_paid', 'paid', 'void'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];
export const INVOICE_STATUS_LABEL: Record<InvoiceStatus, string> = {
  draft: 'To send',
  sent: 'Sent',
  partially_paid: 'Part paid',
  paid: 'Paid',
  void: 'Void',
};

export const SUBSIDY_STATUSES = ['not_started', 'documents', 'applied', 'inspection', 'approved', 'disbursed', 'rejected'] as const;
export type SubsidyStatus = (typeof SUBSIDY_STATUSES)[number];
export const SUBSIDY_STATUS_LABEL: Record<SubsidyStatus, string> = {
  not_started: 'Not started',
  documents: 'Collecting documents',
  applied: 'Applied on portal',
  inspection: 'Inspection',
  approved: 'Approved',
  disbursed: 'Money received',
  rejected: 'Rejected',
};

export const EXPENSE_CATEGORIES = ['transport', 'crane', 'food', 'permit', 'subcontract', 'misc'] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];
export const EXPENSE_LABEL: Record<ExpenseCategory, string> = {
  transport: 'Transport',
  crane: 'Crane / lifting',
  food: 'Crew food',
  permit: 'Permits and fees',
  subcontract: 'Subcontractor',
  misc: 'Other',
};

export const TIMESHEET_SOURCES = ['installation', 'service', 'survey', 'manual'] as const;
export type TimesheetSource = (typeof TIMESHEET_SOURCES)[number];
