import type { Issue, Network, Order, PlanTrip, TripSchedule } from './types.js';
import { scheduleTrip } from './schedule.js';
import { parseWindow, toHHMM, toMin } from './time.js';

export interface VehicleUsage { fresh: number; styleTech: number; fuelAddL: number; trips: number }
export interface Validation {
  issues: Issue[]; errors: Issue[];
  perVehicle: Record<string, VehicleUsage>;
  perTrip: Record<string, TripSchedule>;
}

const tripKey = (t: PlanTrip) => `${t.vehicleId}-${t.trip}`;

/** Check a whole plan against every operating constraint. Used by the planner, the API and the plan board. */
export function validatePlan(net: Network, plan: PlanTrip[], orders: Map<string, Order>): Validation {
  const issues: Issue[] = [];
  const perVehicle: Record<string, VehicleUsage> = {};
  const perTrip: Record<string, TripSchedule> = {};
  const seen = new Map<string, string>();

  for (const t of plan) {
    const v = net.vehicles.get(t.vehicleId);
    if (!v) { issues.push({ code: 'unknown_order', severity: 'error', vehicleId: t.vehicleId, trip: t.trip, title: `Unknown vehicle ${t.vehicleId}`, detail: '' }); continue; }
    const list: Order[] = [];
    for (const id of t.orderIds) {
      const o = orders.get(id);
      if (!o) { issues.push({ code: 'unknown_order', severity: 'error', vehicleId: v.id, trip: t.trip, orderId: id, title: `Unknown order ${id}`, detail: 'It is not in this day’s confirmed orders.' }); continue; }
      if (seen.has(id)) issues.push({ code: 'duplicate_order', severity: 'error', vehicleId: v.id, trip: t.trip, orderId: id, title: `${id} is planned twice`, detail: `Also on ${seen.get(id)}.` });
      seen.set(id, tripKey(t));
      list.push(o);
    }
    const s = scheduleTrip(net, t, orders);
    perTrip[tripKey(t)] = s;
    const pv = (perVehicle[v.id] ??= { fresh: 0, styleTech: 0, fuelAddL: 0, trips: 0 });
    if (!list.length) continue;
    pv.trips += 1;
    if (s.brand === 'Fresh') pv.fresh += s.tripMinutes; else pv.styleTech += s.tripMinutes;
    pv.fuelAddL += s.fuelL;

    if (v.status !== 'available') issues.push({ code: 'vehicle_unavailable', severity: 'error', vehicleId: v.id, trip: t.trip, title: `${v.id} is in the workshop`, detail: 'Only available vehicles can be planned.' });
    if (s.m3 > v.volumeCap + 1e-9) issues.push({ code: 'over_volume', severity: 'error', vehicleId: v.id, trip: t.trip, title: `Over volume: ${s.m3.toFixed(1)} / ${v.volumeCap.toFixed(1)} m³`, detail: `${v.id} Trip ${t.trip}. Move or defer an order.` });
    if (s.kg > v.weightCap + 1e-9) issues.push({ code: 'over_weight', severity: 'error', vehicleId: v.id, trip: t.trip, title: `Over weight: ${Math.round(s.kg).toLocaleString('en')} / ${v.weightCap.toLocaleString('en')} kg`, detail: `${v.id} Trip ${t.trip}.` });
    const brands = new Set(list.map(x => net.outlets.get(x.outletId)!.brand));
    const districts = new Set(list.map(x => net.outlets.get(x.outletId)!.district));
    if (brands.size > 1) issues.push({ code: 'mixed_brand', severity: 'error', vehicleId: v.id, trip: t.trip, title: `Mixed brands on one trip: ${[...brands].join(' + ')}`, detail: 'Each trip serves one brand.' });
    if (districts.size > 1) issues.push({ code: 'mixed_district', severity: 'error', vehicleId: v.id, trip: t.trip, title: `Mixed districts: ${[...districts].join(' + ')}`, detail: 'Each trip serves one district.' });
    for (const x of list) {
      const ot = net.outlets.get(x.outletId)!;
      if (x.temp === 'chilled' && v.temp !== 'reefer') issues.push({ code: 'reefer_required', severity: 'error', vehicleId: v.id, trip: t.trip, orderId: x.id, title: 'Refrigerated vehicle required', detail: `${x.id} (${ot.id}) is chilled; ${v.id} is a dry vehicle.` });
      if (ot.vanOnly && v.type !== 'van') issues.push({ code: 'van_only', severity: 'error', vehicleId: v.id, trip: t.trip, orderId: x.id, title: `${ot.id} is van-only`, detail: `${ot.name} cannot be served by a truck.` });
      if (ot.depot !== v.depot) issues.push({ code: 'home_depot', severity: 'error', vehicleId: v.id, trip: t.trip, orderId: x.id, title: `Wrong depot: ${ot.id} belongs to ${ot.depot}`, detail: `${v.id} is based at ${v.depot}.` });
    }
    for (const st of s.stops) {
      const ot = net.outlets.get(st.outletId)!;
      const m = parseWindow(ot.mallWindow);
      const closeAt = Math.min(toMin(ot.close), m ? m[1] : 1e9);
      if (st.late) issues.push({ code: 'window_breach', severity: 'error', vehicleId: v.id, trip: t.trip, title: `Arrives ${toHHMM(st.arrive)} after ${ot.id} closes at ${toHHMM(closeAt)}`, detail: `${ot.name}. Re-sequence, move or defer.` });
      else if (st.lateRisk) issues.push({ code: 'window_breach', severity: 'warn', vehicleId: v.id, trip: t.trip, title: `Late risk at ${ot.id}: ETA ${toHHMM(st.arrive)}, closes ${toHHMM(closeAt)}`, detail: `Under ${net.rules.lateRiskSlackMin} min of slack.` });
    }
  }
  // trips of one vehicle must not overlap
  const byVehicle = new Map<string, PlanTrip[]>();
  for (const t of plan) byVehicle.set(t.vehicleId, [...(byVehicle.get(t.vehicleId) ?? []), t]);
  for (const [vid, ts] of byVehicle) {
    const sorted = ts.filter(t => t.orderIds.length).sort((a, b) => toMin(a.depart) - toMin(b.depart));
    for (let i = 1; i < sorted.length; i++) {
      const prev = perTrip[tripKey(sorted[i - 1])];
      if (prev && toMin(sorted[i].depart) < prev.returnAt) issues.push({ code: 'too_many_trips', severity: 'error', vehicleId: vid, trip: sorted[i].trip, title: `${vid} Trip ${sorted[i].trip} departs before Trip ${sorted[i - 1].trip} returns`, detail: `Returns ${toHHMM(prev.returnAt)}.` });
    }
  }
  for (const [vid, pv] of Object.entries(perVehicle)) {
    const v = net.vehicles.get(vid)!;
    if (pv.trips > net.rules.maxTripsPerVehicle) issues.push({ code: 'too_many_trips', severity: 'error', vehicleId: vid, title: `${vid}: ${pv.trips} trips planned`, detail: `A vehicle can run at most ${net.rules.maxTripsPerVehicle} trips per day.` });
    if (pv.fresh > net.rules.freshBudgetMin) issues.push({ code: 'fresh_budget', severity: 'error', vehicleId: vid, title: `Fresh time over budget: ${pv.fresh} / ${net.rules.freshBudgetMin} min`, detail: `${vid}'s Fresh trips combined must fit 03:30–08:00.` });
    if (pv.styleTech > net.rules.styleTechBudgetMin) issues.push({ code: 'style_tech_budget', severity: 'error', vehicleId: vid, title: `Style + Tech time over budget: ${pv.styleTech} / ${net.rules.styleTechBudgetMin} min`, detail: vid });
    const fuelAfter = v.fuelUsedL + pv.fuelAddL;
    if (fuelAfter > v.fuelQuotaL + 1e-9) issues.push({ code: 'fuel_quota', severity: 'error', vehicleId: vid, title: `Weekly fuel quota exceeded: ${fuelAfter.toFixed(1)} / ${v.fuelQuotaL} L`, detail: `${vid} has ${(v.fuelQuotaL - v.fuelUsedL).toFixed(1)} L left this week.` });
  }
  return { issues, errors: issues.filter(i => i.severity === 'error'), perVehicle, perTrip };
}
