import bcrypt from 'bcryptjs';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { jwtVerify, SignJWT } from 'jose';
import { z } from 'zod';
import type { Role } from '@pathwise/core';
import { audit } from './audit.js';
import { nowSync } from './clock.js';
import { config } from './config.js';
import { one, pool, q } from './db.js';
import { bad, forbidden, HttpError, locked, unauthorized } from './errors.js';
import { getSettings } from './lib/settings.js';
import { sbPasswordLogin, sbRecoverPassword, sbSendRecovery, sbUpdateUser, SupabaseError } from './lib/supabase.js';

/* ──────────────────────────────────────────────────────────────────────────
   Authentication
   • Passwords are checked by the configured provider: bcrypt hashes in `users` (AUTH_PROVIDER=local,
     the default and what docker compose uses) or Supabase Auth (AUTH_PROVIDER=supabase).
   • Shared dock tablets sign in with a 4-digit PIN scoped to a depot (always checked locally).
   • The API then issues its own short-lived session token (HS256, JWT_SECRET) carrying the user id,
     role and a token version. Every request re-reads the user (cached 20 s) so disabling an account
     or resetting a password signs that person out everywhere.
   • 5 wrong passwords lock the account for 15 minutes. Login routes are also rate-limited per IP.
   ────────────────────────────────────────────────────────────────────────── */

export interface AuthUser { id: number; email: string; name: string; role: Role; depot: string | null; outletId: string | null; vehicleId: string | null; mustChangePassword: boolean }
declare module 'fastify' { interface FastifyRequest { user: AuthUser } }

const key = new TextEncoder().encode(config.jwtSecret);
const MAX_FAILS = 5, LOCK_MIN = 15;
const DUMMY_HASH = bcrypt.hashSync('timing-equaliser', 10);

export const PasswordPolicy = z.string().min(10, 'Use at least 10 characters.').max(128)
  .regex(/[A-Za-z]/, 'Include at least one letter.').regex(/\d/, 'Include at least one number.');

const USER_COLS = `id, email, name, role, depot, outlet_id, vehicle_id, is_active, must_change_password, token_version, password_hash, pin_hash, auth_user_id, failed_logins, locked_until`;
const toAuth = (u: any): AuthUser => ({ id: u.id, email: u.email, name: u.name, role: u.role, depot: u.depot, outletId: u.outlet_id, vehicleId: u.vehicle_id, mustChangePassword: u.must_change_password });

async function issue(u: any) {
  const { operations } = await getSettings();
  const hours = u.role === 'driver' ? operations.driverSessionHours : operations.sessionHours;
  const token = await new SignJWT({ role: u.role, tv: u.token_version }).setProtectedHeader({ alg: 'HS256' }).setSubject(String(u.id))
    .setIssuer('pathwise').setIssuedAt().setExpirationTime(`${Math.round(hours * 60)}m`).sign(key);
  return { token, user: toAuth(u), expiresInHours: hours };
}

async function recordFailure(u: any, ip: string) {
  const fails = (u.failed_logins ?? 0) + 1;
  const lockUntil = fails >= MAX_FAILS ? new Date(Date.now() + LOCK_MIN * 60000) : null;
  await q(`UPDATE users SET failed_logins = $2, locked_until = coalesce($3, locked_until) WHERE id = $1`, [u.id, lockUntil ? 0 : fails, lockUntil]);
  await audit(pool, u.id, lockUntil ? 'auth.locked' : 'auth.login_failed', `user:${u.id}`, { ip });
}
function assertUsable(u: any) {
  if (!u.is_active) throw forbidden('This account is disabled. Ask an administrator.');
  if (u.locked_until && new Date(u.locked_until).getTime() > Date.now()) {
    const min = Math.ceil((new Date(u.locked_until).getTime() - Date.now()) / 60000);
    throw locked(`Too many wrong passwords. Try again in ${min} minute${min === 1 ? '' : 's'}.`);
  }
}
async function succeed(u: any, ip: string, how: string) {
  await q(`UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = now() WHERE id = $1`, [u.id]);
  await audit(pool, u.id, 'auth.login', `user:${u.id}`, { ip, how });
  return issue(u);
}

export async function login(email: string, password: string, ip = '') {
  const u = await one<any>(`SELECT ${USER_COLS} FROM users WHERE lower(email) = lower($1)`, [email.trim()]);
  if (!u) { await bcrypt.compare(password, DUMMY_HASH); return null; }
  assertUsable(u);
  let ok = false;
  if (config.authProvider === 'supabase' && u.auth_user_id) {
    try { const sb = await sbPasswordLogin(u.email, password); ok = !!sb && sb.id === u.auth_user_id; }
    catch (e) { if (e instanceof SupabaseError) throw new HttpError(503, 'Sign-in service is not reachable. Try again in a minute.'); throw e; }
  } else if (u.password_hash) ok = await bcrypt.compare(password, u.password_hash);
  else await bcrypt.compare(password, DUMMY_HASH);
  if (!ok) { await recordFailure(u, ip); return null; }
  return succeed(u, ip, config.authProvider === 'supabase' && u.auth_user_id ? 'supabase' : 'password');
}

/** Shared dock tablets: a loader signs in with a 4-digit PIN for their depot. */
export async function loginWithPin(pin: string, depot: string | undefined, ip = '') {
  if (!/^\d{4,6}$/.test(pin)) return null;
  const loaders = await q<any>(`SELECT ${USER_COLS} FROM users WHERE role = 'loader' AND pin_hash IS NOT NULL AND is_active ${depot ? 'AND depot = $1' : ''}`, depot ? [depot] : []);
  for (const u of loaders) if (await bcrypt.compare(pin, u.pin_hash)) { assertUsable(u); return succeed(u, ip, 'pin'); }
  await audit(pool, null, 'auth.pin_failed', depot ? `depot:${depot}` : null, { ip });
  return null;
}

/* ── per-request ── */
const cache = new Map<number, { u: any; at: number }>();
export const forgetUser = (id: number) => cache.delete(id);
async function loadUser(id: number) {
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < 20_000) return hit.u;
  const u = await one<any>(`SELECT ${USER_COLS} FROM users WHERE id = $1`, [id]);
  cache.set(id, { u, at: Date.now() });
  return u;
}

export async function userFromToken(token: string): Promise<AuthUser> {
  let payload: any;
  try { ({ payload } = await jwtVerify(token, key, { issuer: 'pathwise' })); }
  catch { throw unauthorized('Your session has expired. Sign in again.', 'session_expired'); }
  if (payload.purpose) throw unauthorized('Sign in first.');
  const u = await loadUser(Number(payload.sub));
  if (!u || !u.is_active) throw unauthorized('This account is no longer active.', 'account_disabled');
  if (u.token_version !== payload.tv) throw unauthorized('You were signed out. Sign in again.', 'session_revoked');
  return toAuth(u);
}

const PASSWORD_FREE = new Set(['/api/me', '/api/me/password', '/api/auth/logout', '/api/clock']);
export async function authenticate(req: FastifyRequest, _reply: FastifyReply) {
  const h = req.headers.authorization;
  if (!h?.startsWith('Bearer ')) throw unauthorized();
  req.user = await userFromToken(h.slice(7));
  if (req.user.mustChangePassword && !PASSWORD_FREE.has(req.routeOptions.url ?? '')) throw forbidden('Set a new password before continuing.', 'password_change_required');
}

/** Role guard. An admin can do everything a dispatcher can. */
export const requireRole = (...roles: Role[]) => async (req: FastifyRequest, reply: FastifyReply) => {
  await authenticate(req, reply);
  const r = req.user.role;
  if (!roles.includes(r) && !(r === 'admin' && roles.includes('dispatcher'))) throw forbidden(`This needs the ${roles.map(x => x.replace('_', ' ')).join(' or ')} role.`);
};

/* ── password management ── */
export async function hashPassword(pw: string) { return bcrypt.hash(pw, 12); }

export async function changeOwnPassword(userId: number, current: string, next: string, ip = '') {
  const parsed = PasswordPolicy.safeParse(next);
  if (!parsed.success) throw bad(parsed.error.issues[0].message);
  if (current === next) throw bad('The new password must be different.');
  const u = await one<any>(`SELECT ${USER_COLS} FROM users WHERE id = $1`, [userId]);
  if (!u) throw unauthorized();
  if (config.authProvider === 'supabase' && u.auth_user_id) {
    const sb = await sbPasswordLogin(u.email, current);
    if (!sb) throw bad('Your current password is wrong.');
    await sbUpdateUser(u.auth_user_id, { password: next });
    await q(`UPDATE users SET must_change_password = false, token_version = token_version + 1 WHERE id = $1`, [userId]);
  } else {
    if (!u.password_hash || !(await bcrypt.compare(current, u.password_hash))) throw bad('Your current password is wrong.');
    await q(`UPDATE users SET password_hash = $2, must_change_password = false, token_version = token_version + 1 WHERE id = $1`, [userId, await hashPassword(next)]);
  }
  forgetUser(userId);
  await audit(pool, userId, 'user.password_changed', `user:${userId}`, { ip });
  const fresh = await one<any>(`SELECT ${USER_COLS} FROM users WHERE id = $1`, [userId]);
  return issue(fresh);
}

export async function signOutEverywhere(userId: number) {
  await q(`UPDATE users SET token_version = token_version + 1 WHERE id = $1`, [userId]);
  forgetUser(userId);
}

/* ── short-lived tickets for browser features that cannot send an Authorization header (EventSource) ── */
export async function issueTicket(u: AuthUser, purpose: 'events', seconds = 60) {
  const row = await loadUser(u.id);
  return new SignJWT({ purpose, tv: row?.token_version ?? 0 }).setProtectedHeader({ alg: 'HS256' }).setSubject(String(u.id)).setIssuer('pathwise').setIssuedAt().setExpirationTime(`${seconds}s`).sign(key);
}
export async function userFromTicket(ticket: string, purpose: 'events'): Promise<AuthUser> {
  let payload: any;
  try { ({ payload } = await jwtVerify(ticket, key, { issuer: 'pathwise' })); }
  catch { throw unauthorized('The live-update ticket expired.', 'ticket_expired'); }
  if (payload.purpose !== purpose) throw unauthorized('Wrong ticket.');
  const u = await loadUser(Number(payload.sub));
  if (!u || !u.is_active || u.token_version !== payload.tv) throw unauthorized('You were signed out. Sign in again.', 'session_revoked');
  return toAuth(u);
}

/* ── forgotten passwords ── */
/** Always answers the same way so the form cannot be used to find out which emails exist. */
export async function requestRecovery(email: string, ip = '') {
  const u = await one<any>(`SELECT id, email, auth_user_id, is_active FROM users WHERE lower(email) = lower($1)`, [email.trim()]);
  if (u?.is_active && config.authProvider === 'supabase' && u.auth_user_id) {
    try { await sbSendRecovery(u.email, config.appUrl ? `${config.appUrl}/login` : undefined); } catch { /* do not reveal */ }
  }
  await audit(pool, u?.id ?? null, 'auth.recovery_requested', u ? `user:${u.id}` : null, { ip });
  return {
    ok: true,
    message: config.authProvider === 'supabase'
      ? 'If that email belongs to an active account, a reset link is on its way. It works once and expires in an hour.'
      : 'Ask your PathWise administrator to reset your password — they will give you a temporary one.',
  };
}
/** Finish a Supabase recovery: set the new password with the token from the emailed link, then sign in. */
export async function completeRecovery(accessToken: string, password: string, ip = '') {
  const parsed = PasswordPolicy.safeParse(password);
  if (!parsed.success) throw bad(parsed.error.issues[0].message);
  if (config.authProvider !== 'supabase') throw bad('Password recovery by email is not enabled.');
  let sb;
  try { sb = await sbRecoverPassword(accessToken, password); }
  catch (e) { if (e instanceof SupabaseError) throw bad(e.status >= 500 ? 'Sign-in service is not reachable. Try again in a minute.' : 'The reset link is invalid or has expired. Ask for a new one.'); throw e; }
  const u = await one<any>(`SELECT ${USER_COLS} FROM users WHERE auth_user_id = $1`, [sb.id]);
  if (!u) throw bad('This account is not set up in PathWise. Ask an administrator.');
  assertUsable({ ...u, locked_until: null });
  await q(`UPDATE users SET must_change_password = false, failed_logins = 0, locked_until = NULL, token_version = token_version + 1 WHERE id = $1`, [u.id]);
  forgetUser(u.id);
  await audit(pool, u.id, 'user.password_recovered', `user:${u.id}`, { ip });
  const fresh = await one<any>(`SELECT ${USER_COLS} FROM users WHERE id = $1`, [u.id]);
  return succeed(fresh, ip, 'recovery');
}
