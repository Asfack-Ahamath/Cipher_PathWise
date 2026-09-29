import { autoPlan, DEPOT_POSITION, REASONS, scheduleTrip, toHHMM, type Order } from '@pathwise/core';
import { dayLabel, minutesOfDay, nowSync } from '../clock.js';
import { one, q } from '../db.js';
import type { AuthUser } from '../auth.js';
import { activePlanDate, loadNetwork, ORDER_COLS } from './network.js';
import { planView } from './plans.js';

/* Read models for the dispatcher's screens. */

export async function overview(date?: string) {
  const d = date ?? await activePlanDate();
  const net = await loadNetwork();
  const [orders, byStatus, trips, exceptions, pub, cal] = await Promise.all([
    q<any>(`SELECT o.temp, ot.brand, o.status, o.m3 FROM orders o JOIN outlets ot ON ot.id = o.outlet_id WHERE (o.delivery_date = $1 OR o.id IN (SELECT order_id FROM deferrals WHERE from_date = $1)) AND o.parent_order_id IS NULL`, [d]),
    // whole orders moved to another day; part-deferrals (shortfalls, replacements) are counted separately
    q<any>(`SELECT kind, reason, count(*)::int AS n, count(*) FILTER (WHERE units IS NOT NULL)::int AS partial FROM deferrals WHERE from_date = $1 GROUP BY kind, reason`, [d]),
    q<any>(`SELECT status, count(*)::int AS n FROM trips WHERE plan_date = $1 AND status <> 'cancelled' GROUP BY status`, [d]),
    q<any>(`SELECT id, type, title, detail, raised_at AS "raisedAt", severity FROM exceptions WHERE status = 'open' ORDER BY raised_at DESC`),
    one<any>(`SELECT version, published_at AS "publishedAt" FROM plans WHERE plan_date = $1 AND status = 'published'`, [d]),
    one<any>(`SELECT is_payday AS "isPayday", holiday, festival_ramp AS "festivalRamp", monsoon FROM calendar WHERE date = $1`, [d]),
  ]);
  const draft = await one<any>(`SELECT version FROM plans WHERE plan_date = $1 AND status = 'draft'`, [d]);
  const vehicles = [...net.vehicles.values()];
  const tripCount = Object.fromEntries(trips.map(t => [t.status, t.n]));
  const deferred = byStatus.reduce((a, r) => a + r.n - r.partial, 0);
  const partial = byStatus.reduce((a, r) => a + r.partial, 0);
  const next = await one<any>(`SELECT to_char(date,'YYYY-MM-DD') AS date, holiday FROM calendar WHERE date > $1 ORDER BY date LIMIT 1`, [d]);
  const view = pub ? await planView(d) : null;
  const closest = view ? Object.entries(view.usage).map(([id, u]: any) => ({ id, depot: net.vehicles.get(id)!.depot, fresh: u.fresh, freshBudget: u.freshBudget, fuelAfter: Math.round((u.fuelUsedL + u.fuelAddL) * 10) / 10, fuelQuota: u.fuelQuotaL })).sort((a, b) => b.fresh / b.freshBudget - a.fresh / a.freshBudget).slice(0, 4) : [];
  const reefers = vehicles.filter(v => v.temp === 'reefer');
  return {
    date: d, dateLabel: dayLabel(d), now: nowSync().toISOString(), calendar: cal, nextDay: next,
    plan: { published: pub, draft: draft ? { version: draft.version } : null },
    orders: {
      confirmed: orders.length,
      byBrand: (['Fresh', 'Style', 'Tech'] as const).map(b => ({ brand: b, n: orders.filter(o => o.brand === b).length })),
      planned: orders.length - deferred, deferred, partial,
      forced: byStatus.filter(r => r.kind === 'forced').reduce((a, r) => a + r.n - r.partial, 0),
      chosen: byStatus.filter(r => r.kind === 'chosen').reduce((a, r) => a + r.n - r.partial, 0),
      byReason: byStatus.map(r => ({ ...r, label: REASONS[r.reason as keyof typeof REASONS]?.label ?? r.reason })),
      delivered: orders.filter(o => ['delivered', 'received', 'partial', 'disputed'].includes(o.status)).length,
    },
    fleet: {
      total: vehicles.length, available: vehicles.filter(v => v.status === 'available').length,
      notRunning: vehicles.filter(v => v.status !== 'available').map(v => ({ id: v.id, type: v.type, temp: v.temp, depot: v.depot })),
      groups: [['Reefer trucks', (v: any) => v.type === 'truck' && v.temp === 'reefer'], ['Dry-box trucks', (v: any) => v.type === 'truck' && v.temp === 'ambient'], ['Reefer vans', (v: any) => v.type === 'van' && v.temp === 'reefer'], ['Dry vans', (v: any) => v.type === 'van' && v.temp === 'ambient']]
        .map(([label, f]: any) => { const all = vehicles.filter(f); return { label, total: all.length, available: all.filter(v => v.status === 'available').length }; }),
      reeferAvailable: reefers.filter(v => v.status === 'available').length, reeferTotal: reefers.length,
    },
    trips: { total: trips.reduce((a, t) => a + t.n, 0), ...tripCount },
    chilled: view ? { reeferTrips: view.trips.filter(t => t.vehicle.temp === 'reefer').length, possible: reefers.filter(v => v.status === 'available').length * 2, deferredChilled: view.deferrals.filter((x: any) => x.temp === 'chilled' && !x.units).length } : null,
    closest,
    attention: exceptions,
  };
}

/** Live tracking: every trip of the day with progress, last contact and a position. */
export async function tracking(date?: string) {
  const d = date ?? await activePlanDate();
  const net = await loadNetwork();
  const now = nowSync();
  const trips = await q<any>(`SELECT t.id, t.vehicle_id AS "vehicleId", t.trip_no AS trip, t.depart, t.status, t.started_at AS "startedAt", t.closed_at AS "closedAt", p.last_seen AS "lastSeen"
    FROM trips t LEFT JOIN vehicle_presence p ON p.vehicle_id = t.vehicle_id WHERE t.plan_date = $1 AND t.status <> 'cancelled' ORDER BY t.depart, t.vehicle_id`, [d]);
  const out = [];
  for (const t of trips) {
    const orders = await q<any>(`SELECT ${ORDER_COLS} FROM trip_orders tor JOIN orders o ON o.id = tor.order_id WHERE tor.trip_id = $1 AND tor.moved_at IS NULL AND tor.load_status <> 'removed' ORDER BY tor.seq`, [t.id]);
    const om = new Map<string, Order>(orders.map((o: any) => [o.id, o]));
    const s = scheduleTrip(net, { vehicleId: t.vehicleId, trip: t.trip, depart: t.depart, orderIds: orders.map((o: any) => o.id) }, om);
    const ev = await q<any>(`SELECT type, outlet_id AS "outletId", device_time AS "deviceTime", received_at AS "receivedAt", conflict, payload->>'outcome' AS outcome FROM stop_events WHERE trip_id = $1 ORDER BY device_time`, [t.id]);
    const done = new Set(ev.filter(e => e.type === 'delivered').map(e => e.outletId));
    const lastSeen = t.lastSeen ? new Date(t.lastSeen) : null;
    const offline = t.status === 'in_progress' && (!lastSeen || now.getTime() - lastSeen.getTime() > 10 * 60000);
    const next = s.stops.find(st => !done.has(st.outletId));
    const lastDone = [...s.stops].reverse().find(st => done.has(st.outletId));
    const ot = (id: string) => net.outlets.get(id)!;
    const v = net.vehicles.get(t.vehicleId)!;
    let pos: [number, number] = DEPOT_POSITION[v.depot];
    if (t.status === 'in_progress' && lastDone) pos = [ot(lastDone.outletId).lat ?? pos[0], ot(lastDone.outletId).lng ?? pos[1]];
    let estimate: [number, number] | null = null;
    if (offline && next) {
      // where the plan says the vehicle should be now: between the last known point and the next stop
      const nx = ot(next.outletId); const f = Math.min(1, Math.max(0, (minutesOfDay(now) - (lastDone ? lastDone.leave : Number(t.depart.split(':')[0]) * 60 + Number(t.depart.split(':')[1]))) / Math.max(10, next.arrive - (lastDone ? lastDone.leave : next.arrive - 30))));
      estimate = [pos[0] + ((nx.lat ?? pos[0]) - pos[0]) * f, pos[1] + ((nx.lng ?? pos[1]) - pos[1]) * f];
    }
    const conflicts = ev.filter(e => e.conflict).length;
    const lateRisk = s.stops.filter(st => !done.has(st.outletId) && (st.lateRisk || st.late)).map(st => st.outletId);
    out.push({
      ...t, driverName: v.driverName, vehicle: { type: v.type, temp: v.temp, depot: v.depot }, brand: s.brand, district: s.district,
      stops: s.stops.map(st => ({ seq: st.seq, outletId: st.outletId, arrive: toHHMM(st.arrive), leave: toHHMM(st.leave), done: done.has(st.outletId), outcome: ev.find(e => e.type === 'delivered' && e.outletId === st.outletId)?.outcome ?? null, doneAt: (() => { const e = ev.find(e => e.type === 'delivered' && e.outletId === st.outletId); return e ? toHHMM(minutesOfDay(new Date(e.deviceTime))) : null; })(), lat: ot(st.outletId).lat, lng: ot(st.outletId).lng, window: `${ot(st.outletId).open}–${ot(st.outletId).close}` })),
      done: done.size, total: s.stops.length, next: next ? { outletId: next.outletId, eta: toHHMM(next.arrive) } : null,
      offline, lastSeen: lastSeen?.toISOString() ?? null, position: pos, estimate, conflicts, lateRisk,
      depot: DEPOT_POSITION[v.depot],
    });
  }
  return { date: d, now: now.toISOString(), trips: out, depots: DEPOT_POSITION };
}

/** Weekly chilled demand against usable reefer capacity. Baseline from today's orders, scaled by calendar.csv flags.
 *  Placeholder until the Datathon forecast model (Task 2A) is plugged in. */
export async function forecast() {
  const d = await activePlanDate();
  const net = await loadNetwork();
  const base = await one<any>(`SELECT coalesce(sum(m3) FILTER (WHERE temp = 'chilled'),0) AS chilled, coalesce(sum(m3),0) AS total FROM orders WHERE delivery_date = $1 OR id IN (SELECT order_id FROM deferrals WHERE from_date = $1)`, [d]);
  const weeks = await q<any>(`SELECT iso_week AS week, min(date)::text AS start, max(date)::text AS "end", count(*) FILTER (WHERE is_operating)::int AS "opDays",
      bool_or(is_payday) AS payday, max(festival_ramp) AS ramp, bool_or(monsoon) AS monsoon, array_remove(array_agg(DISTINCT holiday), NULL) AS holidays,
      count(*) FILTER (WHERE is_payday)::int AS paydays
    FROM calendar WHERE date >= $1::date - ((extract(isodow from $1::date)::int) - 1) GROUP BY iso_week ORDER BY min(date) LIMIT 9`, [d]);
  // Usable chilled capacity per day = what the planning engine can actually fit on today's working reefers
  // (it respects brand/district splits, windows and time budgets, so it is well below the raw m³ of the fleet).
  // the day's full demand, including orders the published plan has already moved to the next run (not remainders)
  const today = await q<any>(`SELECT ${ORDER_COLS} FROM orders o WHERE (o.delivery_date = $1 OR o.id IN (SELECT order_id FROM deferrals WHERE from_date = $1 AND units IS NULL)) AND o.status <> 'cancelled' AND o.parent_order_id IS NULL`, [d]);
  const sim = autoPlan(net, today.map((o: any) => ({ ...o, date: d })));
  const perDayCap = Math.max(sim.stats.chilledServedM3, 1);
  return {
    method: 'Demand = today’s chilled m³ per operating day × (1 + 0.12 per payday + 0.25 × festival ramp + 0.05 in monsoon). Capacity = chilled m³ the planning engine fits on today’s working reefers, per operating day. Replace demand with the Datathon model output (Task 2A).',
    today: { chilledDemandM3: sim.stats.chilledDemandM3, chilledServedM3: sim.stats.chilledServedM3, reefersWorking: [...net.vehicles.values()].filter(v => v.temp === 'reefer' && v.status === 'available').length },
    weeks: weeks.map(w => {
      const mult = 1 + 0.12 * w.paydays + 0.25 * Number(w.ramp) + (w.monsoon ? 0.05 : 0);
      const chilled = Math.round(Number(base.chilled) * w.opDays * mult);
      const cap = Math.round(perDayCap * w.opDays);
      return { ...w, chilled, total: Math.round(Number(base.total) * w.opDays * mult), reeferCap: cap, gap: cap - chilled };
    }),
  };
}

export async function reference() {
  const net = await loadNetwork();
  const cal = await q<any>(`SELECT to_char(date,'YYYY-MM-DD') AS date, is_operating AS "isOperating", is_payday AS "isPayday", holiday, festival_ramp AS "festivalRamp", monsoon, iso_week AS "isoWeek" FROM calendar ORDER BY date`);
  return { outlets: [...net.outlets.values()], vehicles: [...net.vehicles.values()], rules: net.rules, reasons: REASONS, calendar: cal, depots: DEPOT_POSITION };
}

export async function myNotifications(u: AuthUser) {
  const aud = [`role:${u.role}`, `user:${u.id}`];
  if (u.depot && u.role === 'loader') aud.push(`depot:${u.depot}`);
  if (u.outletId) aud.push(`outlet:${u.outletId}`);
  if (u.vehicleId) aud.push(`vehicle:${u.vehicleId}`);
  const rows = await q<any>(`SELECT n.id, n.kind, n.tone, n.title, n.body, n.link, n.created_at AS "createdAt", (r.user_id IS NOT NULL) AS read
    FROM notifications n LEFT JOIN notification_reads r ON r.notification_id = n.id AND r.user_id = $2 WHERE n.audience = ANY($1) ORDER BY n.created_at DESC, n.id DESC LIMIT 60`, [aud, u.id]);
  return { unread: rows.filter(r => !r.read).length, items: rows };
}
export async function markRead(u: AuthUser, ids?: number[]) {
  const n = await myNotifications(u);
  const target = ids?.length ? n.items.filter(i => ids.includes(i.id)) : n.items;
  for (const i of target) await q(`INSERT INTO notification_reads (notification_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [i.id, u.id]);
  return { ok: true };
}
