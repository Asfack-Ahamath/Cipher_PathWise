import { buildNetwork, type Network, type Order } from '@pathwise/core';
import { q, type Db } from '../db.js';
import { bus, type LiveEvent } from '../lib/events.js';
import { getSettings, settingsVersion } from '../lib/settings.js';

const seq = async (fns: (() => Promise<any[]>)[]) => { const out: any[][] = []; for (const f of fns) out.push(await f()); return out; };

/* The network (outlets, vehicles, travel, allowances, rules) is read on almost every request but changes only
   when an admin edits it, a vehicle is swapped out, or the demo day is reset. Each query is a round trip to
   the database, so keep the built network in memory; writes call invalidateNetwork() and a short TTL backs it up. */
const NETWORK_TTL = 60_000;
let netCache: { net: Network; at: number; settings: number } | null = null;
let netGen = 0;
export const invalidateNetwork = () => { netCache = null; netGen++; };
// writes that touch vehicles, outlets or settings are audited; refresh once the transaction has committed
bus.on('live', (e: LiveEvent) => { if (e.topics.some(t => t === 'admin' || t === 'reference' || t === 'exceptions' || t === 'clock')) invalidateNetwork(); });

/* Loads the planning network (outlets, vehicles, travel, allowances) from the database. */
export async function loadNetwork(db?: Db): Promise<Network> {
  if (netCache && Date.now() - netCache.at < NETWORK_TTL && netCache.settings === settingsVersion()) return netCache.net;
  const gen = netGen;
  // sequential on purpose: inside a transaction all queries share one client
  const [outlets, vehicles, travel, allowance] = await seq([
    () => q<any>(`SELECT id, name, brand, district, depot, dock, parking, open_time AS open, close_time AS close, mall_window AS "mallWindow", van_only AS "vanOnly", lat, lng, is_active AS "isActive" FROM outlets`, [], db),
    () => q<any>(`SELECT id, type, temp, depot, weight_cap AS "weightCap", volume_cap AS "volumeCap", km_per_l AS "kmPerL", fuel_quota_l AS "fuelQuotaL", fuel_used_l AS "fuelUsedL", status, driver_name AS "driverName" FROM vehicles`, [], db),
    () => q<any>(`SELECT depot, district, out_min AS "outMin", inter_min AS "interMin", out_km AS "outKm", inter_km AS "interKm", road_class AS "roadClass" FROM district_travel`, [], db),
    () => q<any>(`SELECT brand, dock, minutes FROM service_allowance`, [], db),
  ]);
  const al: any = { Fresh: {}, Style: {}, Tech: {} };
  for (const a of allowance) al[a.brand][a.dock] = a.minutes;
  const sv = settingsVersion();
  const { rules } = await getSettings(db);
  const { traffic, roads } = await conditions(db);
  const net = buildNetwork({ outlets: outlets.filter((o: any) => o.isActive !== false), vehicles, travel, allowance: al, rules, traffic, roads });
  // only cache what was read outside a transaction (it may see uncommitted rows) and not invalidated meanwhile
  if (!db && gen === netGen) netCache = { net, at: Date.now(), settings: sv };
  return net;
}

/* traffic_speed and road_conditions change only on re-seed; cache them for ten minutes. */
let condCache: { traffic: Map<string, number>; roads: Map<string, number>; at: number } | null = null;
export const invalidateConditions = () => { condCache = null; invalidateNetwork(); };
async function conditions(db?: Db) {
  if (condCache && Date.now() - condCache.at < 600_000) return condCache;
  const [t, r] = await seq([
    () => q<any>(`SELECT district, hour, monsoon, speed_index FROM traffic_speed`, [], db),
    () => q<any>(`SELECT district, to_char(date,'YYYY-MM-DD') AS date, disruption_index FROM road_conditions WHERE disruption_index < 100`, [], db),
  ]);
  condCache = { traffic: new Map(t.map(x => [`${x.district}|${x.hour}|${x.monsoon ? 1 : 0}`, Number(x.speed_index)])), roads: new Map(r.map(x => [`${x.district}|${x.date}`, Number(x.disruption_index)])), at: Date.now() };
  return condCache;
}

export const ORDER_COLS = `o.id, o.outlet_id AS "outletId", to_char(o.delivery_date, 'YYYY-MM-DD') AS date, o.temp, o.units, o.kg, o.m3, o.description, o.status, o.source,
  o.submitted_at AS "submittedAt", o.after_cutoff AS "afterCutoff", o.deferred_yesterday AS "deferredYesterday", o.days_since_served AS "daysSinceServed", o.parent_order_id AS "parentOrderId"`;

/** The orders a plan for this date works with. */
export async function ordersForDate(date: string, db?: Db): Promise<(Order & { status: string })[]> {
  return q<any>(`SELECT ${ORDER_COLS} FROM orders o WHERE o.delivery_date = $1 AND o.status <> 'cancelled' ORDER BY o.id`, [date], db);
}

export async function nextOperatingDay(after: string, db?: Db): Promise<string> {
  const r = await q<{ date: string }>(`SELECT to_char(date,'YYYY-MM-DD') AS date FROM calendar WHERE date > $1 AND is_operating ORDER BY date LIMIT 1`, [after], db);
  if (r[0]) return r[0].date;
  const d = new Date(after + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + (d.getUTCDay() === 6 ? 2 : 1)); return d.toISOString().slice(0, 10);
}

export async function activePlanDate(db?: Db): Promise<string> {
  const r = await q<{ value: string }>(`SELECT value FROM settings WHERE key = 'plan_date'`, [], db);
  return r[0]?.value ?? '2026-04-30';
}

/** Calendar facts for a date (monsoon affects travel speed). */
export async function calendarDay(date: string, db?: Db) {
  const r = await q<any>(`SELECT is_operating AS "isOperating", is_payday AS "isPayday", holiday, festival, festival_ramp AS "festivalRamp", monsoon, is_holiday AS "isHoliday" FROM calendar WHERE date = $1`, [date], db);
  return r[0] ?? { isOperating: true, isPayday: false, holiday: null, festival: null, festivalRamp: 0, monsoon: false, isHoliday: false };
}
