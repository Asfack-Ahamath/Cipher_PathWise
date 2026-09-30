import { scheduleTrip, toHHMM, type Order } from '@pathwise/core';
import { one, q, type Db } from '../db.js';
import { notFound } from '../errors.js';
import { loadNetwork } from './network.js';

/* A trip with everything the loader, the driver and the dispatcher need: stops in order,
   lines with load state, planned times, and what happened at each stop. */
export async function tripDetail(tripId: number, db?: Db) {
  const t = await one<any>(`SELECT t.*, to_char(t.plan_date,'YYYY-MM-DD') AS date FROM trips t WHERE t.id = $1`, [tripId], db);
  if (!t) throw notFound('Trip not found.');
  const net = await loadNetwork(db);
  const lines = await q<any>(`SELECT tor.order_id AS "orderId", tor.seq, tor.load_status AS "loadStatus", tor.loaded_units AS "loadedUnits", tor.flag_reason AS "flagReason", tor.flag_note AS "flagNote",
      tor.moved_at AS "movedAt", tor.actual_kg::float AS "actualKg", tor.actual_m3::float AS "actualM3", o.outlet_id AS "outletId", o.temp, o.units, o.kg, o.m3, o.description, o.status, o.deferred_yesterday AS "deferredYesterday", o.days_since_served AS "daysSinceServed", to_char(o.delivery_date,'YYYY-MM-DD') AS date
    FROM trip_orders tor JOIN orders o ON o.id = tor.order_id WHERE tor.trip_id = $1 ORDER BY tor.seq`, [tripId], db);
  const active = lines.filter(l => !l.movedAt && l.loadStatus !== 'removed');
  const orders = new Map<string, Order>(active.map(l => [l.orderId, { id: l.orderId, outletId: l.outletId, date: l.date, temp: l.temp, units: l.units, kg: l.kg, m3: l.m3 }]));
  const sched = scheduleTrip(net, { vehicleId: t.vehicle_id, trip: t.trip_no, depart: t.depart, orderIds: active.map(l => l.orderId) }, orders);
  const events = await q<any>(`SELECT e.id, e.type, e.outlet_id AS "outletId", e.payload, e.device_time AS "deviceTime", e.received_at AS "receivedAt", e.conflict,
      p.receiver, p.photo_id AS "photoId", p.signature_id AS "signatureId", p.delivered_units AS "deliveredUnits"
      FROM stop_events e LEFT JOIN pods p ON p.event_id = e.id WHERE e.trip_id = $1 ORDER BY e.device_time`, [tripId], db);
  const moves = await q<any>(`SELECT m.outlet_id AS "outletId", m.moved_at AS "movedAt", m.reason, t2.vehicle_id AS "toVehicle", t2.trip_no AS "toTrip", m.from_trip_id AS "fromTripId", m.to_trip_id AS "toTripId"
    FROM stop_moves m JOIN trips t2 ON t2.id = m.to_trip_id WHERE m.from_trip_id = $1 OR m.to_trip_id = $1`, [tripId], db);
  const v = net.vehicles.get(t.vehicle_id)!;
  const stops = sched.stops.map(s => {
    const ot = net.outlets.get(s.outletId)!;
    const ev = events.filter(e => e.outletId === s.outletId);
    const delivered = [...ev].reverse().find(e => e.type === 'delivered');
    return {
      seq: s.seq, outletId: s.outletId, outlet: ot, arrive: toHHMM(s.arrive), start: toHHMM(s.start), leave: toHHMM(s.leave), waitMin: s.waitMin, allowance: s.allowance, lateRisk: s.lateRisk, late: s.late,
      lines: active.filter(l => l.outletId === s.outletId),
      arrivedAt: ev.find(e => e.type === 'arrived')?.deviceTime ?? null,
      outcome: delivered ? { ...delivered.payload, at: delivered.deviceTime, receivedAt: delivered.receivedAt, conflict: delivered.conflict, receiver: delivered.receiver,
        deliveredUnits: delivered.deliveredUnits ?? {},
        photoUrl: delivered.photoId ? `/api/files/${delivered.photoId}` : null, signatureUrl: delivered.signatureId ? `/api/files/${delivered.signatureId}` : null } : null,
    };
  });
  // outlets moved off this trip while it was running (the driver still sees them, marked)
  const movedAway = lines.filter(l => l.movedAt).map(l => ({ ...l, move: moves.find(m => m.outletId === l.outletId && m.fromTripId === tripId) ?? null }));
  const planVersion = (await one<{ v: number }>(`SELECT coalesce(max(version),0) AS v FROM plans WHERE plan_date = $1 AND status IN ('published','superseded')`, [t.date], db))!.v;
  return {
    id: t.id, date: t.date, vehicleId: t.vehicle_id, trip: t.trip_no, depart: t.depart, status: t.status, version: t.version, planVersion,
    releasedAt: t.released_at, startedAt: t.started_at, closedAt: t.closed_at, swappedFrom: t.swapped_from,
    changedAt: t.changed_at, changeNote: t.change_note ? JSON.parse(t.change_note) : null, ackVersion: t.ack_version,
    vehicle: v, brand: sched.brand, district: sched.district, kg: sched.kg, m3: sched.m3, tripMinutes: sched.tripMinutes, km: sched.km, returnAt: toHHMM(sched.returnAt),
    budget: sched.brand === 'Fresh' ? net.rules.freshBudgetMin : net.rules.styleTechBudgetMin,
    stops, lines, movedAway,
    events: events.map(e => ({ ...e, photoUrl: e.photoId ? `/api/files/${e.photoId}` : (e.payload?.photoId ? `/api/files/${e.payload.photoId}` : null), signatureUrl: e.signatureId ? `/api/files/${e.signatureId}` : null })),
    loadingSession: await one<any>(`SELECT s.user_id AS "userId", u.name, s.device, s.claimed_at AS "claimedAt", s.heartbeat_at AS "heartbeatAt" FROM loading_sessions s JOIN users u ON u.id = s.user_id WHERE s.trip_id = $1`, [tripId], db),
    previousTrip: t.trip_no > 1 ? await one<any>(`SELECT id, status, trip_no AS trip FROM trips WHERE plan_date = $1 AND vehicle_id = $2 AND trip_no = $3 AND status <> 'cancelled'`, [t.date, t.vehicle_id, t.trip_no - 1], db) : null,
    exceptions: await q<any>(`SELECT id, type, status, title, detail, decision, raised_at AS "raisedAt", resolved_at AS "resolvedAt", order_id AS "orderId", outlet_id AS "outletId" FROM exceptions WHERE trip_id = $1 ORDER BY id`, [tripId], db),
  };
}
