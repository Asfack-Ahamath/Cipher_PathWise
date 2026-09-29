import { toHHMM } from '@pathwise/core';
import { z } from 'zod';
import { audit, notify } from '../audit.js';
import { minutesOfDay, nowSync } from '../clock.js';
import { one, q, tx } from '../db.js';
import { bad } from '../errors.js';
import type { AuthUser } from '../auth.js';
import { activePlanDate } from './network.js';
import { tripDetail } from './trips.js';

export const OUTCOME_LABEL: Record<string, string> = { full: 'Delivered in full', partial: 'Partial delivery', refused: 'Store refused goods', no_access: 'Could not access', closed: 'Outlet closed' };

export async function touchPresence(vehicleId: string | null) {
  if (!vehicleId) return;
  await q(`INSERT INTO vehicle_presence (vehicle_id, last_seen) VALUES ($1,$2) ON CONFLICT (vehicle_id) DO UPDATE SET last_seen = EXCLUDED.last_seen`, [vehicleId, nowSync()]);
}

/** The driver's run for the day. The phone caches this for offline use. */
export async function myRun(user: AuthUser) {
  if (!user.vehicleId) throw bad('No vehicle is assigned to your account.');
  await touchPresence(user.vehicleId);
  const date = await activePlanDate();
  const ids = await q<{ id: number }>(`SELECT id FROM trips WHERE plan_date = $1 AND vehicle_id = $2 AND status <> 'cancelled' ORDER BY trip_no`, [date, user.vehicleId]);
  const trips = [];
  for (const { id } of ids) trips.push(await tripDetail(id));
  const v = await one<any>(`SELECT id, type, temp, depot, driver_name AS "driverName" FROM vehicles WHERE id = $1`, [user.vehicleId]);
  return { date, vehicle: v, trips, fetchedAt: nowSync().toISOString() };
}

const Event = z.object({
  clientEventId: z.string().uuid(),
  type: z.enum(['trip_started', 'arrived', 'delivered', 'problem', 'trip_closed', 'conflict_answer']),
  tripId: z.number().int(),
  outletId: z.string().optional().nullable(),
  deviceTime: z.string(),
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
  return tx(async c => {
    const t = await one<any>(`SELECT t.*, to_char(t.plan_date,'YYYY-MM-DD') AS d FROM trips t WHERE t.id = $1`, [ev.tripId], c);
    if (!t) throw bad('Trip not found.');
    if (t.vehicle_id !== user.vehicleId && t.swapped_from !== user.vehicleId) throw bad('This trip is not on your vehicle.');
    const { photo, signature, ...payload } = ev.payload as any;
    const ins = await one<{ id: number }>(`INSERT INTO stop_events (client_event_id, trip_id, outlet_id, type, payload, device_time, received_at, user_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (client_event_id) DO NOTHING RETURNING id`,
      [ev.clientEventId, ev.tripId, ev.outletId ?? null, ev.type, JSON.stringify(payload), ev.deviceTime, nowSync(), user.id], c);
    if (!ins) return { clientEventId: ev.clientEventId, status: 'duplicate' as const };
    const at = new Date(ev.deviceTime);
    const hhmm = toHHMM(minutesOfDay(at));
    let status: 'applied' | 'conflict' = 'applied';

    if (ev.type === 'trip_started') {
      await c.query(`UPDATE trips SET status = 'in_progress', started_at = coalesce(started_at, $2) WHERE id = $1 AND status IN ('released','in_progress','loading')`, [t.id, at]);
      await c.query(`UPDATE orders SET status = 'out_for_delivery' WHERE id IN (SELECT order_id FROM trip_orders WHERE trip_id = $1 AND moved_at IS NULL AND load_status <> 'removed') AND status IN ('loaded','planned')`, [t.id]);
    }
    if (ev.type === 'delivered') {
      if (!ev.outletId) throw bad('outletId is required.');
      const lines = await q<any>(`SELECT tor.order_id, tor.moved_at, tor.loaded_units, o.units FROM trip_orders tor JOIN orders o ON o.id = tor.order_id WHERE tor.trip_id = $1 AND o.outlet_id = $2 AND tor.load_status <> 'removed'`, [t.id, ev.outletId], c);
      const moved = lines.filter(l => l.moved_at);
      const outcome = payload.outcome as string;
      await c.query(`INSERT INTO pods (event_id, trip_id, outlet_id, receiver, photo, signature, device_time) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [ins.id, t.id, ev.outletId, payload.receiver ?? null, photo ?? null, signature ?? null, at]);
      if (moved.length) {
        // the dispatcher moved this stop while the phone was offline: keep the record, ask people
        status = 'conflict';
        await c.query(`UPDATE stop_events SET conflict = true WHERE id = $1`, [ins.id]);
        const moves = await q<any>(`SELECT m.order_id AS "orderId", m.moved_at AS "movedAt", m.to_trip_id AS "toTripId", t2.vehicle_id AS "toVehicle", t2.trip_no AS "toTrip" FROM stop_moves m JOIN trips t2 ON t2.id = m.to_trip_id WHERE m.from_trip_id = $1 AND m.outlet_id = $2 ORDER BY m.id`, [t.id, ev.outletId], c);
        const mv = moves[0];
        for (const l of moved) await c.query(`UPDATE orders SET status = $2 WHERE id = $1`, [l.order_id, outcome === 'partial' ? 'partial' : ['refused', 'no_access', 'closed'].includes(outcome) ? 'failed' : 'delivered']);
        await c.query(`INSERT INTO exceptions (type, plan_date, trip_id, order_id, outlet_id, title, detail, raised_by, raised_at) VALUES ('sync_conflict', $1, $2, $3, $4, $5, $6, $7, $8)`,
          [t.d, t.id, moved[0].order_id, ev.outletId, `${t.vehicle_id} synced a delivery at ${ev.outletId} that was moved`,
            JSON.stringify({ outcome, deliveredAt: hhmm, receiver: payload.receiver ?? null, movedAt: mv ? toHHMM(minutesOfDay(new Date(mv.movedAt))) : null, toVehicle: mv?.toVehicle, toTrip: mv?.toTrip, orderIds: moved.map(l => l.order_id), moves, driverAnswer: null }), user.id, nowSync()]);
        await notify(c, 'role:dispatcher', 'exception', `Sync conflict: ${ev.outletId}`, `${t.vehicle_id} recorded a delivery at ${hhmm} after you moved the stop to ${mv?.toVehicle ?? 'another vehicle'}.`, { tone: 'red', link: '/d/exceptions' });
      } else {
        const orderStatus = outcome === 'full' ? 'delivered' : outcome === 'partial' ? 'partial' : 'failed';
        for (const l of lines) await c.query(`UPDATE orders SET status = $2 WHERE id = $1`, [l.order_id, orderStatus]);
        if (orderStatus === 'failed') {
          await c.query(`INSERT INTO exceptions (type, plan_date, trip_id, order_id, outlet_id, title, detail, raised_by, raised_at) VALUES ('non_delivery', $1, $2, $3, $4, $5, $6, $7, $8)`,
            [t.d, t.id, lines[0]?.order_id ?? null, ev.outletId, `Not delivered: ${ev.outletId} — ${OUTCOME_LABEL[outcome]}`, JSON.stringify({ outcome, reasonLabel: OUTCOME_LABEL[outcome], recommendation: payload.recommendation ?? null, note: payload.note ?? null, at: hhmm, orderIds: lines.map(l => l.order_id) }), user.id, nowSync()]);
          await notify(c, 'role:dispatcher', 'exception', `${t.vehicle_id}: ${OUTCOME_LABEL[outcome]} at ${ev.outletId}`, `Driver recommends: ${payload.recommendation === 'retry_today' ? 'retry later today' : 'return to depot, deliver next run'}.`, { tone: 'red', link: '/d/exceptions' });
        } else {
          await notify(c, `outlet:${ev.outletId}`, 'delivered', `Delivered ${hhmm} — please confirm what arrived`, `${payload.receiver ? `Received by ${payload.receiver} · ` : ''}${t.vehicle_id}. Check each line against the driver’s proof.`, { tone: 'green', link: '/s/receipt' });
        }
      }
    }
    if (ev.type === 'problem') {
      await c.query(`INSERT INTO exceptions (type, severity, plan_date, trip_id, outlet_id, title, detail, raised_by, raised_at) VALUES ('road_problem', $1, $2, $3, $4, $5, $6, $7, $8)`,
        [['vehicle', 'reefer_alarm'].includes(payload.kind) ? 'high' : 'medium', t.d, t.id, ev.outletId ?? null, `${t.vehicle_id}: ${payload.label ?? payload.kind}`, JSON.stringify({ ...payload, at: hhmm, photo: !!photo }), user.id, nowSync()]);
      await notify(c, 'role:dispatcher', 'exception', `${t.vehicle_id} reported: ${payload.label ?? payload.kind}`, payload.note ?? `At ${hhmm}.`, { tone: 'amber', link: '/d/exceptions' });
    }
    if (ev.type === 'conflict_answer') {
      await c.query(`UPDATE exceptions SET detail = jsonb_set(detail, '{driverAnswer}', to_jsonb($3::text)) WHERE trip_id = $1 AND outlet_id = $2 AND type = 'sync_conflict' AND status = 'open'`, [t.id, ev.outletId, payload.answer]);
    }
    if (ev.type === 'trip_closed') {
      await c.query(`UPDATE trips SET status = 'completed', closed_at = $2 WHERE id = $1`, [t.id, at]);
      await notify(c, 'role:dispatcher', 'trip_closed', `${t.vehicle_id} Trip ${t.trip_no} closed at ${hhmm}`, 'Every record is synced.', { tone: 'green' });
    }
    await audit(c, user.id, `driver.${ev.type}`, `trip:${t.id}`, { outletId: ev.outletId, deviceTime: ev.deviceTime, status });
    return { clientEventId: ev.clientEventId, status };
  });
}
