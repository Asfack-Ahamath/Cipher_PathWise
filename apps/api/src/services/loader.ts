import { audit, notify } from '../audit.js';
import { dayLabel, nowSync } from '../clock.js';
import { one, pool, q, tx } from '../db.js';
import { bad, conflict, notFound } from '../errors.js';
import { activePlanDate } from './network.js';
import { tripDetail } from './trips.js';

export async function dockQueue(depot: string, date?: string) {
  const d = date ?? await activePlanDate();
  const rows = await q<any>(`SELECT t.id, t.vehicle_id AS "vehicleId", t.trip_no AS trip, t.depart, t.status, t.swapped_from AS "swappedFrom", t.changed_at AS "changedAt", t.ack_version AS "ackVersion", t.version,
      v.type, v.temp, v.driver_name AS "driverName",
      count(tor.order_id) FILTER (WHERE tor.moved_at IS NULL AND tor.load_status <> 'removed') AS lines,
      count(tor.order_id) FILTER (WHERE tor.load_status = 'loaded' AND tor.moved_at IS NULL) AS loaded,
      count(tor.order_id) FILTER (WHERE tor.load_status = 'flagged' AND tor.moved_at IS NULL) AS flagged,
      count(DISTINCT o.outlet_id) FILTER (WHERE tor.moved_at IS NULL AND tor.load_status <> 'removed') AS stops,
      min(ot.brand) AS brand, min(ot.district) AS district
    FROM trips t JOIN vehicles v ON v.id = t.vehicle_id
    LEFT JOIN trip_orders tor ON tor.trip_id = t.id LEFT JOIN orders o ON o.id = tor.order_id LEFT JOIN outlets ot ON ot.id = o.outlet_id
    WHERE t.plan_date = $1 AND v.depot = $2 GROUP BY t.id, v.id ORDER BY t.depart, t.vehicle_id`, [d, depot]);
  const pub = await one<any>(`SELECT version, published_at FROM plans WHERE plan_date = $1 AND status = 'published'`, [d]);
  return { date: d, dateLabel: dayLabel(d), depot, planVersion: pub?.version ?? null, publishedAt: pub?.published_at ?? null, trips: rows.map(r => ({ ...r, lines: Number(r.lines), loaded: Number(r.loaded), flagged: Number(r.flagged), stops: Number(r.stops), changed: !!r.changedAt })) };
}

async function assertLoaderTrip(tripId: number, depot: string | null) {
  const t = await one<any>(`SELECT t.*, v.depot FROM trips t JOIN vehicles v ON v.id = t.vehicle_id WHERE t.id = $1`, [tripId]);
  if (!t) throw notFound('Trip not found.');
  if (depot && t.depot !== depot) throw bad(`This trip loads at ${t.depot} DC.`);
  if (['in_progress', 'completed', 'cancelled'].includes(t.status)) throw conflict(`This trip is ${t.status.replace('_', ' ')} — it can no longer be loaded.`);
  return t;
}

export async function acknowledge(tripId: number, userId: number) {
  await q(`UPDATE trips SET ack_version = version, changed_at = NULL WHERE id = $1`, [tripId]);
  await audit(pool, userId, 'load.ack_change', `trip:${tripId}`);
  return tripDetail(tripId);
}

export async function setLine(tripId: number, orderId: string, userId: number, depot: string | null, state: 'loaded' | 'pending') {
  const t = await assertLoaderTrip(tripId, depot);
  await tx(async c => {
    const r = await c.query(`UPDATE trip_orders SET load_status = $3, loaded_units = CASE WHEN $3 = 'loaded' THEN coalesce(loaded_units, (SELECT units FROM orders WHERE id = $2)) ELSE NULL END, loaded_at = $4, loaded_by = $5
      WHERE trip_id = $1 AND order_id = $2 AND moved_at IS NULL AND load_status <> 'removed'`, [tripId, orderId, state, nowSync(), userId]);
    if (!r.rowCount) throw notFound('That line is not on this trip.');
    if (t.status === 'planned') await c.query(`UPDATE trips SET status = 'loading' WHERE id = $1`, [tripId]);
    await audit(c, userId, `load.${state}`, `trip:${tripId}`, { orderId });
  });
  return tripDetail(tripId);
}

export async function flagLine(tripId: number, orderId: string, userId: number, depot: string | null, body: { reason: 'missing' | 'damaged' | 'wrong_item'; loadedUnits: number; item?: string; note?: string }) {
  const t = await assertLoaderTrip(tripId, depot);
  await tx(async c => {
    const line = await one<any>(`SELECT tor.*, o.units, o.outlet_id, o.description, o.temp FROM trip_orders tor JOIN orders o ON o.id = tor.order_id WHERE tor.trip_id = $1 AND tor.order_id = $2`, [tripId, orderId], c);
    if (!line) throw notFound('That line is not on this trip.');
    if (body.loadedUnits < 0 || body.loadedUnits >= line.units) throw bad(`Loaded units must be between 0 and ${line.units - 1}.`);
    const at = nowSync();
    await c.query(`UPDATE trip_orders SET load_status = 'flagged', loaded_units = $3, flag_reason = $4, flag_note = $5, loaded_at = $6, loaded_by = $7 WHERE trip_id = $1 AND order_id = $2`, [tripId, orderId, body.loadedUnits, body.reason, body.note ?? null, at, userId]);
    if (t.status === 'planned') await c.query(`UPDATE trips SET status = 'loading' WHERE id = $1`, [tripId]);
    const missing = line.units - body.loadedUnits;
    const what = body.item || line.description || 'items';
    const ex = await one<any>(`INSERT INTO exceptions (type, plan_date, trip_id, order_id, outlet_id, title, detail, raised_by, raised_at) VALUES ('dock_shortfall', $1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [t.plan_date, tripId, orderId, line.outlet_id, `Short at the dock — ${t.vehicle_id} Trip ${t.trip_no}`,
        JSON.stringify({ reason: body.reason, item: what, planned: line.units, loaded: body.loadedUnits, missing, departs: t.depart, note: body.note ?? null, temp: line.temp }), userId, at], c);
    await notify(c, 'role:dispatcher', 'exception', `Short at the dock — ${t.vehicle_id} Trip ${t.trip_no}`, `${body.reason === 'damaged' ? 'Damaged' : 'Missing'}: ${what}, ${body.loadedUnits} of ${line.units} loaded for ${line.outlet_id}. Departs ${t.depart}.`, { tone: 'red', link: `/d/exceptions?id=${ex.id}` });
    await audit(c, userId, 'load.flag', `trip:${tripId}`, { orderId, ...body });
  });
  return tripDetail(tripId);
}

export async function release(tripId: number, userId: number, depot: string | null) {
  const t = await assertLoaderTrip(tripId, depot);
  const d = await tripDetail(tripId);
  const pending = d.lines.filter((l: any) => !l.movedAt && l.loadStatus === 'pending');
  if (pending.length) throw conflict(`${pending.length} line${pending.length > 1 ? 's are' : ' is'} not loaded yet.`);
  const open = d.exceptions.filter((e: any) => e.status === 'open' && ['dock_shortfall', 'vehicle_fault'].includes(e.type));
  if (open.length) throw conflict('Wait for the dispatcher’s decision on the flagged line before releasing.');
  if (t.changed_at) throw conflict('The plan changed — acknowledge the change first.');
  await tx(async c => {
    const at = nowSync();
    await c.query(`UPDATE trips SET status = 'released', released_at = $2, released_by = $3 WHERE id = $1`, [tripId, at, userId]);
    await c.query(`UPDATE orders SET status = 'loaded' WHERE id IN (SELECT order_id FROM trip_orders WHERE trip_id = $1 AND moved_at IS NULL AND load_status <> 'removed') AND status IN ('planned','confirmed')`, [tripId]);
    const short = d.lines.filter((l: any) => l.loadStatus === 'flagged');
    await notify(c, `vehicle:${t.vehicle_id}`, 'released', `${t.vehicle_id} Trip ${t.trip_no} is loaded and released`, short.length ? `Short from the depot: ${short.map((l: any) => `${l.outletId} ${l.loadedUnits}/${l.units}`).join(', ')}. The stores have been told.` : 'Everything on the load list is on board. You can start the trip.', { tone: 'green', link: '/r' });
    await notify(c, 'role:dispatcher', 'released', `${t.vehicle_id} Trip ${t.trip_no} released`, `Loaded ${d.lines.filter((l: any) => l.loadStatus !== 'removed' && !l.movedAt).length} lines${short.length ? ` · ${short.length} short` : ''}.`, { tone: 'green' });
    await audit(c, userId, 'load.release', `trip:${tripId}`);
  });
  return tripDetail(tripId);
}

export async function reportFault(tripId: number, userId: number, depot: string | null, body: { type: string; severity: 'blocking' | 'advisory'; note?: string }) {
  const t = await assertLoaderTrip(tripId, depot);
  await tx(async c => {
    const at = nowSync();
    const ex = await one<any>(`INSERT INTO exceptions (type, severity, plan_date, trip_id, title, detail, raised_by, raised_at) VALUES ('vehicle_fault', $1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [body.severity === 'blocking' ? 'high' : 'medium', t.plan_date, tripId, `${t.vehicle_id}: ${body.type}`, JSON.stringify({ ...body, vehicleId: t.vehicle_id, departs: t.depart }), userId, at], c);
    if (body.severity === 'blocking') await c.query(`UPDATE trips SET status = 'blocked' WHERE id = $1`, [tripId]);
    await notify(c, 'role:dispatcher', 'exception', `${t.vehicle_id} reported: ${body.type}`, body.severity === 'blocking' ? `Trip ${t.trip_no} is frozen until you swap the vehicle.` : 'Advisory — the trip can continue.', { tone: body.severity === 'blocking' ? 'red' : 'amber', link: `/d/exceptions?id=${ex.id}` });
    await audit(c, userId, 'load.fault', `trip:${tripId}`, body);
  });
  return tripDetail(tripId);
}
