import type { Network, Order, PlanTrip } from './types.js';
import { parseWindow, toMin } from './time.js';
import { scheduleTrip } from './schedule.js';

/* Expected (not planned) arrival times.
   Plans use free-flow times — the booklet's planning standard. Expected times scale each leg by
   traffic_speed.csv (district × hour × monsoon) and road_conditions.csv (district × date):
     expected leg = free-flow leg × 100 / speed_index × 100 / disruption_index
   On the training routes this cuts the arrival error from 16.6 to 8.3 minutes (mean absolute). */

export function travelFactor(net: Network, district: string, clockMin: number, date: string, monsoon: boolean): number {
  const hour = ((Math.floor(clockMin / 60) % 24) + 24) % 24;
  const speed = net.traffic?.get(`${district}|${hour}|${monsoon ? 1 : 0}`) ?? 100;
  const disruption = net.roads?.get(`${district}|${date}`) ?? 100;
  return (100 / Math.max(speed, 10)) * (100 / Math.max(disruption, 10));
}

export interface ExpectedStop {
  outletId: string; seq: number;
  plannedArrive: number; expectedArrive: number; expectedLeave: number;
  openAt: number; closeAt: number; done: boolean;
  late: boolean; lateRisk: boolean; delayMin: number;
}

export interface ExpectedOptions {
  date: string; monsoon: boolean;
  /** outlets already delivered, with the minute the stop was completed */
  done?: Map<string, number>;
  /** current business minute of the day; undelivered stops cannot be expected in the past */
  now?: number;
  /** extra minutes reported by the driver (e.g. road closed), added before the next stop */
  reportedDelayMin?: number;
  /** trip has started (otherwise the clock starts at the planned departure) */
  started?: boolean;
  /** the vehicle cannot move before this minute (driver reported a hold, e.g. road closed until 07:35) */
  holdUntil?: number;
}

export function expectedStops(net: Network, trip: PlanTrip, orders: Map<string, Order>, opts: ExpectedOptions): ExpectedStop[] {
  let o = opts;
  const plan = scheduleTrip(net, trip, orders);
  const v = net.vehicles.get(trip.vehicleId);
  if (!plan.stops.length || !v) return [];
  const first = net.outlets.get(plan.stops[0].outletId)!;
  const tr = net.travel.get(`${v.depot}|${first.district}`);
  if (!tr) return [];
  let clock = toMin(trip.depart);
  let delay = o.reportedDelayMin ?? 0;
  const out: ExpectedStop[] = [];
  plan.stops.forEach((st, i) => {
    const ot = net.outlets.get(st.outletId)!;
    const mall = parseWindow(ot.mallWindow);
    const openAt = Math.max(toMin(ot.open), mall ? mall[0] : 0);
    const closeAt = Math.min(toMin(ot.close), mall ? mall[1] : 24 * 60);
    const doneAt = o.done?.get(st.outletId);
    if (doneAt !== undefined) {
      out.push({ outletId: st.outletId, seq: st.seq, plannedArrive: st.arrive, expectedArrive: doneAt - st.allowance, expectedLeave: doneAt, openAt, closeAt, done: true, late: doneAt - st.allowance > closeAt, lateRisk: false, delayMin: Math.max(0, doneAt - st.leave) });
      clock = doneAt;
      return;
    }
    const legFree = i === 0 ? tr.outMin : tr.interMin;
    if (o.holdUntil !== undefined) { clock = Math.max(clock, o.holdUntil); o = { ...o, holdUntil: undefined }; }
    let arrive = clock + legFree * travelFactor(net, ot.district, clock, o.date, o.monsoon) + delay;
    delay = 0; // a reported hold happens once
    if (o.started && o.now !== undefined) arrive = Math.max(arrive, o.now);
    arrive = Math.round(arrive);
    const start = Math.max(arrive, openAt);
    const leave = start + st.allowance;
    clock = leave;
    const late = arrive > closeAt;
    out.push({ outletId: st.outletId, seq: st.seq, plannedArrive: st.arrive, expectedArrive: arrive, expectedLeave: leave, openAt, closeAt, done: false, late, lateRisk: !late && closeAt - arrive <= net.rules.lateRiskSlackMin, delayMin: Math.max(0, arrive - st.arrive) });
  });
  return out;
}
