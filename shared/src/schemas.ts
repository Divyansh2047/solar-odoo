import { z } from 'zod';
import {
  COVERAGES,
  CONFIRM_METHODS,
  CUSTOMER_KINDS,
  EXPENSE_CATEGORIES,
  GRID_CONNECTIONS,
  KIT_KINDS,
  LEAD_SOURCES,
  PAYMENT_METHODS,
  PRODUCT_CATEGORIES,
  QTY_RULES,
  ROLES,
  ROOF_TYPES,
  SHADINGS,
  STRUCTURE_TYPES,
  SUBSIDY_STATUSES,
  SYSTEM_TYPES,
  TICKET_CHANNELS,
  TICKET_PRIORITIES,
  TRACKING,
  UOMS,
} from './enums.js';
import { rupeesToPaise } from './money.js';

/* ------------------------------------------------------------------ */
/* Building blocks                                                     */
/* ------------------------------------------------------------------ */

const blankToUndefined = (v: unknown) => (v === '' || v === null ? undefined : v);
const toNumber = (v: unknown) => {
  if (v === '' || v === null || v === undefined) return undefined;
  if (typeof v === 'string') {
    const t = v.trim();
    return t === '' ? undefined : Number(t);
  }
  return v;
};

/** Number field that accepts form strings and JSON numbers; empty means "missing", never 0. */
export const num = (msg: string) => z.preprocess(toNumber, z.number({ error: msg }).refine(Number.isFinite, msg));
export const int = (msg: string) => z.preprocess(toNumber, z.number({ error: msg }).int(msg));

/** Booleans from JSON or form selects ('true' / 'false'). */
export const bool = (msg: string) => z.preprocess((v) => (v === 'true' ? true : v === 'false' ? false : v), z.boolean({ error: msg }));

export const id = z.preprocess(toNumber, z.number({ error: 'Choose an item' }).int().positive('Choose an item'));
export const optionalId = z.preprocess(blankToUndefined, id.optional());

export const personName = z
  .string({ error: 'Enter a name' })
  .trim()
  .min(2, 'Enter at least 2 characters')
  .max(80, 'Keep it under 80 characters')
  .regex(/^[\p{L}\p{M}][\p{L}\p{M}\s.'-]*$/u, 'Use letters, spaces, dots, apostrophes or hyphens');

export const companyName = z.string({ error: 'Enter the company name' }).trim().min(2, 'Enter at least 2 characters').max(100, 'Keep it under 100 characters');

/** Indian mobile number. Accepts "98250 12345", "+91-9825012345", "09825012345"; stores "+919825012345". */
export const phone = z
  .string({ error: 'Enter a mobile number' })
  .trim()
  .transform((v) => v.replace(/[\s()-]/g, ''))
  .transform((v) => v.replace(/^(\+91|0091|91(?=\d{10}$)|0(?=\d{10}$))/, ''))
  .refine((v) => /^[6-9]\d{9}$/.test(v), 'Enter a 10-digit Indian mobile number starting with 6, 7, 8 or 9')
  .transform((v) => `+91${v}`);

export const optionalPhone = z.preprocess(blankToUndefined, phone.optional());

export const email = z
  .string({ error: 'Enter an email address' })
  .trim()
  .toLowerCase()
  .max(254, 'That email is too long')
  .pipe(z.email('Enter a valid email address, like name@example.com'));

export const optionalEmail = z.preprocess(blankToUndefined, email.optional());

export const pincode = z
  .string({ error: 'Enter the PIN code' })
  .trim()
  .regex(/^[1-9]\d{5}$/, 'PIN codes have 6 digits and donâ€™t start with 0');

export const address = z.string({ error: 'Enter the address' }).trim().min(8, 'Add the house number, street and area').max(240, 'Keep the address under 240 characters');
export const city = z.string({ error: 'Enter the city' }).trim().min(2, 'Enter the city').max(60, 'Keep it under 60 characters');

export const gstin = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, 'A GSTIN has 15 characters, like 24ABCDE1234F1Z5');
export const optionalGstin = z.preprocess(blankToUndefined, gstin.optional());

export const password = z
  .string({ error: 'Enter a password' })
  .min(10, 'Use at least 10 characters')
  .max(128, 'Use at most 128 characters')
  .refine((v) => /[A-Za-z]/.test(v) && /\d/.test(v), 'Use at least one letter and one number')
  .refine((v) => !/^(.)\1+$/.test(v), 'Donâ€™t repeat a single character');

export const otpCode = z.string({ error: 'Enter the 6-digit code' }).trim().regex(/^\d{6}$/, 'The code has 6 digits');

/** Serial numbers: uppercase letters, digits and - / . _ ; 4â€“40 characters. */
export const serial = z
  .string({ error: 'Enter or scan a serial number' })
  .trim()
  .toUpperCase()
  .transform((v) => v.replace(/\s+/g, ''))
  .refine((v) => /^[A-Z0-9][A-Z0-9\-/._]{3,39}$/.test(v), 'Serials have 4â€“40 letters or digits (and - / . _)');

export const isoDate = z.iso.date('Pick a date');
export const isoDateTime = z.iso.datetime({ offset: true, error: 'Pick a date and time' });
/**
 * For browser forms: a <input type="datetime-local"> value ("2026-11-21T09:30", the person's own
 * clock) turned into an ISO instant. Use only in the browser, where local time is the user's.
 */
export const localDateTime = z
  .string({ error: 'Pick a date and time' })
  .min(1, 'Pick a date and time')
  .refine((v) => !Number.isNaN(Date.parse(v)), 'Pick a date and time')
  .transform((v) => new Date(v).toISOString());

export const paise = (msg = 'Enter an amount') => int(msg).pipe(z.number().min(0, 'Amounts canâ€™t be negative').max(1_000_000_000_00, 'That amount is too large'));
export const positivePaise = (msg = 'Enter an amount') => int(msg).pipe(z.number().min(1, 'Enter an amount above â‚¹0').max(1_000_000_000_00, 'That amount is too large'));

/** A rupee amount typed in a form ("1,50,000.50") â†’ paise. */
export const rupees = (msg = 'Enter an amount in rupees') =>
  z
    .union([z.string(), z.number()], { error: msg })
    .transform((v, ctx) => {
      const p = rupeesToPaise(v);
      if (p === null) {
        ctx.addIssue({ code: 'custom', message: 'Use digits, with up to 2 decimals' });
        return z.NEVER;
      }
      return p;
    });

export const qty = num('Enter a quantity').pipe(z.number().gt(0, 'Quantity must be above 0').max(100_000, 'That quantity is too large')).refine(
  (v) => Math.abs(Math.round(v * 1000) - v * 1000) < 1e-6,
  'Use at most 3 decimals',
);

export const capacityKw = num('Enter the size in kW').pipe(z.number().min(0.5, 'At least 0.5 kW').max(100, 'Up to 100 kW'));
export const packageKw = num('Choose a size').pipe(z.number().int('Packages come in whole kW').min(1, 'Packages start at 1 kW').max(5, 'Packages go up to 5 kW'));

const note = (max = 2000) => z.preprocess(blankToUndefined, z.string().trim().max(max, `Keep it under ${max} characters`).optional());

/* ------------------------------------------------------------------ */
/* Accounts                                                            */
/* ------------------------------------------------------------------ */

export const signupSchema = z
  .object({
    companyName,
    name: personName,
    email,
    phone: optionalPhone,
    password,
    confirmPassword: z.string({ error: 'Type the password again' }),
  })
  .refine((v) => v.password === v.confirmPassword, { path: ['confirmPassword'], message: 'The passwords donâ€™t match' });

export const loginSchema = z.object({
  email: z.string({ error: 'Enter your email' }).trim().toLowerCase().min(3, 'Enter your email'),
  password: z.string({ error: 'Enter your password' }).min(1, 'Enter your password').max(128),
});

export const verifyEmailSchema = z.object({ email, code: otpCode });
export const resendSchema = z.object({ email });
export const forgotSchema = z.object({ email });
export const resetSchema = z
  .object({
    email,
    code: otpCode,
    password,
    confirmPassword: z.string({ error: 'Type the password again' }),
  })
  .refine((v) => v.password === v.confirmPassword, { path: ['confirmPassword'], message: 'The passwords donâ€™t match' });

export const acceptInviteSchema = z
  .object({
    token: z.string().min(20).max(200),
    password,
    confirmPassword: z.string({ error: 'Type the password again' }),
  })
  .refine((v) => v.password === v.confirmPassword, { path: ['confirmPassword'], message: 'The passwords donâ€™t match' });

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password'),
    password,
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, { path: ['confirmPassword'], message: 'The passwords donâ€™t match' });

export const inviteSchema = z.object({
  name: personName,
  email,
  phone: optionalPhone,
  role: z.enum(ROLES, { error: 'Choose a role' }),
  hourlyCostPaise: z.preprocess(blankToUndefined, paise('Enter the hourly cost').optional()),
});

export const updateMemberSchema = z.object({
  role: z.enum(ROLES).optional(),
  hourlyCostPaise: paise().optional(),
  active: z.boolean().optional(),
  phone: optionalPhone,
});

export const profileSchema = z.object({ name: personName, phone: optionalPhone });

/* ------------------------------------------------------------------ */
/* Enquiries                                                           */
/* ------------------------------------------------------------------ */

const enquiryCore = {
  name: personName,
  phone,
  email: optionalEmail,
  address,
  city,
  pincode,
  customerKind: z.enum(CUSTOMER_KINDS, { error: 'Is this for a home or a business?' }),
  systemType: z.enum(SYSTEM_TYPES, { error: 'Choose a system type' }),
  requestedKw: z.preprocess(blankToUndefined, capacityKw.optional()),
  wantsSubsidy: z.boolean().default(false),
  monthlyBillRupees: z.preprocess(
    toNumber,
    z.number().int('Round to whole rupees').min(100, 'At least â‚¹100').max(10_00_000, 'Up to â‚¹10,00,000').optional(),
  ),
  message: note(1000),
};

/** Public web form (no account). `website` is a honeypot that real people never fill. */
export const publicEnquirySchema = z.object({
  ...enquiryCore,
  consent: z.literal(true, { error: 'Please agree so we can call you back' }),
  website: z.string().max(0, 'Leave this empty').optional(),
});

/** Staff logging an enquiry that arrived on WhatsApp, a call or a walk-in. */
export const leadCreateSchema = z.object({
  ...enquiryCore,
  source: z.enum(LEAD_SOURCES, { error: 'Where did this enquiry come from?' }),
  assignedTo: optionalId,
});

export const LEAD_CLOSE_REASONS = ['not_interested', 'too_expensive', 'roof_not_suitable', 'grid_not_suitable', 'chose_competitor', 'unreachable', 'duplicate', 'other'] as const;
export const LEAD_CLOSE_LABEL: Record<(typeof LEAD_CLOSE_REASONS)[number], string> = {
  not_interested: 'Not interested any more',
  too_expensive: 'Price too high',
  roof_not_suitable: 'Roof not suitable',
  grid_not_suitable: 'Grid connection not suitable',
  chose_competitor: 'Chose another company',
  unreachable: 'Couldnâ€™t reach them (5+ tries)',
  duplicate: 'Duplicate enquiry',
  other: 'Other',
};

export const leadCloseSchema = z
  .object({ reason: z.enum(LEAD_CLOSE_REASONS, { error: 'Choose a reason' }), note: note(500) })
  .refine((v) => v.reason !== 'other' || (v.note && v.note.length >= 5), { path: ['note'], message: 'Say why in a few words' });

export const leadAssignSchema = z.object({ assignedTo: id });

export const activitySchema = z.object({
  kind: z.enum(['note', 'call', 'whatsapp']),
  body: z.string({ error: 'Write a note' }).trim().min(2, 'Write a note').max(2000, 'Keep it under 2000 characters'),
});

export const qualificationSchema = z
  .object({
    roofAreaSqft: int('Enter the shadow-free roof area').pipe(z.number().min(20, 'At least 20 sq ft').max(50_000, 'Up to 50,000 sq ft')),
    monthlyBillRupees: int('Enter the monthly bill').pipe(z.number().min(100, 'At least â‚¹100').max(10_00_000, 'Up to â‚¹10,00,000')),
    gridConnection: z.enum(GRID_CONNECTIONS, { error: 'Choose the grid connection' }),
    sanctionedLoadKw: z.preprocess(toNumber, z.number().min(0.5, 'At least 0.5 kW').max(500, 'Up to 500 kW').optional()),
    roofType: z.enum(ROOF_TYPES, { error: 'Choose the roof type' }),
    shading: z.enum(SHADINGS, { error: 'Choose how much shade' }),
    systemType: z.enum(SYSTEM_TYPES),
    gridSuitable: bool('Is the grid connection suitable?'),
    outcome: z.enum(['qualified', 'not_suitable'], { error: 'Does it look good?' }),
    note: note(1000),
  })
  .refine((v) => v.outcome !== 'not_suitable' || (v.note && v.note.length >= 5), { path: ['note'], message: 'Say why itâ€™s not suitable' })
  .refine((v) => v.outcome !== 'qualified' || v.systemType === 'off_grid' || v.gridSuitable, {
    path: ['gridSuitable'],
    message: 'On-Grid needs a suitable grid connection. Choose Off-Grid or mark not suitable.',
  });

/* ------------------------------------------------------------------ */
/* Surveys                                                             */
/* ------------------------------------------------------------------ */

export const surveyScheduleSchema = z.object({
  leadId: id,
  technicianId: id,
  startsAt: isoDateTime,
  durationMinutes: int('Enter the visit length').pipe(z.number().min(30, 'At least 30 minutes').max(480, 'Up to 8 hours')),
  notes: note(500),
});

export const surveyRescheduleSchema = surveyScheduleSchema.omit({ leadId: true });

export const surveySubmitSchema = z.object({
  azimuthDeg: int('Enter the roof direction').pipe(z.number().min(0, '0â€“359Â°').max(359, '0â€“359Â°')),
  tiltDeg: num('Enter the tilt').pipe(z.number().min(0, '0â€“60Â°').max(60, '0â€“60Â°')),
  usableAreaSqft: int('Enter the usable roof area').pipe(z.number().min(20, 'At least 20 sq ft').max(50_000, 'Up to 50,000 sq ft')),
  cableDistanceM: num('Enter the cable distance').pipe(z.number().min(1, 'At least 1 m').max(200, 'Up to 200 m')),
  structureType: z.enum(STRUCTURE_TYPES, { error: 'Choose the structure' }),
  roofType: z.enum(ROOF_TYPES, { error: 'Choose the roof type' }),
  shading: z.enum(SHADINGS, { error: 'Choose how much shade' }),
  earthingPossible: bool('Can earthing pits be dug?'),
  recommendedKw: packageKw,
  shadingNotes: note(500),
  notes: note(1000),
  photoIds: z.array(id).min(1, 'Add at least one roof photo').max(12, 'Up to 12 photos'),
});

export const surveyReviewSchema = z
  .object({ decision: z.enum(['approve', 'reject']), note: note(500) })
  .refine((v) => v.decision === 'approve' || (v.note && v.note.length >= 5), { path: ['note'], message: 'Tell the technician what to recheck' });

/* ------------------------------------------------------------------ */
/* Catalogue and kits                                                  */
/* ------------------------------------------------------------------ */

export const GST_RATES_BP = [0, 500, 1200, 1800, 2800] as const;

export const productSchema = z
  .object({
    sku: z.string({ error: 'Enter a SKU' }).trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9-]{1,23}$/, 'Use 2â€“24 letters, digits or hyphens'),
    name: z.string({ error: 'Enter a name' }).trim().min(3, 'Enter at least 3 characters').max(120, 'Keep it under 120 characters'),
    category: z.enum(PRODUCT_CATEGORIES, { error: 'Choose a category' }),
    tracking: z.enum(TRACKING, { error: 'Choose how itâ€™s tracked' }),
    uom: z.enum(UOMS, { error: 'Choose a unit' }),
    unitCostPaise: paise('Enter the cost'),
    salePricePaise: paise('Enter the price'),
    gstRateBp: int('Choose a GST rate').refine((v) => (GST_RATES_BP as readonly number[]).includes(v), 'Choose 0, 5, 12, 18 or 28%'),
    warrantyMonths: z.preprocess(toNumber, z.number().int().min(1, 'At least 1 month').max(360, 'Up to 30 years').optional()),
    capacityW: z.preprocess(toNumber, z.number().int().min(1).max(1_000_000).optional()),
    hsn: z.preprocess(blankToUndefined, z.string().trim().regex(/^\d{4,8}$/, 'HSN/SAC codes have 4â€“8 digits').optional()),
    reorderLevel: z.preprocess(toNumber, z.number().min(0).max(100_000).optional()),
  })
  .refine((v) => v.tracking !== 'serial' || !!v.warrantyMonths, { path: ['warrantyMonths'], message: 'Serial-tracked items need a warranty length' })
  .refine((v) => v.tracking !== 'serial' || v.uom === 'unit', { path: ['uom'], message: 'Serial-tracked items are counted in units' })
  .refine((v) => (v.category === 'service') === (v.tracking === 'none'), { path: ['tracking'], message: 'Services arenâ€™t stocked; stocked items arenâ€™t services' });

export const kitLineSchema = z.object({
  productId: id,
  qtyRule: z.enum(QTY_RULES),
  qty: qty,
});

export const kitTemplateSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9-]{1,15}$/, 'Use 2â€“16 letters, digits or hyphens'),
  name: z.string().trim().min(3, 'Enter at least 3 characters').max(80),
  kind: z.enum(KIT_KINDS),
  capacityKw: z.preprocess(toNumber, z.number().min(0.5).max(100).optional()),
  description: note(500),
  lines: z.array(kitLineSchema).min(1, 'Add at least one part').max(60, 'Up to 60 lines'),
});

/* ------------------------------------------------------------------ */
/* Quotes                                                              */
/* ------------------------------------------------------------------ */

export const quoteCreateSchema = z.object({
  leadId: id,
  templateId: id,
  /** Only for panel sets and installation-only quotes, which are sized per job. */
  capacityKw: z.preprocess(toNumber, packageKw.optional()),
  discountPaise: z.preprocess(toNumber, paise('Enter a discount').optional()),
  advancePercent: z.preprocess(toNumber, z.number().int().min(0, '0â€“100%').max(100, '0â€“100%').optional()),
  notes: note(1000),
});

export const quoteLineSchema = z.object({
  productId: id,
  description: note(160),
  qty,
  unitPricePaise: paise('Enter the price'),
});

export const quoteUpdateSchema = z.object({
  lines: z.array(quoteLineSchema).min(1, 'A quote needs at least one line').max(80),
  discountPaise: paise('Enter a discount'),
  advancePercent: int('Enter the advance').pipe(z.number().min(0, '0â€“100%').max(100, '0â€“100%')),
  validUntil: isoDate,
  notes: note(1000),
});

export const quoteAcceptSchema = z.object({
  name: personName,
  agree: z.literal(true, { error: 'Tick the box to accept the quote' }),
});

export const quoteDeclineSchema = z.object({ reason: z.string().trim().min(3, 'Tell us why in a few words').max(500) });

/* ------------------------------------------------------------------ */
/* Jobs, payments, schedule                                            */
/* ------------------------------------------------------------------ */

export const paymentSchema = z
  .object({
    amountPaise: positivePaise(),
    method: z.enum(PAYMENT_METHODS, { error: 'Choose how it was paid' }),
    reference: z.preprocess(blankToUndefined, z.string().trim().max(60).optional()),
    receivedOn: isoDate,
    note: note(300),
  })
  .refine((v) => !['bank_transfer', 'cheque'].includes(v.method) || (v.reference && v.reference.length >= 4), {
    path: ['reference'],
    message: 'Add the UTR or cheque number',
  });

export const jobCancelSchema = z.object({ reason: z.string().trim().min(5, 'Say why the job is cancelled').max(500) });

export const visitSchema = z
  .object({
    startsAt: isoDateTime,
    endsAt: isoDateTime,
    technicianIds: z.array(id).min(1, 'Choose at least one technician').max(6, 'Up to 6 people per visit'),
    notes: note(500),
  })
  .refine((v) => new Date(v.endsAt) > new Date(v.startsAt), { path: ['endsAt'], message: 'The visit must end after it starts' })
  .refine((v) => new Date(v.endsAt).getTime() - new Date(v.startsAt).getTime() <= 14 * 3600_000, { path: ['endsAt'], message: 'A visit can last at most 14 hours' });

/* ------------------------------------------------------------------ */
/* Warehouse                                                           */
/* ------------------------------------------------------------------ */

export const purchaseLineSchema = z.object({
  productId: id,
  qty,
  unitCostPaise: paise('Enter the unit cost'),
  serials: z.array(serial).max(1000).optional(),
});

export const purchaseSchema = z
  .object({
    supplierName: z.string({ error: 'Enter the supplier' }).trim().min(2, 'Enter the supplier').max(100),
    supplierInvoice: z.preprocess(blankToUndefined, z.string().trim().max(40).optional()),
    receivedOn: isoDate,
    lines: z.array(purchaseLineSchema).min(1, 'Add at least one line').max(100),
    notes: note(500),
  })
  .superRefine((v, ctx) => {
    const all = v.lines.flatMap((l) => l.serials ?? []);
    const seen = new Set<string>();
    for (const s of all) {
      if (seen.has(s)) ctx.addIssue({ code: 'custom', path: ['lines'], message: `Serial ${s} is listed twice` });
      seen.add(s);
    }
  });

export const scanSchema = z.object({ serial });
export const unscanSchema = z.object({ serialUnitId: id });

export const vehicleNo = z
  .string({ error: 'Enter the vehicle number' })
  .trim()
  .toUpperCase()
  .transform((v) => v.replace(/[\s-]/g, ''))
  .refine((v) => /^[A-Z]{2}\d{1,2}[A-Z]{0,3}\d{4}$/.test(v) || /^\d{2}BH\d{4}[A-Z]{1,2}$/.test(v), 'Use the format GJ01AB1234');

export const dispatchSchema = z.object({
  vehicleNo,
  driverName: personName,
  driverPhone: optionalPhone,
});

export const deliverSchema = z.object({
  deliveredOn: isoDate,
  receivedBy: personName,
});

export const stockAdjustSchema = z.object({
  productId: id,
  countedQty: num('Enter the counted quantity').pipe(z.number().min(0, 'Canâ€™t be negative').max(100_000)),
  reason: z.string().trim().min(3, 'Say why').max(200),
});

/* ------------------------------------------------------------------ */
/* On the roof                                                         */
/* ------------------------------------------------------------------ */

export const installReportSchema = z
  .object({
    startedAt: isoDateTime,
    finishedAt: isoDateTime,
    confirmedKw: num('Confirm the system size').pipe(z.number().min(0.5).max(100)),
    sizeMismatchReason: note(300),
    generationKw: num('Enter the test reading').pipe(z.number().gt(0, 'Power must be above 0 kW').max(100, 'That reading is too high')),
    checklist: z.object({
      structure: z.literal(true, { error: 'Confirm the stands are mounted' }),
      panels: z.literal(true, { error: 'Confirm the panels are laid' }),
      wiring: z.literal(true, { error: 'Confirm the boxes are connected' }),
      earthing: z.literal(true, { error: 'Confirm the earthing is finished' }),
      generation: z.literal(true, { error: 'Confirm power is being generated' }),
    }),
    photoIds: z.array(id).min(2, 'Add at least 2 photos of the finished roof').max(12, 'Up to 12 photos'),
    signatureFileId: id,
    signedByName: personName,
    crewIds: z.array(id).min(1, 'Who was on the roof?').max(8),
    notes: note(1000),
  })
  .refine((v) => new Date(v.finishedAt) > new Date(v.startedAt), { path: ['finishedAt'], message: 'Finish must be after start' })
  .refine((v) => new Date(v.finishedAt).getTime() - new Date(v.startedAt).getTime() <= 16 * 3600_000, {
    path: ['finishedAt'],
    message: 'A single dayâ€™s work canâ€™t be longer than 16 hours',
  })
  .refine((v) => new Date(v.finishedAt).getTime() <= Date.now() + 10 * 60_000, { path: ['finishedAt'], message: 'Finish time canâ€™t be in the future' });

/* ------------------------------------------------------------------ */
/* Service                                                             */
/* ------------------------------------------------------------------ */

export const ticketCreateSchema = z.object({
  customerId: id,
  serialUnitId: optionalId,
  channel: z.enum(TICKET_CHANNELS, { error: 'How did they contact us?' }),
  faultCode: z.preprocess(blankToUndefined, z.string().trim().toUpperCase().max(24, 'Up to 24 characters').optional()),
  description: z.string({ error: 'Describe the problem' }).trim().min(5, 'Describe the problem in a few words').max(2000),
  priority: z.enum(TICKET_PRIORITIES),
});

export const portalTicketSchema = z.object({
  serialUnitId: optionalId,
  description: z.string({ error: 'Describe the problem' }).trim().min(5, 'Describe the problem in a few words').max(2000),
  phone,
});

export const ticketAssignSchema = z.object({ technicianId: id });

export const ticketPartSchema = z
  .object({
    productId: id,
    qty,
    /** serial of the faulty unit being swapped out (must belong to this customer) */
    replacesSerialUnitId: optionalId,
    /** serial of the new unit fitted (must be in stock) */
    newSerial: z.preprocess(blankToUndefined, serial.optional()),
  })
  .refine((v) => !v.replacesSerialUnitId || !!v.newSerial, { path: ['newSerial'], message: 'Scan the replacement unitâ€™s serial' });

export const ticketResolveSchema = z.object({
  resolution: z.string({ error: 'Say what was done' }).trim().min(5, 'Say what was done').max(2000),
  parts: z.array(ticketPartSchema).max(20),
  labourHours: num('Enter the labour hours').pipe(z.number().min(0, 'Canâ€™t be negative').max(24, 'Up to 24 hours')),
  coverage: z.enum(COVERAGES).optional(),
});

export const ticketConfirmSchema = z.object({
  method: z.enum(CONFIRM_METHODS),
  note: note(500),
});

export const ticketReopenSchema = z.object({ reason: z.string().trim().min(5, 'Say whatâ€™s still wrong').max(1000) });

/* ------------------------------------------------------------------ */
/* Money                                                               */
/* ------------------------------------------------------------------ */

export const invoiceVoidSchema = z.object({ reason: z.string().trim().min(5, 'Say why').max(300) });

export const subsidyUpdateSchema = z.object({
  status: z.enum(SUBSIDY_STATUSES),
  applicationNo: z.preprocess(blankToUndefined, z.string().trim().max(40).optional()),
  docsBill: z.boolean(),
  docsId: z.boolean(),
  docsBank: z.boolean(),
  docsPhoto: z.boolean(),
  disbursedPaise: z.preprocess(toNumber, paise().optional()),
  note: note(500),
});

export const expenseSchema = z.object({
  jobId: id,
  category: z.enum(EXPENSE_CATEGORIES, { error: 'Choose a category' }),
  amountPaise: positivePaise(),
  spentOn: isoDate,
  note: note(300),
});

export const timesheetSchema = z.object({
  technicianId: id,
  jobId: optionalId,
  ticketId: optionalId,
  workDate: isoDate,
  hours: num('Enter the hours').pipe(z.number().min(0.25, 'At least 15 minutes').max(16, 'Up to 16 hours')),
  note: note(300),
});

export const payrunSchema = z
  .object({ periodStart: isoDate, periodEnd: isoDate })
  .refine((v) => v.periodEnd >= v.periodStart, { path: ['periodEnd'], message: 'The end must be on or after the start' });

export const shareLinkSchema = z.object({
  period: z.enum(['today', 'week', 'month']),
  expiresInDays: int('Choose how long').pipe(z.number().min(1).max(30)),
});

export const settingsSchema = z.object({
  name: companyName,
  phone: optionalPhone,
  email: optionalEmail,
  address: z.preprocess(blankToUndefined, address.optional()),
  gstin: optionalGstin,
  advancePercent: int('Enter the advance').pipe(z.number().min(0, '0â€“100%').max(100, '0â€“100%')),
  labourRatePaise: paise('Enter the labour rate'),
  slaFirstCallMinutes: int('Enter minutes').pipe(z.number().min(15, 'At least 15 minutes').max(2880, 'Up to 2 days')),
  quoteValidityDays: int('Enter days').pipe(z.number().min(1, 'At least 1 day').max(90, 'Up to 90 days')),
  subsidyEnabled: z.boolean(),
  subsidySlab1PerKwPaise: paise(),
  subsidySlab2PerKwPaise: paise(),
  subsidyCapPaise: paise(),
});

export type SignupInput = z.infer<typeof signupSchema>;
export type PublicEnquiryInput = z.infer<typeof publicEnquirySchema>;
export type LeadCreateInput = z.infer<typeof leadCreateSchema>;
export type QualificationInput = z.infer<typeof qualificationSchema>;
export type SurveySubmitInput = z.infer<typeof surveySubmitSchema>;
export type InstallReportInput = z.infer<typeof installReportSchema>;
export type TicketResolveInput = z.infer<typeof ticketResolveSchema>;
export type PurchaseInput = z.infer<typeof purchaseSchema>;
