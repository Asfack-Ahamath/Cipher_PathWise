/* Production features: accounts and roles, security gates, admin tools, files, loader safety rules.
   Runs against a real PostgreSQL (DATABASE_URL), after the walkthrough test (files run in sequence). */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

let app: FastifyInstance;
const tokens: Record<string, string> = {};
const call = async (who: string, method: string, url: string, body?: unknown, ip = '10.0.0.1') => {
  const r = await app.inject({ method: method as any, url, payload: body as any, remoteAddress: ip, headers: tokens[who] ? { authorization: `Bearer ${tokens[who]}` } : {} });
  let json: any = null; try { json = r.json(); } catch { json = r.body; }
  return { status: r.statusCode, body: json, headers: r.headers, raw: r };
};
const login = async (who: string, email: string, password = 'PathWise@2026') => {
  const r = await call('', 'POST', '/api/auth/login', { email, password });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  tokens[who] = r.body.token;
  return r.body;
};
const PLAN = '2026-04-30';
const NEW = `new.store.${Date.now()}@pathwise.lk`;
const JPEG = `data:image/jpeg;base64,${Buffer.from('ffd8ffe000104a46494600010100000100010000ffd9', 'hex').toString('base64')}`;

beforeAll(async () => {
  const { migrate } = await import('../src/migrate.js');
  const { seedIfEmpty, resetDay } = await import('../src/seed/seed.js');
  const { loadClock } = await import('../src/clock.js');
  const { buildServer } = await import('../src/server.js');
  await migrate(() => {}); await seedIfEmpty(() => {}); await resetDay(() => {}); await loadClock();
  // make the file re-runnable on the same database
  const { pool } = await import('../src/db.js');
  const { hashPassword } = await import('../src/auth.js');
  await pool.query(`UPDATE users SET password_hash = $1, must_change_password = false, failed_logins = 0, locked_until = NULL, is_active = true WHERE email LIKE '%@pathwise.lk'`, [await hashPassword('PathWise@2026')]);
  await pool.query(`UPDATE users SET is_active = false WHERE email LIKE 'new.store.%'`);
  app = await buildServer();
  await login('admin', 'admin@pathwise.lk');
  await login('dispatcher', 'dispatcher@pathwise.lk');
  await login('driver', 'driver@pathwise.lk');
  await login('store', 'store@pathwise.lk');
  await login('store2', 'store.style@pathwise.lk');
  const pin = await call('', 'POST', '/api/auth/pin', { pin: '2468', depot: 'Kandy' });
  tokens.loader = pin.body.token;
}, 60000);
afterAll(async () => { await app?.close(); const { pool } = await import('../src/db.js'); await pool.end(); });

describe('accounts and roles', () => {
  it('admin creates a store manager who must change the temporary password first', async () => {
    const bad = await call('admin', 'POST', '/api/admin/users', { email: NEW, name: 'New Manager', role: 'store_manager' });
    expect(bad.status).toBe(400); // no outlet
    const r = await call('admin', 'POST', '/api/admin/users', { email: NEW.replace('new.store', 'New.Store'), name: 'New Manager', role: 'store_manager', outletId: 'OUT001', phone: '+94 77 123 4567' });
    expect(r.status).toBe(200);
    expect(r.body.temporaryPassword).toMatch(/^[A-Za-z]{4}-[A-Za-z]{4}-\d{4}$/);
    expect(r.body.user.email).toBe(NEW);
    const dup = await call('admin', 'POST', '/api/admin/users', { email: NEW, name: 'Again', role: 'store_manager', outletId: 'OUT001' });
    expect(dup.status).toBe(409);
    await login('newstore', NEW, r.body.temporaryPassword);
    const blocked = await call('newstore', 'GET', '/api/store/overview');
    expect(blocked.status).toBe(403); expect(blocked.body.code).toBe('password_change_required');
    expect((await call('newstore', 'GET', '/api/me')).status).toBe(200);
    const weak = await call('newstore', 'POST', '/api/me/password', { current: r.body.temporaryPassword, next: 'short' });
    expect(weak.status).toBe(400);
    const ok = await call('newstore', 'POST', '/api/me/password', { current: r.body.temporaryPassword, next: 'BetterPass2026' });
    expect(ok.status).toBe(200);
    const old = tokens.newstore; tokens.newstore = ok.body.token;
    expect((await call('newstore', 'GET', '/api/store/overview')).status).toBe(200);
    tokens.stale = old;
    expect((await call('stale', 'GET', '/api/me')).status).toBe(401); // the password change signed out the old session
  });

  it('disabling a user ends their sessions; admins cannot lock themselves out', async () => {
    const users = (await call('admin', 'GET', `/api/admin/users?q=${NEW}`)).body;
    const id = users[0].id;
    expect((await call('admin', 'PATCH', `/api/admin/users/${id}`, { isActive: false })).status).toBe(200);
    const r = await call('newstore', 'GET', '/api/store/overview');
    expect(r.status).toBe(401); expect(r.body.code).toBe('account_disabled');
    expect((await call('', 'POST', '/api/auth/login', { email: NEW, password: 'BetterPass2026' })).status).toBe(403);
    const me = (await call('admin', 'GET', '/api/me')).body.user;
    expect((await call('admin', 'PATCH', `/api/admin/users/${me.id}`, { isActive: false })).status).toBe(400);
    expect((await call('admin', 'PATCH', `/api/admin/users/${id}`, { isActive: true })).status).toBe(200);
  });

  it('five wrong passwords lock an account; an admin can unlock it', async () => {
    for (let i = 0; i < 5; i++) expect((await call('', 'POST', '/api/auth/login', { email: 'store.tech@pathwise.lk', password: `wrong-${i}` }, `10.1.0.${i}`)).status).toBe(401);
    const locked = await call('', 'POST', '/api/auth/login', { email: 'store.tech@pathwise.lk', password: 'PathWise@2026' }, '10.1.0.9');
    expect(locked.status).toBe(423);
    const u = (await call('admin', 'GET', '/api/admin/users?q=store.tech')).body[0];
    expect(u.lockedUntil).toBeTruthy();
    expect((await call('admin', 'POST', `/api/admin/users/${u.id}/unlock`)).status).toBe(200);
    expect((await call('', 'POST', '/api/auth/login', { email: 'store.tech@pathwise.lk', password: 'PathWise@2026' }, '10.1.0.10')).status).toBe(200);
  });

  it('password and PIN resets', async () => {
    const u = (await call('admin', 'GET', '/api/admin/users?q=store.tech')).body[0];
    const r = await call('admin', 'POST', `/api/admin/users/${u.id}/reset-password`, {});
    expect(r.body.temporaryPassword).toBeTruthy();
    const s = await login('tech', 'store.tech@pathwise.lk', r.body.temporaryPassword);
    expect(s.user.mustChangePassword).toBe(true);
    const loaders = (await call('admin', 'GET', '/api/admin/users?role=loader')).body;
    const kandy = loaders.find((l: any) => l.depot === 'Kandy');
    const peli = loaders.find((l: any) => l.depot === 'Peliyagoda');
    expect((await call('admin', 'POST', `/api/admin/users/${peli.id}/reset-pin`, { pin: '2468' })).status).toBe(200); // other depot: allowed
    const other = await call('admin', 'POST', '/api/admin/users', { email: 'loader2@pathwise.lk', name: 'Second Loader', role: 'loader', depot: 'Kandy', pin: '2468' });
    expect(other.status).toBe(409); // same PIN at the same depot
    const gen = await call('admin', 'POST', `/api/admin/users/${kandy.id}/reset-pin`, {});
    expect(gen.body.pin).toMatch(/^\d{4}$/);
    expect((await call('', 'POST', '/api/auth/pin', { pin: gen.body.pin, depot: 'Kandy' })).status).toBe(200);
    expect((await call('', 'POST', '/api/auth/pin', { pin: '2468', depot: 'Kandy' })).status).toBe(401);
    // put the demo PIN back for the next steps
    await call('admin', 'POST', `/api/admin/users/${peli.id}/reset-pin`, { pin: '1357' });
    await call('admin', 'POST', `/api/admin/users/${kandy.id}/reset-pin`, { pin: '2468' });
    tokens.loader = (await call('', 'POST', '/api/auth/pin', { pin: '2468', depot: 'Kandy' })).body.token;
  });

  it('role guards', async () => {
    expect((await call('driver', 'GET', '/api/overview')).status).toBe(403);
    expect((await call('dispatcher', 'GET', '/api/admin/users')).status).toBe(403);
    expect((await call('admin', 'GET', '/api/overview')).status).toBe(200); // admin inherits dispatcher
    expect((await call('store', 'GET', '/api/loader/queue')).status).toBe(403);
    expect((await call('', 'GET', '/api/me')).status).toBe(401);
    const ticket = (await call('store', 'POST', '/api/events/ticket')).body.ticket;
    tokens.ticket = ticket;
    expect((await call('ticket', 'GET', '/api/me')).status).toBe(401); // a live-update ticket is not a session
  });
});

describe('settings, data and audit', () => {
  it('validates and applies operations settings', async () => {
    expect((await call('admin', 'PUT', '/api/admin/settings/operations', { cutoffTime: '25:00' })).status).toBe(400);
    const r = await call('admin', 'PUT', '/api/admin/settings/operations', { cutoffTime: '17:30' });
    expect(r.status).toBe(200); expect(r.body.operations.cutoffTime).toBe('17:30');
    const w = await call('store', 'GET', '/api/store/order-window');
    expect(w.body.cutoffTime).toBe('17:30');
    await call('admin', 'PUT', '/api/admin/settings/operations', { cutoffTime: '16:00' });
    expect((await call('admin', 'PUT', '/api/admin/settings/rules', { maxTripsPerVehicle: 9 })).status).toBe(400);
  });

  it('imports the Datathon Task 2A forecast and shows it on the forecast page', async () => {
    const { FORECAST_HORIZON } = await import('@pathwise/core');
    const csv = ['row_id,pred_total_volume_m3,pred_chilled_volume_m3', ...FORECAST_HORIZON.map(([id], i) => `${id},${100 + i},${40 + i / 2}`)].join('\n');
    const bad = await call('admin', 'POST', '/api/admin/data/forecast', { csv: 'row_id,pred_total_volume_m3,pred_chilled_volume_m3\nW9999,10,2\n' });
    expect(bad.status).toBe(400);
    const worse = await call('admin', 'POST', '/api/admin/data/forecast', { csv: 'row_id,pred_total_volume_m3,pred_chilled_volume_m3\nW0000,10,20\n' });
    expect(worse.status).toBe(400); // chilled > total
    const r = await call('admin', 'POST', '/api/admin/data/forecast', { csv });
    expect(r.status).toBe(200); expect(r.body.imported).toBe(60);
    const d = await call('admin', 'GET', '/api/admin/data');
    expect(d.body.demand.find((x: any) => x.source === 'forecast_import').rows).toBe(60);
    expect(d.body.counts.traffic_speed).toBe(576);
  });

  it('audit log pages and never stores secrets', async () => {
    const a = await call('admin', 'GET', '/api/admin/audit?limit=5');
    expect(a.body.items).toHaveLength(5); expect(a.body.nextBefore).toBeTruthy();
    const b = await call('admin', 'GET', `/api/admin/audit?limit=5&before=${a.body.nextBefore}`);
    expect(b.body.items[0].id).toBeLessThan(a.body.nextBefore + 1);
    const all = await call('admin', 'GET', '/api/admin/audit?limit=200&action=user');
    expect(JSON.stringify(all.body)).not.toMatch(/BetterPass2026|2468/);
  });

  it('system health reports migrations and row-level security', async () => {
    const s = await call('admin', 'GET', '/api/admin/system');
    expect(s.body.database.ok).toBe(true);
    expect(s.body.migrations.map((m: any) => m.name)).toEqual(expect.arrayContaining(['001_init.sql', '002_production.sql', '003_security.sql']));
    expect(s.body.rls.missing).toEqual([]);
    const h = await call('', 'GET', '/api/health');
    expect(h.body).toEqual({ ok: true });
    expect(h.headers['content-security-policy']).toContain("default-src 'self'");
    expect(h.headers['x-content-type-options']).toBe('nosniff');
  });
});

describe('operations safety rules', () => {
  let trip1 = 0, trip2 = 0;
  it('publishes a plan to work with', async () => {
    await call('dispatcher', 'POST', `/api/plans/${PLAN}/auto`);
    expect((await call('dispatcher', 'POST', `/api/plans/${PLAN}/publish`)).status).toBe(200);
    const q = (await call('loader', 'GET', '/api/loader/queue')).body.trips;
    const two = q.find((t: any) => t.trip === 2);
    expect(two).toBeTruthy();
    trip2 = two.id; trip1 = q.find((t: any) => t.vehicleId === two.vehicleId && t.trip === 1).id;
  });

  it('trip 2 cannot be loaded while the truck is still on trip 1', async () => {
    const d = (await call('loader', 'GET', `/api/loader/trips/${trip2}`)).body;
    expect(d.previousTrip.status).not.toBe('completed');
    const r = await call('loader', 'POST', `/api/loader/trips/${trip2}/lines/${d.lines[0].orderId}`, { state: 'loaded' });
    expect(r.status).toBe(409); expect(r.body.error).toContain('still on Trip 1');
  });

  it('one loader per trip: a second tablet is refused unless it takes over', async () => {
    expect((await call('loader', 'POST', `/api/loader/trips/${trip1}/claim`, { device: 'Tablet A' })).status).toBe(200);
    const other = await call('dispatcher', 'POST', `/api/loader/trips/${trip1}/claim`, { device: 'Office' });
    expect(other.status).toBe(409); expect(other.body.code).toBe('TRIP_CLAIMED');
    const d = (await call('dispatcher', 'GET', `/api/loader/trips/${trip1}`)).body;
    expect((await call('dispatcher', 'POST', `/api/loader/trips/${trip1}/lines/${d.lines[0].orderId}`, { state: 'loaded' })).status).toBe(409);
    expect((await call('dispatcher', 'POST', `/api/loader/trips/${trip1}/claim`, { takeOver: true })).status).toBe(200);
    expect((await call('loader', 'POST', `/api/loader/trips/${trip1}/lines/${d.lines[0].orderId}`, { state: 'loaded' })).status).toBe(409);
    expect((await call('loader', 'POST', `/api/loader/trips/${trip1}/claim`, { takeOver: true })).status).toBe(200);
  });

  it('goods bigger than ordered: over capacity blocks release until the dispatcher decides', async () => {
    const d = (await call('loader', 'GET', `/api/loader/trips/${trip1}`)).body;
    const line = d.lines[d.lines.length - 1];
    const r = await call('loader', 'POST', `/api/loader/trips/${trip1}/lines/${line.orderId}/size`, { actualKg: 9000, actualM3: 60, note: 'Pallets double-stacked' });
    expect(r.status).toBe(200);
    for (const l of d.lines) await call('loader', 'POST', `/api/loader/trips/${trip1}/lines/${l.orderId}`, { state: 'loaded' });
    const rel = await call('loader', 'POST', `/api/loader/trips/${trip1}/release`);
    expect(rel.status).toBe(409);
    const ex = (await call('dispatcher', 'GET', '/api/exceptions')).body.find((e: any) => e.type === 'size_divergence' && e.status === 'open');
    expect(ex.detail.overCapacity).toBe(true);
    expect((await call('dispatcher', 'POST', `/api/exceptions/${ex.id}/resolve`, { decision: 'accept' })).status).toBe(400); // override needs a note
    expect((await call('dispatcher', 'POST', `/api/exceptions/${ex.id}/resolve`, { decision: 'remove_line' })).status).toBe(200);
    const rel2 = await call('loader', 'POST', `/api/loader/trips/${trip1}/release`);
    expect(rel2.status, JSON.stringify(rel2.body)).toBe(200);
    const def = await call('dispatcher', 'GET', '/api/deferrals');
    expect(def.body.deferrals.some((x: any) => x.order_id === line.orderId)).toBe(true);
  });

  it('proof photos are private to the outlet and the office', async () => {
    let run = (await call('driver', 'GET', '/api/driver/run')).body;
    if (run.trips[0].status !== 'released') {
      const id = run.trips[0].id;
      await call('loader', 'POST', `/api/loader/trips/${id}/claim`, { takeOver: true });
      for (const l of run.trips[0].lines) await call('loader', 'POST', `/api/loader/trips/${id}/lines/${l.orderId}`, { state: 'loaded' });
      const rel = await call('loader', 'POST', `/api/loader/trips/${id}/release`);
      expect(rel.status, JSON.stringify(rel.body)).toBe(200);
      run = (await call('driver', 'GET', '/api/driver/run')).body;
    }
    const t = run.trips[0];
    expect(t.status).toBe('released');
    const stop = t.stops[0];
    // an unreleased trip cannot start
    const ev = (type: string, outletId: string | null, at: string, payload: any = {}) => ({ clientEventId: randomUUID(), type, tripId: t.id, outletId, deviceTime: `${PLAN}T${at}:00+05:30`, payload });
    const s = await call('driver', 'POST', '/api/driver/sync', { events: [ev('trip_started', null, '04:05'), ev('delivered', stop.outletId, '05:10', { outcome: 'full', receiver: 'K. Silva', photo: JPEG })] });
    expect(s.body.results.map((r: any) => r.status)).toEqual(['applied', 'applied']);
    const noReceiver = await call('driver', 'POST', '/api/driver/sync', { events: [ev('delivered', t.stops[1].outletId, '05:40', { outcome: 'full' })] });
    expect(noReceiver.body.results[0].status).toBe('rejected');
    const detail = (await call('dispatcher', 'GET', `/api/trips/${t.id}`)).body;
    const url = detail.stops[0].outcome.photoUrl;
    expect(url).toMatch(/^\/api\/files\//);
    const office = await call('dispatcher', 'GET', url);
    expect(office.status).toBe(200); expect(office.headers['content-type']).toBe('image/jpeg');
    tokens.outletMgr = tokens.store;
    const other = await call('store2', 'GET', url);
    expect(other.status).toBe(403);
    expect((await call('store', 'GET', `/api/trips/${t.id}`)).status).toBe(403);
    const fake = await call('driver', 'POST', '/api/driver/sync', { events: [ev('problem', null, '05:50', { kind: 'road', photo: 'data:image/jpeg;base64,aGVsbG8=' })] });
    expect(fake.body.results[0].status).toBe('rejected'); // not really a JPEG
  });

  it('stores edit and cancel their upcoming orders', async () => {
    const p = await call('store', 'POST', '/api/store/orders', { temp: 'ambient', lines: [{ category: 'Dry grocery', units: 10 }] });
    if (p.status !== 200) console.log(p.body);
    expect(p.status).toBe(200);
    const again = await call('store', 'POST', '/api/store/orders', { temp: 'ambient', lines: [{ category: 'Dry grocery', units: 3 }] });
    expect(again.status).toBe(409);
    const e = await call('store', 'PATCH', `/api/store/orders/${p.body.id}`, { lines: [{ category: 'Dry grocery', units: 14 }] });
    expect(e.status).toBe(200); expect(e.body.units).toBe(14);
    expect((await call('store2', 'PATCH', `/api/store/orders/${p.body.id}`, { lines: [{ category: 'Dry grocery', units: 1 }] })).status).toBe(404);
    expect((await call('store', 'DELETE', `/api/store/orders/${p.body.id}`, { reason: '' })).status).toBe(400);
    expect((await call('store', 'DELETE', `/api/store/orders/${p.body.id}`, { reason: 'Ordered twice by mistake' })).status).toBe(200);
    const h = await call('store', 'GET', '/api/store/history?status=cancelled&days=30');
    expect(h.body.orders.some((o: any) => o.id === p.body.id)).toBe(true);
  });

  it('sign-in is rate limited per address', async () => {
    let last = 0;
    for (let i = 0; i < 32; i++) last = (await call('', 'POST', '/api/auth/login', { email: 'nobody@pathwise.lk', password: 'x' }, '10.9.9.9')).status;
    expect(last).toBe(429);
  });
});
