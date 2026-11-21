/** Errors the API turns into clear, structured responses: { error: { code, message, fields? } } */
export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields?: Record<string, string>,
    public data?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export const notFound = (what = 'That record') => new AppError(404, 'not_found', `${what} doesn’t exist or isn’t in this workspace.`);
export const forbidden = (msg = 'Your role can’t do this. Ask the director for access.') => new AppError(403, 'forbidden', msg);
export const conflict = (code: string, msg: string, data?: Record<string, unknown>) => new AppError(409, code, msg, undefined, data);
export const invalid = (msg: string, fields?: Record<string, string>) => new AppError(400, 'invalid', msg, fields);
export const unauthorized = (msg = 'Please sign in again.') => new AppError(401, 'unauthorized', msg);

/** Map Postgres constraint violations that users can trigger to friendly messages. */
const CONSTRAINT_MESSAGES: Record<string, [number, string, string]> = {
  visit_crew_no_double_booking: [409, 'double_booked', 'That technician is already booked at this time. Pick another slot or person.'],
  quotes_survey_approved: [409, 'survey_not_approved', 'Approve the roof survey before creating a quote.'],
  serial_scanned_before_dispatch: [409, 'serial_not_scanned', 'Every serial must be scanned before the truck leaves.'],
  users_email_uq: [409, 'email_taken', 'An account with this email already exists.'],
  customers_company_id_phone_key: [409, 'phone_taken', 'A customer with this phone number already exists.'],
  products_company_id_sku_key: [409, 'sku_taken', 'Another product already uses this SKU.'],
  kit_templates_company_id_code_key: [409, 'code_taken', 'Another kit already uses this code.'],
  serial_units_company_id_product_id_serial_key: [409, 'serial_taken', 'This serial number is already in the system.'],
  products_on_hand_check: [409, 'insufficient_stock', 'Not enough stock for this.'],
};

export function fromPg(err: unknown): AppError | null {
  const e = err as { code?: string; constraint?: string; message?: string };
  if (!e || typeof e.code !== 'string') return null;
  if (e.constraint && CONSTRAINT_MESSAGES[e.constraint]) {
    const [status, code, msg] = CONSTRAINT_MESSAGES[e.constraint]!;
    return new AppError(status, code, msg);
  }
  if (e.code === '23505') return new AppError(409, 'duplicate', 'That already exists.');
  if (e.code === '23503') return new AppError(400, 'invalid_reference', 'That refers to something that doesn’t exist in this workspace.');
  if (e.code === '23514') return new AppError(409, 'rule_broken', 'That change isn’t allowed in this state. Refresh the page and try again.');
  if (e.code === '40P01' || e.code === '40001') return new AppError(409, 'retry', 'Someone else changed this at the same moment. Try again.');
  return null;
}
