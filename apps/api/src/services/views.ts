import { allocationFromTrips, autoPlan, buildNetwork, checkAllocation, DEPOT_POSITION, forecastWeek, REASONS, toHHMM, tripMinutesTable, type Order, type WeeklyHistory } from '@pathwise/core';
import { dayLabel, minutesOfDay, nowSync } from '../clock.js';
import { one, q } from '../db.js';
import type { AuthUser } from '../auth.js';
import { MS_PER_MINUTE } from '../lib/constants.js';
import { getSettings } from '../lib/settings.js';
import { activePlanDate, loadNetwork, ORDER_COLS } from './network.js';
import { planView } from './plans.js';
import { liveEta } from './live.js';

/* Read models for the dispatcher's screens. */

/** map with at most `limit` calls in flight, keeping the input order */
async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]); }
  }));
  return out;
}

export async function overview(date?: string, depot?: string) {
  const d = date ?? await activePlanDate();
  const net = await loadNetwork();
  const { operations } = await getSettings();
  const [orders, byStatus, trips, exceptions, pub, cal] = await Promise.all([
    q<any>(`SELECT o.temp, ot.brand, o.status, o.m3 FROM orders o JOIN outlets ot ON ot.id = o.outlet_id WHERE (o.delivery_date = $1 OR o.id IN (SELECT order_id FROM deferrals WHERE from_date = $1)) AND o.parent_order_id IS NULL AND o.status <> 'cancelled' AND ($2::text IS NULL OR ot.depot = $2)`, [d, depot ?? null]),
    // whole orders moved to another day; part-deferrals (shortfalls, replacements) are counted separately
    q<any>(`SELECT df.kind, df.reason, count(*)::int AS n, count(*) FILTER (WHERE df.units IS NOT NULL)::int AS partial FROM deferrals df JOIN orders o ON o.id = df.order_id JOIN outlets ot ON ot.id = o.outlet_id WHERE df.from_date = $1 AND ($2::text IS NULL OR ot.depot = $2) GROUP BY df.kind, df.reason`, [d, depot ?? null]),
    q<any>(`SELECT t.status, count(*)::int AS n FROM trips t JOIN vehicles ve ON ve.id = t.vehicle_id WHERE t.plan_date = $1 AND t.status <> 'cancelled' AND ($2::text IS NULL OR ve.depot = $2) GROUP BY t.status`, [d, depot ?? null]),
    q<any>(`SELECT e.id, e.type, e.title, e.detail, e.raised_at AS "raisedAt", e.severity, COALESCE(ot.depot, ve.depot) AS depot FROM exceptions e LEFT JOIN trips t ON t.id = e.trip_id LEFT JOIN vehicles ve ON ve.id = t.vehicle_id LEFT JOIN outlets ot ON ot.id = e.outlet_id WHERE e.status = 'open' AND ($1::text IS NULL OR COALESCE(ot.depot, ve.depot) IS NULL OR COALESCE(ot.depot, ve.depot) = $1) ORDER BY e.raised_at DESC`, [depot ?? null]),
    one<any>(`SELECT version, published_at AS "publishedAt" FROM plans WHERE plan_date = $1 AND status = 'published'`, [d]),
    one<any>(`SELECT is_payday AS "isPayday", holiday, festival_ramp AS "festivalRamp", monsoon FROM calendar WHERE date = $1`, [d]),
  ]);
  const vehicles = [...net.vehicles.values()].filter(v => !depot || v.depot === depot);
  const tripCount = Object.fromEntries(trips.map(t => [t.status, t.n]));
  const deferred = byStatus.reduce((a, r) => a + r.n - r.partial, 0);
  const partial = byStatus.reduce((a, r) => a + r.partial, 0);
  const reefers = vehicles.filter(v => v.temp === 'reefer');
  const unconfirmedQ = one<{ n: number }>(`SELECT count(*)::int AS n FROM orders o JOIN outlets ot ON ot.id = o.outlet_id WHERE o.delivery_date = $1 AND ($4::text IS NULL OR ot.depot = $4) AND o.status IN ('delivered','partial') AND NOT EXISTS (SELECT 1 FROM receipts r WHERE r.order_id = o.id)
      AND EXISTS (SELECT 1 FROM trip_orders tor JOIN stop_events e ON e.trip_id = tor.trip_id AND e.outlet_id = o.outlet_id AND e.type = 'delivered' WHERE tor.order_id = o.id AND e.device_time < $2::timestamptz - make_interval(mins => $3))`,
    [d, nowSync(), Math.round(operations.receiptConfirmHours * 60), depot ?? null]);
  const [draft, next, view, unconfirmed] = await Promise.all([
    one<any>(`SELECT version FROM plans WHERE plan_date = $1 AND status = 'draft'`, [d]),
    one<any>(`SELECT to_char(date,'YYYY-MM-DD') AS date, holiday FROM calendar WHERE date > $1 ORDER BY date LIMIT 1`, [d]),
    pub ? planView(d) : Promise.resolve(null),
    unconfirmedQ,
  ]);
  const closest = view ? Object.entries(view.usage).filter(([id]) => !depot || net.vehicles.get(id)!.depot === depot).map(([id, u]: any) => ({ id, depot: net.vehicles.get(id)!.depot, fresh: u.fresh, freshBudget: u.freshBudget, fuelAfter: Math.round((u.fuelUsedL + u.fuelAddL) * 10) / 10, fuelQuota: u.fuelQuotaL })).sort((a, b) => b.fresh / b.freshBudget - a.fresh / a.freshBudget).slice(0, 4) : [];
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
      unconfirmedReceipts: unconfirmed?.n ?? 0,
    },
    fleet: {
      total: vehicles.length, available: vehicles.filter(v => v.status === 'available').length,
      notRunning: vehicles.filter(v => v.status !== 'available').map(v => ({ id: v.id, type: v.type, temp: v.temp, depot: v.depot })),
      groups: [['Reefer trucks', (v: any) => v.type === 'truck' && v.temp === 'reefer'], ['Dry-box trucks', (v: any) => v.type === 'truck' && v.temp === 'ambient'], ['Reefer vans', (v: any) => v.type === 'van' && v.temp === 'reefer'], ['Dry vans', (v: any) => v.type === 'van' && v.temp === 'ambient']]
        .map(([label, f]: any) => { const all = vehicles.filter(f); return { label, total: all.length, available: all.filter(v => v.status === 'available').length }; }),
      reeferAvailable: reefers.filter(v => v.status === 'available').length, reeferTotal: reefers.length,
    },
    trips: { total: trips.reduce((a, t) => a + t.n, 0), ...tripCount },
    chilled: view ? { reeferTrips: view.trips.filter(t => t.vehicle.temp === 'reefer' && (!depot || t.vehicle.depot === depot)).length, possible: reefers.filter(v => v.status === 'available').length * net.rules.maxTripsPerVehicle, deferredChilled: view.deferrals.filter((x: any) => x.temp === 'chilled' && !x.units).length } : null,
    closest,
    attention: exceptions,
  };
}

/** Live tracking: every trip of the day with progress, last contact, expected ETAs and a position. */
export async function tracking(date?: string) {
  const d = date ?? await activePlanDate();
  const net = await loadNetwork();
  const { operations } = await getSettings();
  const now = nowSync();
  const trips = await q<any>(`SELECT t.id, t.vehicle_id, t.trip_no, t.depart, t.status, to_char(t.plan_date,'YYYY-MM-DD') AS plan_date, t.started_at AS "startedAt", t.closed_at AS "closedAt", p.last_seen AS "lastSeen"
    FROM trips t LEFT JOIN vehicle_presence p ON p.vehicle_id = t.vehicle_id WHERE t.plan_date = $1 AND t.status <> 'cancelled' ORDER BY t.depart, t.vehicle_id`, [d]);
  // a few trips at a time: sequential is slow over a remote database, unbounded would starve the pool
  const out = await mapLimit(trips, 4, async (t: any) => {
    const eta = await liveEta(net, t, now);
    const ev = await q<any>(`SELECT outlet_id AS "outletId", device_time AS "deviceTime", conflict, payload->>'outcome' AS outcome FROM stop_events WHERE trip_id = $1 AND type = 'delivered' ORDER BY device_time`, [t.id]);
    const lastSeen = t.lastSeen ? new Date(t.lastSeen) : null;
    const offline = t.status === 'in_progress' && (!lastSeen || now.getTime() - lastSeen.getTime() > operations.offlineAfterMin * MS_PER_MINUTE);
    const v = net.vehicles.get(t.vehicle_id)!;
    const ot = (id: string) => net.outlets.get(id)!;
    const next = eta.stops.find(s => !s.done);
    const lastDone = [...eta.stops].reverse().find(s => s.done);
    let pos: [number, number] = DEPOT_POSITION[v.depot];
    if (t.status === 'completed' && lastDone) pos = [ot(lastDone.outletId).lat ?? pos[0], ot(lastDone.outletId).lng ?? pos[1]];
    else if (t.status === 'in_progress' && lastDone) pos = [ot(lastDone.outletId).lat ?? pos[0], ot(lastDone.outletId).lng ?? pos[1]];
    let estimate: [number, number] | null = null;
    if (offline && next) {
      // where the vehicle should be now: between the last known point and the next stop
      const nx = ot(next.outletId);
      const from = lastDone ? lastDone.expectedLeave : Number(t.depart.slice(0, 2)) * 60 + Number(t.depart.slice(3));
      const f = Math.min(1, Math.max(0, (minutesOfDay(now) - from) / Math.max(10, next.expectedArrive - from)));
      estimate = [pos[0] + ((nx.lat ?? pos[0]) - pos[0]) * f, pos[1] + ((nx.lng ?? pos[1]) - pos[1]) * f];
    }
    return {
      id: t.id, vehicleId: t.vehicle_id, trip: t.trip_no, depart: t.depart, status: t.status, startedAt: t.startedAt, closedAt: t.closedAt,
      driverName: v.driverName, vehicle: { type: v.type, temp: v.temp, depot: v.depot },
      brand: ot(eta.stops[0]?.outletId ?? '')?.brand ?? null, district: ot(eta.stops[0]?.outletId ?? '')?.district ?? null,
      stops: eta.stops.map(s => {
        const e = ev.find(x => x.outletId === s.outletId);
        return { seq: s.seq, outletId: s.outletId, arrive: s.plannedHHMM, expected: s.expectedArriveHHMM, delayMin: s.delayMin, done: s.done, outcome: e?.outcome ?? null, doneAt: e ? toHHMM(minutesOfDay(new Date(e.deviceTime))) : null, lat: ot(s.outletId).lat, lng: ot(s.outletId).lng, window: `${toHHMM(s.openAt)}–${s.closeHHMM}`, late: s.late, lateRisk: s.lateRisk };
      }),
      done: eta.stops.filter(s => s.done).length, total: eta.stops.length,
      next: next ? { outletId: next.outletId, eta: next.expectedArriveHHMM, planned: next.plannedHHMM } : null,
      offline, lastSeen: lastSeen?.toISOString() ?? null, position: pos, estimate, conflicts: ev.filter(e => e.conflict).length,
      lateRisk: eta.lateRisk, hold: eta.hold, depot: DEPOT_POSITION[v.depot],
    };
  });
  return { date: d, now: now.toISOString(), trips: out, depots: DEPOT_POSITION };
}

/** Weekly demand history and a forecast for the Task 2A horizon, against usable chilled capacity. */
export async function forecast() {
  const d = await activePlanDate();
  const net = await loadNetwork();
  const rows = await q<any>(`SELECT depot, brand, iso_year, iso_week, source, total_m3, chilled_m3, orders FROM demand_weekly ORDER BY iso_year, iso_week`);
  const history: WeeklyHistory = new Map(rows.filter(r => r.source === 'history').map(r => [`${r.depot}|${r.brand}|${r.iso_year}-${String(r.iso_week).padStart(2, '0')}`, { total: Number(r.total_m3), chilled: Number(r.chilled_m3), orders: r.orders }]));
  const imported = new Map(rows.filter(r => r.source === 'forecast_import').map(r => [`${r.depot}|${r.brand}|${r.iso_year}-${r.iso_week}`, r]));
  const lastHist = rows.filter(r => r.source === 'history').reduce((m, r) => Math.max(m, r.iso_year * 100 + r.iso_week), 0);
  // four weeks of actual history, then forward to eight weeks after the delivery day — whole ISO weeks only
  const weeks = await q<any>(`WITH bounds AS (
      SELECT least(date_trunc('week', $1::date - 28)::date, coalesce((SELECT min(date) FROM calendar WHERE iso_year * 100 + iso_week = $2::int) - 21, $1::date - 28)) AS start,
             date_trunc('week', $1::date + 56)::date + 6 AS stop)
    SELECT iso_year, iso_week, min(date)::text AS start, max(date)::text AS "end", count(*) FILTER (WHERE is_operating)::int AS "opDays", count(*) FILTER (WHERE is_payday)::int AS paydays,
      max(festival_ramp) AS ramp, bool_or(monsoon) AS monsoon, array_remove(array_agg(DISTINCT holiday), NULL) AS holidays
    FROM calendar, bounds WHERE iso_year IS NOT NULL AND date >= bounds.start AND date <= bounds.stop
    GROUP BY iso_year, iso_week HAVING count(*) = 7 ORDER BY iso_year, iso_week LIMIT 20`, [d, lastHist]);

  // usable chilled capacity per operating day = what the planning engine fits on today's working reefers
  const today = await q<any>(`SELECT ${ORDER_COLS} FROM orders o WHERE (o.delivery_date = $1 OR o.id IN (SELECT order_id FROM deferrals WHERE from_date = $1 AND units IS NULL)) AND o.status <> 'cancelled' AND o.parent_order_id IS NULL`, [d]);
  const sim = autoPlan(net, today.map((o: any) => ({ ...o, date: d })));
  const perDay = { Peliyagoda: 0, Kandy: 0 } as Record<string, number>;
  for (const t of sim.trips) { const v = net.vehicles.get(t.vehicleId)!; if (v.temp !== 'reefer') continue; for (const id of t.orderIds) { const o = today.find((x: any) => x.id === id); if (o?.temp === 'chilled') perDay[v.depot] += Number(o.m3); } }
  const depots = ['Peliyagoda', 'Kandy'], brands = ['Fresh', 'Style', 'Tech'];
  const series = weeks.map(w => {
    const key = w.iso_year * 100 + w.iso_week;
    const cells = depots.flatMap(dep => brands.map(br => {
      const k = `${dep}|${br}|${w.iso_year}-${String(w.iso_week).padStart(2, '0')}`;
      const imp = imported.get(`${dep}|${br}|${w.iso_year}-${w.iso_week}`);
      if (key <= lastHist && history.has(k)) return { depot: dep, brand: br, total: history.get(k)!.total, chilled: history.get(k)!.chilled, kind: 'actual' as const };
      if (imp) return { depot: dep, brand: br, total: Number(imp.total_m3), chilled: Number(imp.chilled_m3), kind: 'imported' as const };
      const f = forecastWeek(history, dep, br, w.iso_year, w.iso_week);
      return { depot: dep, brand: br, total: f.total, chilled: f.chilled, kind: 'forecast' as const };
    }));
    const chilled = cells.reduce((a, c) => a + c.chilled, 0);
    const reeferCap = Math.round((perDay.Peliyagoda + perDay.Kandy) * w.opDays);
    return {
      week: `W${String(w.iso_week).padStart(2, '0')}`, isoYear: w.iso_year, isoWeek: w.iso_week, start: w.start, end: w.end, opDays: w.opDays, paydays: w.paydays, ramp: Number(w.ramp), monsoon: w.monsoon, holidays: w.holidays,
      kind: cells.every(c => c.kind === 'actual') ? 'actual' : cells.some(c => c.kind === 'imported') ? 'imported' : 'forecast',
      total: Math.round(cells.reduce((a, c) => a + c.total, 0)), chilled: Math.round(chilled), reeferCap, gap: Math.round(reeferCap - chilled),
      byDepot: depots.map(dep => ({ depot: dep, chilled: Math.round(cells.filter(c => c.depot === dep).reduce((a, c) => a + c.chilled, 0)), total: Math.round(cells.filter(c => c.depot === dep).reduce((a, c) => a + c.total, 0)), reeferCap: Math.round(perDay[dep] * w.opDays) })),
      cells,
    };
  });
  const chilledDemand = today.filter((o: any) => o.temp === 'chilled').reduce((a: number, o: any) => a + Number(o.m3), 0);
  return {
    method: imported.size
      ? 'Weeks marked "imported" use the Datathon Task 2A forecast you uploaded. Other future weeks use the baseline: 0.7 × same week last year × recent growth + 0.3 × last-8-week average (≈14% error in back-tests).'
      : 'Past weeks are actual order volume (deliveries_train + task1 inputs, by the week the store requested). Future weeks use the baseline: 0.7 × same week last year × recent growth + 0.3 × last-8-week average (≈14% error in back-tests). Upload the Datathon Task 2A forecast in Admin → Data to replace it.',
    capacityMethod: 'Usable chilled capacity per operating day = chilled m³ the planning engine fits on today\'s working reefers (it respects brand/district splits, windows and time budgets).',
    today: { chilledDemandM3: Math.round(chilledDemand * 10) / 10, chilledServedM3: sim.stats.chilledServedM3, reefersWorking: [...net.vehicles.values()].filter(v => v.temp === 'reefer' && v.status === 'available').length, byDepot: perDay },
    weeks: series,
  };
}

/** Task 2B peak day (S1): the engine allocates it with the scenario's fleet and checks the official rules. */
export async function peakDay() {
  const { PEAK_DAY_ORDERS, PEAK_DAY_FLEET } = await import('@pathwise/core');
  const base = await loadNetwork();
  const available = new Set(PEAK_DAY_FLEET.filter(([, s]) => s === 'available').map(([v]) => v));
  const net = buildNetwork({ outlets: [...base.outlets.values()], vehicles: [...base.vehicles.values()].map(v => ({ ...v, fuelUsedL: 0, status: available.has(v.id) ? 'available' : 'in_workshop' })), travel: [...base.travel.values()], allowance: base.allowance, rules: base.rules });
  const orders: Order[] = PEAK_DAY_ORDERS.map(([id, outletId, temp, units, kg, m3, dy, days]) => ({ id, outletId, temp, units, kg, m3, date: 'S1', deferredYesterday: dy === 1, daysSinceServed: days }));
  const t0 = Date.now();
  const res = autoPlan(net, orders);
  const ms = Date.now() - t0;
  const byId = new Map(orders.map(o => [o.id, o]));
  const alloc = allocationFromTrips(orders.map(o => o.id), res.trips);
  const errors = checkAllocation(net, byId, alloc, available);
  const fleet = PEAK_DAY_FLEET.map(([id, status]) => { const v = net.vehicles.get(id)!; return { id, status, type: v.type, temp: v.temp, depot: v.depot }; });
  const chilled = orders.filter(o => o.temp === 'chilled');
  const reeferAvail = fleet.filter(f => f.status === 'available' && f.temp === 'reefer' && f.depot === 'Peliyagoda');
  return {
    scenario: 'S1', depot: 'Peliyagoda', ms,
    summary: { orders: orders.length, served: res.stats.served, deferred: res.stats.deferred, trips: res.trips.length, vehiclesUsed: res.stats.vehiclesUsed, chilledDemandM3: res.stats.chilledDemandM3, chilledServedM3: res.stats.chilledServedM3, reefersAvailable: reeferAvail.length, fleetListed: fleet.length, fleetAvailable: fleet.filter(f => f.status === 'available').length },
    feasibility: { passed: errors.length === 0, errors },
    trips: tripMinutesTable(net, res.trips, byId).map(t => ({ ...t, budget: t.brand === 'Fresh' ? net.rules.freshBudgetMin : net.rules.styleTechBudgetMin })),
    allocation: alloc.map(a => { const o = byId.get(a.orderId)!; const ot = net.outlets.get(o.outletId)!; const def = res.deferrals.find(x => x.orderId === a.orderId); return { ...a, outletId: o.outletId, brand: ot.brand, district: ot.district, temp: o.temp, kg: o.kg, m3: o.m3, deferredYesterday: !!o.deferredYesterday, daysSinceServed: o.daysSinceServed, reason: def?.reason ?? null, kind: def?.kind ?? null, why: def?.why ?? null }; }),
    limiting: chilled.length ? `Chilled demand is ${res.stats.chilledDemandM3} m³; the ${reeferAvail.length} available Peliyagoda reefers could carry ${res.stats.chilledServedM3} m³ within the brand/district, window and 270-minute rules.` : '',
  };
}
export function peakDayCsv(p: Awaited<ReturnType<typeof peakDay>>) {
  return ['scenario,order_ref,outlet_id,decision,vehicle_id,trip_id', ...p.allocation.map(a => `S1,${a.orderId},${a.outletId},${a.decision},${a.vehicleId ?? ''},${a.trip ?? ''}`)].join('\n') + '\n';
}

export async function reference() {
  const net = await loadNetwork();
  const cal = await q<any>(`SELECT to_char(date,'YYYY-MM-DD') AS date, is_operating AS "isOperating", is_payday AS "isPayday", holiday, festival_ramp AS "festivalRamp", monsoon, iso_week AS "isoWeek" FROM calendar WHERE date BETWEEN $1::date - 60 AND $1::date + 90 ORDER BY date`, [await activePlanDate()]);
  const { operations } = await getSettings();
  return { outlets: [...net.outlets.values()], vehicles: [...net.vehicles.values()], rules: net.rules, operations, reasons: REASONS, calendar: cal, depots: DEPOT_POSITION };
}

function audiences(u: AuthUser) {
  const aud = [`role:${u.role}`, `user:${u.id}`];
  if (u.role === 'admin') aud.push('role:dispatcher');
  if (u.depot && u.role === 'loader') aud.push(`depot:${u.depot}`);
  if (u.outletId) aud.push(`outlet:${u.outletId}`);
  if (u.vehicleId) aud.push(`vehicle:${u.vehicleId}`);
  return aud;
}
export async function myNotifications(u: AuthUser) {
  const rows = await q<any>(`SELECT n.id, n.kind, n.tone, n.title, n.body, n.link, n.created_at AS "createdAt", (r.user_id IS NOT NULL) AS read
    FROM notifications n LEFT JOIN notification_reads r ON r.notification_id = n.id AND r.user_id = $2 WHERE n.audience = ANY($1) ORDER BY n.created_at DESC, n.id DESC LIMIT 60`, [audiences(u), u.id]);
  return { unread: rows.filter(r => !r.read).length, items: rows };
}
export async function markRead(u: AuthUser, ids?: number[]) {
  await q(`INSERT INTO notification_reads (notification_id, user_id)
    SELECT n.id, $2 FROM notifications n WHERE n.audience = ANY($1) AND ($3::int[] IS NULL OR n.id = ANY($3)) ON CONFLICT DO NOTHING`, [audiences(u), u.id, ids?.length ? ids : null]);
  return { ok: true };
}
