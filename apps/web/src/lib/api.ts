/* Thin fetch client. The token lives in localStorage so a phone that loses signal
   (or reloads with no signal) still knows who is signed in. */

export class ApiError extends Error {
  constructor(public status: number, message: string, public body?: any) { super(message); }
  get code(): string | undefined { return this.body?.code; }
  /** Per-field messages from the server's validation, e.g. { 'lines.0.units': 'Number must be greater than 0' } */
  get fields(): Record<string, string> { return Object.fromEntries((Array.isArray(this.body?.details) ? this.body.details : []).filter((d: any) => d?.field).map((d: any) => [d.field, d.message])); }
}

const TOKEN_KEY = 'pw.token';
const USER_KEY = 'pw.user';

export const store = {
  get(key: string): string | null { try { return localStorage.getItem(key); } catch { return null; } },
  set(key: string, v: string | null) { try { v === null ? localStorage.removeItem(key) : localStorage.setItem(key, v); } catch { /* private mode */ } },
  json<T>(key: string, fallback: T): T { const s = store.get(key); if (!s) return fallback; try { return JSON.parse(s) as T; } catch { return fallback; } },
};

export const session = {
  token: () => store.get(TOKEN_KEY),
  user: () => store.json<User | null>(USER_KEY, null),
  save(token: string, user: User) { store.set(TOKEN_KEY, token); store.set(USER_KEY, JSON.stringify(user)); },
  clear() { store.set(TOKEN_KEY, null); store.set(USER_KEY, null); store.set('pw.noSignal', null); },
};

export type Role = 'admin' | 'dispatcher' | 'loader' | 'driver' | 'store_manager';
export interface User { id: number; email: string; name: string; role: Role; depot: string | null; outletId: string | null; vehicleId: string | null; mustChangePassword?: boolean }

let onUnauthorized: ((code?: string) => void) | null = null;
let onPasswordRequired: (() => void) | null = null;
export const setUnauthorizedHandler = (f: (code?: string) => void) => { onUnauthorized = f; };
export const setPasswordRequiredHandler = (f: () => void) => { onPasswordRequired = f; };
const PUBLIC = ['/auth/login', '/auth/pin', '/auth/forgot', '/auth/recover'];

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  const t = session.token();
  if (t) headers.authorization = `Bearer ${t}`;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  // "Simulate no signal" on the driver phone: behave exactly as if the network were gone
  if (store.get('pw.noSignal') === '1' && !PUBLIC.includes(path)) throw new ApiError(0, 'No signal (simulated).');
  let res: Response;
  try {
    res = await fetch(`/api${path}`, { method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'), headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined, signal: opts.signal });
  } catch (e: any) {
    if (e?.name === 'AbortError') throw e;
    throw new ApiError(0, 'No connection to the server.');
  }
  const text = await res.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!res.ok) {
    if (res.status === 401 && !PUBLIC.includes(path)) onUnauthorized?.(body?.code);
    if (res.status === 403 && body?.code === 'password_change_required') onPasswordRequired?.();
    if (res.status === 429) throw new ApiError(429, body?.error ?? 'Too many requests. Wait a minute and try again.', body);
    throw new ApiError(res.status, body?.error ?? body?.message ?? `Request failed (${res.status})`, body);
  }
  return body as T;
}

export const post = <T = any>(path: string, body: unknown = {}) => api<T>(path, { method: 'POST', body });
export const put = <T = any>(path: string, body: unknown = {}) => api<T>(path, { method: 'PUT', body });
export const patch = <T = any>(path: string, body: unknown = {}) => api<T>(path, { method: 'PATCH', body });
export const del = <T = any>(path: string, body?: unknown) => api<T>(path, { method: 'DELETE', body });

/** Download a protected file (CSV export, proof photo) with the session token and return a blob URL. */
export async function fetchBlob(path: string): Promise<{ url: string; type: string; name: string | null }> {
  const t = session.token();
  let res: Response;
  try { res = await fetch(path.startsWith('/api/') ? path : `/api${path}`, { headers: t ? { authorization: `Bearer ${t}` } : {} }); }
  catch { throw new ApiError(0, 'No connection to the server.'); }
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    if (res.status === 401) onUnauthorized?.(body?.code);
    throw new ApiError(res.status, body?.error ?? `Could not open the file (${res.status}).`, body);
  }
  const blob = await res.blob();
  const cd = res.headers.get('content-disposition') ?? '';
  return { url: URL.createObjectURL(blob), type: blob.type, name: /filename="?([^"]+)"?/.exec(cd)?.[1] ?? null };
}
export async function download(path: string, fallbackName: string) {
  const f = await fetchBlob(path);
  const a = document.createElement('a');
  a.href = f.url; a.download = f.name ?? fallbackName; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(f.url), 10_000);
}
