import { REASONS, toHHMM } from '@pathwise/core';
import { audit, notify } from '../audit.js';
import { dayLabel, minutesOfDay, nowSync } from '../clock.js';
import { one, q, tx, type Db } from '../db.js';
import { bad, conflict, notFound } from '../errors.js';
import { nextOperatingDay } from './network.js';

export async function listExceptions(date: string) {
  return q<any>(`SELECT e.id, e.type, e.status, e.severity, e.trip_id AS "tripId", e.order_id AS "orderId", e.outlet_id AS "outletId", e.title, e.detail,
      e.raised_at AS "raisedAt", e.decision, e.decision_note AS "decisionNote", e.resolved_at AS "resolvedAt",
      u.name AS "raisedBy", u.role AS "raisedByRole", r.name AS "resolvedBy", t.vehicle_id AS "vehicleId", t.trip_no AS "tripNo", t.depart
    FROM exceptions e LEFT JOIN users u ON u.id = e.raised_by LEFT JOIN users r ON r.id = e.resolved_by LEFT JOIN trips t ON t.id = e.trip_id
    WHERE e.plan_date = $1 OR e.status = 'open' ORDER BY (e.status = 'open') DESC, e.raised_at DESC`, [date]);
}

/** Split an order: the part that did not travel becomes a new order on the next run, with a deferral. */
async function deferRemainder(c: Db, orderId: string, units: number, reason: keyof typeof REASONS, why: string, userId: number) {
  const o = await one<any>(`SELECT *, to_char(delivery_date,'YYYY-MM-DD') AS d FROM orders WHERE id = $1`, [orderId], c);
  const next = await nextOperatingDay(o.d, c);
  const share = units / o.units;
  const id = `${o.id}-R${(await one<{ n: number }>(`SELECT count(*)::int AS n FROM orders WHERE parent_order_id = $1`, [o.id], c))!.n + 1}`;
  await c.query(`INSERT INTO orders (id, outlet_id, delivery_date, temp, units, kg, m3, description, source, status, submitted_at, deferred_yesterday, days_since_served, parent_order_id)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'app','deferred',$9,true,$10,$11)`, [id, o.outlet_id, next, o.temp, units, Math.max(1, Math.round(o.kg * share)), Math.max(0.1, Math.round(o.m3 * share * 10) / 10), `${o.description ?? 'Items'} — remainder`, nowSync(), o.days_since_served + 1, o.id]);
  const escalated = !!o.deferred_yesterday;
  await c.query(`INSERT INTO deferrals (order_id, from_date, to_date, reason, kind, why, units, created_by, created_at, notified_at, escalated) VALUES ($1,$2,$3,$4,'forced',$5,$6,$7,$8,$8,$9)`, [id, o.d, next, reason, why, units, userId, nowSync(), escalated]);
  return { id, next, escalated, outletId: o.outlet_id };
}

export async function resolve(id: number, userId: number, body: { decision: string; note?: string; vehicleId?: string }) {
  return tx(async c => {
    const e = await one<any>(`SELECT e.*, to_char(e.plan_date,'YYYY-MM-DD') AS d, t.vehicle_id, t.trip_no, t.depart FROM exceptions e LEFT JOIN trips t ON t.id = e.trip_id WHERE e.id = $1 FOR UPDATE OF e`, [id], c);
    if (!e) throw notFound('Exception not found.');
    if (e.status === 'resolved') throw conflict('Already decided.');
    const d = e.detail ?? {};
    const at = nowSync();
    let summary = body.decision;
    switch (e.type) {
      case 'dock_shortfall': {
        if (body.decision === 'send_partial') {
          const r = await deferRemainder(c, e.order_id, d.missing, 'dock_shortfall', `${d.missing} of ${d.planned} ${d.item} were short at the depot at ${toHHMM(minutesOfDay(new Date(e.raised_at)))}; the rest travels today.`, userId);
          await c.query(`UPDATE orders SET units = units - $2, kg = greatest(1, round(kg * (units - $2)::numeric / units)), m3 = greatest(0.1, round(m3 * (units - $2)::numeric / units, 1)) WHERE id = $1`, [e.order_id, d.missing]);
          await c.query(`UPDATE trip_orders SET load_status = 'loaded' WHERE trip_id = $1 AND order_id = $2`, [e.trip_id, e.order_id]);
          summary = `Send partial · ${d.missing} to ${dayLabel(r.next)}`;
          await notify(c, `outlet:${e.outlet_id}`, 'deferral', `${d.missing} ${d.item} move to ${dayLabel(r.next)}`, `${REASONS.dock_shortfall.store} Found by the loader before the truck left. The rest of your order comes today.${r.escalated ? ' This order was deferred before, so it goes first on the next run.' : ''}`, { tone: 'amber', link: '/s/deferrals' });
          await notify(c, `vehicle:${e.vehicle_id}`, 'partial_by_plan', `${e.outlet_id}: partial by plan`, `${d.missing} ${d.item} stay at the depot. The store already knows.`, { tone: 'amber', link: '/r' });
        } else if (body.decision === 'substitute') {
          await c.query(`UPDATE trip_orders SET load_status = 'pending', flag_note = 'Substitute from depot stock' WHERE trip_id = $1 AND order_id = $2`, [e.trip_id, e.order_id]);
          summary = 'Substitute from depot stock';
        } else if (body.decision === 'hold') {
          await c.query(`UPDATE trip_orders SET load_status = 'pending' WHERE trip_id = $1 AND order_id = $2`, [e.trip_id, e.order_id]);
          summary = 'Hold the vehicle up to 15 min';
        } else throw bad('Unknown decision.');
        const depot = (await one<any>(`SELECT depot FROM vehicles WHERE id = $1`, [e.vehicle_id], c)).depot;
        await notify(c, `depot:${depot}`, 'decision', `Decision for ${e.vehicle_id} Trip ${e.trip_no}: ${summary}`, body.decision === 'send_partial' ? 'The line is marked loaded with what is on board. You can release when the rest is loaded.' : body.decision === 'hold' ? 'Find the stock and load it; the truck may leave up to 15 min late.' : 'Load the nearest equivalent item and mark the line loaded.', { tone: 'violet', link: `/l/trip/${e.trip_id}` });
        break;
      }
      case 'vehicle_fault': {
        if (body.decision === 'swap') {
          if (!body.vehicleId) throw bad('Pick the replacement vehicle.');
          const nv = await one<any>(`SELECT * FROM vehicles WHERE id = $1`, [body.vehicleId], c);
          const busy = await one<any>(`SELECT 1 FROM trips WHERE plan_date = $1 AND vehicle_id = $2 AND trip_no = $3 AND status <> 'cancelled'`, [e.d, body.vehicleId, e.trip_no], c);
          if (!nv || nv.status !== 'available' || busy) throw conflict(`${body.vehicleId} is not free for this trip.`);
          await c.query(`UPDATE vehicles SET status = 'in_workshop', status_note = $2 WHERE id = $1`, [e.vehicle_id, d.type ?? 'Fault reported at the dock']);
          await c.query(`UPDATE trips SET vehicle_id = $2, swapped_from = $3, status = 'loading' WHERE id = $1`, [e.trip_id, body.vehicleId, e.vehicle_id]);
          await c.query(`UPDATE trip_orders SET load_status = 'pending' WHERE trip_id = $1 AND moved_at IS NULL AND load_status = 'loaded'`, [e.trip_id]);
          summary = `Swap to ${body.vehicleId}`;
          await notify(c, `depot:${nv.depot}`, 'swap', `Vehicle swap: ${e.vehicle_id} → ${body.vehicleId}`, 'Move every loaded line to the new vehicle in stop order, ticking each one off.', { tone: 'violet', link: `/l/trip/${e.trip_id}` });
          await notify(c, `vehicle:${body.vehicleId}`, 'run_ready', `You now run ${e.vehicle_id}'s Trip ${e.trip_no}`, 'Open your run for the stops.', { tone: 'blue', link: '/r' });
          await notify(c, `vehicle:${e.vehicle_id}`, 'swap', `${e.vehicle_id} is off the road`, `Your trip moved to ${body.vehicleId}.`, { tone: 'amber' });
        } else if (body.decision === 'continue') {
          await c.query(`UPDATE trips SET status = CASE WHEN status = 'blocked' THEN 'loading' ELSE status END WHERE id = $1`, [e.trip_id]);
          summary = 'Continue — advisory only';
        } else throw bad('Unknown decision.');
        break;
      }
      case 'non_delivery': {
        if (body.decision === 'return_to_depot') {
          for (const oid of d.orderIds ?? [e.order_id]) {
            const o = await one<any>(`SELECT units FROM orders WHERE id = $1`, [oid], c);
            const r = await deferRemainder(c, oid, o.units, 'other', `Not delivered: ${d.reasonLabel ?? d.outcome}. The driver brought it back to the depot.`, userId);
            await notify(c, `outlet:${e.outlet_id}`, 'deferral', `Your delivery moves to ${dayLabel(r.next)}`, `The driver could not deliver today (${(d.reasonLabel ?? d.outcome ?? '').toLowerCase()}).`, { tone: 'amber', link: '/s/deferrals' });
          }
          summary = 'Return to depot · deliver next run';
        } else if (body.decision === 'retry_today') {
          summary = 'Retry later today';
          await notify(c, `vehicle:${e.vehicle_id}`, 'retry', `Retry ${e.outlet_id} after your last stop`, body.note ?? '', { tone: 'blue', link: '/r' });
        } else throw bad('Unknown decision.');
        break;
      }
      case 'sync_conflict': {
        if (body.decision === 'keep_driver') {
          // the proven delivery stands: take the stop off the other trip and tell its driver
          for (const m of d.moves ?? []) {
            await c.query(`UPDATE trip_orders SET load_status = 'removed', moved_at = $3 WHERE trip_id = $1 AND order_id = $2`, [m.toTripId, m.orderId, at]);
            await c.query(`UPDATE trip_orders SET moved_at = NULL WHERE trip_id = $1 AND order_id = $2`, [e.trip_id, m.orderId]);
          }
          const other = d.moves?.[0];
          if (other) await notify(c, `vehicle:${other.toVehicle}`, 'stop_cancelled', `${e.outlet_id} is already delivered — skip it`, `${e.vehicle_id} delivered it at ${d.deliveredAt}. Turn back if you are on the way.`, { tone: 'amber', link: '/r' });
          summary = 'Keep the driver’s delivery · recall the other vehicle';
        } else if (body.decision === 'keep_reassignment') {
          for (const oid of d.orderIds ?? []) await c.query(`UPDATE orders SET status = 'loaded' WHERE id = $1`, [oid]);
          summary = 'Let the other vehicle deliver · return goods';
        } else throw bad('Unknown decision.');
        break;
      }
      case 'receipt_issue': {
        if (body.decision === 'redeliver') {
          for (const l of (d.lines ?? []).filter((x: any) => x.status !== 'ok')) {
            const r = await deferRemainder(c, l.orderId, Math.max(1, l.expected - (l.received ?? 0)), 'other', `Store reported ${l.status} on receipt; replacement on the next run.`, userId);
            await notify(c, `outlet:${e.outlet_id}`, 'deferral', `Replacement for ${l.orderId} on ${dayLabel(r.next)}`, 'We will send what was short or damaged on the next run.', { tone: 'blue', link: '/s/deferrals' });
          }
          summary = 'Replace on the next run';
        } else if (body.decision === 'credit') {
          summary = 'Credit the store';
          await notify(c, `outlet:${e.outlet_id}`, 'credit', 'Credit approved', 'The missing or damaged items are credited to your account.', { tone: 'green', link: '/s/history' });
        } else throw bad('Unknown decision.');
        break;
      }
      case 'road_problem': summary = body.decision === 'acknowledge' ? 'Acknowledged' : body.decision; break;
    }
    await c.query(`UPDATE exceptions SET status = 'resolved', decision = $2, decision_note = $3, resolved_by = $4, resolved_at = $5 WHERE id = $1`, [id, summary, body.note ?? null, userId, at]);
    await audit(c, userId, 'exception.resolve', `exception:${id}`, body);
    return { id, decision: summary };
  });
}
