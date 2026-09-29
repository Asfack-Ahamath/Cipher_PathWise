import type { Brand, DeferralDecision, Network, Order, PlanResult, PlanTrip, ReasonCode, Vehicle } from './types.js';
import { departureFor, scheduleTrip, sequenceOrders } from './schedule.js';
import { toHHMM, toMin } from './time.js';

/* ──────────────────────────────────────────────────────────────────────────
   Auto-plan: a greedy, priority-first allocation with a repair pass.

   1. Orders are ranked: skipped on the last run → days since last served →
      chilled before ambient → Fresh, Tech, Style.
   2. The highest-ranked unplanned order is placed first: into an open trip of
      its group (same depot, brand and district), or on the best free vehicle
      (reefer only when chilled, van only when the outlet is van-only).
   3. A new trip is then filled with the next orders of the same group while
      every rule still holds: weight, volume, temperature, van-only, depot,
      delivery windows (incl. mall access), Fresh 270-min and Style/Tech
      480-min budgets, two trips per vehicle, weekly fuel quota.
   4. What cannot be placed is deferred with a reason code and a sentence,
      marked "forced" (no vehicle could take it today) or "chosen" (capacity
      went to higher-priority orders). A repair pass then retries every
      deferred order against the spare room left in the plan.
   The result always passes validatePlan() with zero errors.
   ────────────────────────────────────────────────────────────────────────── */

const BRAND_WEIGHT: Record<Brand, number> = { Fresh: 3, Tech: 2, Style: 1 };

export function orderPriority(net: Network, o: Order): number {
  const ot = net.outlets.get(o.outletId)!;
  return (o.deferredYesterday ? 1_000_000 : 0) + (o.daysSinceServed ?? 1) * 1000 + (o.temp === 'chilled' ? 100 : 0) + BRAND_WEIGHT[ot.brand] * 10;
}

interface VState { v: Vehicle; trips: PlanTrip[]; fresh: number; styleTech: number; fuel: number }
interface Draft { vs: VState; trip: PlanTrip; group: string; reefer: boolean; van: boolean }

export function autoPlan(net: Network, orderList: Order[]): PlanResult {
  const orders = new Map(orderList.map(o => [o.id, o]));
  const log: string[] = [];
  const groupOf = (o: Order) => { const ot = net.outlets.get(o.outletId)!; return `${ot.depot}|${ot.brand}|${ot.district}`; };
  const needs = (o: Order) => ({ reefer: o.temp === 'chilled', van: net.outlets.get(o.outletId)!.vanOnly });
  const fits = (v: Vehicle, o: Order) => { const n = needs(o); const ot = net.outlets.get(o.outletId)!; return v.depot === ot.depot && (!n.reefer || v.temp === 'reefer') && (!n.van || v.type === 'van'); };

  const states = new Map<string, VState>();
  for (const v of net.vehicles.values()) states.set(v.id, { v, trips: [], fresh: 0, styleTech: 0, fuel: v.fuelUsedL });

  const departFor = (vs: VState, _brand: Brand, outletIds: string[]): number => departureFor(net, vs.trips, outletIds, orders);

  /* would this set of orders be a valid trip for this vehicle, given its other trips? */
  type Why = 'ok' | 'volume' | 'weight' | 'window' | 'budget' | 'fuel' | 'trips' | 'compat';
  const check = (vs: VState, orderIds: string[], replacing?: PlanTrip): { why: Why; trip?: PlanTrip } => {
    const list = orderIds.map(id => orders.get(id)!);
    if (list.some(o => !fits(vs.v, o))) return { why: 'compat' };
    const others = vs.trips.filter(t => t !== replacing);
    if (!replacing && others.length >= net.rules.maxTripsPerVehicle) return { why: 'trips' };
    const seq = sequenceOrders(net, orderIds, orders);
    const outletIds = [...new Set(seq.map(id => orders.get(id)!.outletId))];
    const brand = net.outlets.get(outletIds[0])!.brand;
    const earlier = replacing ? others.filter(t => toMin(t.depart) < toMin(replacing.depart)) : others;
    const depart = departFor({ ...vs, trips: earlier }, brand, outletIds);
    const trip: PlanTrip = { vehicleId: vs.v.id, trip: replacing?.trip ?? others.length + 1, depart: toHHMM(depart), orderIds: seq };
    const s = scheduleTrip(net, trip, orders);
    if (s.m3 > vs.v.volumeCap + 1e-9) return { why: 'volume' };
    if (s.kg > vs.v.weightCap + 1e-9) return { why: 'weight' };
    if (s.stops.some(st => st.late)) return { why: 'window' };
    const prev = replacing ? scheduleTrip(net, replacing, orders) : null;
    const prevMin = prev ? prev.tripMinutes : 0, prevFuel = prev ? prev.fuelL : 0;
    if (brand === 'Fresh' && vs.fresh - (prev?.brand === 'Fresh' ? prevMin : 0) + s.tripMinutes > net.rules.freshBudgetMin) return { why: 'budget' };
    if (brand !== 'Fresh' && vs.styleTech - (prev && prev.brand !== 'Fresh' ? prevMin : 0) + s.tripMinutes > net.rules.styleTechBudgetMin) return { why: 'budget' };
    if (vs.fuel - prevFuel + s.fuelL > vs.v.fuelQuotaL + 1e-9) return { why: 'fuel' };
    // a later trip of this vehicle must still start after this one returns
    const later = others.filter(t => toMin(t.depart) > depart);
    if (later.some(t => toMin(t.depart) < s.returnAt)) return { why: 'window' };
    return { why: 'ok', trip };
  };

  const commit = (vs: VState, trip: PlanTrip, replacing?: PlanTrip) => {
    if (replacing) {
      const p = scheduleTrip(net, replacing, orders);
      if (p.brand === 'Fresh') vs.fresh -= p.tripMinutes; else vs.styleTech -= p.tripMinutes;
      vs.fuel -= p.fuelL;
      vs.trips[vs.trips.indexOf(replacing)] = trip;
    } else vs.trips.push(trip);
    const s = scheduleTrip(net, trip, orders);
    if (s.brand === 'Fresh') vs.fresh += s.tripMinutes; else vs.styleTech += s.tripMinutes;
    vs.fuel += s.fuelL;
  };

  const ranked = [...orders.values()].sort((a, b) => orderPriority(net, b) - orderPriority(net, a) || a.id.localeCompare(b.id));
  const planned = new Set<string>();
  const drafts: Draft[] = [];
  const deferred: Order[] = [];

  /* vehicle preference: do not spend scarce reefers and vans on work a plain truck can do */
  const vehicleScore = (vs: VState, o: Order) => {
    const n = needs(o);
    return (vs.v.temp === 'reefer' && !n.reefer ? 1000 : 0) + (vs.v.type === 'van' && !n.van ? 500 : 0) + vs.trips.length * 50 + (vs.v.fuelQuotaL - vs.fuel < 60 ? 30 : 0) + vs.v.volumeCap;
  };

  const tryAddToDraft = (d: Draft, ids: string[], strictKind: boolean): boolean => {
    const o = orders.get(ids[0])!;
    if (groupOf(o) !== d.group) return false;
    if (strictKind) {
      // keep reefer trips for chilled work and van trips for van-only outlets (plus same-outlet orders)
      const onTrip = new Set(d.trip.orderIds.map(id => orders.get(id)!.outletId));
      const sameStop = onTrip.has(o.outletId);
      if (d.reefer && !needs(o).reefer && !sameStop) return false;
      if (d.van && !needs(o).van && !sameStop) return false;
    }
    const r = check(d.vs, [...d.trip.orderIds, ...ids], d.trip);
    if (r.why !== 'ok') return false;
    commit(d.vs, r.trip!, d.trip); d.trip = r.trip!;
    ids.forEach(id => planned.add(id));
    return true;
  };

  for (const o of ranked) {
    if (planned.has(o.id)) continue;
    // 1) an open trip of the same group
    const open = drafts.filter(d => d.group === groupOf(o));
    if (open.some(d => tryAddToDraft(d, [o.id], true))) continue;
    // 2) a new trip on the best vehicle
    const cands = [...states.values()].filter(vs => vs.v.status === 'available' && fits(vs.v, o)).sort((a, b) => vehicleScore(a, o) - vehicleScore(b, o));
    let placed = false;
    for (const vs of cands) {
      const r = check(vs, [o.id]);
      if (r.why !== 'ok') continue;
      commit(vs, r.trip!);
      const d: Draft = { vs, trip: r.trip!, group: groupOf(o), reefer: vs.v.temp === 'reefer', van: vs.v.type === 'van' };
      drafts.push(d); planned.add(o.id); placed = true;
      // fill it with the next orders of the group, highest priority first
      for (const x of ranked) if (!planned.has(x.id) && groupOf(x) === d.group) tryAddToDraft(d, [x.id], true);
      break;
    }
    if (!placed) deferred.push(o);
  }

  /* repair pass: spare room anywhere in the group (reefer/van trips may now take any order of the group) */
  const stillDeferred: Order[] = [];
  for (const o of deferred.sort((a, b) => orderPriority(net, b) - orderPriority(net, a))) {
    const ok = drafts.filter(d => d.group === groupOf(o)).some(d => tryAddToDraft(d, [o.id], false));
    if (ok) { log.push(`Repair: ${o.id} fitted into spare room.`); continue; }
    // or a fresh trip if a vehicle has become free enough
    const cands = [...states.values()].filter(vs => vs.v.status === 'available' && fits(vs.v, o)).sort((a, b) => vehicleScore(a, o) - vehicleScore(b, o));
    const vs = cands.find(c => check(c, [o.id]).why === 'ok');
    if (vs) { const r = check(vs, [o.id]); commit(vs, r.trip!); drafts.push({ vs, trip: r.trip!, group: groupOf(o), reefer: vs.v.temp === 'reefer', van: vs.v.type === 'van' }); planned.add(o.id); continue; }
    stillDeferred.push(o);
  }

  /* number trips per vehicle by departure */
  const trips: PlanTrip[] = [];
  for (const vs of states.values()) {
    vs.trips.sort((a, b) => toMin(a.depart) - toMin(b.depart)).forEach((t, i) => trips.push({ ...t, trip: i + 1 }));
  }
  trips.sort((a, b) => a.vehicleId.localeCompare(b.vehicleId) || a.trip - b.trip);

  const deferrals = stillDeferred.map(o => explainDeferral(net, o, orders, states));
  const chilled = orderList.filter(o => o.temp === 'chilled');
  const reeferTrips = trips.filter(t => net.vehicles.get(t.vehicleId)!.temp === 'reefer').length;
  return {
    trips, deferrals, log,
    stats: {
      orders: orderList.length, served: orderList.length - deferrals.length, deferred: deferrals.length, trips: trips.length,
      vehiclesUsed: new Set(trips.map(t => t.vehicleId)).size, reeferTrips,
      chilledDemandM3: round1(chilled.reduce((a, o) => a + o.m3, 0)),
      chilledServedM3: round1(chilled.filter(o => planned.has(o.id)).reduce((a, o) => a + o.m3, 0)),
    },
  };

  function explainDeferral(net: Network, o: Order, orders: Map<string, Order>, states: Map<string, VState>): DeferralDecision {
    const ot = net.outlets.get(o.outletId)!;
    const n = needs(o);
    const kind = n.van ? (n.reefer ? 'refrigerated van' : 'van') : n.reefer ? 'refrigerated vehicle' : 'vehicle';
    const compat = [...net.vehicles.values()].filter(v => fits(v, o));
    const avail = compat.filter(v => v.status === 'available');
    const noneReason: ReasonCode = n.van ? 'no_van_capacity' : n.reefer ? 'no_reefer_capacity' : 'capacity_volume';
    if (!compat.length) return { orderId: o.id, reason: noneReason, kind: 'forced', why: `${ot.depot} has no ${kind} for ${ot.id}.` };
    if (!avail.length) return { orderId: o.id, reason: 'vehicle_in_workshop', kind: 'forced', why: `Every ${ot.depot} ${kind} that can serve ${ot.id} is in the workshop (${compat.map(v => v.id).join(', ')}).` };
    // could it go alone on an empty vehicle?
    const alone = avail.map(v => check({ v, trips: [], fresh: 0, styleTech: 0, fuel: v.fuelUsedL }, [o.id]).why);
    if (!alone.includes('ok')) {
      const why = alone.includes('fuel') ? 'fuel' : alone.includes('window') ? 'window' : alone.includes('budget') ? 'budget' : alone.includes('weight') ? 'weight' : 'volume';
      const map: Record<string, [ReasonCode, string]> = {
        fuel: ['fuel_quota', `Every ${ot.depot} ${kind} that fits has used its weekly fuel quota.`],
        window: ['window_unreachable', `No ${kind} leaving ${ot.depot} at ${net.rules.freshDepart} can reach ${ot.district} before ${ot.id} closes at ${ot.close}.`],
        budget: ['time_budget_exceeded', `A trip to ${ot.district} does not fit in the ${ot.brand === 'Fresh' ? net.rules.freshBudgetMin : net.rules.styleTechBudgetMin}-minute budget.`],
        weight: ['capacity_weight', `${o.kg} kg is more than any free ${kind} can carry.`],
        volume: ['capacity_volume', `${o.m3} m³ is more than any free ${kind} can hold.`],
      };
      const [reason, why2] = map[why];
      return { orderId: o.id, reason, kind: 'forced', why: why2 };
    }
    // capacity went to higher-priority orders
    const used = avail.filter(v => states.get(v.id)!.trips.length);
    const reason: ReasonCode = n.van ? 'no_van_capacity' : n.reefer ? 'no_reefer_capacity' : ot.brand === 'Style' ? 'capacity_volume' : ot.brand === 'Tech' ? 'capacity_weight' : 'time_budget_exceeded';
    return {
      orderId: o.id, reason, kind: 'chosen',
      why: `All ${avail.length} free ${ot.depot} ${kind}${avail.length === 1 ? '' : 's'} that can serve ${ot.id} ${used.length === avail.length ? 'are' : 'were'} full with higher-priority orders (skipped last run, then days since last served).`,
    };
  }
}

const round1 = (x: number) => Math.round(x * 10) / 10;
