import { step } from '../lib/console.js';
import bcrypt from 'bcryptjs';
import { CALENDAR_ROWS, DEMO_DAY, generateDemoOrders, ROAD_DISRUPTION, SKIPPED_YESTERDAY, TRAFFIC_SPEED, WEEKLY_DEMAND, type Outlet } from '@pathwise/core';
import { config } from '../config.js';
import { one, q, tx, type Db } from '../db.js';
import { setClock } from '../clock.js';
import { BCRYPT_COST } from '../lib/constants.js';
import { sbEnsureUser } from '../lib/supabase.js';
import { invalidateSettings } from '../lib/settings.js';
import { invalidateConditions, invalidateNetwork } from '../services/network.js';
import { loadDatasets, readCsv } from './datasets.js';

/* Assumed for the demo (the datasets do not include them): which vehicles are in the
   workshop, fuel already used this week, and drivers' names. */
const WORKSHOP: Record<string, string> = { VEH004: 'Brake service', VEH017: 'Gearbox repair', VEH025: 'Annual inspection', VEH058: 'Reefer unit repair' };
const FUEL_USED: Record<string, number> = { VEH002: 402, VEH035: 188, VEH012: 535.5, VEH009: 287, VEH041: 244, VEH057: 205, VEH039: 251, VEH047: 318, VEH042: 212 };
const DRIVERS = ['Lahiru Silva', 'Amila Dias', 'Pradeep Kumara', 'Sampath Fernando', 'Malith Wickrama', 'Chaminda Silva', 'Dinesh Kumara', 'Nuwan Rathnayake', 'Kamal Jayawardena', 'Saman Kumara', 'Ruwan Bandara', 'Chathura Perera', 'Isuru Herath', 'Tharindu Silva', 'Janaka Wijesinghe', 'Buddhika Rajapaksha', 'Mahesh Gunasekara', 'Asitha Fernando', 'Gayan Madushanka', 'Dilan Jayasuriya'];

/** The first administrator. Set ADMIN_EMAIL / ADMIN_PASSWORD before the first start; otherwise the demo
 *  password is used and (outside demo mode) must be changed at first sign-in. */
export const ADMIN_USER = { email: config.adminEmail, name: 'PathWise Administrator', role: 'admin', depot: null, outlet: null, vehicle: null, pin: null } as const;

export const DEMO_USERS = [
  { email: 'dispatcher@pathwise.lk', name: 'Nimal Perera', role: 'dispatcher', depot: null, outlet: null, vehicle: null, pin: null },
  { email: 'loader@pathwise.lk', name: 'Kasun Jayasinghe', role: 'loader', depot: 'Kandy', outlet: null, vehicle: null, pin: '2468' },
  { email: 'driver@pathwise.lk', name: 'Ruwan Bandara', role: 'driver', depot: 'Kandy', outlet: null, vehicle: 'VEH041', pin: null },
  { email: 'store@pathwise.lk', name: 'Sanduni Fernando', role: 'store_manager', depot: null, outlet: 'OUT116', vehicle: null, pin: null },
  // extra accounts for exploring (not needed for the walkthrough)
  { email: 'loader.peliyagoda@pathwise.lk', name: 'Jagath Silva', role: 'loader', depot: 'Peliyagoda', outlet: null, vehicle: null, pin: '1357' },
  { email: 'driver.veh039@pathwise.lk', name: 'Chaminda Silva', role: 'driver', depot: 'Kandy', outlet: null, vehicle: 'VEH039', pin: null },
  { email: 'store.style@pathwise.lk', name: 'Dilani Silva', role: 'store_manager', depot: null, outlet: 'OUT089', vehicle: null, pin: null },
  { email: 'store.tech@pathwise.lk', name: 'Asanka Senanayake', role: 'store_manager', depot: null, outlet: 'OUT024', vehicle: null, pin: null },
] as const;

/** Insert many rows with one statement per chunk (reference tables have thousands of rows). */
async function bulk(db: Db, table: string, cols: string[], rows: unknown[][], conflict = 'ON CONFLICT DO NOTHING') {
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const params: unknown[] = [];
    const values = chunk.map(r => `(${r.map(v => { params.push(v); return `$${params.length}`; }).join(',')})`).join(',');
    await q(`INSERT INTO ${table} (${cols.join(',')}) VALUES ${values} ${conflict}`, params, db);
  }
}
const HOLIDAY_NAMES: Record<string, string> = { vesak: 'Vesak Full Moon Poya', poson: 'Poson Full Moon Poya', esala: 'Esala Full Moon Poya', new_year: 'Sinhala & Tamil New Year', thai_pongal: 'Thai Pongal', deepavali: 'Deepavali', christmas: 'Christmas' };
const nice = (f: string) => HOLIDAY_NAMES[f] ?? f.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

/** calendar.csv (or the bundled copy): operating days, paydays, festivals, monsoon, ISO weeks. */
export function calendarRows(dir: string) {
  const csv = readCsv(dir, 'calendar.csv');
  const rows = csv
    ? csv.map(r => [r.date, Number(r.is_operating ?? 1), Number(r.is_payday ?? 0), r.festival ?? '', Number(r.festival_ramp ?? 0), Number(r.is_holiday ?? 0), Number(r.monsoon ?? 0), Number(r.iso_year), Number(r.iso_week)] as const)
    : CALENDAR_ROWS;
  return rows.map(([date, op, pay, fest, ramp, hol, mon, y, w]) => ({
    date, isOperating: !!op, isPayday: !!pay, festival: fest || null, festivalRamp: ramp, isHoliday: !!hol, monsoon: !!mon, isoYear: y, isoWeek: w,
    holiday: hol ? (fest ? nice(fest) : 'Public holiday') : null, dow: (new Date(date + 'T12:00:00Z').getUTCDay() + 6) % 7,
  }));
}

/** traffic_speed.csv, road_conditions.csv and weekly demand history. */
export async function seedConditions(db: Db, log: (m: string) => void = step) {
  const dir = config.dataDir;
  const tc = readCsv(dir, 'traffic_speed.csv');
  const traffic = tc ? tc.map(r => [r.district, Number(r.hour), r.monsoon === '1' || r.monsoon === 'true', Number(r.speed_index)])
    : Object.entries(TRAFFIC_SPEED).map(([k, v]) => { const [d, h, m] = k.split('|'); return [d, Number(h), m === '1', v]; });
  await bulk(db, 'traffic_speed', ['district', 'hour', 'monsoon', 'speed_index'], traffic, 'ON CONFLICT (district, hour, monsoon) DO UPDATE SET speed_index = EXCLUDED.speed_index');
  const rc = readCsv(dir, 'road_conditions.csv');
  const roads = rc ? rc.map(r => [r.district, r.date, Number(r.disruption_index)])
    : Object.entries(ROAD_DISRUPTION).map(([k, v]) => { const [d, date] = k.split('|'); return [d, date, v]; });
  await bulk(db, 'road_conditions', ['district', 'date', 'disruption_index'], roads, 'ON CONFLICT (district, date) DO UPDATE SET disruption_index = EXCLUDED.disruption_index');
  const weekly = WEEKLY_DEMAND.map(([k, total, chilled, orders]) => { const [depot, brand, yw] = k.split('|'); const [y, w] = yw.split('-').map(Number); return [depot, brand, y, w, 'history', total, chilled, orders]; });
  await bulk(db, 'demand_weekly', ['depot', 'brand', 'iso_year', 'iso_week', 'source', 'total_m3', 'chilled_m3', 'orders'], weekly, 'ON CONFLICT (depot, brand, iso_year, iso_week, source) DO NOTHING');
  invalidateConditions();
  log(`conditions: ${traffic.length} traffic rows${tc ? ' (CSV)' : ''}, ${roads.length} road-condition rows${rc ? ' (CSV)' : ''}, ${weekly.length} weekly demand rows`);
}

export async function seedReference(db: Db, log: (m: string) => void = step) {
  const ds = loadDatasets(config.dataDir, log);
  for (const o of ds.outlets) await q(`INSERT INTO outlets (id,name,brand,district,depot,dock,parking,open_time,close_time,mall_window,van_only,lat,lng) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT (id) DO NOTHING`,
    [o.id, o.name, o.brand, o.district, o.depot, o.dock, o.parking, o.open, o.close, o.mallWindow, o.vanOnly, o.lat, o.lng], db);
  let i = 0;
  for (const v of ds.vehicles) {
    const driver = v.id === 'VEH041' ? 'Ruwan Bandara' : v.id === 'VEH039' ? 'Chaminda Silva' : DRIVERS[i++ % DRIVERS.length];
    await q(`INSERT INTO vehicles (id,type,temp,depot,weight_cap,volume_cap,km_per_l,fuel_quota_l,fuel_used_l,status,status_note,driver_name) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT (id) DO NOTHING`,
      [v.id, v.type, v.temp, v.depot, v.weightCap, v.volumeCap, v.kmPerL, v.fuelQuotaL, FUEL_USED[v.id] ?? Math.round(v.fuelQuotaL * 0.45), WORKSHOP[v.id] ? 'in_workshop' : 'available', WORKSHOP[v.id] ?? null, driver], db);
  }
  for (const t of ds.travel) await q(`INSERT INTO district_travel VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`, [t.depot, t.district, t.outMin, t.interMin, t.outKm, t.interKm, t.roadClass], db);
  for (const [brand, docks] of Object.entries(ds.allowance)) for (const [dock, min] of Object.entries(docks)) await q(`INSERT INTO service_allowance VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [brand, dock, min], db);
  const cal = calendarRows(config.dataDir);
  await bulk(db, 'calendar', ['date', 'is_operating', 'is_payday', 'holiday', 'festival', 'festival_ramp', 'is_holiday', 'monsoon', 'iso_year', 'iso_week', 'dow'],
    cal.map(c => [c.date, c.isOperating, c.isPayday, c.holiday, c.festival, c.festivalRamp, c.isHoliday, c.monsoon, c.isoYear, c.isoWeek, c.dow]),
    `ON CONFLICT (date) DO UPDATE SET is_operating = EXCLUDED.is_operating, is_payday = EXCLUDED.is_payday, holiday = EXCLUDED.holiday, festival = EXCLUDED.festival,
       festival_ramp = EXCLUDED.festival_ramp, is_holiday = EXCLUDED.is_holiday, monsoon = EXCLUDED.monsoon, iso_year = EXCLUDED.iso_year, iso_week = EXCLUDED.iso_week, dow = EXCLUDED.dow`);
  await seedConditions(db, log);
  invalidateSettings();
}

/** Accounts. With AUTH_PROVIDER=supabase each person also gets a Supabase Auth user (created or linked by
 *  email) and no local password hash; loaders keep their dock PIN locally. */
export async function seedUsers(db: Db, log: (m: string) => void = step) {
  const people = [ADMIN_USER, ...(config.demoMode ? DEMO_USERS : [])];
  for (const u of people) {
    const isAdmin = u.role === 'admin';
    const password = isAdmin && config.adminPassword ? config.adminPassword : config.demoPassword;
    const mustChange = isAdmin && !config.adminPassword && !config.demoMode;
    let authId: string | null = null;
    if (config.authProvider === 'supabase') {
      try { authId = (await sbEnsureUser(u.email, password, u.role)).id; }
      catch (e: any) { throw new Error(`Could not create the Supabase Auth user ${u.email}: ${e.message}`); }
    }
    const hash = config.authProvider === 'supabase' ? null : await bcrypt.hash(password, BCRYPT_COST);
    await q(`INSERT INTO users (email,name,role,password_hash,pin_hash,depot,outlet_id,vehicle_id,auth_user_id,must_change_password) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      ON CONFLICT (email) DO UPDATE SET auth_user_id = coalesce(EXCLUDED.auth_user_id, users.auth_user_id)`,
      [u.email.toLowerCase(), u.name, u.role, hash, u.pin ? await bcrypt.hash(u.pin, BCRYPT_COST) : null, u.depot, u.outlet, u.vehicle, authId, mustChange], db);
  }
  log(`accounts: ${people.length}${config.authProvider === 'supabase' ? ' (linked to Supabase Auth)' : ''}`);
}

/** Operational data for the seeded day: 143 confirmed orders for Thu 30 Apr and last week's history. */
export async function seedDay(db: Db) {
  const outlets = (await q<any>(`SELECT id, brand, district, depot, dock, parking, open_time AS open, close_time AS close, mall_window AS "mallWindow", van_only AS "vanOnly", name FROM outlets`, [], db)) as Outlet[];
  const orders = generateDemoOrders(outlets, DEMO_DAY.date);
  const store = await one<{ id: number }>(`SELECT id FROM users WHERE email='store@pathwise.lk'`, [], db);
  for (const o of orders) {
    const phone = parseInt(o.id.slice(-2), 10) % 7 === 0;
    await q(`INSERT INTO orders (id,outlet_id,delivery_date,temp,units,kg,m3,description,source,status,submitted_at,deferred_yesterday,days_since_served,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'confirmed',$10,$11,$12,$13)`,
      [o.id, o.outletId, o.date, o.temp, o.units, o.kg, o.m3, o.description ?? null, phone ? 'phone' : 'app', phone ? '2026-04-29T15:42:00+05:30' : '2026-04-29T11:20:00+05:30', !!o.deferredYesterday, o.daysSinceServed ?? 1, o.outletId === 'OUT116' ? store?.id ?? null : null], db);
  }
  // Orders that came in after Wednesday's 16:00 cutoff roll to the next run (Sat 2 May)
  const late: [string, string, string, number, number, number, string][] = [
    ['ORD0093201', 'OUT006', 'ambient', 14, 300, 1.9, '2026-04-29T16:12:00+05:30'],
    ['ORD0093202', 'OUT024', 'ambient', 1, 380, 1.4, '2026-04-29T17:40:00+05:30'],
    ['ORD0093203', 'OUT119', 'ambient', 12, 260, 1.7, '2026-04-29T19:05:00+05:30'],
    ['ORD0093204', 'OUT005', 'ambient', 16, 350, 2.2, '2026-04-30T07:30:00+05:30'],
  ];
  for (const [id, out, temp, u, kg, m3, at] of late) await q(`INSERT INTO orders (id,outlet_id,delivery_date,temp,units,kg,m3,description,source,status,submitted_at,after_cutoff) VALUES ($1,$2,$3,$4,$5,$6,$7,'Ambient cartons','phone','confirmed',$8,true)`, [id, out, DEMO_DAY.nextRun, temp, u, kg, m3, at], db);

  // History: Wednesday's deferrals (why today's plan must serve these outlets first) and earlier deliveries
  let h = 93000;
  for (const oid of SKIPPED_YESTERDAY) {
    const id = `ORD00${h++}`;
    await q(`INSERT INTO orders (id,outlet_id,delivery_date,temp,units,kg,m3,description,status,submitted_at) VALUES ($1,$2,'2026-04-29','chilled',10,300,2.0,'Chilled crates','deferred','2026-04-28T11:00:00+05:30')`, [id, oid], db);
    await q(`INSERT INTO deferrals (order_id,from_date,to_date,reason,kind,why,created_at,notified_at,acknowledged_at) VALUES ($1,'2026-04-29','2026-04-30',$2,'chosen',$3,'2026-04-28T18:40:00+05:30','2026-04-28T18:41:00+05:30','2026-04-28T19:05:00+05:30')`,
      [id, oid === 'OUT079' ? 'no_van_capacity' : 'no_reefer_capacity', oid === 'OUT079' ? 'Both Kandy reefer vans were full.' : 'All refrigerated vehicles for this area were full.'], db);
  }
  const past: [string, string, string, string][] = [['2026-04-28', 'received', 'ambient', 'Ambient cartons'], ['2026-04-28', 'received', 'chilled', 'Chilled crates'], ['2026-04-27', 'disputed', 'ambient', 'Ambient cartons · 1 case damaged'], ['2026-04-25', 'received', 'ambient', 'Ambient cartons'], ['2026-04-24', 'delivered', 'ambient', 'Ambient cartons']];
  for (const [d, st, temp, desc] of past) {
    const id = `ORD00${h++}`;
    await q(`INSERT INTO orders (id,outlet_id,delivery_date,temp,units,kg,m3,description,status,submitted_at) VALUES ($1,'OUT116',$2,$3,14,320,2.0,$4,$5,$6)`, [id, d, temp, desc, st, `${d}T08:00:00+05:30`], db);
  }
  await q(`INSERT INTO settings (key, value) VALUES ('plan_date', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [JSON.stringify(DEMO_DAY.date)], db);
  await setClock(config.demoClockStart, db);
}

// the audit log is never wiped: a reset is itself an audited action
const OPERATIONAL = ['loading_sessions', 'vehicle_presence', 'notification_reads', 'notifications', 'pods', 'attachments', 'stop_events', 'receipts', 'exceptions', 'stop_moves', 'deferrals', 'trip_orders', 'trips', 'plans', 'orders'];

export async function resetDay(log: (m: string) => void = step) {
  await tx(async c => {
    await c.query(`TRUNCATE ${OPERATIONAL.join(', ')} RESTART IDENTITY CASCADE`);
    await c.query(`UPDATE vehicles SET status = CASE WHEN id = ANY($1) THEN 'in_workshop' ELSE 'available' END, status_note = NULL`, [Object.keys(WORKSHOP)]);
    for (const [id, note] of Object.entries(WORKSHOP)) await c.query(`UPDATE vehicles SET status_note = $2 WHERE id = $1`, [id, note]);
    await seedDay(c);
  });
  invalidateNetwork();
  log('demo day reset: 143 confirmed orders for Thu 30 Apr 2026');
}

/** First start: reference data, the admin (and demo accounts), and — in demo mode — the demo day.
 *  Safe to call on every start: it does nothing once outlets exist. */
export async function seedIfEmpty(log: (m: string) => void = step) {
  const n = await one<{ n: number }>(`SELECT count(*)::int AS n FROM outlets`);
  if (n && n.n > 0) return false;
  await tx(async c => {
    await seedReference(c, log);
    await seedUsers(c, log);
    if (config.demoMode) await seedDay(c);
    else await q(`INSERT INTO settings (key, value) VALUES ('plan_date', $1) ON CONFLICT (key) DO NOTHING`, [JSON.stringify(DEMO_DAY.date)], c);
  });
  log(config.demoMode ? 'seeded: datasets, accounts and the demo day (143 confirmed orders for Thu 30 Apr 2026)' : 'seeded: datasets and the administrator account');
  return true;
}
