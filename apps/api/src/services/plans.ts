import { autoPlan, departureFor, REASONS, scheduleTrip, sequenceOrders, toHHMM, validatePlan, type DeferralDecision, type Network, type Order, type PlanTrip, type ReasonCode } from '@pathwise/core';
import { audit, notifyMany, type Notice } from '../audit.js';
import { dayLabel, nowSync } from '../clock.js';
import { one, pool, q, tx, type Db } from '../db.js';
import { bad, conflict, notFound } from '../errors.js';
import { MS_PER_MINUTE } from '../lib/constants.js';
import { z } from 'zod';
import { loadNetwork, nextOperatingDay, ordersForDate } from './network.js';
import { liveEta } from './live.js';

const vehicleId = z.string().trim().regex(/^VEH\d{3}$/, 'Vehicle ids look like VEH041.');
export const MoveBody = z.object({
  orderId: z.string().trim().min(1).max(40),
  target: z.object({ vehicleId, trip: z.number().int().min(1).max(3) }).nullable(),
  reason: z.object({ reason: z.enum(['capacity_volume', 'capacity_weight', 'no_reefer_capacity', 'no_van_capacity', 'vehicle_in_workshop', 'time_budget_exceeded', 'window_unreachable', 'fuel_quota', 'after_cutoff', 'dock_shortfall', 'other']), why: z.string().trim().max(300).optional() }).optional(),
}).refine(b => b.target || b.reason?.reason !== 'other' || !!b.reason?.why, { message: 'Add a note when the reason is "Other".', path: ['reason', 'why'] });
export const LiveMoveBody = z.object({
  outletId: z.string().trim().regex(/^OUT\d{3}$/, 'Outlet ids look like OUT116.'),
  to: z.object({ vehicleId, trip: z.number().int().min(1).max(3).optional() }),
  reason: z.string().trim().min(3, 'Say why the stop is moving — the driver and the store will see it.').max(300),
});

/* ──────────────────────────────────────────────────────────────────────────
   Plans. A draft is JSON on a plans row (editable, validated on every change).
   Publishing applies it to the live trips of the day — updating rows in place
   so trip ids never change — writes deferrals, and notifies every role.
   ────────────────────────────────────────────────────────────────────────── */

interface PlanRow { id: number; plan_date: string; version: number; status: 'draft' | 'published' | 'superseded'; source: string; trips: PlanTrip[]; deferrals: DeferralDecision[]; created_at: string; published_at: string | null; note: string | null }

const PLAN_COLS = `id, to_char(plan_date,'YYYY-MM-DD') AS plan_date, version, status, source, trips, deferrals, created_at, published_at, note`;
async function latest(date: string, status: string, db?: Db) {
  return one<PlanRow>(`SELECT ${PLAN_COLS} FROM plans WHERE plan_date = $1 AND status = $2 ORDER BY version DESC LIMIT 1`, [date, status], db);
}

/** Live trips of the day, in the same shape as a draft. */
export async function liveTrips(date: string, db?: Db): Promise<(PlanTrip & { id: number; status: string })[]> {
  const rows = await q<any>(`SELECT t.id, t.vehicle_id, t.trip_no, t.depart, t.status,
      coalesce(array_agg(tor.order_id ORDER BY tor.seq) FILTER (WHERE tor.order_id IS NOT NULL AND tor.moved_at IS NULL AND tor.load_status <> 'removed'), '{}') AS order_ids
    FROM trips t LEFT JOIN trip_orders tor ON tor.trip_id = t.id
    WHERE t.plan_date = $1 AND t.status <> 'cancelled' GROUP BY t.id ORDER BY t.vehicle_id, t.trip_no`, [date], db);
  return rows.map(r => ({ id: r.id, vehicleId: r.vehicle_id, trip: r.trip_no, depart: r.depart, status: r.status, orderIds: r.order_ids }));
}

/** Everything the plan board needs: the current draft (or the live plan), its validation and the unassigned orders. */
export async function planView(date: string) {
  // independent reads run side by side on the pool: one round trip of waiting instead of six
  const [net, draft, published, orders, deferredHere, live, movedOn] = await Promise.all([
    loadNetwork(), latest(date, 'draft'), latest(date, 'published'), ordersForDate(date),
    q<any>(`SELECT d.id, d.order_id AS "orderId", d.reason, d.kind, d.why, d.units, to_char(d.to_date,'YYYY-MM-DD') AS "toDate", d.notified_at AS "notifiedAt", d.acknowledged_at AS "acknowledgedAt", d.escalated,
        o.outlet_id AS "outletId", o.temp, o.units AS "orderUnits", o.kg, o.m3, o.description
      FROM deferrals d JOIN orders o ON o.id = d.order_id WHERE d.from_date = $1 ORDER BY d.id`, [date]),
    liveTrips(date),
    // orders deferred at publish moved to the next run; keep them visible on this day's board
    q<any>(`SELECT DISTINCT ON (o.id) o.id, o.outlet_id AS "outletId", o.temp, o.units, o.kg, o.m3, o.description, o.status, o.deferred_yesterday AS "deferredYesterday", o.days_since_served AS "daysSinceServed"
      FROM deferrals d JOIN orders o ON o.id = d.order_id WHERE d.from_date = $1 AND (o.delivery_date <> $1 OR o.status = 'cancelled') ORDER BY o.id`, [date]),
  ]);
  const all = new Map<string, any>(orders.map(o => [o.id, o]));
  const movedById = new Map<string, any>(movedOn.map(o => [o.id, o]));
  for (const d of deferredHere) if (!all.has(d.orderId) && movedById.has(d.orderId)) all.set(d.orderId, { ...movedById.get(d.orderId), date });
  const orderMap = new Map<string, Order>([...all.values()].map(o => [o.id, o]));
  const mode: 'draft' | 'live' | 'empty' = draft ? 'draft' : published ? 'live' : 'empty';
  const trips: PlanTrip[] = draft ? draft.trips : live;
  const v = validatePlan(net, trips, orderMap);
  const planned = new Set(trips.flatMap(t => t.orderIds));
  const deferredIds = new Set(deferredHere.filter(d => !d.units).map(d => d.orderId));
  const unassigned = [...orderMap.values()].filter(o => !planned.has(o.id) && !(mode === 'live' && deferredIds.has(o.id)) && (all.get(o.id)?.status ?? 'confirmed') !== 'cancelled');
  const proposals: DeferralDecision[] = draft?.deferrals ?? [];
  const statusById = new Map(live.map(t => [`${t.vehicleId}-${t.trip}`, t.status]));
  return {
    date, dateLabel: dayLabel(date), mode,
    draft: draft ? { id: draft.id, version: draft.version, source: draft.source, createdAt: draft.created_at } : null,
    published: published ? { id: published.id, version: published.version, publishedAt: published.published_at } : null,
    trips: trips.map(t => {
      const s = v.perTrip[`${t.vehicleId}-${t.trip}`] ?? scheduleTrip(net, t, orderMap);
      const veh = net.vehicles.get(t.vehicleId)!;
      return {
        ...t, status: statusById.get(`${t.vehicleId}-${t.trip}`) ?? 'planned',
        vehicle: { id: veh.id, type: veh.type, temp: veh.temp, depot: veh.depot, weightCap: veh.weightCap, volumeCap: veh.volumeCap, driverName: veh.driverName },
        brand: s.brand, district: s.district, kg: s.kg, m3: s.m3, tripMinutes: s.tripMinutes, km: s.km, returnAt: toHHMM(s.returnAt),
        stops: s.stops.map(st => ({ ...st, arrive: toHHMM(st.arrive), start: toHHMM(st.start), leave: toHHMM(st.leave) })),
      };
    }),
    usage: Object.fromEntries(Object.entries(v.perVehicle).map(([k, u]) => { const veh = net.vehicles.get(k)!; return [k, { ...u, freshBudget: net.rules.freshBudgetMin, styleTechBudget: net.rules.styleTechBudgetMin, fuelUsedL: veh.fuelUsedL, fuelQuotaL: veh.fuelQuotaL }]; })),
    issues: v.issues, errors: v.errors.length, warnings: v.issues.length - v.errors.length,
    unassigned: unassigned.map(o => ({ ...o, proposal: proposals.find(p => p.orderId === o.id) ?? null })),
    deferrals: deferredHere,
    orders: [...orderMap.values()],
    vehicles: [...net.vehicles.values()],
    rules: net.rules,
  };
}

async function ensureDraft(date: string, userId: number, db: Db): Promise<PlanRow> {
  const d = await latest(date, 'draft', db);
  if (d) return d;
  const pub = await latest(date, 'published', db);
  const ver = (await one<{ v: number }>(`SELECT coalesce(max(version),0) AS v FROM plans WHERE plan_date = $1`, [date], db))!.v + 1;
  const trips = pub ? (await liveTrips(date, db)).map(({ vehicleId, trip, depart, orderIds }) => ({ vehicleId, trip, depart, orderIds })) : [];
  return (await one<PlanRow>(`INSERT INTO plans (plan_date, version, status, source, trips, deferrals, created_by, created_at) VALUES ($1,$2,'draft',$3,$4,'[]',$5,$6) RETURNING ${PLAN_COLS}`,
    [date, ver, pub ? 'republish' : 'manual', JSON.stringify(trips), userId, nowSync()], db))!;
}

/** Run the planning engine and store the result as the draft. */
export async function runAutoPlan(date: string, userId: number) {
  return tx(async c => {
    const net = await loadNetwork(c);
    const orders = (await ordersForDate(date, c)).filter(o => o.status === 'confirmed' || o.status === 'planned' || o.status === 'deferred');
    // trips already on the road keep their orders; the engine plans around them
    const live = await liveTrips(date, c);
    const locked = live.filter(t => ['released', 'in_progress', 'completed'].includes(t.status));
    const lockedIds = new Set(locked.flatMap(t => t.orderIds));
    const lockedVeh = new Set(locked.map(t => t.vehicleId));
    const netFree: Network = { ...net, vehicles: new Map([...net.vehicles].filter(([id]) => !lockedVeh.has(id))) };
    const res = autoPlan(netFree, orders.filter(o => !lockedIds.has(o.id)));
    const trips = [...locked.map(({ vehicleId, trip, depart, orderIds }) => ({ vehicleId, trip, depart, orderIds })), ...res.trips];
    const d = await ensureDraft(date, userId, c);
    await c.query(`UPDATE plans SET trips = $2, deferrals = $3, source = 'auto' WHERE id = $1`, [d.id, JSON.stringify(trips), JSON.stringify(res.deferrals)]);
    await audit(c, userId, 'plan.auto', `plan:${date}`, res.stats);
    return res.stats;
  });
}

/** Manual edit on the draft: move one order (and its outlet's other orders if asked) to a trip, or unassign it. */
export async function moveInDraft(date: string, userId: number, orderId: string, target: { vehicleId: string; trip: number } | null, reason?: { reason: ReasonCode; why?: string }) {
  return tx(async c => {
    const net = await loadNetwork(c);
    const orders = new Map((await ordersForDate(date, c)).map(o => [o.id, o]));
    if (!orders.has(orderId)) throw notFound(`Order ${orderId} is not on ${date}.`);
    const d = await ensureDraft(date, userId, c);
    let trips: PlanTrip[] = d.trips.map(t => ({ ...t, orderIds: t.orderIds.filter(id => id !== orderId) }));
    let deferrals = d.deferrals.filter(x => x.orderId !== orderId);
    if (target) {
      if (!net.vehicles.has(target.vehicleId)) throw bad(`Unknown vehicle ${target.vehicleId}.`);
      let t = trips.find(x => x.vehicleId === target.vehicleId && x.trip === target.trip);
      if (!t) {
        const prev = trips.filter(x => x.vehicleId === target.vehicleId && x.orderIds.length);
        const outletId = orders.get(orderId)!.outletId;
        t = { vehicleId: target.vehicleId, trip: prev.length + 1, depart: toHHMM(departureFor(net, prev, [outletId], orders)), orderIds: [] };
        trips.push(t);
      }
      t.orderIds = sequenceOrders(net, [...t.orderIds, orderId], orders);
    } else {
      deferrals.push({ orderId, reason: reason?.reason ?? 'other', kind: 'chosen', why: reason?.why ?? 'Deferred by the dispatcher.' });
    }
    trips = trips.filter(t => t.orderIds.length).map(t => ({ ...t, orderIds: sequenceOrders(net, t.orderIds, orders) }));
    await c.query(`UPDATE plans SET trips = $2, deferrals = $3, source = CASE WHEN source = 'auto' THEN 'auto+manual' ELSE source END WHERE id = $1`, [d.id, JSON.stringify(trips), JSON.stringify(deferrals)]);
    await audit(c, userId, 'plan.move', `order:${orderId}`, { target });
  });
}

/** Every version of the day's plan, newest first, with who published it and what changed. */
export async function planVersions(date: string) {
  return q<any>(`SELECT p.id, p.version, p.status, p.source, p.created_at AS "createdAt", p.published_at AS "publishedAt", p.note, p.stats, p.changes,
      jsonb_array_length(p.trips) AS trips, jsonb_array_length(p.deferrals) AS "deferralProposals", c.name AS "createdBy", u.name AS "publishedBy"
    FROM plans p LEFT JOIN users c ON c.id = p.created_by LEFT JOIN users u ON u.id = p.published_by WHERE p.plan_date = $1 ORDER BY p.version DESC`, [date]);
}

export async function discardDraft(date: string, userId: number) {
  await q(`DELETE FROM plans WHERE plan_date = $1 AND status = 'draft'`, [date]);
  await audit(pool, userId, 'plan.discard', `plan:${date}`);
}

/** Publish the draft: apply it to the live trips, record deferrals, notify stores, loaders and drivers.
 *  Every step is a set-based statement, so the number of round trips stays fixed however many trips,
 *  orders and notices the plan has (one query per row took tens of seconds against a remote database). */
export async function publish(date: string, userId: number) {
  return tx(async c => {
    const d = await latest(date, 'draft', c);
    if (!d) throw bad('There is no draft to publish. Run Auto-plan or edit the plan first.');
    const net = await loadNetwork(c);
    const orderRows = await ordersForDate(date, c);
    const orders = new Map(orderRows.map(o => [o.id, o]));
    const v = validatePlan(net, d.trips, orders);
    if (v.errors.length) throw conflict(`The plan still breaks ${v.errors.length} rule${v.errors.length > 1 ? 's' : ''}. Fix them before publishing.`, v.errors);
    const at = nowSync();
    const nextRun = await nextOperatingDay(date, c);
    await c.query(`UPDATE plans SET status = 'superseded' WHERE plan_date = $1 AND status = 'published'`, [date]);
    await c.query(`UPDATE plans SET status = 'published', published_at = $2, published_by = $3 WHERE id = $1`, [d.id, at, userId]);

    // apply trips in place
    const live = await q<any>(`SELECT id, vehicle_id, trip_no, status FROM trips WHERE plan_date = $1`, [date], c);
    const liveIds = new Set<number>(live.map(r => r.id));
    const rowOf = new Map<string, any>(live.map(r => [`${r.vehicle_id}-${r.trip_no}`, r]));
    const fresh = d.trips.filter(t => !rowOf.has(`${t.vehicleId}-${t.trip}`));
    if (fresh.length) {
      const ins = await q<any>(`INSERT INTO trips (plan_date, version, vehicle_id, trip_no, depart)
        SELECT $1, $2, v, n, dep FROM unnest($3::text[], $4::int[], $5::text[]) AS x(v, n, dep) RETURNING id, vehicle_id, trip_no, status`,
        [date, d.version, fresh.map(t => t.vehicleId), fresh.map(t => t.trip), fresh.map(t => t.depart)], c);
      for (const r of ins) rowOf.set(`${r.vehicle_id}-${r.trip_no}`, r);
    }
    const current = await q<{ trip_id: number; order_id: string }>(`SELECT tor.trip_id, tor.order_id FROM trip_orders tor JOIN trips t ON t.id = tor.trip_id
      WHERE t.plan_date = $1 AND tor.moved_at IS NULL AND tor.load_status <> 'removed'`, [date], c);
    const curByTrip = new Map<number, string[]>();
    for (const r of current) { const a = curByTrip.get(r.trip_id); if (a) a.push(r.order_id); else curByTrip.set(r.trip_id, [r.order_id]); }

    const keep = new Set<number>();
    const changedTrips: { id: number; vehicleId: string; trip: number; added: string[]; removed: string[]; status: string }[] = [];
    const rm = { trip: [] as number[], order: [] as string[] };
    const up = { trip: [] as number[], order: [] as string[], seq: [] as number[] };
    const tu = { id: [] as number[], depart: [] as string[], reopened: [] as boolean[], changed: [] as boolean[], note: [] as string[] };
    for (const t of d.trips) {
      const row = rowOf.get(`${t.vehicleId}-${t.trip}`);
      keep.add(row.id);
      const cur = curByTrip.get(row.id) ?? [];
      const added = t.orderIds.filter(id => !cur.includes(id)), removed = cur.filter(id => !t.orderIds.includes(id));
      for (const id of removed) { rm.trip.push(row.id); rm.order.push(id); }
      const seen = new Set<string>();
      t.orderIds.forEach((id, i) => { if (seen.has(id)) return; seen.add(id); up.trip.push(row.id); up.order.push(id); up.seq.push(i + 1); });
      const changed = !!(added.length || removed.length) && liveIds.has(row.id);
      tu.id.push(row.id); tu.depart.push(t.depart); tu.reopened.push(!!(added.length || removed.length) && row.status === 'released');
      tu.changed.push(changed); tu.note.push(JSON.stringify({ added, removed }));
      if (changed) changedTrips.push({ id: row.id, vehicleId: t.vehicleId, trip: t.trip, added, removed, status: row.status });
    }
    if (rm.trip.length) await c.query(`UPDATE trip_orders tor SET load_status = 'removed' FROM unnest($1::int[], $2::text[]) AS x(trip_id, order_id) WHERE tor.trip_id = x.trip_id AND tor.order_id = x.order_id`, [rm.trip, rm.order]);
    if (up.trip.length) await c.query(`INSERT INTO trip_orders (trip_id, order_id, seq) SELECT * FROM unnest($1::int[], $2::text[], $3::int[])
        ON CONFLICT (trip_id, order_id) DO UPDATE SET seq = EXCLUDED.seq, load_status = CASE WHEN trip_orders.load_status = 'removed' THEN 'pending' ELSE trip_orders.load_status END, moved_at = NULL`, [up.trip, up.order, up.seq]);
    if (tu.id.length) await c.query(`UPDATE trips t SET depart = x.depart, version = $6, status = CASE WHEN t.status = 'cancelled' THEN 'planned' WHEN x.reopened THEN 'loading' ELSE t.status END,
        changed_at = CASE WHEN x.changed THEN $7::timestamptz ELSE t.changed_at END, change_note = CASE WHEN x.changed THEN x.note ELSE t.change_note END
      FROM unnest($1::int[], $2::text[], $3::boolean[], $4::boolean[], $5::text[]) AS x(id, depart, reopened, changed, note) WHERE t.id = x.id`,
      [tu.id, tu.depart, tu.reopened, tu.changed, tu.note, d.version, at]);
    const cancel = live.filter(r => !keep.has(r.id) && r.status !== 'cancelled');
    if (cancel.length) await c.query(`UPDATE trips SET status = 'cancelled', changed_at = $2 WHERE id = ANY($1::int[])`, [cancel.map(r => r.id), at]);
    for (const r of cancel) changedTrips.push({ id: r.id, vehicleId: r.vehicle_id, trip: r.trip_no, added: [], removed: ['(all)'], status: 'cancelled' });

    // order statuses
    const planned = new Set(d.trips.flatMap(t => t.orderIds));
    const toPlanned = orderRows.filter(o => planned.has(o.id) && ['confirmed', 'deferred'].includes(o.status)).map(o => o.id);
    if (toPlanned.length) await c.query(`UPDATE orders SET status = 'planned' WHERE id = ANY($1::text[])`, [toPlanned]);

    const notices: Notice[] = [];
    // deferrals: every unassigned order moves to the next run, with its reason
    const unassigned = orderRows.filter(o => !planned.has(o.id) && ['confirmed', 'planned', 'deferred'].includes(o.status));
    if (unassigned.length) {
      const decs = unassigned.map(o => d.deferrals.find(x => x.orderId === o.id) ?? { orderId: o.id, reason: 'other' as ReasonCode, kind: 'chosen' as const, why: 'Deferred by the dispatcher.' });
      await c.query(`INSERT INTO deferrals (order_id, from_date, to_date, reason, kind, why, plan_id, created_by, created_at, notified_at, escalated)
        SELECT oid, $1, $2, r, k, w, $3, $4, $5, $5, e FROM unnest($6::text[], $7::text[], $8::text[], $9::text[], $10::boolean[]) WITH ORDINALITY AS x(oid, r, k, w, e, n) ORDER BY n`,
        [date, nextRun, d.id, userId, at, unassigned.map(o => o.id), decs.map(x => x.reason), decs.map(x => x.kind), decs.map(x => x.why), unassigned.map(o => !!o.deferredYesterday)]);
      await c.query(`UPDATE orders SET status = 'deferred', delivery_date = $2, deferred_yesterday = true, days_since_served = days_since_served + 1 WHERE id = ANY($1::text[])`, [unassigned.map(o => o.id), nextRun]);
      unassigned.forEach((o, i) => {
        const dec = decs[i], escalated = !!o.deferredYesterday;
        notices.push({ audience: `outlet:${o.outletId}`, kind: 'deferral', title: `${o.temp === 'chilled' ? 'Chilled' : 'Ambient'} order ${o.id} moves to ${dayLabel(nextRun)}`,
          body: `${REASONS[dec.reason]?.store ?? dec.why}${escalated ? ' This is the second deferral in a row, so it goes first on the next run.' : ' It stays on order — no need to re-order.'}`, tone: 'amber', link: '/s/deferrals' });
      });
    }

    // notices
    const tripsByDepot = new Map<string, number>();
    for (const t of d.trips) { const dep = net.vehicles.get(t.vehicleId)!.depot; tripsByDepot.set(dep, (tripsByDepot.get(dep) ?? 0) + 1); }
    for (const [dep, n] of tripsByDepot) notices.push({ audience: `depot:${dep}`, kind: 'plan_published', title: `Plan v${d.version} published for ${dayLabel(date)}`, body: `${n} trips from ${dep} DC. Load lists are ready in stop order.`, tone: 'violet', link: '/l' });
    for (const t of d.trips) {
      const s = scheduleTrip(net, t, orders);
      notices.push({ audience: `vehicle:${t.vehicleId}`, kind: 'run_ready', title: `Trip ${t.trip} for ${dayLabel(date)}: ${s.stops.length} stops in ${s.district}`, body: `Departs ${t.depart}. Saved to your phone for offline use.`, tone: 'blue', link: '/r' });
      for (const st of s.stops) notices.push({ audience: `outlet:${st.outletId}`, kind: 'planned', title: `Planned on ${t.vehicleId} Trip ${t.trip}`, body: `${dayLabel(date)} · estimated arrival ${toHHMM(st.arrive)} · stop ${st.seq} of ${s.stops.length}.`, tone: 'blue', link: '/s/track' });
    }
    for (const ch of changedTrips) {
      const dep = net.vehicles.get(ch.vehicleId)!.depot;
      notices.push({ audience: `depot:${dep}`, kind: 'plan_changed', title: `${ch.vehicleId} Trip ${ch.trip} changed in plan v${d.version}`, body: [ch.added.length ? `Added ${ch.added.join(', ')}` : '', ch.removed.length ? `Removed ${ch.removed.join(', ')}` : ''].filter(Boolean).join(' · '), tone: 'amber', link: `/l/trip/${ch.id}` });
      notices.push({ audience: `vehicle:${ch.vehicleId}`, kind: 'plan_changed', title: `Your Trip ${ch.trip} changed`, body: 'Open your run to see the new stops.', tone: 'amber', link: '/r' });
    }
    await notifyMany(c, notices);
    const plannedOrders = orderRows.filter(o => planned.has(o.id));
    const stats = {
      trips: d.trips.length, vehicles: new Set(d.trips.map(t => t.vehicleId)).size, orders: plannedOrders.length, deferred: unassigned.length,
      units: plannedOrders.reduce((a, o) => a + o.units, 0), kg: Math.round(plannedOrders.reduce((a, o) => a + Number(o.kg), 0)),
      warnings: v.issues.length - v.errors.length,
    };
    const changes = changedTrips.map(ch => ({ vehicleId: ch.vehicleId, trip: ch.trip, added: ch.added, removed: ch.removed, cancelled: ch.status === 'cancelled' }));
    await c.query(`UPDATE plans SET stats = $2, changes = $3 WHERE id = $1`, [d.id, JSON.stringify(stats), JSON.stringify(changes)]);
    await audit(c, userId, 'plan.publish', `plan:${date}`, { version: d.version, trips: d.trips.length, deferred: unassigned.length });
    return { version: d.version, trips: d.trips.length, deferred: unassigned.length, nextRun };
  });
}

/* Plan a live move without committing: which trip of the target vehicle takes the stop, and is it valid? */
type MoveContext = { orders: Map<string, Order>; ids: string[]; live: Awaited<ReturnType<typeof liveTrips>> };
async function moveContext(c: Db, date: string, fromTripId: number, outletId: string): Promise<MoveContext> {
  const orders = new Map<string, Order>((await ordersForDate(date, c)).map(o => [o.id, o]));
  const ids = (await q<any>(`SELECT tor.order_id FROM trip_orders tor JOIN orders o ON o.id = tor.order_id WHERE tor.trip_id = $1 AND o.outlet_id = $2 AND tor.moved_at IS NULL AND tor.load_status <> 'removed'`, [fromTripId, outletId], c)).map(r => r.order_id);
  const live = await liveTrips(date, c);
  return { orders, ids, live };
}
async function simulateMove(c: Db, net: Network, date: string, fromTripId: number, outletId: string, to: { vehicleId: string; trip?: number }, at: Date, ctx?: MoveContext) {
  const { orders, ids, live } = ctx ?? await moveContext(c, date, fromTripId, outletId);
  if (!ids.length) throw bad(`${outletId} is not on this trip.`);
  const ot = net.outlets.get(outletId)!;
  const groupOf = (t: PlanTrip) => { const o = orders.get(t.orderIds[0]); const x = o && net.outlets.get(o.outletId); return x ? `${x.brand}|${x.district}` : ''; };
  const mine = live.filter(t => t.vehicleId === to.vehicleId && t.id !== fromTripId);
  const target = to.trip ? mine.find(t => t.trip === to.trip) : mine.find(t => !['completed', 'cancelled', 'in_progress'].includes(t.status) && groupOf(t) === `${ot.brand}|${ot.district}`);
  const plan: PlanTrip[] = live.filter(t => t.vehicleId === to.vehicleId).map(t => ({ vehicleId: t.vehicleId, trip: t.trip, depart: t.depart, orderIds: [...t.orderIds] }));
  let newTrip: PlanTrip | null = null;
  if (target) {
    const pt = plan.find(p => p.trip === target.trip)!;
    pt.orderIds = sequenceOrders(net, [...pt.orderIds, ...ids], orders);
  } else {
    const nowMin = Math.round((at.getTime() - new Date(date + 'T00:00:00+05:30').getTime()) / MS_PER_MINUTE);
    const dep = Math.max(departureFor(net, plan, [outletId], orders), Math.ceil((nowMin + 10) / 5) * 5);
    newTrip = { vehicleId: to.vehicleId, trip: (plan.reduce((m, p) => Math.max(m, p.trip), 0)) + 1, depart: toHHMM(dep), orderIds: sequenceOrders(net, ids, orders) };
    plan.push(newTrip);
  }
  const check = validatePlan(net, plan, orders);
  const tp = target ? plan.find(p => p.trip === target.trip)! : newTrip!;
  const s = scheduleTrip(net, tp, orders);
  const stop = s.stops.find(x => x.outletId === outletId);
  return { ids, target, newTrip, tp, errors: check.errors, eta: stop ? toHHMM(stop.arrive) : null };
}

/** Which vehicles could take this stop right now (for the dispatcher's move dialog). The first row is always
 *  "keep it where it is", with the expected arrival that includes traffic and any delay the driver reported,
 *  so a move is only suggested when it actually helps the store. */
export async function moveOptions(date: string, fromTripId: number, outletId: string) {
  const [net, from, orders, ctx] = await Promise.all([
    loadNetwork(),
    one<any>(`SELECT id, vehicle_id, trip_no, depart, status, to_char(plan_date,'YYYY-MM-DD') AS plan_date FROM trips WHERE id = $1`, [fromTripId]),
    q<any>(`SELECT o.temp FROM trip_orders tor JOIN orders o ON o.id = tor.order_id WHERE tor.trip_id = $1 AND o.outlet_id = $2 AND tor.moved_at IS NULL AND tor.load_status <> 'removed'`, [fromTripId, outletId]),
    // the same orders and trips for every candidate below: read them once, not once per vehicle
    moveContext(pool, date, fromTripId, outletId),
  ]);
  const ot = net.outlets.get(outletId);
  if (!from || !ot) throw notFound('Trip or outlet not found.');
  if (!orders.length) throw bad(`${outletId} is not on this trip any more.`);
  const needReefer = orders.some(o => o.temp === 'chilled');
  const at = nowSync();
  const [eta, presence] = await Promise.all([
    liveEta(net, from, at),
    one<any>(`SELECT last_seen FROM vehicle_presence WHERE vehicle_id = $1`, [from.vehicle_id]),
  ]);
  const cur = eta.stops.find(x => x.outletId === outletId);
  const quietMin = presence ? Math.round((at.getTime() - new Date(presence.last_seen).getTime()) / MS_PER_MINUTE) : null;
  const keep = {
    vehicleId: from.vehicle_id, trip: from.trip_no, keep: true, eta: cur?.expectedArriveHHMM ?? null, planned: cur?.plannedHHMM ?? null, closeAt: cur?.closeHHMM ?? ot.close,
    delivered: !!cur?.done, late: !!cur?.late, lateRisk: !!cur?.lateRisk, hold: eta.hold, lastSeenMinAgo: quietMin,
  };
  // why a move might be needed — never "no signal" alone: a phone out of coverage still delivers
  const why = cur?.done ? 'Already delivered — nothing to move.'
    : eta.hold ? `${from.vehicle_id} reported "${eta.hold.label}" at ${eta.hold.at} (${eta.hold.minutes} min). Expected ${keep.eta} vs close ${keep.closeAt}.`
    : cur?.late ? `Expected ${keep.eta}, after the store closes at ${keep.closeAt}.`
    : cur?.lateRisk ? `Expected ${keep.eta}, close to the ${keep.closeAt} close.`
    : null;
  const out = [];
  for (const v of net.vehicles.values()) {
    if (v.id === from.vehicle_id || v.depot !== ot.depot || v.status !== 'available' || (needReefer && v.temp !== 'reefer') || (ot.vanOnly && v.type !== 'van')) continue;
    try {
      const r = await simulateMove(pool, net, date, fromTripId, outletId, { vehicleId: v.id }, at, ctx);
      out.push({ vehicleId: v.id, type: v.type, temp: v.temp, driverName: v.driverName, trip: r.tp.trip, newTrip: !!r.newTrip, depart: r.tp.depart, eta: r.eta, ok: r.errors.length === 0 && (!r.target || !['in_progress', 'completed'].includes(r.target.status)), problem: r.errors[0]?.title ?? (r.target && ['in_progress', 'completed'].includes(r.target.status) ? 'Already on the road' : null) });
    } catch { /* vehicle cannot be simulated (no free trip) */ }
  }
  out.sort((a, b) => Number(b.ok) - Number(a.ok) || (a.eta ?? '99').localeCompare(b.eta ?? '99'));
  return { keep, why, recommendMove: !!why && !cur?.done && (keep.late || keep.lateRisk) && out.some(o => o.ok && (o.eta ?? '99') < (keep.eta ?? '99')), options: out };
}

/** During the day: move a stop to another vehicle without re-planning (e.g. a driver is out of signal). */
export async function moveStopLive(date: string, userId: number, fromTripId: number, outletId: string, to: { vehicleId: string; trip?: number }, reason: string) {
  return tx(async c => {
    const net = await loadNetwork(c);
    const from = await one<any>(`SELECT * FROM trips WHERE id = $1`, [fromTripId], c);
    if (!from) throw notFound('Trip not found.');
    if (['completed', 'cancelled'].includes(from.status)) throw conflict(`This trip is ${from.status}.`);
    if (to.vehicleId === from.vehicle_id) throw bad('Pick a different vehicle.');
    const done = await one(`SELECT 1 FROM stop_events WHERE trip_id = $1 AND outlet_id = $2 AND type = 'delivered'`, [fromTripId, outletId], c);
    if (done) throw conflict(`${from.vehicle_id} already recorded ${outletId} as delivered.`);
    const at = nowSync();
    const sim = await simulateMove(c, net, date, fromTripId, outletId, to, at);
    if (sim.errors.length) throw conflict(`${to.vehicleId} cannot take ${outletId}: ${sim.errors[0].title}.`, sim.errors);
    if (sim.target && ['in_progress', 'completed'].includes(sim.target.status)) throw conflict(`${to.vehicleId} Trip ${sim.target.trip} is already on the road — its goods cannot be added.`);
    let targetId: number;
    if (sim.target) targetId = sim.target.id;
    else {
      const r = await one<any>(`INSERT INTO trips (plan_date, version, vehicle_id, trip_no, depart, status) VALUES ($1, (SELECT coalesce(max(version),1) FROM plans WHERE plan_date = $1), $2, $3, $4, 'planned') RETURNING id`, [date, sim.tp.vehicleId, sim.tp.trip, sim.tp.depart], c);
      targetId = r.id;
    }
    const ids = sim.ids;
    await c.query(`UPDATE trip_orders SET moved_at = $3 WHERE trip_id = $1 AND order_id = ANY($2)`, [fromTripId, ids, at]);
    await c.query(`INSERT INTO trip_orders (trip_id, order_id, seq) SELECT $1, oid, n FROM unnest($2::text[]) WITH ORDINALITY AS x(oid, n)
      ON CONFLICT (trip_id, order_id) DO UPDATE SET seq = EXCLUDED.seq, moved_at = NULL, load_status = CASE WHEN trip_orders.load_status = 'removed' THEN 'pending' ELSE trip_orders.load_status END`, [targetId, [...new Set(sim.tp.orderIds)]]);
    await c.query(`INSERT INTO stop_moves (order_id, outlet_id, from_trip_id, to_trip_id, moved_at, moved_by, reason) SELECT oid, $2, $3, $4, $5, $6, $7 FROM unnest($1::text[]) WITH ORDINALITY AS x(oid, n) ORDER BY n`, [ids, outletId, fromTripId, targetId, at, userId, reason]);
    await c.query(`UPDATE trips SET changed_at = $2, change_note = $3 WHERE id = ANY($1)`, [[fromTripId, targetId], at, JSON.stringify({ moved: outletId, from: from.vehicle_id, to: to.vehicleId })]);
    const hhmm = toHHMM((at.getTime() - new Date(date + 'T00:00:00+05:30').getTime()) / MS_PER_MINUTE);
    // the goods for the moved stop leave from the depot on the new vehicle: tell the loaders
    if (sim.target && sim.target.status === 'released') await c.query(`UPDATE trips SET status = 'loading' WHERE id = $1`, [targetId]);
    const depot = net.vehicles.get(to.vehicleId)!.depot;
    await notifyMany(c, [
      { audience: `vehicle:${from.vehicle_id}`, kind: 'stop_moved', title: `${outletId} moved to ${to.vehicleId}`, body: `The dispatcher moved this stop at ${hhmm}. ${reason}`, tone: 'amber', link: '/r' },
      { audience: `vehicle:${to.vehicleId}`, kind: 'stop_added', title: `${outletId} added to your Trip ${sim.tp.trip}`, body: `${reason} Estimated arrival ${sim.eta}.`, tone: 'amber', link: '/r' },
      { audience: `outlet:${outletId}`, kind: 'eta', title: `Your delivery now comes on ${to.vehicleId}`, body: `Estimated arrival ${sim.eta}, inside your window.`, tone: 'blue', link: '/s/track' },
      { audience: `depot:${depot}`, kind: 'plan_changed', title: `Load ${outletId} on ${to.vehicleId} Trip ${sim.tp.trip}`, body: `Moved from ${from.vehicle_id}: ${reason} Pick ${ids.join(', ')} from depot stock. Departs ${sim.tp.depart}.`, tone: 'amber', link: `/l/trip/${targetId}` },
    ]);
    await audit(c, userId, 'trip.move_stop', `trip:${fromTripId}`, { outletId, to: targetId, reason });
    return { toTripId: targetId, eta: sim.eta };
  });
}
