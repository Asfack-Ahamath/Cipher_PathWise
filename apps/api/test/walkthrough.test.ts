/* End-to-end walkthrough across all four roles, against a real PostgreSQL (DATABASE_URL).
   Mirrors the numbered judge walkthrough in the README. */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

let app: FastifyInstance;
const tokens: Record<string, string> = {};
const call = async (who: string, method: string, url: string, body?: unknown) => {
  const r = await app.inject({ method: method as any, url, payload: body as any, headers: tokens[who] ? { authorization: `Bearer ${tokens[who]}` } : {} });
  return { status: r.statusCode, body: r.json() as any };
};
const PLAN = '2026-04-30';

beforeAll(async () => {
  const { migrate } = await import('../src/migrate.js');
  const { seedIfEmpty, resetDay } = await import('../src/seed/seed.js');
  const { loadClock } = await import('../src/clock.js');
  const { buildServer } = await import('../src/server.js');
  await migrate(() => {}); await seedIfEmpty(() => {}); await resetDay(() => {}); await loadClock();
  app = await buildServer();
  for (const [who, email] of [['dispatcher', 'dispatcher@pathwise.lk'], ['driver', 'driver@pathwise.lk'], ['store', 'store@pathwise.lk'], ['driver2', 'driver.veh039@pathwise.lk']]) {
    const r = await call('', 'POST', '/api/auth/login', { email, password: 'PathWise@2026' });
    expect(r.status).toBe(200); tokens[who] = r.body.token;
  }
  const pin = await call('', 'POST', '/api/auth/login', { pin: '2468', depot: 'Kandy' });
  expect(pin.status).toBe(200); tokens.loader = pin.body.token;
}, 60000);
afterAll(async () => { await app?.close(); const { pool } = await import('../src/db.js'); await pool.end(); });

describe('judge walkthrough', () => {
  let tripId = 0;
  it('1. store manager sees the confirmed order and places the next one', async () => {
    const o = await call('store', 'GET', '/api/store/overview');
    expect(o.status).toBe(200);
    expect(o.body.orders.map((x: any) => x.id)).toEqual(expect.arrayContaining(['ORD0093173', 'ORD0093174']));
    const w = await call('store', 'GET', '/api/store/order-window');
    expect(w.body.deliveryDate).toBe('2026-05-02'); // Fri 1 May is Vesak
    const p = await call('store', 'POST', '/api/store/orders', { temp: 'chilled', lines: [{ category: 'Dairy', units: 8 }, { category: 'Meat and fish', units: 2 }] });
    expect(p.status).toBe(200); expect(p.body.deliveryDate).toBe('2026-05-02');
  });

  it('2. dispatcher auto-plans a day where demand exceeds capacity and publishes', async () => {
    const r = await call('dispatcher', 'POST', `/api/plans/${PLAN}/auto`);
    expect(r.status).toBe(200);
    expect(r.body.view.errors).toBe(0);
    expect(r.body.stats.deferred).toBeGreaterThan(0);
    expect(r.body.view.unassigned.every((u: any) => u.proposal?.reason)).toBe(true);
    // a manual move that breaks a rule is caught
    const chilled = r.body.view.orders.find((o: any) => o.id === 'ORD0093173');
    const bad = await call('dispatcher', 'POST', `/api/plans/${PLAN}/move`, { orderId: chilled.id, target: { vehicleId: 'VEH044', trip: 1 } });
    expect(bad.body.issues.some((i: any) => i.code === 'reefer_required')).toBe(true);
    const blocked = await call('dispatcher', 'POST', `/api/plans/${PLAN}/publish`);
    expect(blocked.status).toBe(409);
    await call('dispatcher', 'POST', `/api/plans/${PLAN}/auto`);
    const pub = await call('dispatcher', 'POST', `/api/plans/${PLAN}/publish`);
    expect(pub.status).toBe(200);
    expect(pub.body.deferred).toBeGreaterThan(0);
    const n = await call('store', 'GET', '/api/notifications');
    expect(n.body.items.some((i: any) => i.kind === 'planned')).toBe(true);
  });

  it('3. loader loads VEH041 in stop order, flags a shortfall, gets a decision and releases', async () => {
    const q = await call('loader', 'GET', '/api/loader/queue');
    const t = q.body.trips.find((x: any) => x.vehicleId === 'VEH041');
    expect(t).toBeTruthy(); tripId = t.id;
    const d = await call('loader', 'GET', `/api/loader/trips/${tripId}`);
    const lines = d.body.stops.flatMap((s: any) => s.lines);
    for (const l of lines.filter((l: any) => l.orderId !== 'ORD0093173')) expect((await call('loader', 'POST', `/api/loader/trips/${tripId}/lines/${l.orderId}`, { state: 'loaded' })).status).toBe(200);
    const f = await call('loader', 'POST', `/api/loader/trips/${tripId}/lines/ORD0093173/flag`, { reason: 'missing', loadedUnits: 10, item: 'yoghurt cases' });
    expect(f.status).toBe(200);
    expect((await call('loader', 'POST', `/api/loader/trips/${tripId}/release`)).status).toBe(409);
    const ex = (await call('dispatcher', 'GET', '/api/exceptions')).body.find((e: any) => e.type === 'dock_shortfall' && e.status === 'open');
    expect((await call('dispatcher', 'POST', `/api/exceptions/${ex.id}/resolve`, { decision: 'send_partial' })).status).toBe(200);
    const rel = await call('loader', 'POST', `/api/loader/trips/${tripId}/release`);
    expect(rel.status).toBe(200); expect(rel.body.status).toBe('released');
    const def = (await call('store', 'GET', '/api/store/overview')).body.deferrals;
    expect(def.some((x: any) => x.reason === 'dock_shortfall' && x.units === 2)).toBe(true);
  });

  it('4. driver delivers offline; a stop moved meanwhile becomes a conflict the dispatcher resolves', async () => {
    const run = await call('driver', 'GET', '/api/driver/run');
    const trip = run.body.trips[0]; expect(trip.id).toBe(tripId);
    const stops = trip.stops.map((s: any) => s.outletId);
    const last = stops[stops.length - 1];
    const ev = (type: string, outletId: string | null, at: string, payload: any = {}) => ({ clientEventId: randomUUID(), type, tripId, outletId, deviceTime: `${PLAN}T${at}:00+05:30`, payload });
    // online: start and first stop
    let s = await call('driver', 'POST', '/api/driver/sync', { events: [ev('trip_started', null, '04:10'), ev('arrived', stops[0], '05:01'), ev('delivered', stops[0], '05:17', { outcome: 'full', receiver: 'A. Perera' })] });
    expect(s.body.results.every((r: any) => r.status === 'applied')).toBe(true);
    // the phone goes quiet; at 05:55 the dispatcher moves the last stop to VEH039
    await call('dispatcher', 'PUT', '/api/clock', { at: `${PLAN}T05:55:00+05:30` });
    const opts = await call('dispatcher', 'GET', `/api/trips/${tripId}/move-options?outletId=${last}`);
    console.log(opts.body.map((o: any) => `${o.vehicleId} T${o.trip} ${o.depart} eta ${o.eta} ${o.ok ? 'OK' : o.problem}`));
    const pick = opts.body.find((o: any) => o.ok);
    expect(pick).toBeTruthy();
    const mv = await call('dispatcher', 'POST', `/api/trips/${tripId}/move-stop`, { outletId: last, toVehicleId: pick.vehicleId, reason: 'VEH041 out of signal on the Kandy–Kegalle road.' });
    if (mv.status !== 200) console.log(mv.body);
    expect(mv.status).toBe(200);
    // 06:51: signal back; the phone uploads everything it saved, including the moved stop
    await call('dispatcher', 'PUT', '/api/clock', { at: `${PLAN}T06:51:00+05:30` });
    const offline = stops.slice(1).map((o: string, i: number) => ev('delivered', o, ['05:46', '06:15', '06:42', '06:55'][i] ?? '06:58', { outcome: o === 'OUT116' ? 'partial' : 'full', receiver: 'Store staff' }));
    s = await call('driver', 'POST', '/api/driver/sync', { events: offline });
    expect(s.body.results.some((r: any) => r.status === 'conflict')).toBe(true);
    // replaying the same events is safe
    const again = await call('driver', 'POST', '/api/driver/sync', { events: offline });
    expect(again.body.results.every((r: any) => r.status === 'duplicate')).toBe(true);
    const ex = (await call('dispatcher', 'GET', '/api/exceptions')).body.find((e: any) => e.type === 'sync_conflict' && e.status === 'open');
    expect(ex).toBeTruthy();
    expect((await call('dispatcher', 'POST', `/api/exceptions/${ex.id}/resolve`, { decision: 'keep_driver' })).status).toBe(200);
    const close = await call('driver', 'POST', '/api/driver/sync', { events: [ev('trip_closed', null, '07:15')] });
    expect(close.body.results[0].status).toBe('applied');
  });

  it('5. store manager confirms receipt and reports a short line', async () => {
    const o = await call('store', 'GET', '/api/store/overview');
    expect(o.body.delivery.delivered).toBeTruthy();
    const lines = o.body.toConfirm.map((x: any) => ({ orderId: x.id, status: x.temp === 'chilled' ? 'short' : 'ok', received: x.temp === 'chilled' ? x.units - 1 : x.units, expected: x.units }));
    const r = await call('store', 'POST', '/api/store/receipts', { orderId: lines[0].orderId, lines });
    expect(r.status).toBe(200); expect(r.body.issues).toBe(1);
    const ex = (await call('dispatcher', 'GET', '/api/exceptions')).body.find((e: any) => e.type === 'receipt_issue');
    expect(ex).toBeTruthy();
  });

  it('dispatcher read models respond', async () => {
    for (const u of ['/api/overview', '/api/tracking', '/api/forecast', '/api/deferrals', '/api/orders']) expect((await call('dispatcher', 'GET', u)).status).toBe(200);
    expect((await call('driver', 'GET', '/api/overview')).status).toBe(403);
  });
});
