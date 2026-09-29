import { buildNetwork, type Network, type Order } from '@pathwise/core';
import { q, type Db } from '../db.js';

const seq = async (fns: (() => Promise<any[]>)[]) => { const out: any[][] = []; for (const f of fns) out.push(await f()); return out; };

/* Loads the planning network (outlets, vehicles, travel, allowances) from the database. */
export async function loadNetwork(db?: Db): Promise<Network> {
  // sequential on purpose: inside a transaction all queries share one client
  const [outlets, vehicles, travel, allowance] = await seq([
    () => q<any>(`SELECT id, name, brand, district, depot, dock, parking, open_time AS open, close_time AS close, mall_window AS "mallWindow", van_only AS "vanOnly", lat, lng FROM outlets`, [], db),
    () => q<any>(`SELECT id, type, temp, depot, weight_cap AS "weightCap", volume_cap AS "volumeCap", km_per_l AS "kmPerL", fuel_quota_l AS "fuelQuotaL", fuel_used_l AS "fuelUsedL", status, driver_name AS "driverName" FROM vehicles`, [], db),
    () => q<any>(`SELECT depot, district, out_min AS "outMin", inter_min AS "interMin", out_km AS "outKm", inter_km AS "interKm", road_class AS "roadClass" FROM district_travel`, [], db),
    () => q<any>(`SELECT brand, dock, minutes FROM service_allowance`, [], db),
  ]);
  const al: any = { Fresh: {}, Style: {}, Tech: {} };
  for (const a of allowance) al[a.brand][a.dock] = a.minutes;
  return buildNetwork({ outlets, vehicles, travel, allowance: al });
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
