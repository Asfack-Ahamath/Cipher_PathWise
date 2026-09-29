/* Thin fetch client. The token lives in localStorage so a phone that loses signal
   (or reloads with no signal) still knows who is signed in. */

export class ApiError extends Error {
  constructor(public status: number, message: string, public body?: any) { super(message); }
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

export type Role = 'dispatcher' | 'loader' | 'driver' | 'store_manager';
export interface User { id: number; email: string; name: string; role: Role; depot: string | null; outletId: string | null; vehicleId: string | null }

let onUnauthorized: (() => void) | null = null;
export const setUnauthorizedHandler = (f: () => void) => { onUnauthorized = f; };

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  const t = session.token();
  if (t) headers.authorization = `Bearer ${t}`;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  // "Simulate no signal" on the driver phone: behave exactly as if the network were gone
  if (store.get('pw.noSignal') === '1' && path !== '/auth/login') throw new ApiError(0, 'No signal (simulated).');
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
    if (res.status === 401 && path !== '/auth/login') onUnauthorized?.();
    throw new ApiError(res.status, body?.error ?? body?.message ?? `Request failed (${res.status})`, body);
  }
  return body as T;
}

export const post = <T = any>(path: string, body: unknown = {}) => api<T>(path, { method: 'POST', body });
export const put = <T = any>(path: string, body: unknown = {}) => api<T>(path, { method: 'PUT', body });
export const patch = <T = any>(path: string, body: unknown = {}) => api<T>(path, { method: 'PATCH', body });
export const del = <T = any>(path: string) => api<T>(path, { method: 'DELETE' });
