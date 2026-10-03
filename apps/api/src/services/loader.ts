import { audit, notify } from '../audit.js';
import { dayLabel, nowSync } from '../clock.js';
import { z } from 'zod';
import { one, pool, q, tx, type Db } from '../db.js';
import { MS_PER_MINUTE } from '../lib/constants.js';
import { getSettings } from '../lib/settings.js';
import type { AuthUser } from '../auth.js';
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

async function assertLoaderTrip(tripId: number, depot: string | null, userId?: number, opts: { forLoading?: boolean } = {}) {
  const t = await one<any>(`SELECT t.*, to_char(t.plan_date,'YYYY-MM-DD') AS d, v.depot FROM trips t JOIN vehicles v ON v.id = t.vehicle_id WHERE t.id = $1`, [tripId]);
  if (!t) throw notFound('Trip not found.');
  if (depot && t.depot !== depot) throw bad(`This trip loads at ${t.depot} DC.`);
  if (['in_progress', 'completed', 'cancelled'].includes(t.status)) throw conflict(`This trip is ${t.status.replace('_', ' ')} — it can no longer be loaded.`);
  if (t.status === 'released' && opts.forLoading) throw conflict('This trip is already released. Ask the dispatcher if something has to change.');
  if (opts.forLoading && t.trip_no > 1) {
    // the same truck does trip 1 first; it cannot be loaded for trip 2 until it is back
    const prev = await one<any>(`SELECT status FROM trips WHERE plan_date = $1 AND vehicle_id = $2 AND trip_no = $3 AND status <> 'cancelled'`, [t.d, t.vehicle_id, t.trip_no - 1]);
    if (prev && prev.status !== 'completed') throw conflict(`${t.vehicle_id} is still on Trip ${t.trip_no - 1}. Trip ${t.trip_no} can be loaded when it is back and the driver closes Trip ${t.trip_no - 1}.`);
  }
  if (userId && opts.forLoading) await assertClaim(tripId, userId);
  return t;
}

/* ── Loading sessions: one loader works a trip at a time ─────────────────────────
   A loader's tablet claims the trip when they open it and keeps it with a heartbeat.
   Someone else can take over once the claim has been quiet for `loaderClaimMinutes`,
   or at once with "take over" (recorded in the audit log). */
async function assertClaim(tripId: number, userId: number, db?: Db) {
  const s = await one<any>(`SELECT s.user_id, s.heartbeat_at, u.name FROM loading_sessions s JOIN users u ON u.id = s.user_id WHERE s.trip_id = $1`, [tripId], db);
  if (!s || s.user_id === userId) return;
  const quietMin = (nowSync().getTime() - new Date(s.heartbeat_at).getTime()) / MS_PER_MINUTE;
  const limit = (await getSettings()).operations.loaderClaimMinutes;
  if (quietMin < limit) throw conflict(`${s.name} is loading this trip on another tablet. Take over only if they have stopped.`, { holder: s.name }, 'TRIP_CLAIMED');
}

export async function claimTrip(tripId: number, user: AuthUser, body: { device?: string; takeOver?: boolean }) {
  const t = await one<any>(`SELECT t.id, v.depot FROM trips t JOIN vehicles v ON v.id = t.vehicle_id WHERE t.id = $1`, [tripId]);
  if (!t) throw notFound('Trip not found.');
  if (user.depot && t.depot !== user.depot) throw bad(`This trip loads at ${t.depot} DC.`);
  return tx(async c => {
    const cur = await one<any>(`SELECT user_id FROM loading_sessions WHERE trip_id = $1 FOR UPDATE`, [tripId], c);
    if (cur && cur.user_id !== user.id && !body.takeOver) await assertClaim(tripId, user.id, c);
    const at = nowSync();
    await c.query(`INSERT INTO loading_sessions (trip_id, user_id, device, claimed_at, heartbeat_at) VALUES ($1,$2,$3,$4,$4)
      ON CONFLICT (trip_id) DO UPDATE SET user_id = EXCLUDED.user_id, device = EXCLUDED.device, heartbeat_at = EXCLUDED.heartbeat_at,
        claimed_at = CASE WHEN loading_sessions.user_id = EXCLUDED.user_id THEN loading_sessions.claimed_at ELSE EXCLUDED.claimed_at END`, [tripId, user.id, body.device?.slice(0, 80) ?? null, at]);
    if (cur && cur.user_id !== user.id) await audit(c, user.id, 'load.takeover', `trip:${tripId}`, { from: cur.user_id });
    return { tripId, holder: user.name, heartbeatAt: at.toISOString() };
  });
}

export async function releaseClaim(tripId: number, userId: number) {
  await q(`DELETE FROM loading_sessions WHERE trip_id = $1 AND user_id = $2`, [tripId, userId]);
  return { ok: true };
}

export async function acknowledge(tripId: number, userId: number) {
  await q(`UPDATE trips SET ack_version = version, changed_at = NULL WHERE id = $1`, [tripId]);
  await audit(pool, userId, 'load.ack_change', `trip:${tripId}`);
  return tripDetail(tripId);
}

export async function setLine(tripId: number, orderId: string, userId: number, depot: string | null, state: 'loaded' | 'pending') {
  const t = await assertLoaderTrip(tripId, depot, userId, { forLoading: true });
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
  const t = await assertLoaderTrip(tripId, depot, userId, { forLoading: true });
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
  const t = await assertLoaderTrip(tripId, depot, userId, { forLoading: true });
  const d = await tripDetail(tripId);
  const pending = d.lines.filter((l: any) => !l.movedAt && l.loadStatus === 'pending');
  if (pending.length) throw conflict(`${pending.length} line${pending.length > 1 ? 's are' : ' is'} not loaded yet.`);
  const open = d.exceptions.filter((e: any) => e.status === 'open' && (['dock_shortfall', 'vehicle_fault'].includes(e.type) || (e.type === 'size_divergence' && e.detail?.overCapacity)));
  if (open.length) throw conflict('Wait for the dispatcher’s decision on the flagged line before releasing.');
  if (t.changed_at) throw conflict('The plan changed — acknowledge the change first.');
  await tx(async c => {
    const at = nowSync();
    await c.query(`UPDATE trips SET status = 'released', released_at = $2, released_by = $3 WHERE id = $1`, [tripId, at, userId]);
    await c.query(`UPDATE orders SET status = 'loaded' WHERE id IN (SELECT order_id FROM trip_orders WHERE trip_id = $1 AND moved_at IS NULL AND load_status <> 'removed') AND status IN ('planned','confirmed')`, [tripId]);
    const short = d.lines.filter((l: any) => l.loadStatus === 'flagged');
    await notify(c, `vehicle:${t.vehicle_id}`, 'released', `${t.vehicle_id} Trip ${t.trip_no} is loaded and released`, short.length ? `Short from the depot: ${short.map((l: any) => `${l.outletId} ${l.loadedUnits}/${l.units}`).join(', ')}. The stores have been told.` : 'Everything on the load list is on board. You can start the trip.', { tone: 'green', link: '/r' });
    await notify(c, 'role:dispatcher', 'released', `${t.vehicle_id} Trip ${t.trip_no} released`, `Loaded ${d.lines.filter((l: any) => l.loadStatus !== 'removed' && !l.movedAt).length} lines${short.length ? ` · ${short.length} short` : ''}.`, { tone: 'green' });
    await c.query(`DELETE FROM loading_sessions WHERE trip_id = $1`, [tripId]);
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

export const FlagBody = z.object({ reason: z.enum(['missing', 'damaged', 'wrong_item']), loadedUnits: z.number().int().min(0), item: z.string().trim().max(120).optional(), note: z.string().trim().max(500).optional() });
export const FaultBody = z.object({ type: z.string().trim().min(2).max(80), severity: z.enum(['blocking', 'advisory']), note: z.string().trim().max(500).optional() });
export const SizeBody = z.object({ actualKg: z.number().positive().max(100000), actualM3: z.number().positive().max(1000), note: z.string().trim().max(500).optional() });

/** The goods on the dock are bigger or heavier than the order said. Record the real size; if the
 *  truck no longer fits, the dispatcher has to decide before the loader can release. */
export async function reportSize(tripId: number, orderId: string, userId: number, depot: string | null, body: z.infer<typeof SizeBody>) {
  const t = await assertLoaderTrip(tripId, depot, userId, { forLoading: true });
  await tx(async c => {
    const line = await one<any>(`SELECT tor.*, o.kg, o.m3, o.outlet_id, o.description FROM trip_orders tor JOIN orders o ON o.id = tor.order_id WHERE tor.trip_id = $1 AND tor.order_id = $2 AND tor.moved_at IS NULL AND tor.load_status <> 'removed'`, [tripId, orderId], c);
    if (!line) throw notFound('That line is not on this trip.');
    await c.query(`UPDATE trip_orders SET actual_kg = $3, actual_m3 = $4 WHERE trip_id = $1 AND order_id = $2`, [tripId, orderId, body.actualKg, body.actualM3]);
    const tot = (await one<any>(`SELECT sum(coalesce(tor.actual_kg, o.kg))::float AS kg, sum(coalesce(tor.actual_m3, o.m3))::float AS m3, v.weight_cap AS "weightCap", v.volume_cap AS "volumeCap"
      FROM trip_orders tor JOIN orders o ON o.id = tor.order_id JOIN trips t ON t.id = tor.trip_id JOIN vehicles v ON v.id = t.vehicle_id
      WHERE tor.trip_id = $1 AND tor.moved_at IS NULL AND tor.load_status <> 'removed' GROUP BY v.weight_cap, v.volume_cap`, [tripId], c))!;
    const overCapacity = tot.kg > Number(tot.weightCap) || tot.m3 > Number(tot.volumeCap);
    const planned = { kg: Number(line.kg), m3: Number(line.m3) };
    const change = Math.max(Math.abs(body.actualKg - planned.kg) / planned.kg, Math.abs(body.actualM3 - planned.m3) / planned.m3);
    if (!overCapacity && change < 0.15) { await audit(c, userId, 'load.size', `trip:${tripId}`, { orderId, ...body, minor: true }); return; }
    await c.query(`UPDATE exceptions SET status = 'resolved', decision = 'Superseded by a newer size report', resolved_by = $3, resolved_at = $4 WHERE trip_id = $1 AND order_id = $2 AND type = 'size_divergence' AND status = 'open'`, [tripId, orderId, userId, nowSync()]);
    const ex = await one<any>(`INSERT INTO exceptions (type, severity, plan_date, trip_id, order_id, outlet_id, title, detail, raised_by, raised_at) VALUES ('size_divergence', $1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [overCapacity ? 'high' : 'medium', t.plan_date, tripId, orderId, line.outlet_id, `${overCapacity ? 'Over capacity' : 'Size differs'} — ${t.vehicle_id} Trip ${t.trip_no}`,
        JSON.stringify({ planned, actual: { kg: body.actualKg, m3: body.actualM3 }, truck: { kg: tot.kg, m3: tot.m3, weightCap: Number(tot.weightCap), volumeCap: Number(tot.volumeCap) }, overCapacity, note: body.note ?? null, departs: t.depart, item: line.description }), userId, nowSync()], c);
    await notify(c, 'role:dispatcher', 'exception', `${overCapacity ? 'Over capacity' : 'Size differs'}: ${orderId} on ${t.vehicle_id}`,
      `Order said ${planned.kg} kg / ${planned.m3} m³; on the dock it is ${body.actualKg} kg / ${body.actualM3} m³.${overCapacity ? ` The truck is now ${Math.round(tot.kg)} of ${tot.weightCap} kg, ${tot.m3.toFixed(1)} of ${tot.volumeCap} m³ — decide before it leaves.` : ''}`,
      { tone: overCapacity ? 'red' : 'amber', link: `/d/exceptions?id=${ex.id}` });
    await audit(c, userId, 'load.size', `trip:${tripId}`, { orderId, ...body, overCapacity });
  });
  return tripDetail(tripId);
}
