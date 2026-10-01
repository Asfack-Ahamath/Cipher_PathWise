/* AUTH_PROVIDER=supabase + STORAGE_PROVIDER=supabase against a mock Supabase, on a fresh database
   that has Supabase's roles (anon, authenticated) and auth.uid() — so row-level security is exercised too. */
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { startSupabaseMock } from './supabase-mock.js';

const BASE = process.env.DATABASE_URL!;
const DB = `pw_sb_${Date.now()}`;
const saved = { ...process.env };
let app: FastifyInstance;
let mock: Awaited<ReturnType<typeof startSupabaseMock>>;
const tokens: Record<string, string> = {};
const call = async (who: string, method: string, url: string, body?: unknown) => {
  const r = await app.inject({ method: method as any, url, payload: body as any, headers: tokens[who] ? { authorization: `Bearer ${tokens[who]}` } : {} });
  let json: any = null; try { json = r.json(); } catch { json = r.body; }
  return { status: r.statusCode, body: json, headers: r.headers };
};
const admin = new pg.Client({ connectionString: BASE });

beforeAll(async () => {
  mock = await startSupabaseMock({ anon: 'anon-key', service: 'service-key' });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${DB}`);
  // what a Supabase project already has before our migrations run
  const url = BASE.replace(/\/[^/]+$/, `/${DB}`);
  const c = new pg.Client({ connectionString: url }); await c.connect();
  await c.query(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
    END $$;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $f$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $f$;
    GRANT USAGE ON SCHEMA auth, public TO anon, authenticated;
    GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;`);
  await c.end();
  Object.assign(process.env, {
    DATABASE_URL: url, AUTH_PROVIDER: 'supabase', STORAGE_PROVIDER: 'supabase', SUPABASE_URL: mock.url, SUPABASE_ANON_KEY: 'anon-key', SUPABASE_SERVICE_ROLE_KEY: 'service-key',
    SUPABASE_STORAGE_BUCKET: 'pathwise-proofs', ADMIN_PASSWORD: 'AdminPass2026',
  });
  const { migrate } = await import('../src/migrate.js');
  const { seedIfEmpty } = await import('../src/seed/seed.js');
  const { loadClock } = await import('../src/clock.js');
  const { buildServer } = await import('../src/server.js');
  await migrate(() => {}); await seedIfEmpty(() => {}); await loadClock();
  app = await buildServer();
}, 90000);
afterAll(async () => {
  await app?.close();
  const { pool } = await import('../src/db.js'); await pool.end();
  await admin.query(`DROP DATABASE IF EXISTS ${DB}`); await admin.end();
  await mock?.close();
  process.env = saved;
});

describe('Supabase Auth', () => {
  it('seeding created an auth user for every account and kept no local password hashes', async () => {
    const { pool } = await import('../src/db.js');
    const r = await pool.query(`SELECT count(*)::int AS n, count(auth_user_id)::int AS linked, count(password_hash)::int AS hashes FROM users`);
    expect(r.rows[0].n).toBe(9); expect(r.rows[0].linked).toBe(9); expect(r.rows[0].hashes).toBe(0);
    expect(mock.state.users.size).toBe(9);
  });
  it('signs in through Supabase and still issues PathWise sessions', async () => {
    expect((await call('', 'POST', '/api/auth/login', { email: 'admin@pathwise.lk', password: 'PathWise@2026' })).status).toBe(401);
    const a = await call('', 'POST', '/api/auth/login', { email: 'admin@pathwise.lk', password: 'AdminPass2026' });
    expect(a.status).toBe(200); tokens.admin = a.body.token;
    const d = await call('', 'POST', '/api/auth/login', { email: 'driver@pathwise.lk', password: 'PathWise@2026' });
    expect(d.status).toBe(200); tokens.driver = d.body.token;
    expect((await call('', 'POST', '/api/auth/pin', { pin: '2468', depot: 'Kandy' })).status).toBe(200); // PINs stay local
  });
  it('admin-created users live in Supabase; disabling bans them there', async () => {
    const r = await call('admin', 'POST', '/api/admin/users', { email: 'sb.store@pathwise.lk', name: 'SB Store', role: 'store_manager', outletId: 'OUT010' });
    expect(r.status).toBe(200);
    const sb = [...mock.state.users.values()].find(u => u.email === 'sb.store@pathwise.lk')!;
    expect(sb.password).toBe(r.body.temporaryPassword);
    expect(sb.app_metadata.app_role).toBe('store_manager');
    await call('admin', 'PATCH', `/api/admin/users/${r.body.user.id}`, { isActive: false });
    expect(sb.banned).toBe(true);
  });
  it('password change and email recovery go through Supabase', async () => {
    const s = await call('', 'POST', '/api/auth/login', { email: 'store@pathwise.lk', password: 'PathWise@2026' });
    tokens.store = s.body.token;
    const c = await call('store', 'POST', '/api/me/password', { current: 'PathWise@2026', next: 'StorePass2026' });
    expect(c.status).toBe(200);
    expect([...mock.state.users.values()].find(u => u.email === 'store@pathwise.lk')!.password).toBe('StorePass2026');
    const f = await call('', 'POST', '/api/auth/forgot', { email: 'store@pathwise.lk' });
    expect(f.status).toBe(200); expect(mock.state.recoveries).toContain('store@pathwise.lk');
    const unknown = await call('', 'POST', '/api/auth/forgot', { email: 'nobody@pathwise.lk' });
    expect(unknown.body.message).toBe(f.body.message); // no account enumeration
    const token = [...mock.state.tokens.keys()][0];
    const done = await call('', 'POST', '/api/auth/recover', { accessToken: token, password: 'Recovered2026x' });
    expect(done.status).toBe(200); expect(done.body.user.email).toBe('store@pathwise.lk');
    expect((await call('', 'POST', '/api/auth/login', { email: 'store@pathwise.lk', password: 'Recovered2026x' })).status).toBe(200);
    expect((await call('', 'POST', '/api/auth/recover', { accessToken: token, password: 'Another2026x' })).status).toBe(400); // single use
  });
});

describe('Supabase Storage', () => {
  it('proof photos go to the private bucket and are served through short-lived signed URLs', async () => {
    const { pool } = await import('../src/db.js');
    // release VEH041's trip directly so the driver can deliver
    await call('admin', 'POST', `/api/plans/2026-04-30/auto`);
    expect((await call('admin', 'POST', `/api/plans/2026-04-30/publish`)).status).toBe(200);
    const trip = (await pool.query(`SELECT id FROM trips WHERE vehicle_id = 'VEH041' AND trip_no = 1`)).rows[0];
    await pool.query(`UPDATE trips SET status = 'released' WHERE id = $1`, [trip.id]);
    const run = (await call('driver', 'GET', '/api/driver/run')).body;
    const stop = run.trips[0].stops[0].outletId;
    const jpeg = `data:image/jpeg;base64,${Buffer.from('ffd8ffe000104a46494600010100000100010000ffd9', 'hex').toString('base64')}`;
    const ev = (type: string, outletId: string | null, at: string, payload: any = {}) => ({ clientEventId: randomUUID(), type, tripId: trip.id, outletId, deviceTime: `2026-04-30T${at}:00+05:30`, payload });
    const s = await call('driver', 'POST', '/api/driver/sync', { events: [ev('trip_started', null, '04:05'), ev('delivered', stop, '05:10', { outcome: 'full', receiver: 'K. Silva', photo: jpeg })] });
    expect(s.body.results.map((r: any) => r.status)).toEqual(['applied', 'applied']);
    expect(mock.state.buckets.has('pathwise-proofs')).toBe(true);
    expect([...mock.state.objects.keys()].some(k => k.startsWith(`pathwise-proofs/pod_photo/${stop}/`))).toBe(true);
    const a = (await pool.query(`SELECT id, storage, data FROM attachments`)).rows[0];
    expect(a.storage).toBe('supabase'); expect(a.data).toBeNull();
    const f = await call('driver', 'GET', `/api/files/${a.id}`);
    expect(f.status).toBe(302); expect(String(f.headers.location)).toContain(`${mock.url}/storage/v1/object/sign/pathwise-proofs/`);
  });
});

describe('row-level security for the Supabase Data API', () => {
  const asUser = async (authId: string | null, sql: string) => {
    const { pool } = await import('../src/db.js');
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query(`SET LOCAL ROLE ${authId ? 'authenticated' : 'anon'}`);
      if (authId) await c.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [authId]);
      return (await c.query(sql)).rows;
    } finally { await c.query('ROLLBACK'); c.release(); }
  };
  it('anon sees nothing; nobody can write', async () => {
    await expect(asUser(null, 'SELECT * FROM outlets')).rejects.toThrow(/permission denied/);
    const { pool } = await import('../src/db.js');
    const store = (await pool.query(`SELECT auth_user_id FROM users WHERE email = 'store@pathwise.lk'`)).rows[0].auth_user_id;
    await expect(asUser(store, `UPDATE orders SET units = 1`)).rejects.toThrow(/permission denied/);
    expect(await asUser(store, `SELECT * FROM attachments`)).toHaveLength(0);   // no policy → no rows
    expect(await asUser(store, `SELECT * FROM settings`)).toHaveLength(0);
  });
  it('a store manager reads only their outlet; a driver only their vehicle; audit is admin-only', async () => {
    const { pool } = await import('../src/db.js');
    const id = async (email: string) => (await pool.query(`SELECT auth_user_id FROM users WHERE email = $1`, [email])).rows[0].auth_user_id;
    const orders = await asUser(await id('store@pathwise.lk'), 'SELECT DISTINCT outlet_id FROM orders');
    expect(orders.map(r => r.outlet_id)).toEqual(['OUT116']);
    const trips = await asUser(await id('driver@pathwise.lk'), 'SELECT DISTINCT vehicle_id FROM trips');
    expect(trips.map(r => r.vehicle_id)).toEqual(['VEH041']);
    expect(await asUser(await id('driver@pathwise.lk'), 'SELECT * FROM audit_log')).toHaveLength(0);
    expect((await asUser(await id('admin@pathwise.lk'), 'SELECT count(*)::int AS n FROM audit_log'))[0].n).toBeGreaterThan(0);
    expect(await asUser(randomUUID(), 'SELECT * FROM outlets')).toHaveLength(0); // signed in to Supabase but not a PathWise user
  });
});
