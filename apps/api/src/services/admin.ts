import { randomInt } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { FORECAST_HORIZON } from '@pathwise/core';
import { audit } from '../audit.js';
import { forgetUser, hashPassword, PasswordPolicy, type AuthUser } from '../auth.js';
import { config } from '../config.js';
import { one, pool, q, tx } from '../db.js';
import { bad, conflict, HttpError, notFound } from '../errors.js';
import { BCRYPT_COST } from '../lib/constants.js';
import { getSettings, OperationsSchema, RulesSchema, saveSettings } from '../lib/settings.js';
import { sbCreateUser, sbFindUserByEmail, sbHealth, sbSendRecovery, sbUpdateUser, SupabaseError } from '../lib/supabase.js';
import { parseCsv } from '../seed/datasets.js';
import { invalidateConditions } from './network.js';

/* ──────────────────────────────────────────────────────────────────────────
   Administration: people, fleet, outlets, settings, data imports, audit log
   and system health. Only the admin role reaches these (routes/admin.ts).
   ────────────────────────────────────────────────────────────────────────── */

const ROLES = ['admin', 'dispatcher', 'loader', 'driver', 'store_manager'] as const;
const DEPOTS = ['Peliyagoda', 'Kandy'] as const;
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM (24-hour).');

/** A readable temporary password that satisfies the policy (shown once to the admin). */
export function tempPassword() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz', D = '23456789';
  let s = '';
  for (let i = 0; i < 8; i++) s += A[randomInt(A.length)];
  for (let i = 0; i < 4; i++) s += D[randomInt(D.length)];
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}`;
}

const sbWrap = async <T>(fn: () => Promise<T>) => {
  try { return await fn(); }
  catch (e) { if (e instanceof SupabaseError) throw new HttpError(502, `Supabase Auth: ${e.message}`, undefined, 'supabase_error'); throw e; }
};

/* ── people ── */
const USER_VIEW = `u.id, u.email, u.name, u.role, u.depot, u.outlet_id AS "outletId", u.vehicle_id AS "vehicleId", u.phone, u.is_active AS "isActive",
  u.must_change_password AS "mustChangePassword", u.locked_until AS "lockedUntil", u.failed_logins AS "failedLogins", u.last_login_at AS "lastLoginAt",
  u.created_at AS "createdAt", u.updated_at AS "updatedAt", (u.pin_hash IS NOT NULL) AS "hasPin", (u.auth_user_id IS NOT NULL) AS "supabaseLinked"`;

export const UserQuery = z.object({ q: z.string().trim().max(80).optional(), role: z.enum(ROLES).optional(), active: z.enum(['true', 'false']).optional() });
export async function listUsers(f: z.infer<typeof UserQuery>) {
  const where: string[] = [], p: unknown[] = [];
  if (f.q) { p.push(`%${f.q.toLowerCase()}%`); where.push(`(lower(u.email) LIKE $${p.length} OR lower(u.name) LIKE $${p.length} OR lower(coalesce(u.outlet_id,'')) LIKE $${p.length} OR lower(coalesce(u.vehicle_id,'')) LIKE $${p.length})`); }
  if (f.role) { p.push(f.role); where.push(`u.role = $${p.length}`); }
  if (f.active) { p.push(f.active === 'true'); where.push(`u.is_active = $${p.length}`); }
  return q<any>(`SELECT ${USER_VIEW} FROM users u ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY u.role, u.name LIMIT 500`, p);
}

const Scope = z.object({
  depot: z.enum(DEPOTS).nullable().optional(),
  outletId: z.string().trim().regex(/^OUT\d{3}$/).nullable().optional(),
  vehicleId: z.string().trim().regex(/^VEH\d{3}$/).nullable().optional(),
});
export const UserCreate = Scope.extend({
  email: z.string().trim().toLowerCase().email().max(120),
  name: z.string().trim().min(2).max(80),
  role: z.enum(ROLES),
  phone: z.string().trim().regex(/^\+?[0-9 ]{7,16}$/, 'Use digits, e.g. +94 77 123 4567.').nullable().optional(),
  password: PasswordPolicy.optional(),
  pin: z.string().regex(/^\d{4,6}$/, 'PINs are 4 to 6 digits.').optional(),
});
export const UserUpdate = Scope.extend({
  name: z.string().trim().min(2).max(80).optional(),
  role: z.enum(ROLES).optional(),
  phone: z.string().trim().regex(/^\+?[0-9 ]{7,16}$/).nullable().optional(),
  isActive: z.boolean().optional(),
});

/** Role ↔ scope rules: store managers need an outlet, drivers a vehicle, loaders a depot. */
async function normaliseScope(role: string, s: z.infer<typeof Scope>) {
  const out = { depot: s.depot ?? null, outletId: s.outletId ?? null, vehicleId: s.vehicleId ?? null };
  if (role === 'store_manager') {
    if (!out.outletId) throw bad('Pick the outlet this store manager runs.');
    if (!(await one(`SELECT 1 FROM outlets WHERE id = $1`, [out.outletId]))) throw bad(`Unknown outlet ${out.outletId}.`);
    return { depot: null, outletId: out.outletId, vehicleId: null };
  }
  if (role === 'driver') {
    if (!out.vehicleId) throw bad('Pick the vehicle this driver drives.');
    const v = await one<any>(`SELECT depot FROM vehicles WHERE id = $1`, [out.vehicleId]);
    if (!v) throw bad(`Unknown vehicle ${out.vehicleId}.`);
    return { depot: v.depot, outletId: null, vehicleId: out.vehicleId };
  }
  if (role === 'loader') {
    if (!out.depot) throw bad('Pick the depot this loader works at.');
    return { depot: out.depot, outletId: null, vehicleId: null };
  }
  return { depot: role === 'dispatcher' ? out.depot : null, outletId: null, vehicleId: null };
}

async function assertPinFree(pin: string, depot: string, exceptId?: number) {
  const loaders = await q<any>(`SELECT id, pin_hash FROM users WHERE role = 'loader' AND depot = $1 AND pin_hash IS NOT NULL AND is_active`, [depot]);
  for (const l of loaders) if (l.id !== exceptId && await bcrypt.compare(pin, l.pin_hash)) throw conflict('Another loader at this depot already uses that PIN. Pick a different one.');
}

export async function createUser(admin: AuthUser, body: z.infer<typeof UserCreate>) {
  if (await one(`SELECT 1 FROM users WHERE lower(email) = $1`, [body.email])) throw conflict('Someone already has that email.');
  const scope = await normaliseScope(body.role, body);
  if (body.pin && body.role !== 'loader') throw bad('Only loaders sign in with a PIN.');
  if (body.pin) await assertPinFree(body.pin, scope.depot!);
  const password = body.password ?? tempPassword();
  const mustChange = !body.password;
  let authId: string | null = null;
  if (config.authProvider === 'supabase') {
    authId = await sbWrap(async () => {
      const existing = await sbFindUserByEmail(body.email);
      if (existing) { await sbUpdateUser(existing.id, { password, app_metadata: { app_role: body.role } }); return existing.id; }
      return (await sbCreateUser(body.email, password, body.role)).id;
    });
  }
  const u = await tx(async c => {
    const r = await one<any>(`INSERT INTO users (email, name, role, depot, outlet_id, vehicle_id, phone, password_hash, pin_hash, auth_user_id, must_change_password)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
      [body.email, body.name, body.role, scope.depot, scope.outletId, scope.vehicleId, body.phone ?? null, config.authProvider === 'supabase' ? null : await hashPassword(password), body.pin ? await bcrypt.hash(body.pin, BCRYPT_COST) : null, authId, mustChange], c);
    await audit(c, admin.id, 'user.create', `user:${r.id}`, { email: body.email, role: body.role, ...scope });
    return r;
  });
  const row = await one<any>(`SELECT ${USER_VIEW} FROM users u WHERE u.id = $1`, [u.id]);
  return { user: row, temporaryPassword: mustChange ? password : null };
}

async function assertNotLastAdmin(userId: number) {
  const n = await one<{ n: number }>(`SELECT count(*)::int AS n FROM users WHERE role = 'admin' AND is_active AND id <> $1`, [userId]);
  if (!n || n.n === 0) throw conflict('This is the last active administrator. Add another admin first.');
}

export async function updateUser(admin: AuthUser, id: number, body: z.infer<typeof UserUpdate>) {
  const cur = await one<any>(`SELECT * FROM users WHERE id = $1`, [id]);
  if (!cur) throw notFound('User not found.');
  const role = body.role ?? cur.role;
  if (id === admin.id && (body.isActive === false || (body.role && body.role !== 'admin'))) throw bad('You cannot disable your own account or remove your own admin role.');
  if (cur.role === 'admin' && cur.is_active && (body.isActive === false || (body.role && body.role !== 'admin'))) await assertNotLastAdmin(id);
  const scopeIn = { depot: body.depot !== undefined ? body.depot : cur.depot, outletId: body.outletId !== undefined ? body.outletId : cur.outlet_id, vehicleId: body.vehicleId !== undefined ? body.vehicleId : cur.vehicle_id };
  const scope = await normaliseScope(role, scopeIn);
  const active = body.isActive ?? cur.is_active;
  if (config.authProvider === 'supabase' && cur.auth_user_id && (body.isActive !== undefined || body.role)) {
    await sbWrap(() => sbUpdateUser(cur.auth_user_id, { app_metadata: { app_role: role }, ...(body.isActive !== undefined ? { ban_duration: active ? 'none' : '876000h' } : {}) }));
  }
  // any change to who someone is or what they can reach signs them out everywhere
  const revoke = role !== cur.role || !active || scope.depot !== cur.depot || scope.outletId !== cur.outlet_id || scope.vehicleId !== cur.vehicle_id;
  await tx(async c => {
    await c.query(`UPDATE users SET name = $2, role = $3, depot = $4, outlet_id = $5, vehicle_id = $6, phone = $7, is_active = $8,
        pin_hash = CASE WHEN $3 = 'loader' THEN pin_hash ELSE NULL END, token_version = token_version + CASE WHEN $9::boolean THEN 1 ELSE 0 END WHERE id = $1`,
      [id, body.name ?? cur.name, role, scope.depot, scope.outletId, scope.vehicleId, body.phone !== undefined ? body.phone : cur.phone, active, revoke]);
    if (!active) await c.query(`DELETE FROM loading_sessions WHERE user_id = $1`, [id]);
    await audit(c, admin.id, body.isActive === false ? 'user.disable' : body.isActive === true && !cur.is_active ? 'user.enable' : 'user.update', `user:${id}`, body);
  });
  forgetUser(id);
  return one<any>(`SELECT ${USER_VIEW} FROM users u WHERE u.id = $1`, [id]);
}

export const ResetBody = z.object({ password: PasswordPolicy.optional(), sendEmail: z.boolean().optional() });
/** Set a temporary password (shown once; must be changed at next sign-in), or email a recovery link (Supabase). */
export async function resetPassword(admin: AuthUser, id: number, body: z.infer<typeof ResetBody>) {
  const u = await one<any>(`SELECT id, email, auth_user_id FROM users WHERE id = $1`, [id]);
  if (!u) throw notFound('User not found.');
  if (body.sendEmail) {
    if (config.authProvider !== 'supabase' || !u.auth_user_id) throw bad('Recovery emails need AUTH_PROVIDER=supabase. Set a temporary password instead.');
    await sbWrap(() => sbSendRecovery(u.email, config.appUrl ? `${config.appUrl}/login` : undefined));
    await audit(pool, admin.id, 'user.recovery_email', `user:${id}`);
    return { emailed: true, temporaryPassword: null };
  }
  const password = body.password ?? tempPassword();
  if (config.authProvider === 'supabase' && u.auth_user_id) await sbWrap(() => sbUpdateUser(u.auth_user_id, { password }));
  await q(`UPDATE users SET password_hash = $2, must_change_password = true, failed_logins = 0, locked_until = NULL, token_version = token_version + 1 WHERE id = $1`,
    [id, config.authProvider === 'supabase' && u.auth_user_id ? null : await hashPassword(password)]);
  forgetUser(id);
  await audit(pool, admin.id, 'user.password_reset', `user:${id}`);
  return { emailed: false, temporaryPassword: password };
}

export const PinBody = z.object({ pin: z.string().regex(/^\d{4,6}$/, 'PINs are 4 to 6 digits.').optional() });
export async function resetPin(admin: AuthUser, id: number, body: z.infer<typeof PinBody>) {
  const u = await one<any>(`SELECT id, role, depot FROM users WHERE id = $1`, [id]);
  if (!u) throw notFound('User not found.');
  if (u.role !== 'loader') throw bad('Only loaders have a dock PIN.');
  let pin = body.pin;
  if (pin) await assertPinFree(pin, u.depot, id);
  else for (let i = 0; i < 20 && !pin; i++) { const p = String(randomInt(1000, 10000)); try { await assertPinFree(p, u.depot, id); pin = p; } catch { /* try another */ } }
  if (!pin) throw conflict('Could not find a free PIN. Enter one.');
  await q(`UPDATE users SET pin_hash = $2, token_version = token_version + 1 WHERE id = $1`, [id, await bcrypt.hash(pin, BCRYPT_COST)]);
  forgetUser(id);
  await audit(pool, admin.id, 'user.pin_reset', `user:${id}`);
  return { pin };
}

export async function unlockUser(admin: AuthUser, id: number) {
  const r = await one(`UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = $1 RETURNING id`, [id]);
  if (!r) throw notFound('User not found.');
  forgetUser(id);
  await audit(pool, admin.id, 'user.unlock', `user:${id}`);
  return { ok: true };
}
export async function signOutUser(admin: AuthUser, id: number) {
  const r = await one(`UPDATE users SET token_version = token_version + 1 WHERE id = $1 RETURNING id`, [id]);
  if (!r) throw notFound('User not found.');
  forgetUser(id);
  await audit(pool, admin.id, 'user.sign_out', `user:${id}`);
  return { ok: true };
}

/* ── fleet and outlets ── */
export async function listVehicles() {
  return q<any>(`SELECT v.id, v.type, v.temp, v.depot, v.weight_cap AS "weightCap", v.volume_cap AS "volumeCap", v.km_per_l AS "kmPerL", v.fuel_quota_l AS "fuelQuotaL", v.fuel_used_l AS "fuelUsedL",
      v.fuel_type AS "fuelType", v.status, v.status_note AS "statusNote", v.driver_name AS "driverName", v.updated_at AS "updatedAt",
      (SELECT json_agg(json_build_object('id', u.id, 'name', u.name, 'email', u.email)) FROM users u WHERE u.vehicle_id = v.id AND u.is_active) AS drivers
    FROM vehicles v ORDER BY v.depot, v.id`);
}
export const VehicleUpdate = z.object({
  status: z.enum(['available', 'in_workshop']).optional(),
  statusNote: z.string().trim().max(120).nullable().optional(),
  driverName: z.string().trim().min(2).max(80).optional(),
  fuelUsedL: z.number().min(0).max(10000).optional(),
  fuelQuotaL: z.number().positive().max(10000).optional(),
});
export async function updateVehicle(user: AuthUser, id: string, b: z.infer<typeof VehicleUpdate>) {
  const v = await one<any>(`SELECT * FROM vehicles WHERE id = $1`, [id]);
  if (!v) throw notFound('Unknown vehicle.');
  if (b.status === 'in_workshop' && !b.statusNote && !v.status_note) throw bad('Say why the vehicle is in the workshop.');
  if (b.status === 'in_workshop') {
    const live = await one<any>(`SELECT trip_no FROM trips WHERE vehicle_id = $1 AND status IN ('released','in_progress') LIMIT 1`, [id]);
    if (live) throw conflict(`${id} is on Trip ${live.trip_no} right now. Report a fault on the trip so the dispatcher can swap it.`);
  }
  await q(`UPDATE vehicles SET status = coalesce($2, status), status_note = CASE WHEN $2 = 'available' THEN NULL WHEN $3::text IS NOT NULL THEN $3 ELSE status_note END,
      driver_name = coalesce($4, driver_name), fuel_used_l = coalesce($5, fuel_used_l), fuel_quota_l = coalesce($6, fuel_quota_l) WHERE id = $1`,
    [id, b.status ?? null, b.statusNote ?? null, b.driverName ?? null, b.fuelUsedL ?? null, b.fuelQuotaL ?? null]);
  await audit(pool, user.id, 'vehicle.update', `vehicle:${id}`, b);
  return (await listVehicles()).find(x => x.id === id);
}

export async function listOutlets() {
  return q<any>(`SELECT o.id, o.name, o.brand, o.district, o.depot, o.dock, o.parking, o.open_time AS open, o.close_time AS close, o.mall_window AS "mallWindow", o.van_only AS "vanOnly",
      o.is_active AS "isActive", o.lat, o.lng, o.updated_at AS "updatedAt",
      (SELECT json_agg(json_build_object('id', u.id, 'name', u.name, 'email', u.email)) FROM users u WHERE u.outlet_id = o.id AND u.is_active) AS managers
    FROM outlets o ORDER BY o.id`);
}
export const OutletUpdate = z.object({
  name: z.string().trim().min(3).max(100).optional(),
  open: hhmm.optional(), close: hhmm.optional(),
  mallWindow: z.string().trim().regex(/^([01]\d|2[0-3]):[0-5]\d[–-]([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM–HH:MM.').nullable().optional(),
  dock: z.enum(['rear_dock', 'street', 'mall_bay']).optional(),
  parking: z.enum(['normal', 'van_only', 'mall_dock']).optional(),
  vanOnly: z.boolean().optional(),
  isActive: z.boolean().optional(),
});
export async function updateOutlet(user: AuthUser, id: string, b: z.infer<typeof OutletUpdate>) {
  const o = await one<any>(`SELECT * FROM outlets WHERE id = $1`, [id]);
  if (!o) throw notFound('Unknown outlet.');
  const open = b.open ?? o.open_time, close = b.close ?? o.close_time;
  if (open >= close) throw bad('The window must open before it closes.');
  if (b.dock) {
    const allowed = await one(`SELECT 1 FROM service_allowance WHERE brand = $1 AND dock = $2`, [o.brand, b.dock]);
    if (!allowed) throw bad(`There is no service allowance for ${o.brand} at a ${b.dock.replace('_', ' ')}.`);
  }
  await q(`UPDATE outlets SET name = $2, open_time = $3, close_time = $4, mall_window = $5, dock = $6, parking = $7, van_only = $8, is_active = $9 WHERE id = $1`,
    [id, b.name ?? o.name, open, close, b.mallWindow !== undefined ? b.mallWindow?.replace('-', '–') ?? null : o.mall_window, b.dock ?? o.dock, b.parking ?? o.parking, b.vanOnly ?? (b.parking ? b.parking === 'van_only' : o.van_only), b.isActive ?? o.is_active]);
  await audit(pool, user.id, 'outlet.update', `outlet:${id}`, b);
  return (await listOutlets()).find(x => x.id === id);
}

/* ── settings ── */
export async function readSettings() {
  const s = await getSettings();
  return { ...s, schema: { rules: Object.keys(RulesSchema.shape), operations: Object.keys(OperationsSchema.shape) } };
}
export async function writeSettings(user: AuthUser, key: 'rules' | 'operations', value: unknown) {
  const cur = (await getSettings())[key];
  const parsed = (key === 'rules' ? RulesSchema : OperationsSchema).safeParse({ ...cur, ...(value as object) });
  if (!parsed.success) throw bad(parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '));
  const saved = await saveSettings(key, parsed.data);
  await audit(pool, user.id, 'settings.update', `settings:${key}`, { before: cur, after: saved });
  return readSettings();
}

/* ── audit log ── */
export const AuditQuery = z.object({
  action: z.string().trim().max(60).optional(), userId: z.coerce.number().int().optional(), entity: z.string().trim().max(60).optional(),
  from: z.string().datetime({ offset: true }).optional(), to: z.string().datetime({ offset: true }).optional(),
  before: z.coerce.number().int().optional(), limit: z.coerce.number().int().min(1).max(200).default(50),
});
export async function auditLog(f: z.infer<typeof AuditQuery>) {
  const where: string[] = [], p: unknown[] = [];
  const add = (sql: string, v: unknown) => { p.push(v); where.push(sql.replace('?', `$${p.length}`)); };
  if (f.action) add(`a.action LIKE ?`, `${f.action}%`);
  if (f.userId) add(`a.user_id = ?`, f.userId);
  if (f.entity) add(`a.entity LIKE ?`, `${f.entity}%`);
  if (f.from) add(`a.at >= ?`, f.from);
  if (f.to) add(`a.at <= ?`, f.to);
  if (f.before) add(`a.id < ?`, f.before);
  p.push(f.limit + 1);
  const rows = await q<any>(`SELECT a.id, a.at, a.action, a.entity, a.data, a.user_id AS "userId", u.name AS "userName", u.role AS "userRole"
    FROM audit_log a LEFT JOIN users u ON u.id = a.user_id ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY a.id DESC LIMIT $${p.length}`, p);
  const more = rows.length > f.limit;
  const items = rows.slice(0, f.limit);
  const actions = await q<{ prefix: string }>(`SELECT DISTINCT split_part(action, '.', 1) AS prefix FROM audit_log ORDER BY 1`);
  return { items, nextBefore: more ? items[items.length - 1].id : null, actionPrefixes: actions.map(a => a.prefix) };
}

/* ── data management ── */
export async function dataStatus() {
  const count = async (t: string) => (await one<{ n: number }>(`SELECT count(*)::int AS n FROM ${t}`))!.n;
  const tables = ['outlets', 'vehicles', 'district_travel', 'service_allowance', 'calendar', 'traffic_speed', 'road_conditions', 'demand_weekly', 'users', 'orders', 'plans', 'trips', 'stop_events', 'pods', 'receipts', 'exceptions', 'deferrals', 'notifications', 'attachments', 'audit_log'];
  const counts: Record<string, number> = {};
  for (const t of tables) counts[t] = await count(t);
  const cal = await one<any>(`SELECT to_char(min(date),'YYYY-MM-DD') AS "from", to_char(max(date),'YYYY-MM-DD') AS "to" FROM calendar`);
  const roads = await one<any>(`SELECT to_char(min(date),'YYYY-MM-DD') AS "from", to_char(max(date),'YYYY-MM-DD') AS "to" FROM road_conditions`);
  const demand = await q<any>(`SELECT source, count(*)::int AS rows, min(iso_year * 100 + iso_week) AS "fromWeek", max(iso_year * 100 + iso_week) AS "toWeek", max(imported_at) AS "importedAt" FROM demand_weekly GROUP BY source ORDER BY source`);
  const files = await one<any>(`SELECT count(*)::int AS n, coalesce(sum(bytes),0)::bigint AS bytes, count(*) FILTER (WHERE storage = 'supabase')::int AS supabase FROM attachments`);
  const orders = await one<any>(`SELECT to_char(min(delivery_date),'YYYY-MM-DD') AS "from", to_char(max(delivery_date),'YYYY-MM-DD') AS "to" FROM orders`);
  return { counts, calendar: cal, roadConditions: roads, demand, attachments: { count: files.n, bytes: Number(files.bytes), inSupabase: files.supabase }, orders, dataDir: config.dataDir, demoMode: config.demoMode };
}

/** Datathon Task 2A output (submission_task2a.csv: row_id, pred_total_volume_m3, pred_chilled_volume_m3),
 *  mapped to depot/brand/week through task2a_test_inputs (bundled), or a CSV that names those columns itself. */
export async function importForecast(user: AuthUser, csv: string) {
  if (csv.length > 2_000_000) throw bad('The file is too large (2 MB max).');
  let rows: Record<string, string>[];
  try { rows = parseCsv(csv.replace(/^\uFEFF/, '')); } catch { throw bad('That is not a CSV file.'); }
  if (!rows.length) throw bad('The file has no rows.');
  const horizon = new Map(FORECAST_HORIZON.map(([id, depot, brand, y, w]) => [id, { depot, brand, y, w }]));
  const problems: string[] = [];
  const out: [string, string, number, number, number, number][] = [];
  rows.forEach((r, i) => {
    const line = i + 2;
    const key = r.row_id ? horizon.get(r.row_id) : r.depot && r.brand && r.iso_year && r.iso_week ? { depot: r.depot, brand: r.brand, y: Number(r.iso_year), w: Number(r.iso_week) } : undefined;
    if (!key) { problems.push(`line ${line}: unknown row_id "${r.row_id ?? ''}"`); return; }
    const total = Number(r.pred_total_volume_m3 ?? r.total_m3), chilled = Number(r.pred_chilled_volume_m3 ?? r.chilled_m3 ?? 0);
    if (!Number.isFinite(total) || total < 0) { problems.push(`line ${line}: total volume must be a number ≥ 0`); return; }
    if (!Number.isFinite(chilled) || chilled < 0 || chilled > total + 0.001) { problems.push(`line ${line}: chilled volume must be between 0 and the total`); return; }
    if (!DEPOTS.includes(key.depot as any) || !['Fresh', 'Style', 'Tech'].includes(key.brand) || key.w < 1 || key.w > 53) { problems.push(`line ${line}: unknown depot/brand/week`); return; }
    out.push([key.depot, key.brand, key.y, key.w, total, chilled]);
  });
  if (problems.length) throw bad(`The file was not imported: ${problems.slice(0, 5).join('; ')}${problems.length > 5 ? ` (+${problems.length - 5} more)` : ''}.`);
  await tx(async c => {
    for (const [depot, brand, y, w, total, chilled] of out) {
      await c.query(`INSERT INTO demand_weekly (depot, brand, iso_year, iso_week, source, total_m3, chilled_m3, imported_at) VALUES ($1,$2,$3,$4,'forecast_import',$5,$6,now())
        ON CONFLICT (depot, brand, iso_year, iso_week, source) DO UPDATE SET total_m3 = EXCLUDED.total_m3, chilled_m3 = EXCLUDED.chilled_m3, imported_at = now()`, [depot, brand, y, w, total, chilled]);
    }
    await audit(c, user.id, 'admin.forecast_import', 'demand_weekly', { rows: out.length });
  });
  return { imported: out.length };
}
export async function clearForecastImport(user: AuthUser) {
  const r = await q(`DELETE FROM demand_weekly WHERE source = 'forecast_import' RETURNING 1`);
  await audit(pool, user.id, 'admin.forecast_clear', 'demand_weekly', { rows: r.length });
  invalidateConditions();
  return { removed: r.length };
}

/* ── system ── */
const started = Date.now();
export async function systemHealth() {
  const t0 = Date.now();
  const db = await one<any>(`SELECT version() AS version, current_database() AS name, now() AS now`);
  const dbMs = Date.now() - t0;
  const migrations = await q<any>(`SELECT name, applied_at AS "appliedAt" FROM schema_migrations ORDER BY name`);
  const rls = await q<any>(`SELECT c.relname AS table, c.relrowsecurity AS rls FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY 1`);
  const supabase = config.authProvider === 'supabase' || config.storageProvider === 'supabase' ? await sbHealth() : null;
  return {
    status: 'ok', uptimeSec: Math.round((Date.now() - started) / 1000), node: process.version, env: config.env,
    database: { ok: true, latencyMs: dbMs, name: db.name, version: String(db.version).split(' ').slice(0, 2).join(' '), ssl: config.databaseSsl, pool: { total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount } },
    migrations, rls: { enabled: rls.filter(r => r.rls).length, total: rls.length, missing: rls.filter(r => !r.rls && r.table !== 'schema_migrations').map(r => r.table) },
    providers: { auth: config.authProvider, storage: config.storageProvider, supabaseUrl: config.supabase.url || null, bucket: config.storageProvider === 'supabase' ? config.supabase.bucket : null },
    supabase, demoMode: config.demoMode, corsOrigins: config.corsOrigins,
  };
}
