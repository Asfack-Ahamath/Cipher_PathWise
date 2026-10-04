import { toHHMM } from '@pathwise/core';
import { z } from 'zod';
import { audit, notify } from '../audit.js';
import { minutesOfDay, nowSync } from '../clock.js';
import { one, q, tx } from '../db.js';
import { bad } from '../errors.js';
import { MS_PER_MINUTE } from '../lib/constants.js';
import { saveAttachment } from '../lib/storage.js';
import type { AuthUser } from '../auth.js';
import { activePlanDate, loadNetwork } from './network.js';
import { tripDetail } from './trips.js';
import { liveEta } from './live.js';

export const OUTCOME_LABEL: Record<string, string> = { full: 'Delivered in full', partial: 'Partial delivery', refused: 'Store refused goods', no_access: 'Could not access', closed: 'Outlet closed' };

export async function touchPresence(vehicleId: string | null) {
  if (!vehicleId) return;
  await q(`INSERT INTO vehicle_presence (vehicle_id, last_seen) VALUES ($1,$2) ON CONFLICT (vehicle_id) DO UPDATE SET last_seen = EXCLUDED.last_seen`, [vehicleId, nowSync()]);
}

/** The driver's run for the day, with expected arrival times. The phone caches this for offline use. */
export async function myRun(user: AuthUser) {
  if (!user.vehicleId) throw bad('No vehicle is assigned to your account. Ask the dispatcher.');
  const [, date, net, v] = await Promise.all([
    touchPresence(user.vehicleId), activePlanDate(), loadNetwork(),
    one<any>(`SELECT id, type, temp, depot, driver_name AS "driverName", weight_cap AS "weightCap", volume_cap AS "volumeCap" FROM vehicles WHERE id = $1`, [user.vehicleId]),
  ]);
  const now = nowSync();
  // trips of this vehicle, plus trips it took over from a faulty vehicle
  const rows = await q<any>(`SELECT id, vehicle_id, trip_no, depart, status, to_char(plan_date,'YYYY-MM-DD') AS plan_date FROM trips WHERE plan_date = $1 AND vehicle_id = $2 AND status <> 'cancelled' ORDER BY trip_no`, [date, user.vehicleId]);
  const trips = await Promise.all(rows.map(async r => {
    const [eta, d] = await Promise.all([liveEta(net, r, now), tripDetail(r.id)]);
    // a stop was moved on or off this trip since the driver last acknowledged: show a banner until they tap "Got it"
    const change = await one<any>(`SELECT max(m.moved_at) AS at,
        json_agg(json_build_object('outletId', m.outlet_id, 'direction', CASE WHEN m.from_trip_id = $1 THEN 'off' ELSE 'on' END, 'reason', m.reason) ORDER BY m.id) AS moves
      FROM stop_moves m WHERE (m.from_trip_id = $1 OR m.to_trip_id = $1)
        AND m.moved_at > coalesce((SELECT max(e.device_time) FROM stop_events e WHERE e.trip_id = $1 AND e.type = 'route_ack'), '-infinity')`, [r.id]);
    const moves = change?.moves ? change.moves.filter((m: any, i: number, a: any[]) => a.findIndex(x => x.outletId === m.outletId && x.direction === m.direction) === i) : [];
    return { ...d, routeChange: change?.at ? { at: change.at, moves } : null, stops: d.stops.map((s: any) => { const e = eta.stops.find(x => x.outletId === s.outletId); return { ...s, expected: e?.expectedArriveHHMM ?? s.arrive, late: e?.late ?? s.late, lateRisk: e?.lateRisk ?? s.lateRisk, openAt: e ? toHHMM(e.openAt) : s.outlet.open, closeAt: e?.closeHHMM ?? s.outlet.close }; }), hold: eta.hold };
  }));
  return { date, vehicle: v, trips, fetchedAt: now.toISOString() };
}

const img = z.string().max(7_500_000);
const Payloads = {
  trip_started: z.object({}).passthrough(),
  arrived: z.object({}).passthrough(),
  delivered: z.object({
    outcome: z.enum(['full', 'partial', 'refused', 'no_access', 'closed']),
    receiver: z.string().trim().max(80).optional().nullable(),
    photo: img.optional().nullable(), signature: img.optional().nullable(),
    recommendation: z.enum(['return_to_depot', 'retry_today']).optional().nullable(),
    note: z.string().trim().max(500).optional().nullable(),
    deliveredUnits: z.record(z.string(), z.number().int().min(0).max(100000)).optional(),
    waitMin: z.number().int().min(0).max(600).optional(),
  }),
  problem: z.object({ kind: z.string().max(40), label: z.string().max(80).optional(), note: z.string().trim().max(500).optional().nullable(), delayMin: z.number().int().min(0).max(600).optional(), photo: img.optional().nullable() }),
  trip_closed: z.object({ unrecorded: z.array(z.object({ outletId: z.string(), reason: z.string().max(200) })).optional(), note: z.string().max(500).optional() }).passthrough(),
  conflict_answer: z.object({ answer: z.string().min(2).max(200) }),
  route_ack: z.object({ changedAt: z.string().optional() }).passthrough(),
};
const Event = z.object({
  clientEventId: z.string().uuid(),
  type: z.enum(['trip_started', 'arrived', 'delivered', 'problem', 'trip_closed', 'conflict_answer', 'route_ack']),
  tripId: z.number().int().positive(),
  outletId: z.string().max(10).optional().nullable(),
  deviceTime: z.string().datetime({ offset: true }),
  payload: z.record(z.any()).default({}),
});
export const SyncBody = z.object({ events: z.array(Event).max(200) });
type Ev = z.infer<typeof Event>;

/** Apply records written on the phone, possibly long after they happened. Idempotent per clientEventId. */
export async function sync(user: AuthUser, events: Ev[]) {
  const results: { clientEventId: string; status: 'applied' | 'duplicate' | 'conflict' | 'rejected'; message?: string }[] = [];
  for (const ev of [...events].sort((a, b) => a.deviceTime.localeCompare(b.deviceTime))) {
    try { results.push(await applyEvent(user, ev)); }
    catch (e: any) { results.push({ clientEventId: ev.clientEventId, status: 'rejected', message: e.message }); }
  }
  await touchPresence(user.vehicleId);
  return { results, syncedAt: nowSync().toISOString() };
}

async function applyEvent(user: AuthUser, ev: Ev) {
  const parsed = Payloads[ev.type].safeParse(ev.payload);
  if (!parsed.success) throw bad(`Invalid ${ev.type} record: ${parsed.error.issues[0].message}`);
  const payloadIn = parsed.data as any;
  // a phone clock far in the future is a bug or tampering; keep the record but use the server time
  const serverNow = nowSync();
  const at0 = new Date(ev.deviceTime);
  const at = at0.getTime() > serverNow.getTime() + 10 * MS_PER_MINUTE ? serverNow : at0;
  return tx(async c => {
    const t = await one<any>(`SELECT t.*, to_char(t.plan_date,'YYYY-MM-DD') AS d FROM trips t WHERE t.id = $1`, [ev.tripId], c);
    if (!t) throw bad('Trip not found.');
    if (t.vehicle_id !== user.vehicleId && t.swapped_from !== user.vehicleId) throw bad('This trip is not on your vehicle.');
    const dup = await one(`SELECT 1 FROM stop_events WHERE client_event_id = $1`, [ev.clientEventId], c);
    if (dup) return { clientEventId: ev.clientEventId, status: 'duplicate' as const };
    if (ev.type === 'trip_started' && !['released', 'in_progress', 'loading', 'completed'].includes(t.status)) throw bad('The loader has not released this vehicle yet.');
    if (['arrived', 'delivered'].includes(ev.type)) {
      if (!ev.outletId) throw bad('outletId is required.');
      const onTrip = await one(`SELECT 1 FROM trip_orders tor JOIN orders o ON o.id = tor.order_id WHERE tor.trip_id = $1 AND o.outlet_id = $2`, [t.id, ev.outletId], c);
      if (!onTrip) throw bad(`${ev.outletId} is not a stop on this trip.`);
    }
    if (ev.type === 'trip_closed') {
      const missing = await q<any>(`SELECT DISTINCT o.outlet_id FROM trip_orders tor JOIN orders o ON o.id = tor.order_id WHERE tor.trip_id = $1 AND tor.moved_at IS NULL AND tor.load_status <> 'removed'
          AND NOT EXISTS (SELECT 1 FROM stop_events e WHERE e.trip_id = $1 AND e.outlet_id = o.outlet_id AND e.type = 'delivered')`, [t.id], c);
      const explained = new Set((payloadIn.unrecorded ?? []).map((u: any) => u.outletId));
      const unexplained = missing.filter(m => !explained.has(m.outlet_id));
      if (unexplained.length) throw bad(`Record an outcome (or a reason) for ${unexplained.map(m => m.outlet_id).join(', ')} before closing the trip.`);
    }

    const { photo, signature, ...rest } = payloadIn;
    const ins = await one<{ id: number }>(`INSERT INTO stop_events (client_event_id, trip_id, outlet_id, type, payload, device_time, received_at, user_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [ev.clientEventId, ev.tripId, ev.outletId ?? null, ev.type, JSON.stringify(rest), at, serverNow, user.id], c);
    const hhmm = toHHMM(minutesOfDay(at));
    let status: 'applied' | 'conflict' = 'applied';

    if (ev.type === 'trip_started') {
      await c.query(`UPDATE trips SET status = 'in_progress', started_at = coalesce(started_at, $2) WHERE id = $1 AND status IN ('released','in_progress','loading')`, [t.id, at]);
      await c.query(`UPDATE orders SET status = 'out_for_delivery' WHERE id IN (SELECT order_id FROM trip_orders WHERE trip_id = $1 AND moved_at IS NULL AND load_status <> 'removed') AND status IN ('loaded','planned')`, [t.id]);
    }
    if (ev.type === 'delivered') {
      const lines = await q<any>(`SELECT tor.order_id, tor.moved_at, tor.loaded_units, o.units FROM trip_orders tor JOIN orders o ON o.id = tor.order_id WHERE tor.trip_id = $1 AND o.outlet_id = $2 AND tor.load_status <> 'removed'`, [t.id, ev.outletId], c);
      const moved = lines.filter(l => l.moved_at);
      const outcome = payloadIn.outcome as string;
      if (['refused', 'no_access', 'closed'].includes(outcome) && !photo && !payloadIn.note) throw bad('Add a photo or a note when a stop is not delivered.');
      if (['full', 'partial'].includes(outcome) && !payloadIn.receiver) throw bad('Add the name of the person who received the goods.');
      const photoId = photo ? await saveAttachment(c, photo, { kind: 'pod_photo', outletId: ev.outletId, tripId: t.id, userId: user.id }) : null;
      const signatureId = signature ? await saveAttachment(c, signature, { kind: 'pod_signature', outletId: ev.outletId, tripId: t.id, userId: user.id }) : null;
      const deliveredUnits = payloadIn.deliveredUnits ?? Object.fromEntries(lines.filter(l => !l.moved_at).map(l => [l.order_id, outcome === 'full' ? (l.loaded_units ?? l.units) : 0]));
      await c.query(`INSERT INTO pods (event_id, trip_id, outlet_id, receiver, photo_id, signature_id, device_time, delivered_units) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [ins!.id, t.id, ev.outletId, payloadIn.receiver ?? null, photoId, signatureId, at, JSON.stringify(deliveredUnits)]);
      if (moved.length) {
        // the dispatcher moved this stop while the phone was offline: keep the record, ask people
        status = 'conflict';
        await c.query(`UPDATE stop_events SET conflict = true WHERE id = $1`, [ins!.id]);
        const moves = await q<any>(`SELECT m.order_id AS "orderId", m.moved_at AS "movedAt", m.to_trip_id AS "toTripId", t2.vehicle_id AS "toVehicle", t2.trip_no AS "toTrip" FROM stop_moves m JOIN trips t2 ON t2.id = m.to_trip_id WHERE m.from_trip_id = $1 AND m.outlet_id = $2 ORDER BY m.id`, [t.id, ev.outletId], c);
        const mv = moves[0];
        for (const l of moved) await c.query(`UPDATE orders SET status = $2 WHERE id = $1`, [l.order_id, outcome === 'partial' ? 'partial' : ['refused', 'no_access', 'closed'].includes(outcome) ? 'failed' : 'delivered']);
        await c.query(`INSERT INTO exceptions (type, plan_date, trip_id, order_id, outlet_id, title, detail, raised_by, raised_at) VALUES ('sync_conflict', $1, $2, $3, $4, $5, $6, $7, $8)`,
          [t.d, t.id, moved[0].order_id, ev.outletId, `${t.vehicle_id} synced a delivery at ${ev.outletId} that was moved`,
            JSON.stringify({ outcome, deliveredAt: hhmm, receiver: payloadIn.receiver ?? null, movedAt: mv ? toHHMM(minutesOfDay(new Date(mv.movedAt))) : null, toVehicle: mv?.toVehicle, toTrip: mv?.toTrip, orderIds: moved.map(l => l.order_id), moves, driverAnswer: null }), user.id, serverNow]);
        await notify(c, 'role:dispatcher', 'exception', `Sync conflict: ${ev.outletId}`, `${t.vehicle_id} recorded a delivery at ${hhmm} after you moved the stop to ${mv?.toVehicle ?? 'another vehicle'}.`, { tone: 'red', link: '/d/exceptions' });
      } else {
        const orderStatus = outcome === 'full' ? 'delivered' : outcome === 'partial' ? 'partial' : 'failed';
        for (const l of lines) await c.query(`UPDATE orders SET status = $2 WHERE id = $1`, [l.order_id, orderStatus]);
        if (orderStatus === 'failed') {
          await c.query(`INSERT INTO exceptions (type, plan_date, trip_id, order_id, outlet_id, title, detail, raised_by, raised_at) VALUES ('non_delivery', $1, $2, $3, $4, $5, $6, $7, $8)`,
            [t.d, t.id, lines[0]?.order_id ?? null, ev.outletId, `Not delivered: ${ev.outletId} — ${OUTCOME_LABEL[outcome]}`, JSON.stringify({ outcome, reasonLabel: OUTCOME_LABEL[outcome], recommendation: payloadIn.recommendation ?? null, note: payloadIn.note ?? null, at: hhmm, orderIds: lines.map(l => l.order_id), photoId }), user.id, serverNow]);
          await notify(c, 'role:dispatcher', 'exception', `${t.vehicle_id}: ${OUTCOME_LABEL[outcome]} at ${ev.outletId}`, `Driver recommends: ${payloadIn.recommendation === 'retry_today' ? 'retry later today' : 'return to depot, deliver next run'}.`, { tone: 'red', link: '/d/exceptions' });
          await notify(c, `outlet:${ev.outletId}`, 'not_delivered', `Delivery not completed at ${hhmm}`, `${OUTCOME_LABEL[outcome]}. The dispatcher will tell you the new plan.`, { tone: 'red', link: '/s' });
        } else {
          await notify(c, `outlet:${ev.outletId}`, 'delivered', `Delivered ${hhmm} — please confirm what arrived`, `${payloadIn.receiver ? `Received by ${payloadIn.receiver} · ` : ''}${t.vehicle_id}. Check each line against the driver's proof.`, { tone: 'green', link: '/s/receipt' });
        }
      }
    }
    if (ev.type === 'problem') {
      const photoId = photo ? await saveAttachment(c, photo, { kind: 'problem_photo', outletId: ev.outletId ?? null, tripId: t.id, userId: user.id }) : null;
      const delay = payloadIn.delayMin ?? 0;
      await c.query(`INSERT INTO exceptions (type, severity, plan_date, trip_id, outlet_id, title, detail, raised_by, raised_at) VALUES ('road_problem', $1, $2, $3, $4, $5, $6, $7, $8)`,
        [['vehicle', 'reefer_alarm', 'safety'].includes(payloadIn.kind) || delay >= 60 ? 'high' : 'medium', t.d, t.id, ev.outletId ?? null, `${t.vehicle_id}: ${payloadIn.label ?? payloadIn.kind}${delay ? ` · ${delay >= 60 ? `${delay / 60} h` : `${delay} min`}` : ''}`, JSON.stringify({ ...rest, at: hhmm, photoId }), user.id, serverNow]);
      await notify(c, 'role:dispatcher', 'exception', `${t.vehicle_id} reported: ${payloadIn.label ?? payloadIn.kind}${delay ? ` (${delay} min)` : ''}`, payloadIn.note ?? `At ${hhmm}.${delay ? ' Remaining arrival times now include the delay.' : ''}`, { tone: 'amber', link: '/d/exceptions' });
      if (delay >= 30) {
        const outlets = await q<any>(`SELECT DISTINCT o.outlet_id FROM trip_orders tor JOIN orders o ON o.id = tor.order_id WHERE tor.trip_id = $1 AND tor.moved_at IS NULL AND tor.load_status <> 'removed'
          AND NOT EXISTS (SELECT 1 FROM stop_events e WHERE e.trip_id = $1 AND e.outlet_id = o.outlet_id AND e.type = 'delivered')`, [t.id], c);
        for (const o of outlets) await notify(c, `outlet:${o.outlet_id}`, 'eta', `Your delivery is running about ${delay} min late`, `${t.vehicle_id} reported: ${payloadIn.label ?? 'a delay'} at ${hhmm}.`, { tone: 'amber', link: '/s' });
      }
    }
    if (ev.type === 'conflict_answer') {
      await c.query(`UPDATE exceptions SET detail = jsonb_set(detail, '{driverAnswer}', to_jsonb($3::text)) WHERE trip_id = $1 AND outlet_id = $2 AND type = 'sync_conflict' AND status = 'open'`, [t.id, ev.outletId, payloadIn.answer]);
    }
    if (ev.type === 'trip_closed') {
      for (const u of payloadIn.unrecorded ?? []) {
        const ords = await q<any>(`SELECT o.id FROM trip_orders tor JOIN orders o ON o.id = tor.order_id WHERE tor.trip_id = $1 AND o.outlet_id = $2 AND tor.moved_at IS NULL`, [t.id, u.outletId], c);
        for (const o of ords) await c.query(`UPDATE orders SET status = 'failed' WHERE id = $1 AND status IN ('out_for_delivery','loaded','planned')`, [o.id]);
        await c.query(`INSERT INTO exceptions (type, plan_date, trip_id, order_id, outlet_id, title, detail, raised_by, raised_at) VALUES ('non_delivery', $1, $2, $3, $4, $5, $6, $7, $8)`,
          [t.d, t.id, ords[0]?.id ?? null, u.outletId, `Not attempted: ${u.outletId}`, JSON.stringify({ outcome: 'not_attempted', reasonLabel: 'Not attempted', note: u.reason, at: hhmm, orderIds: ords.map(o => o.id) }), user.id, serverNow]);
      }
      await c.query(`UPDATE trips SET status = 'completed', closed_at = $2 WHERE id = $1`, [t.id, at]);
      await notify(c, 'role:dispatcher', 'trip_closed', `${t.vehicle_id} Trip ${t.trip_no} closed at ${hhmm}`, payloadIn.unrecorded?.length ? `${payloadIn.unrecorded.length} stop(s) not attempted — see Exceptions.` : 'Every record is synced.', { tone: payloadIn.unrecorded?.length ? 'amber' : 'green' });
      const v = await one<any>(`SELECT depot FROM vehicles WHERE id = $1`, [t.vehicle_id], c);
      const next = await one<any>(`SELECT id, trip_no FROM trips WHERE plan_date = $1 AND vehicle_id = $2 AND trip_no > $3 AND status <> 'cancelled' ORDER BY trip_no LIMIT 1`, [t.d, t.vehicle_id, t.trip_no], c);
      if (next && v) await notify(c, `depot:${v.depot}`, 'trip_back', `${t.vehicle_id} is back — Trip ${next.trip_no} can be loaded`, `Trip ${t.trip_no} closed at ${hhmm}.`, { tone: 'violet', link: `/l/trip/${next.id}` });
    }
    await audit(c, user.id, `driver.${ev.type}`, `trip:${t.id}`, { outletId: ev.outletId, deviceTime: ev.deviceTime, status, clockAdjusted: at !== at0 });
    return { clientEventId: ev.clientEventId, status };
  });
}
