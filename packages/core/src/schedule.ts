import type { Network, Order, PlanTrip, StopPlan, TripSchedule } from './types.js';
import { parseWindow, toMin } from './time.js';

/* Trip time follows the booklet's published planning standard (Task 2B, "Calculate trip time"):
     trip_minutes = outbound + inter_stop × (orders − 1) + Σ handling per order
   with no return leg (the budgets already allow for it) and no waiting.
   The stop timeline (arrive / start / leave) is the physical schedule: orders for the same outlet
   are one stop, a vehicle that arrives early waits for the window, and handling is per order. */
export function stopOutlets(orderIds: string[], orders: Map<string, Order>): string[] {
  const ids: string[] = [];
  for (const id of orderIds) { const o = orders.get(id); if (o && !ids.includes(o.outletId)) ids.push(o.outletId); }
  return ids;
}

export function scheduleTrip(net: Network, trip: PlanTrip, orders: Map<string, Order>): TripSchedule {
  const list = trip.orderIds.map(id => orders.get(id)).filter((o): o is Order => !!o);
  const v = net.vehicles.get(trip.vehicleId);
  const empty: TripSchedule = { stops: [], tripMinutes: 0, km: 0, fuelL: 0, returnAt: toMin(trip.depart), kg: 0, m3: 0 };
  if (!list.length || !v) return empty;
  const outletIds = stopOutlets(trip.orderIds, orders);
  const first = net.outlets.get(outletIds[0])!;
  const tr = net.travel.get(`${v.depot}|${first.district}`) ?? net.travel.get(`${first.depot}|${first.district}`);
  if (!tr) return { ...empty, brand: first.brand, district: first.district };
  let clock = toMin(trip.depart) + tr.outMin;
  let handling = 0;
  const stops: StopPlan[] = outletIds.map((oid, i) => {
    const ot = net.outlets.get(oid)!;
    if (i > 0) clock += tr.interMin;
    const arrive = clock;
    const mall = parseWindow(ot.mallWindow);
    const openAt = Math.max(toMin(ot.open), mall ? mall[0] : 0);
    const closeAt = Math.min(toMin(ot.close), mall ? mall[1] : 24 * 60);
    const start = Math.max(arrive, openAt);
    const nOrders = list.filter(x => x.outletId === oid).length;
    const allowance = net.allowance[ot.brand][ot.dock] * nOrders;
    handling += allowance;
    const leave = start + allowance;
    clock = leave;
    const late = arrive > closeAt;
    return {
      seq: i + 1, outletId: oid, orderIds: list.filter(x => x.outletId === oid).map(x => x.id),
      arrive, start, leave, waitMin: start - arrive, allowance, late, lateRisk: !late && closeAt - arrive <= net.rules.lateRiskSlackMin,
    };
  });
  const tripMinutes = tr.outMin + tr.interMin * (list.length - 1) + handling;
  const km = tr.outKm * 2 + tr.interKm * (outletIds.length - 1);
  return {
    stops, tripMinutes, km, fuelL: km / v.kmPerL, returnAt: clock + tr.outMin,
    brand: first.brand, district: first.district,
    kg: list.reduce((a, x) => a + x.kg, 0), m3: list.reduce((a, x) => a + x.m3, 0),
  };
}

/** Sort a trip's stops so the earliest-closing window is served first. */
export function sequenceOrders(net: Network, orderIds: string[], orders: Map<string, Order>): string[] {
  const byOutlet = new Map<string, string[]>();
  for (const id of orderIds) { const o = orders.get(id); if (!o) continue; byOutlet.set(o.outletId, [...(byOutlet.get(o.outletId) ?? []), id]); }
  const key = (oid: string) => { const ot = net.outlets.get(oid)!; const m = parseWindow(ot.mallWindow); return [Math.min(toMin(ot.close), m ? m[1] : 1e9), toMin(ot.open), oid] as const; };
  return [...byOutlet.keys()].sort((a, b) => { const ka = key(a), kb = key(b); return ka[0] - kb[0] || ka[1] - kb[1] || ka[2].localeCompare(kb[2]); })
    .flatMap(oid => byOutlet.get(oid)!.sort((a, b) => (orders.get(a)!.temp === 'chilled' ? -1 : 1) - (orders.get(b)!.temp === 'chilled' ? -1 : 1)));
}

/** Departure for a vehicle's next trip: Fresh leaves at the first departure (or after the previous
 *  trip returns and reloads); Style and Tech leave so they reach the first outlet as it opens. */
export function departureFor(net: Network, previous: PlanTrip[], outletIds: string[], orders: Map<string, Order>): number {
  const ot0 = net.outlets.get(outletIds[0]);
  let dep = toMin(net.rules.freshDepart);
  if (!ot0) return dep;
  const vehicleId = previous[0]?.vehicleId;
  const v = vehicleId ? net.vehicles.get(vehicleId) : undefined;
  const tr = net.travel.get(`${v?.depot ?? ot0.depot}|${ot0.district}`);
  const last = [...previous].sort((a, b) => toMin(a.depart) - toMin(b.depart)).pop();
  if (last) dep = Math.max(dep, scheduleTrip(net, last, orders).returnAt + net.rules.reloadMin);
  if (ot0.brand !== 'Fresh' && tr) {
    const firstOpen = Math.min(...outletIds.map(id => { const ot = net.outlets.get(id)!; const m = parseWindow(ot.mallWindow); return Math.max(toMin(ot.open), m ? m[0] : 0); }));
    dep = Math.max(dep, firstOpen - tr.outMin);
  }
  return Math.ceil(dep / 5) * 5;
}
