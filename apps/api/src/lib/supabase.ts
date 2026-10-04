import { config } from '../config.js';

/* Minimal Supabase REST client (Auth + Storage) using fetch — no SDK needed on the server.
   Only the API holds the service-role key; the browser never talks to Supabase directly. */

export class SupabaseError extends Error {
  constructor(public status: number, message: string, public body?: unknown) { super(message); }
}

async function call<T>(path: string, init: RequestInit & { key?: 'anon' | 'service'; raw?: boolean } = {}): Promise<T> {
  const { url, anonKey, serviceRoleKey } = config.supabase;
  if (!url) throw new SupabaseError(500, 'SUPABASE_URL is not set.');
  const key = init.key === 'anon' ? anonKey : serviceRoleKey;
  const headers: Record<string, string> = { apikey: key, Authorization: `Bearer ${key}`, ...(init.headers as Record<string, string> ?? {}) };
  if (init.body && typeof init.body === 'string' && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  let res: Response;
  try { res = await fetch(`${url}${path}`, { ...init, headers, signal: AbortSignal.timeout(15_000) }); }
  catch (e: any) { throw new SupabaseError(503, `Supabase is not reachable: ${e?.message ?? e}`); }
  if (init.raw) { if (!res.ok) throw new SupabaseError(res.status, `Supabase ${res.status}`); return res as unknown as T; }
  const text = await res.text();
  let body: any = null; try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!res.ok) throw new SupabaseError(res.status, body?.msg ?? body?.message ?? body?.error_description ?? body?.error ?? `Supabase ${res.status}`, body);
  return body as T;
}

/* ── Auth ── */
export interface SbUser { id: string; email: string; app_metadata?: Record<string, unknown>; banned_until?: string | null }

/** Check an email + password with Supabase Auth. Returns the auth user, or null if wrong. */
export async function sbPasswordLogin(email: string, password: string): Promise<SbUser | null> {
  try {
    const r = await call<{ user: SbUser }>('/auth/v1/token?grant_type=password', { method: 'POST', key: 'anon', body: JSON.stringify({ email, password }) });
    return r.user;
  } catch (e) {
    if (e instanceof SupabaseError && [400, 401, 422].includes(e.status)) return null;
    throw e;
  }
}
export async function sbCreateUser(email: string, password: string, appRole: string): Promise<SbUser> {
  return call<SbUser>('/auth/v1/admin/users', { method: 'POST', body: JSON.stringify({ email, password, email_confirm: true, app_metadata: { app_role: appRole } }) });
}
export async function sbUpdateUser(id: string, patch: { password?: string; email?: string; app_metadata?: Record<string, unknown>; ban_duration?: string }): Promise<SbUser> {
  return call<SbUser>(`/auth/v1/admin/users/${id}`, { method: 'PUT', body: JSON.stringify(patch) });
}
export async function sbFindUserByEmail(email: string): Promise<SbUser | null> {
  for (let page = 1; page <= 50; page++) {
    const r = await call<{ users: SbUser[] }>(`/auth/v1/admin/users?page=${page}&per_page=200`);
    const hit = r.users.find(u => u.email?.toLowerCase() === email.toLowerCase());
    if (hit) return hit;
    if (r.users.length < 200) return null;
  }
  return null;
}
/** Create the auth user, or return the existing one with that email (seeding is re-runnable). */
export async function sbEnsureUser(email: string, password: string, appRole: string): Promise<SbUser> {
  try { return await sbCreateUser(email, password, appRole); }
  catch (e) {
    if (e instanceof SupabaseError && [409, 422].includes(e.status)) {
      const u = await sbFindUserByEmail(email);
      if (u) return u;
    }
    throw e;
  }
}
/** Send the "reset your password" email (uses the Supabase project's email settings). */
export async function sbSendRecovery(email: string, redirectTo?: string): Promise<void> {
  await call('/auth/v1/recover', { method: 'POST', key: 'anon', body: JSON.stringify({ email, ...(redirectTo ? { redirect_to: redirectTo } : {}) }) });
}

/* ── Storage ── */
export async function sbEnsureBucket(bucket = config.supabase.bucket): Promise<void> {
  try { await call(`/storage/v1/bucket/${bucket}`); }
  catch (e) {
    if (!(e instanceof SupabaseError) || ![400, 404].includes(e.status)) throw e;
    await call('/storage/v1/bucket', { method: 'POST', body: JSON.stringify({ id: bucket, name: bucket, public: false, file_size_limit: 5 * 1024 * 1024, allowed_mime_types: ['image/jpeg', 'image/png', 'image/webp'] }) });
  }
}
export async function sbUpload(path: string, bytes: Buffer, mime: string, bucket = config.supabase.bucket): Promise<void> {
  await call(`/storage/v1/object/${bucket}/${path}`, { method: 'POST', body: bytes as unknown as BodyInit, headers: { 'Content-Type': mime, 'x-upsert': 'false', 'cache-control': 'max-age=31536000' } });
}
export async function sbSignedUrl(path: string, expiresIn = 300, bucket = config.supabase.bucket): Promise<string> {
  const r = await call<{ signedURL: string }>(`/storage/v1/object/sign/${bucket}/${path}`, { method: 'POST', body: JSON.stringify({ expiresIn }) });
  return `${config.supabase.url}/storage/v1${r.signedURL.startsWith('/') ? '' : '/'}${r.signedURL}`;
}
export async function sbDownload(path: string, bucket = config.supabase.bucket): Promise<Buffer> {
  const res = await call<Response>(`/storage/v1/object/${bucket}/${path}`, { raw: true });
  return Buffer.from(await res.arrayBuffer());
}
export async function sbHealth(): Promise<{ auth: boolean; storage: boolean }> {
  const ok = (p: Promise<unknown>) => p.then(() => true, () => false);
  const [auth, storage] = await Promise.all([ok(call('/auth/v1/health', { key: 'anon' })), ok(call(`/storage/v1/bucket/${config.supabase.bucket}`))]);
  return { auth, storage };
}

/** Password recovery: the person followed the emailed link; Supabase gave the browser a recovery access token. */
export async function sbRecoverPassword(accessToken: string, password: string): Promise<SbUser> {
  const { url, anonKey } = config.supabase;
  let res: Response;
  try {
    res = await fetch(`${url}/auth/v1/user`, { method: 'PUT', headers: { apikey: anonKey, Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ password }), signal: AbortSignal.timeout(15_000) });
  } catch (e: any) { throw new SupabaseError(503, `Supabase is not reachable: ${e?.message ?? e}`); }
  const body: any = await res.json().catch(() => null);
  if (!res.ok) throw new SupabaseError(res.status, body?.msg ?? body?.message ?? 'The recovery link is invalid or has expired.', body);
  return body as SbUser;
}
