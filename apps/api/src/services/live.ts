import { expectedStops, toHHMM, type ExpectedStop, type Network, type Order } from '@pathwise/core';
import { minutesOfDay } from '../clock.js';
import { parallel, q, type Db } from '../db.js';
import { getSettings, type Operations } from '../lib/settings.js';
import { calendarDay, ORDER_COLS } from './network.js';

/* Expected arrival times for a running (or planned) trip: free-flow plan adjusted for traffic and road
   conditions, the stops already delivered, and any hold the driver reported ("road closed · 2 h"). */
export interface LiveTrip { id: number; vehicle_id: string; trip_no: number; depart: string; status: string; plan_date: string }
export interface LiveEta {
  stops: (ExpectedStop & { expectedArriveHHMM: string; plannedHHMM: string; closeHHMM: string })[];
  hold: { at: string; minutes: number; label: string; note: string | null; until: string } | null;
  lateRisk: string[];
}

export async function liveEta(net: Network, t: LiveTrip, now: Date, db?: Db): Promise<LiveEta> {
  const [orders, ev, cal, { operations }] = await parallel(db, [
    () => q<any>(`SELECT ${ORDER_COLS} FROM trip_orders tor JOIN orders o ON o.id = tor.order_id WHERE tor.trip_id = $1 AND tor.moved_at IS NULL AND tor.load_status <> 'removed' ORDER BY tor.seq`, [t.id], db),
    () => q<any>(`SELECT type, outlet_id, device_time, payload FROM stop_events WHERE trip_id = $1 AND type IN ('delivered','problem') ORDER BY device_time`, [t.id], db),
    () => calendarDay(t.plan_date, db),
    () => getSettings(),
  ] as const);
  return computeEta(net, t, now, orders, ev, cal, operations);
}

/** ETAs for many trips with three queries in total (the tracking board shows every trip of the day). */
export async function liveEtaMany(net: Network, trips: LiveTrip[], now: Date): Promise<Map<number, LiveEta>> {
  const out = new Map<number, LiveEta>();
  if (!trips.length) return out;
  const ids = trips.map(t => t.id);
  const dates = [...new Set(trips.map(t => t.plan_date))];
  const [orders, ev, cals, { operations }] = await Promise.all([
    q<any>(`SELECT tor.trip_id AS "tripId", ${ORDER_COLS} FROM trip_orders tor JOIN orders o ON o.id = tor.order_id WHERE tor.trip_id = ANY($1::int[]) AND tor.moved_at IS NULL AND tor.load_status <> 'removed' ORDER BY tor.trip_id, tor.seq`, [ids]),
    q<any>(`SELECT trip_id, type, outlet_id, device_time, payload FROM stop_events WHERE trip_id = ANY($1::int[]) AND type IN ('delivered','problem') ORDER BY device_time`, [ids]),
    Promise.all(dates.map(d => calendarDay(d))),
    getSettings(),
  ]);
  const calOf = new Map(dates.map((d, i) => [d, cals[i]]));
  const ordersOf = new Map<number, any[]>(), evOf = new Map<number, any[]>();
  for (const { tripId, ...o } of orders) { const a = ordersOf.get(tripId); if (a) a.push(o); else ordersOf.set(tripId, [o]); }
  for (const e of ev) { const a = evOf.get(e.trip_id); if (a) a.push(e); else evOf.set(e.trip_id, [e]); }
  for (const t of trips) out.set(t.id, computeEta(net, t, now, ordersOf.get(t.id) ?? [], evOf.get(t.id) ?? [], calOf.get(t.plan_date), operations));
  return out;
}

function computeEta(net: Network, t: LiveTrip, now: Date, orders: any[], ev: any[], cal: any, operations: Operations): LiveEta {
  const om = new Map<string, Order>(orders.map((o: any) => [o.id, o]));
  const done = new Map<string, number>();
  for (const e of ev) if (e.type === 'delivered') done.set(e.outlet_id, minutesOfDay(new Date(e.device_time)));
  const lastDone = ev.filter(e => e.type === 'delivered').pop();
  const holdEv = ev.filter(e => e.type === 'problem' && Number(e.payload?.delayMin) > 0 && (!lastDone || new Date(e.device_time) >= new Date(lastDone.device_time))).pop();
  const hold = holdEv ? { at: toHHMM(minutesOfDay(new Date(holdEv.device_time))), minutes: Number(holdEv.payload.delayMin), label: holdEv.payload.label ?? 'Delay', note: holdEv.payload.note ?? null, until: toHHMM(minutesOfDay(new Date(holdEv.device_time)) + Number(holdEv.payload.delayMin)) } : null;
  const nowMin = minutesOfDay(now);
  const stops = expectedStops(operations.useTrafficForEta ? net : { ...net, traffic: undefined, roads: undefined }, { vehicleId: t.vehicle_id, trip: t.trip_no, depart: t.depart, orderIds: orders.map((o: any) => o.id) }, om, {
    date: t.plan_date, monsoon: !!cal?.monsoon, done, started: ['in_progress', 'completed'].includes(t.status),
    now: ['in_progress'].includes(t.status) ? nowMin : undefined,
    holdUntil: holdEv ? minutesOfDay(new Date(holdEv.device_time)) + Number(holdEv.payload.delayMin) : undefined,
  });
  const out = stops.map(s => ({ ...s, expectedArriveHHMM: toHHMM(s.expectedArrive), plannedHHMM: toHHMM(s.plannedArrive), closeHHMM: toHHMM(s.closeAt) }));
  return { stops: out, hold, lateRisk: out.filter(s => !s.done && (s.late || s.lateRisk)).map(s => s.outletId) };
}
