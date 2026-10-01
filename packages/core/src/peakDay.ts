import type { Network, Order, PlanTrip } from './types.js';
import { scheduleTrip } from './schedule.js';

/* The Task 2B feasibility rules exactly as check_allocation.py applies them, so the app can show
   "passes the official checker" for any plan (and the tests can assert it). */
export interface Allocation { orderId: string; decision: 'served' | 'deferred'; vehicleId?: string; trip?: number }

export function checkAllocation(net: Network, orders: Map<string, Order>, alloc: Allocation[], available: Set<string>): string[] {
  const errors: string[] = [];
  const served = alloc.filter(a => a.decision === 'served');
  for (const a of served) {
    if (!a.vehicleId || !a.trip) errors.push(`${a.orderId} is served but has no vehicle or trip`);
    else if (![1, 2].includes(a.trip)) errors.push(`${a.orderId}: trip must be 1 or 2`);
  }
  const groups = new Map<string, Allocation[]>();
  for (const a of served) if (a.vehicleId && a.trip) groups.set(`${a.vehicleId}|${a.trip}`, [...(groups.get(`${a.vehicleId}|${a.trip}`) ?? []), a]);
  const perVehicle = new Map<string, { fresh: number; other: number; trips: Set<number> }>();
  for (const [key, g] of groups) {
    const [vid, tripStr] = key.split('|');
    const v = net.vehicles.get(vid);
    const tag = `[${vid} trip ${tripStr}]`;
    if (!v) { errors.push(`${tag} unknown vehicle`); continue; }
    if (!available.has(vid)) { errors.push(`${tag} vehicle is in the workshop that day`); continue; }
    const list = g.map(a => orders.get(a.orderId)!).filter(Boolean);
    const outs = list.map(o => net.outlets.get(o.outletId)!);
    if (new Set(outs.map(o => o.depot)).size > 1 || outs[0].depot !== v.depot) errors.push(`${tag} vehicle is based at ${v.depot} but carries orders for another depot`);
    if (new Set(outs.map(o => o.brand)).size > 1) errors.push(`${tag} mixes brands`);
    if (new Set(outs.map(o => o.district)).size > 1) errors.push(`${tag} mixes districts`);
    if (list.some(o => o.temp === 'chilled') && v.temp !== 'reefer') errors.push(`${tag} carries chilled orders on a non-refrigerated vehicle`);
    if (outs.some(o => o.parking === 'van_only') && v.type !== 'van') errors.push(`${tag} sends a ${v.type} to a van_only outlet`);
    const m3 = list.reduce((x, o) => x + o.m3, 0), kg = list.reduce((x, o) => x + o.kg, 0);
    if (m3 > v.volumeCap + 1e-6) errors.push(`${tag} volume ${m3.toFixed(1)} m3 exceeds ${v.volumeCap}`);
    if (kg > v.weightCap + 1e-6) errors.push(`${tag} weight ${kg.toFixed(0)} kg exceeds ${v.weightCap}`);
    const pv = perVehicle.get(vid) ?? { fresh: 0, other: 0, trips: new Set<number>() };
    pv.trips.add(Number(tripStr));
    if (new Set(outs.map(o => o.brand)).size === 1 && new Set(outs.map(o => o.district)).size === 1) {
      const tr = net.travel.get(`${outs[0].depot}|${outs[0].district}`);
      const minutes = tr ? tr.outMin + tr.interMin * (list.length - 1) + outs.reduce((x, o) => x + net.allowance[o.brand][o.dock], 0) : 0;
      if (outs[0].brand === 'Fresh') pv.fresh += minutes; else pv.other += minutes;
    }
    perVehicle.set(vid, pv);
  }
  for (const [vid, pv] of perVehicle) {
    if (pv.trips.size > net.rules.maxTripsPerVehicle) errors.push(`[${vid}] ${pv.trips.size} trips; a vehicle runs at most ${net.rules.maxTripsPerVehicle} a day`);
    if (pv.fresh > net.rules.freshBudgetMin + 1e-6) errors.push(`[${vid}] Fresh trips total ${Math.round(pv.fresh)} min; the pre-dawn window is ${net.rules.freshBudgetMin} min`);
    if (pv.other > net.rules.styleTechBudgetMin + 1e-6) errors.push(`[${vid}] daytime trips total ${Math.round(pv.other)} min; the daytime window is ${net.rules.styleTechBudgetMin}`);
  }
  return errors;
}

export function allocationFromTrips(orderIds: string[], trips: PlanTrip[]): Allocation[] {
  const at = new Map<string, [string, number]>();
  for (const t of trips) for (const id of t.orderIds) at.set(id, [t.vehicleId, t.trip]);
  return orderIds.map(id => { const a = at.get(id); return a ? { orderId: id, decision: 'served', vehicleId: a[0], trip: a[1] } : { orderId: id, decision: 'deferred' }; });
}

/** Minutes per trip by the booklet formula, for the written policy. */
export function tripMinutesTable(net: Network, trips: PlanTrip[], orders: Map<string, Order>) {
  return trips.map(t => { const s = scheduleTrip(net, t, orders); return { vehicleId: t.vehicleId, trip: t.trip, brand: s.brand, district: s.district, orders: t.orderIds.length, minutes: s.tripMinutes, kg: Math.round(s.kg), m3: Math.round(s.m3 * 10) / 10 }; });
}
