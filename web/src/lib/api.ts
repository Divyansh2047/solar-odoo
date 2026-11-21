/** One way to talk to the server. Errors become ApiError with field-level messages. */

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields: Record<string, string> = {},
    public data: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

let onSignedOut: (() => void) | null = null;
export const setSignedOutHandler = (fn: () => void) => {
  onSignedOut = fn;
};

type Body = Record<string, unknown> | unknown[] | undefined;

async function request<T>(method: string, url: string, body?: Body | Blob, headers: Record<string, string> = {}): Promise<T> {
  const isBlob = body instanceof Blob;
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        ...(method !== 'GET' ? { 'X-Requested-With': 'arka' } : {}),
        ...(body !== undefined && !isBlob ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : isBlob ? body : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'offline', 'Can’t reach Arka. Check your connection and try again.');
  }
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON */
  }
  if (!res.ok) {
    const e = (json as { error?: { code?: string; message?: string; fields?: Record<string, string> } } | null)?.error;
    if (res.status === 401 && onSignedOut) onSignedOut();
    const { code, message, fields, ...rest } = (e ?? {}) as Record<string, unknown>;
    throw new ApiError(res.status, String(code ?? 'error'), String(message ?? `Request failed (${res.status}).`), (fields as Record<string, string>) ?? {}, rest);
  }
  return json as T;
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T = { ok: true }>(url: string, body: Body = {}) => request<T>('POST', url, body),
  put: <T = { ok: true }>(url: string, body: Body = {}) => request<T>('PUT', url, body),
  patch: <T = { ok: true }>(url: string, body: Body = {}) => request<T>('PATCH', url, body),
  upload: <T>(url: string, blob: Blob) => request<T>('POST', url, blob, { 'Content-Type': blob.type }),
};

/** Build a query string, skipping empty values. */
export function qs(params: Record<string, string | number | boolean | null | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '' && v !== false) p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}
