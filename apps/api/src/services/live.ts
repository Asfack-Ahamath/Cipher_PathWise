import { expectedStops, toHHMM, type ExpectedStop, type Network, type Order } from '@pathwise/core';
import { minutesOfDay } from '../clock.js';
import { q, type Db } from '../db.js';
import { getSettings } from '../lib/settings.js';
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
  const orders = await q<any>(`SELECT ${ORDER_COLS} FROM trip_orders tor JOIN orders o ON o.id = tor.order_id WHERE tor.trip_id = $1 AND tor.moved_at IS NULL AND tor.load_status <> 'removed' ORDER BY tor.seq`, [t.id], db);
  const om = new Map<string, Order>(orders.map((o: any) => [o.id, o]));
  const ev = await q<any>(`SELECT type, outlet_id, device_time, payload FROM stop_events WHERE trip_id = $1 AND type IN ('delivered','problem') ORDER BY device_time`, [t.id], db);
  const done = new Map<string, number>();
  for (const e of ev) if (e.type === 'delivered') done.set(e.outlet_id, minutesOfDay(new Date(e.device_time)));
  const lastDone = ev.filter(e => e.type === 'delivered').pop();
  const holdEv = ev.filter(e => e.type === 'problem' && Number(e.payload?.delayMin) > 0 && (!lastDone || new Date(e.device_time) >= new Date(lastDone.device_time))).pop();
  const hold = holdEv ? { at: toHHMM(minutesOfDay(new Date(holdEv.device_time))), minutes: Number(holdEv.payload.delayMin), label: holdEv.payload.label ?? 'Delay', note: holdEv.payload.note ?? null, until: toHHMM(minutesOfDay(new Date(holdEv.device_time)) + Number(holdEv.payload.delayMin)) } : null;
  const { operations } = await getSettings();
  const cal = await calendarDay(t.plan_date, db);
  const nowMin = minutesOfDay(now);
  const stops = expectedStops(operations.useTrafficForEta ? net : { ...net, traffic: undefined, roads: undefined }, { vehicleId: t.vehicle_id, trip: t.trip_no, depart: t.depart, orderIds: orders.map((o: any) => o.id) }, om, {
    date: t.plan_date, monsoon: !!cal.monsoon, done, started: ['in_progress', 'completed'].includes(t.status),
    now: ['in_progress'].includes(t.status) ? nowMin : undefined,
    holdUntil: holdEv ? minutesOfDay(new Date(holdEv.device_time)) + Number(holdEv.payload.delayMin) : undefined,
  });
  const out = stops.map(s => ({ ...s, expectedArriveHHMM: toHHMM(s.expectedArrive), plannedHHMM: toHHMM(s.plannedArrive), closeHHMM: toHHMM(s.closeAt) }));
  return { stops: out, hold, lateRisk: out.filter(s => !s.done && (s.late || s.lateRisk)).map(s => s.outletId) };
}
