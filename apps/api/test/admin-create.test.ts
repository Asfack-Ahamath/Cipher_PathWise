/* Admin adds a vehicle and an outlet, then people for them; the new outlet orders, the planner puts it on
   the new vehicle, the plan is published, and the new driver and store manager see it.
   Runs against a real PostgreSQL (DATABASE_URL). */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

let app: FastifyInstance;
const tokens: Record<string, string> = {};
const call = async (who: string, method: string, url: string, body?: unknown) => {
  const r = await app.inject({ method: method as any, url, payload: body as any, headers: tokens[who] ? { authorization: `Bearer ${tokens[who]}` } : {} });
  let json: any = null; try { json = r.json(); } catch { json = r.body; }
  return { status: r.statusCode, body: json };
};
const login = async (who: string, email: string, password = 'PathWise@2026') => {
  const r = await call('', 'POST', '/api/auth/login', { email, password });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  tokens[who] = r.body.token;
};
const PLAN = '2026-04-30';
const PW = 'NewPeople@2026';
const stamp = Date.now();
let vehicleId = '', outletId = '', outlet2Id = '';

beforeAll(async () => {
  const { migrate } = await import('../src/migrate.js');
  const { seedIfEmpty, resetDay } = await import('../src/seed/seed.js');
  const { loadClock } = await import('../src/clock.js');
  const { buildServer } = await import('../src/server.js');
  const { pool } = await import('../src/db.js');
  const { hashPassword } = await import('../src/auth.js');
  await migrate(() => {}); await seedIfEmpty(() => {}); await resetDay(() => {}); await loadClock();
  // re-runnable: remove what an earlier run of this file created
  await pool.query(`UPDATE users SET is_active = false, role = 'dispatcher', outlet_id = NULL, vehicle_id = NULL, depot = NULL WHERE email LIKE 'test.%@pathwise.lk'`);
  await pool.query(`DELETE FROM orders WHERE outlet_id IN (SELECT id FROM outlets WHERE name LIKE 'Test outlet%')`); // reset seeds demo orders for every outlet
  await pool.query(`DELETE FROM outlets WHERE name LIKE 'Test outlet%'`);
  await pool.query(`DELETE FROM vehicles WHERE driver_name = 'Test Driver'`);
  await pool.query(`DELETE FROM district_travel WHERE district = 'Ratnapura'`);
  await pool.query(`UPDATE users SET password_hash = $1, must_change_password = false, failed_logins = 0, locked_until = NULL, is_active = true WHERE email IN ('admin@pathwise.lk','dispatcher@pathwise.lk')`, [await hashPassword('PathWise@2026')]);
  const { invalidateNetwork } = await import('../src/services/network.js');
  invalidateNetwork();
  app = await buildServer();
  await login('admin', 'admin@pathwise.lk');
  await login('dispatcher', 'dispatcher@pathwise.lk');
}, 60000);
afterAll(async () => { await app?.close(); const { pool } = await import('../src/db.js'); await pool.end(); });

describe('admin adds vehicles and outlets', () => {
  it('suggests the next free ids', async () => {
    const r = await call('admin', 'GET', '/api/admin/next-ids');
    expect(r.status).toBe(200);
    expect(r.body.vehicle).toMatch(/^VEH\d{3}$/);
    expect(r.body.outlet).toMatch(/^OUT\d{3}$/);
  });

  it('only an admin can add', async () => {
    expect((await call('dispatcher', 'POST', '/api/admin/vehicles', {})).status).toBe(403);
    expect((await call('dispatcher', 'POST', '/api/admin/outlets', {})).status).toBe(403);
  });

  it('adds a vehicle with the next id and rejects bad input', async () => {
    const bad = await call('admin', 'POST', '/api/admin/vehicles', { type: 'lorry', temp: 'ambient', depot: 'Peliyagoda', weightCap: -1, volumeCap: 10, kmPerL: 5, fuelQuotaL: 400, driverName: 'X' });
    expect(bad.status).toBe(400);
    const r = await call('admin', 'POST', '/api/admin/vehicles', { type: 'truck', temp: 'ambient', depot: 'Peliyagoda', weightCap: 5510, volumeCap: 26.4, kmPerL: 4.7, fuelQuotaL: 450, driverName: 'Test Driver' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    vehicleId = r.body.id;
    expect(vehicleId).toMatch(/^VEH\d{3}$/);
    expect(r.body).toMatchObject({ type: 'truck', temp: 'ambient', depot: 'Peliyagoda', status: 'available', driverName: 'Test Driver' });
    const dup = await call('admin', 'POST', '/api/admin/vehicles', { id: vehicleId, type: 'van', temp: 'ambient', depot: 'Kandy', weightCap: 1100, volumeCap: 8, kmPerL: 11, fuelQuotaL: 400, driverName: 'Test Driver' });
    expect(dup.status).toBe(409);
    const workshopNoReason = await call('admin', 'POST', '/api/admin/vehicles', { type: 'van', temp: 'ambient', depot: 'Kandy', weightCap: 1100, volumeCap: 8, kmPerL: 11, fuelQuotaL: 400, driverName: 'Test Driver', status: 'in_workshop' });
    expect(workshopNoReason.status).toBe(400);
  });

  it('the planner and every screen see the new vehicle at once', async () => {
    const ref = await call('dispatcher', 'GET', '/api/reference');
    expect(ref.body.vehicles.some((v: any) => v.id === vehicleId)).toBe(true);
    expect((await call('admin', 'GET', '/api/admin/vehicles')).body.some((v: any) => v.id === vehicleId)).toBe(true);
  });

  it('adds an outlet in a district the depot already serves', async () => {
    const r = await call('admin', 'POST', '/api/admin/outlets', { name: 'Test outlet Colombo', brand: 'Style', depot: 'Peliyagoda', district: 'colombo', dock: 'street', parking: 'normal', open: '08:00', close: '18:00' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    outlet2Id = r.body.id;
    expect(r.body.district).toBe('Colombo');           // matched to the existing spelling
    expect(r.body.lat).toBeGreaterThan(6);              // placed on the map in its district
  });

  it('a new district needs travel times; with them the outlet is added', async () => {
    const base = { name: 'Test outlet Ratnapura', brand: 'Style', depot: 'Peliyagoda', district: 'Ratnapura', dock: 'street', parking: 'normal', open: '07:00', close: '20:00' };
    const missing = await call('admin', 'POST', '/api/admin/outlets', base);
    expect(missing.status).toBe(400);
    expect(missing.body.error).toMatch(/travel times/);
    const badWindow = await call('admin', 'POST', '/api/admin/outlets', { ...base, open: '20:00', close: '07:00' });
    expect(badWindow.status).toBe(400);
    const r = await call('admin', 'POST', '/api/admin/outlets', { ...base, travel: { outMin: 110, interMin: 10, outKm: 95, interKm: 6, roadClass: 'hill' } });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    outletId = r.body.id;
    expect(r.body).toMatchObject({ brand: 'Style', district: 'Ratnapura', depot: 'Peliyagoda', isActive: true });
    const travel = await call('admin', 'GET', '/api/admin/travel');
    expect(travel.body.some((t: any) => t.depot === 'Peliyagoda' && t.district === 'Ratnapura' && t.outMin === 110)).toBe(true);
    expect((await call('admin', 'POST', '/api/admin/outlets', { ...base, id: outletId })).status).toBe(409);
  });

  it('adds a driver for the new vehicle and a store manager for the new outlet; both can sign in', async () => {
    const d = await call('admin', 'POST', '/api/admin/users', { email: `test.driver.${stamp}@pathwise.lk`, name: 'Test Driver', role: 'driver', vehicleId, password: PW });
    expect(d.status, JSON.stringify(d.body)).toBe(200);
    expect(d.body.user).toMatchObject({ vehicleId, depot: 'Peliyagoda' });
    const s = await call('admin', 'POST', '/api/admin/users', { email: `test.store.${stamp}@pathwise.lk`, name: 'Test Store', role: 'store_manager', outletId, password: PW });
    expect(s.status, JSON.stringify(s.body)).toBe(200);
    await login('newDriver', `test.driver.${stamp}@pathwise.lk`, PW);
    await login('newStore', `test.store.${stamp}@pathwise.lk`, PW);
  });

  it('the new outlet orders; the order is planned on the new vehicle, published, and both people see it', async () => {
    // the new store places an order through the app; the demo day's cut-off has passed, so it is for the next run
    const placed = await call('newStore', 'POST', '/api/store/orders', { temp: 'ambient', lines: [{ category: 'Casualwear (cartons)', units: 40 }] });
    expect(placed.status, JSON.stringify(placed.body)).toBe(200);
    expect(placed.body.deliveryDate > PLAN).toBe(true);
    // an order for the demo day itself (as if confirmed before the cut-off)
    const { pool } = await import('../src/db.js');
    const amb = `TSA${String(stamp).slice(-7)}`;
    await pool.query(`INSERT INTO orders (id, outlet_id, delivery_date, temp, units, kg, m3, description, source, status, submitted_at)
      VALUES ($1, $2, $3, 'ambient', 40, 560, 11.2, '40 Casualwear (cartons)', 'phone', 'confirmed', now())`, [amb, outletId, PLAN]);
    // a Style store cannot order chilled goods
    expect((await call('newStore', 'POST', '/api/store/orders', { temp: 'chilled', lines: [{ category: 'Dairy', units: 5 }] })).status).toBe(400);

    let board: any;
    expect((await call('dispatcher', 'POST', `/api/plans/${PLAN}/auto`)).status).toBe(200);
    board = await call('dispatcher', 'GET', `/api/plans/${PLAN}`);
    // the engine already uses the new truck for other stops; give Ratnapura a trip of its own (one district per trip)
    const used = board.body.trips.filter((t: any) => t.vehicleId === vehicleId && !t.orderIds.includes(amb));
    expect(used.length).toBeLessThan(3);
    const mv = await call('dispatcher', 'POST', `/api/plans/${PLAN}/move`, { orderId: amb, target: { vehicleId, trip: used.length + 1 } });
    expect(mv.status, JSON.stringify(mv.body)).toBe(200);
    board = await call('dispatcher', 'GET', `/api/plans/${PLAN}`);
    const newTrip = board.body.trips.find((t: any) => t.vehicleId === vehicleId && t.orderIds.includes(amb));
    expect(newTrip, 'order on the new vehicle').toBeTruthy();
    expect(newTrip.stops.map((s: any) => s.outletId)).toEqual([outletId]);
    expect(newTrip.km).toBeGreaterThan(150);             // 95 km out and back, from the travel times we entered
    expect(board.body.issues.filter((i: any) => i.severity === 'error' && JSON.stringify(i).includes(vehicleId))).toEqual([]);

    const pub = await call('dispatcher', 'POST', `/api/plans/${PLAN}/publish`);
    expect(pub.status, JSON.stringify(pub.body)).toBe(200);

    // the new driver's phone shows the run with the new outlet
    const run = await call('newDriver', 'GET', '/api/driver/run');
    expect(run.status, JSON.stringify(run.body)).toBe(200);
    expect(run.body.vehicle.id).toBe(vehicleId);
    expect(run.body.trips.flatMap((t: any) => t.stops.map((s: any) => s.outletId))).toContain(outletId);
    // the new store sees its delivery with an arrival time
    const home = await call('newStore', 'GET', '/api/store/overview');
    expect(home.status, JSON.stringify(home.body)).toBe(200);
    const del = home.body.deliveries.find((x: any) => x.vehicleId === vehicleId);
    expect(del?.eta).toMatch(/^\d{2}:\d{2}$/);
    // and tracking shows the trip on the map
    const tr = await call('dispatcher', 'GET', '/api/tracking');
    expect(tr.body.trips.some((t: any) => t.vehicleId === vehicleId && t.stops[0].lat)).toBe(true);
  });

  it('the other new outlet can be edited and deactivated like any other', async () => {
    const r = await call('admin', 'PATCH', `/api/admin/outlets/${outlet2Id}`, { isActive: false });
    expect(r.status).toBe(200);
    expect(r.body.isActive).toBe(false);
    const ref = await call('dispatcher', 'GET', '/api/reference');
    expect(ref.body.outlets.some((o: any) => o.id === outlet2Id)).toBe(false);
  });
});
