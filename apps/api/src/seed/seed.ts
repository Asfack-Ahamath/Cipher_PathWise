import bcrypt from 'bcryptjs';
import { DEMO_DAY, generateDemoOrders, SKIPPED_YESTERDAY, type Outlet } from '@pathwise/core';
import { config } from '../config.js';
import { one, q, tx, type Db } from '../db.js';
import { setClock } from '../clock.js';
import { loadDatasets } from './datasets.js';

/* Assumed for the demo (the datasets do not include them): which vehicles are in the
   workshop, fuel already used this week, and drivers' names. */
const WORKSHOP: Record<string, string> = { VEH004: 'Brake service', VEH017: 'Gearbox repair', VEH025: 'Annual inspection', VEH058: 'Reefer unit repair' };
const FUEL_USED: Record<string, number> = { VEH002: 402, VEH035: 188, VEH012: 535.5, VEH009: 287, VEH041: 244, VEH057: 205, VEH039: 251, VEH047: 318, VEH042: 212 };
const DRIVERS = ['Lahiru Silva', 'Amila Dias', 'Pradeep Kumara', 'Sampath Fernando', 'Malith Wickrama', 'Chaminda Silva', 'Dinesh Kumara', 'Nuwan Rathnayake', 'Kamal Jayawardena', 'Saman Kumara', 'Ruwan Bandara', 'Chathura Perera', 'Isuru Herath', 'Tharindu Silva', 'Janaka Wijesinghe', 'Buddhika Rajapaksha', 'Mahesh Gunasekara', 'Asitha Fernando', 'Gayan Madushanka', 'Dilan Jayasuriya'];

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

const isoWeek = (date: string) => {
  const d = new Date(date + 'T12:00:00Z'); const day = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - day + 3);
  const firstThu = new Date(Date.UTC(d.getUTCFullYear(), 0, 4)); return `W${String(1 + Math.round(((d.getTime() - firstThu.getTime()) / 86400000 - 3 + ((firstThu.getUTCDay() + 6) % 7)) / 7)).padStart(2, '0')}`;
};

export async function seedReference(db: Db, log = console.log) {
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
  for (const c of ds.calendar) await q(`INSERT INTO calendar (date,is_operating,is_payday,holiday,festival_ramp,monsoon,iso_week) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`, [c.date, c.isOperating, c.isPayday, c.holiday, c.festivalRamp, c.monsoon, isoWeek(c.date)], db);
}

export async function seedUsers(db: Db) {
  const hash = await bcrypt.hash(config.demoPassword, 10);
  for (const u of DEMO_USERS) {
    await q(`INSERT INTO users (email,name,role,password_hash,pin_hash,depot,outlet_id,vehicle_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (email) DO NOTHING`,
      [u.email, u.name, u.role, hash, u.pin ? await bcrypt.hash(u.pin, 10) : null, u.depot, u.outlet, u.vehicle], db);
  }
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

const OPERATIONAL = ['vehicle_presence', 'notification_reads', 'notifications', 'audit_log', 'pods', 'stop_events', 'receipts', 'exceptions', 'stop_moves', 'deferrals', 'trip_orders', 'trips', 'plans', 'orders'];

export async function resetDay(log = console.log) {
  await tx(async c => {
    await c.query(`TRUNCATE ${OPERATIONAL.join(', ')} RESTART IDENTITY CASCADE`);
    await c.query(`UPDATE vehicles SET status = CASE WHEN id = ANY($1) THEN 'in_workshop' ELSE 'available' END, status_note = NULL`, [Object.keys(WORKSHOP)]);
    for (const [id, note] of Object.entries(WORKSHOP)) await c.query(`UPDATE vehicles SET status_note = $2 WHERE id = $1`, [id, note]);
    await seedDay(c);
  });
  log('demo day reset: 143 confirmed orders for Thu 30 Apr 2026');
}

export async function seedIfEmpty(log = console.log) {
  const n = await one<{ n: number }>(`SELECT count(*)::int AS n FROM outlets`);
  if (n && n.n > 0) return false;
  await tx(async c => { await seedReference(c, log); await seedUsers(c); await seedDay(c); });
  log('seeded: datasets, 8 accounts, 143 confirmed orders for Thu 30 Apr 2026');
  return true;
}
