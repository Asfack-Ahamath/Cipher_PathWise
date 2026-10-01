import { REASONS, toHHMM } from '@pathwise/core';
import { z } from 'zod';
import { audit, notify } from '../audit.js';
import { dayLabel, localDate, minutesOfDay, nowSync } from '../clock.js';
import { one, pool, q, tx, type Db } from '../db.js';
import { bad, conflict, forbidden, notFound } from '../errors.js';
import { getSettings } from '../lib/settings.js';
import { saveAttachment } from '../lib/storage.js';
import type { AuthUser } from '../auth.js';
import { activePlanDate, loadNetwork, nextOperatingDay, ORDER_COLS } from './network.js';
import { liveEta } from './live.js';

/* Estimated kg and m³ per unit, per category (the datasets have no product master). */
export const CATEGORIES = {
  Fresh: {
    ambient: [{ k: 'Dry grocery', kg: 22, m3: 0.14 }, { k: 'Beverages', kg: 26, m3: 0.12 }, { k: 'Household', kg: 12, m3: 0.15 }],
    chilled: [{ k: 'Dairy', kg: 28, m3: 0.19 }, { k: 'Meat and fish', kg: 30, m3: 0.2 }, { k: 'Fresh produce', kg: 25, m3: 0.22 }],
  },
  Style: { ambient: [{ k: 'Casualwear (cartons)', kg: 14, m3: 0.28 }, { k: 'Denim and trousers (cartons)', kg: 22, m3: 0.32 }, { k: 'Footwear (boxes)', kg: 16, m3: 0.36 }, { k: 'Hanging garments (rails)', kg: 9, m3: 0.45 }] },
  Tech: { ambient: [{ k: 'Double-door refrigerators', kg: 95, m3: 0.85 }, { k: '65" TVs', kg: 38, m3: 0.45 }, { k: 'Front-load washing machines', kg: 72, m3: 0.55 }, { k: 'Small appliances (cartons)', kg: 8, m3: 0.06 }] },
} as const;

const dayBefore = (d: string) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() - 1); return x.toISOString().slice(0, 10); };
async function cutoffFor(delivery: string) {
  const { operations } = await getSettings();
  return new Date(`${dayBefore(delivery)}T${operations.cutoffTime}:00+05:30`);
}

/** Which delivery day an order placed now goes to: the next operating day, unless it is after the cut-off. */
export async function orderWindow() {
  const now = nowSync();
  const { operations } = await getSettings();
  const planDate = await activePlanDate();
  const today = localDate(now);
  const base = today > planDate ? today : planDate;          // the plan date itself is already closed
  let delivery = await nextOperatingDay(base);
  let cutoffAt = await cutoffFor(delivery);
  let afterCutoff = false;
  if (now > cutoffAt) { afterCutoff = true; delivery = await nextOperatingDay(delivery); cutoffAt = await cutoffFor(delivery); }
  const skipped = await q<any>(`SELECT to_char(date,'YYYY-MM-DD') AS date, holiday FROM calendar WHERE date > $1 AND date < $2 AND NOT is_operating ORDER BY date`, [base, delivery]);
  const cal = await one<any>(`SELECT is_payday AS "isPayday", holiday, festival_ramp AS "festivalRamp", monsoon FROM calendar WHERE date = $1`, [delivery]);
  const upcoming = await q<any>(`SELECT to_char(date,'YYYY-MM-DD') AS date, is_operating AS "isOperating", holiday FROM calendar WHERE date >= $1 ORDER BY date LIMIT 7`, [delivery]);
  return { now: now.toISOString(), cutoffTime: operations.cutoffTime, deliveryDate: delivery, deliveryLabel: dayLabel(delivery), cutoffAt: cutoffAt.toISOString(), minutesLeft: Math.max(0, Math.round((cutoffAt.getTime() - now.getTime()) / 60000)), afterCutoff, skipped, calendar: cal, upcoming };
}

const Line = z.object({ category: z.string().min(1).max(60), units: z.number().int().min(0).max(500) });
export const OrderBody = z.object({
  temp: z.enum(['ambient', 'chilled']),
  lines: z.array(Line).min(1).max(20),
  note: z.string().trim().max(300).optional(),
});
export const OrderEditBody = z.object({ lines: z.array(Line).min(1).max(20), note: z.string().trim().max(300).optional() });

function sizeLines(brand: string, temp: string, lines: z.infer<typeof Line>[]) {
  const cats = (CATEGORIES as any)[brand]?.[temp] as { k: string; kg: number; m3: number }[] | undefined;
  if (!cats) throw bad(temp === 'chilled' ? 'Only Fresh outlets order chilled goods.' : 'This outlet cannot order these goods.');
  let units = 0, kg = 0, m3 = 0;
  const seen = new Set<string>();
  const out = lines.filter(l => l.units > 0).map(l => {
    const c = cats.find(x => x.k === l.category); if (!c) throw bad(`Unknown category "${l.category}".`);
    if (seen.has(l.category)) throw bad(`"${l.category}" is listed twice.`); seen.add(l.category);
    units += l.units; kg += l.units * c.kg; m3 += l.units * c.m3; return { category: l.category, units: l.units };
  });
  if (!units) throw bad('Add at least one item.');
  if (units > 2000) throw bad('That is more than one order can hold. Split it or call the dispatcher.');
  return { lines: out, units, kg: Math.max(1, Math.round(kg)), m3: Math.max(0.1, Math.round(m3 * 10) / 10), description: out.map(l => `${l.units} ${l.category}`).join(', ') };
}

export async function placeOrder(user: AuthUser, outletId: string, body: z.infer<typeof OrderBody>, source: 'app' | 'phone' = 'app') {
  const ot = await one<any>(`SELECT * FROM outlets WHERE id = $1`, [outletId]);
  if (!ot || ot.is_active === false) throw notFound('Outlet not found.');
  const s = sizeLines(ot.brand, body.temp, body.lines);
  const w = await orderWindow();
  return tx(async c => {
    // one ambient and one chilled order per outlet per delivery day — more is an edit, not a new order
    const dup = await one<any>(`SELECT id FROM orders WHERE outlet_id = $1 AND delivery_date = $2 AND temp = $3 AND status = 'confirmed' AND parent_order_id IS NULL`, [outletId, w.deliveryDate, body.temp], c);
    if (dup) throw conflict(`There is already a ${body.temp} order (${dup.id}) for ${w.deliveryLabel}. Edit that order instead.`, { orderId: dup.id });
    const n = (await one<{ n: number }>(`SELECT nextval('order_number')::int AS n`, [], c))!.n;
    const id = `ORD${String(n).padStart(7, '0')}`;
    await c.query(`INSERT INTO orders (id, outlet_id, delivery_date, temp, units, kg, m3, description, lines, note, source, status, submitted_at, after_cutoff, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'confirmed',$12,$13,$14)`,
      [id, outletId, w.deliveryDate, body.temp, s.units, s.kg, s.m3, s.description, JSON.stringify(s.lines), body.note ?? null, source, nowSync(), w.afterCutoff, user.id]);
    await notify(c, `outlet:${outletId}`, 'order_confirmed', `Order ${id} confirmed for ${w.deliveryLabel}`, `${s.units} ${body.temp} units · ~${s.kg} kg · ~${s.m3} m³.${w.afterCutoff ? ` It came after the ${w.cutoffTime} cutoff, so it goes on the following run.` : ''}${source === 'phone' ? ' Taken by phone by the dispatcher.' : ''}`, { tone: 'green', link: '/s/history' });
    await audit(c, user.id, 'order.place', `order:${id}`, { outletId, units: s.units, source });
    return { id, deliveryDate: w.deliveryDate, deliveryLabel: w.deliveryLabel, units: s.units, kg: s.kg, m3: s.m3, afterCutoff: w.afterCutoff };
  });
}

async function editableOrder(c: Db, user: AuthUser, orderId: string) {
  const o = await one<any>(`SELECT o.*, to_char(o.delivery_date,'YYYY-MM-DD') AS d, ot.brand FROM orders o JOIN outlets ot ON ot.id = o.outlet_id WHERE o.id = $1 FOR UPDATE OF o`, [orderId], c);
  if (!o) throw notFound('Order not found.');
  if (user.role === 'store_manager' && o.outlet_id !== user.outletId) throw notFound('Order not found.');
  if (o.status !== 'confirmed') throw conflict(`This order is ${o.status.replace(/_/g, ' ')} and can no longer be changed. Call the dispatcher.`);
  if (o.parent_order_id) throw conflict('This is the remainder of an earlier order and is managed by the dispatcher.');
  if (user.role === 'store_manager' && nowSync() > await cutoffFor(o.d)) throw conflict('Orders for this day closed at the cutoff. Call the dispatcher to change it.');
  const onLive = await one<any>(`SELECT 1 FROM trip_orders tor JOIN trips t ON t.id = tor.trip_id WHERE tor.order_id = $1 AND tor.moved_at IS NULL AND tor.load_status <> 'removed' AND t.status <> 'cancelled'`, [orderId], c);
  if (onLive) throw conflict('This order is already on a published trip. Change it on the plan board instead.');
  return o;
}

export async function updateOrder(user: AuthUser, orderId: string, body: z.infer<typeof OrderEditBody>) {
  return tx(async c => {
    const o = await editableOrder(c, user, orderId);
    const s = sizeLines(o.brand, o.temp, body.lines);
    await c.query(`UPDATE orders SET units = $2, kg = $3, m3 = $4, description = $5, lines = $6, note = $7 WHERE id = $1`, [orderId, s.units, s.kg, s.m3, s.description, JSON.stringify(s.lines), body.note ?? o.note]);
    await notify(c, `outlet:${o.outlet_id}`, 'order_changed', `Order ${orderId} updated`, `${s.units} units · ~${s.kg} kg · ~${s.m3} m³ for ${dayLabel(o.d)}.`, { tone: 'blue', link: '/s/history' });
    await audit(c, user.id, 'order.update', `order:${orderId}`, { from: { units: o.units }, to: { units: s.units } });
    return { id: orderId, units: s.units, kg: s.kg, m3: s.m3 };
  });
}

export async function cancelOrder(user: AuthUser, orderId: string, reason: string) {
  return tx(async c => {
    const o = await editableOrder(c, user, orderId);
    await c.query(`UPDATE orders SET status = 'cancelled', cancelled_at = $2, cancelled_by = $3, cancel_reason = $4 WHERE id = $1`, [orderId, nowSync(), user.id, reason]);
    // take it out of any draft plan
    await c.query(`UPDATE plans SET trips = (SELECT coalesce(jsonb_agg(jsonb_set(t, '{orderIds}', (SELECT coalesce(jsonb_agg(x), '[]') FROM jsonb_array_elements(t->'orderIds') x WHERE x #>> '{}' <> $2))), '[]') FROM jsonb_array_elements(trips) t)
      WHERE plan_date = $1 AND status = 'draft'`, [o.d, orderId]);
    await notify(c, `outlet:${o.outlet_id}`, 'order_cancelled', `Order ${orderId} cancelled`, reason, { tone: 'grey', link: '/s/history' });
    if (user.role === 'store_manager') await notify(c, 'role:dispatcher', 'order_cancelled', `${o.outlet_id} cancelled ${orderId}`, reason, { tone: 'grey', link: '/d/orders' });
    await audit(c, user.id, 'order.cancel', `order:${orderId}`, { reason });
    return { ok: true };
  });
}

/** The store's home: today's deliveries with honest ETAs, deferrals, what to confirm. */
export async function storeOverview(outletId: string) {
  const date = await activePlanDate();
  const net = await loadNetwork();
  const { operations } = await getSettings();
  const ot = net.outlets.get(outletId);
  if (!ot) throw notFound('Outlet not found.');
  const now = nowSync();
  const orders = await q<any>(`SELECT ${ORDER_COLS}, o.lines, o.note, (SELECT count(*) FROM receipts r WHERE r.order_id = o.id)::int AS receipts FROM orders o WHERE o.outlet_id = $1 AND o.delivery_date = $2 AND o.status <> 'cancelled' ORDER BY o.id`, [outletId, date]);
  // a Fresh outlet's ambient and chilled orders can travel on different vehicles
  const trips = await q<any>(`SELECT DISTINCT t.id, t.vehicle_id, t.trip_no, t.depart, t.status, to_char(t.plan_date,'YYYY-MM-DD') AS plan_date FROM trips t JOIN trip_orders tor ON tor.trip_id = t.id JOIN orders o ON o.id = tor.order_id
    WHERE t.plan_date = $1 AND o.outlet_id = $2 AND tor.moved_at IS NULL AND tor.load_status <> 'removed' AND t.status <> 'cancelled' ORDER BY t.depart`, [date, outletId]);
  const deliveries: any[] = [];
  for (const trip of trips) {
    const eta = await liveEta(net, trip, now);
    const stop = eta.stops.find(s => s.outletId === outletId);
    if (!stop) continue;
    const presence = await one<any>(`SELECT last_seen FROM vehicle_presence WHERE vehicle_id = $1`, [trip.vehicle_id]);
    const delivered = await one<any>(`SELECT e.device_time, e.received_at, e.payload, p.receiver, p.delivered_units FROM stop_events e LEFT JOIN pods p ON p.event_id = e.id WHERE e.trip_id = $1 AND e.outlet_id = $2 AND e.type = 'delivered' ORDER BY e.device_time DESC LIMIT 1`, [trip.id, outletId]);
    const lastSeen = presence?.last_seen ? new Date(presence.last_seen) : null;
    const offline = trip.status === 'in_progress' && (!lastSeen || now.getTime() - lastSeen.getTime() > operations.offlineAfterMin * 60000);
    const lines = await q<any>(`SELECT o.id, o.temp FROM trip_orders tor JOIN orders o ON o.id = tor.order_id WHERE tor.trip_id = $1 AND o.outlet_id = $2 AND tor.moved_at IS NULL AND tor.load_status <> 'removed'`, [trip.id, outletId]);
    deliveries.push({
      tripId: trip.id, vehicleId: trip.vehicle_id, trip: trip.trip_no, tripStatus: trip.status, stop: stop.seq, stops: eta.stops.length, orderIds: lines.map(l => l.id), temps: [...new Set(lines.map(l => l.temp))],
      plannedEta: stop.plannedHHMM, eta: stop.expectedArriveHHMM, delayMin: stop.delayMin, window: `${ot.open}–${ot.close}`, mallWindow: ot.mallWindow,
      late: stop.late, lateRisk: stop.lateRisk, hold: eta.hold,
      estimate: offline, lastUpdate: lastSeen?.toISOString() ?? null, handlingMin: net.allowance[ot.brand][ot.dock],
      delivered: delivered ? { at: toHHMM(minutesOfDay(new Date(delivered.device_time))), outcome: delivered.payload?.outcome, receiver: delivered.receiver ?? null, syncedAt: delivered.received_at, driverUnits: delivered.delivered_units ?? {} } : null,
      driverName: net.vehicles.get(trip.vehicle_id)?.driverName ?? null,
    });
  }
  const deferrals = await q<any>(`SELECT d.id, d.order_id AS "orderId", d.reason, d.kind, d.why, d.units, to_char(d.from_date,'YYYY-MM-DD') AS "fromDate", to_char(d.to_date,'YYYY-MM-DD') AS "toDate", d.created_at AS "createdAt", d.acknowledged_at AS "acknowledgedAt", d.escalated,
      o.temp, o.units AS "orderUnits", o.description FROM deferrals d JOIN orders o ON o.id = d.order_id WHERE o.outlet_id = $1 AND d.to_date >= $2::date - 7 ORDER BY d.created_at DESC`, [outletId, date]);
  const driverUnitsFor = (orderId: string) => { for (const d of deliveries) if (d.delivered?.driverUnits && orderId in d.delivered.driverUnits) return d.delivered.driverUnits[orderId]; return null; };
  const deliveredAt = (orderId: string) => deliveries.find(d => d.orderIds.includes(orderId))?.delivered?.syncedAt ?? null;
  const toConfirm = orders.filter(o => ['delivered', 'partial'].includes(o.status) && !o.receipts).map(o => {
    const at = deliveredAt(o.id);
    return { ...o, driverUnits: driverUnitsFor(o.id), overdue: !!at && now.getTime() - new Date(at).getTime() > operations.receiptConfirmHours * 3600_000 };
  });
  const upcoming = await q<any>(`SELECT ${ORDER_COLS}, o.lines, o.note FROM orders o WHERE o.outlet_id = $1 AND o.delivery_date > $2 AND o.status = 'confirmed' AND o.parent_order_id IS NULL ORDER BY o.delivery_date, o.id`, [outletId, date]);
  const window = await orderWindow();
  return {
    date, dateLabel: dayLabel(date), now: now.toISOString(), outlet: ot, orders, deliveries, delivery: deliveries[0] ?? null,
    deferrals: deferrals.map(d => ({ ...d, reasonLabel: REASONS[d.reason as keyof typeof REASONS]?.label ?? d.reason, storeText: REASONS[d.reason as keyof typeof REASONS]?.store ?? d.why, toLabel: dayLabel(d.toDate) })),
    toConfirm, receiptConfirmHours: operations.receiptConfirmHours,
    upcoming: await Promise.all(upcoming.map(async o => ({ ...o, dateLabel: dayLabel(o.date), editable: now < await cutoffFor(o.date) }))),
    window,
    categories: (CATEGORIES as any)[ot.brand],
  };
}

export async function ackDeferral(outletId: string, id: number, userId: number) {
  const r = await one<any>(`UPDATE deferrals d SET acknowledged_at = coalesce(acknowledged_at, $3) FROM orders o WHERE d.id = $1 AND o.id = d.order_id AND o.outlet_id = $2 RETURNING d.id`, [id, outletId, nowSync()]);
  if (!r) throw notFound('Deferral not found.');
  await audit(pool, userId, 'deferral.ack', `deferral:${id}`);
  return { ok: true };
}

export const ReceiptBody = z.object({
  orderId: z.string(),
  lines: z.array(z.object({ orderId: z.string(), status: z.enum(['ok', 'short', 'damaged', 'temperature']), received: z.number().int().min(0).max(100000), expected: z.number().int().min(0).max(100000) })).min(1).max(10),
  note: z.string().trim().max(500).optional(),
  photos: z.array(z.string().max(7_500_000)).max(3).optional(),
});

export async function confirmReceipt(user: AuthUser, outletId: string, body: z.infer<typeof ReceiptBody>) {
  for (const l of body.lines) {
    if (l.status === 'ok' && l.received !== l.expected) throw bad(`${l.orderId}: "All OK" means ${l.expected} received. Choose Short or Damaged if not.`);
    if (l.status !== 'ok' && l.received > l.expected) throw bad(`${l.orderId}: received cannot be more than was sent.`);
  }
  const issues = body.lines.filter(l => l.status !== 'ok');
  if (issues.length && !body.note && !body.photos?.length && issues.some(i => i.status === 'damaged')) throw bad('For damaged goods add a photo or a short note.');
  return tx(async c => {
    const ids = [...new Set(body.lines.map(l => l.orderId))];
    const rows = await q<any>(`SELECT id, status, to_char(delivery_date,'YYYY-MM-DD') AS d FROM orders WHERE id = ANY($1) AND outlet_id = $2 FOR UPDATE`, [ids, outletId], c);
    if (rows.length !== ids.length) throw notFound('Order not found for this outlet.');
    if (rows.some(r => !['delivered', 'partial'].includes(r.status))) throw conflict('Only delivered orders can be confirmed, and each only once.');
    const photoIds: string[] = [];
    for (const p of body.photos ?? []) photoIds.push(await saveAttachment(c, p, { kind: 'receipt_photo', outletId, userId: user.id }));
    // the driver's count is kept next to the store's — neither overwrites the other
    const pods = await q<any>(`SELECT p.delivered_units FROM pods p JOIN trip_orders tor ON tor.trip_id = p.trip_id WHERE tor.order_id = ANY($1) AND p.outlet_id = $2`, [ids, outletId], c);
    const driverCount = (id: string) => { for (const p of pods) if (p.delivered_units && id in p.delivered_units) return Number(p.delivered_units[id]); return null; };
    for (const id of ids) {
      const ls = body.lines.filter(l => l.orderId === id).map(l => ({ ...l, driverUnits: driverCount(id) }));
      await c.query(`INSERT INTO receipts (order_id, outlet_id, lines, status, confirmed_by, confirmed_at, attachment_ids) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [id, outletId, JSON.stringify(ls), ls.some(l => l.status !== 'ok') ? 'issue' : 'ok', user.id, nowSync(), JSON.stringify(photoIds)]);
      await c.query(`UPDATE orders SET status = $2 WHERE id = $1`, [id, ls.some(l => l.status !== 'ok') ? 'disputed' : 'received']);
    }
    if (issues.length) {
      const detail = issues.map(i => ({ ...i, driverUnits: driverCount(i.orderId) }));
      await c.query(`INSERT INTO exceptions (type, severity, plan_date, order_id, outlet_id, title, detail, raised_by, raised_at) VALUES ('receipt_issue','medium',$1,$2,$3,$4,$5,$6,$7)`,
        [rows[0].d, issues[0].orderId, outletId, `${outletId} reported ${[...new Set(issues.map(i => i.status === 'temperature' ? 'too warm' : i.status))].join(', ')} on receipt`, JSON.stringify({ lines: detail, note: body.note ?? null, photoIds }), user.id, nowSync()]);
      await notify(c, 'role:dispatcher', 'exception', `Receipt issue at ${outletId}`, detail.map(i => `${i.orderId}: ${i.status} (${i.received}/${i.expected}${i.driverUnits != null ? `, driver says ${i.driverUnits}` : ''})`).join(' · '), { tone: 'amber', link: '/d/exceptions' });
    }
    await audit(c, user.id, 'receipt.confirm', `outlet:${outletId}`, { ids, issues: issues.length, photos: photoIds.length });
    return { ok: true, issues: issues.length };
  });
}

export const HistoryQuery = z.object({ temp: z.enum(['ambient', 'chilled']).optional(), status: z.enum(['delivered', 'deferred', 'issue', 'cancelled']).optional(), days: z.coerce.number().int().min(1).max(365).default(30) });
export async function storeHistory(outletId: string, f: z.infer<typeof HistoryQuery> = { days: 30 }) {
  const date = await activePlanDate();
  const rows = await q<any>(`SELECT ${ORDER_COLS}, o.cancel_reason AS "cancelReason", (SELECT json_agg(json_build_object('reason', d.reason, 'toDate', to_char(d.to_date,'YYYY-MM-DD'), 'units', d.units, 'kind', d.kind)) FROM deferrals d WHERE d.order_id = o.id) AS deferrals,
      (SELECT json_build_object('status', r.status, 'lines', r.lines, 'at', r.confirmed_at) FROM receipts r WHERE r.order_id = o.id ORDER BY id DESC LIMIT 1) AS receipt
    FROM orders o WHERE o.outlet_id = $1 AND o.delivery_date >= $2::date - $3::int AND ($4::text IS NULL OR o.temp = $4) ORDER BY o.delivery_date DESC, o.id`, [outletId, date, f.days, f.temp ?? null]);
  const filtered = rows.filter(r => !f.status || (f.status === 'delivered' ? ['delivered', 'received', 'partial'].includes(r.status) : f.status === 'deferred' ? !!r.deferrals : f.status === 'issue' ? r.status === 'disputed' : r.status === 'cancelled'));
  const done = rows.filter(r => ['delivered', 'received', 'partial', 'disputed'].includes(r.status));
  return { orders: filtered.map(r => ({ ...r, dateLabel: dayLabel(r.date) })), stats: { orders: rows.length, delivered: done.length, deferred: rows.filter(r => r.deferrals).length, issues: rows.filter(r => r.status === 'disputed').length, onTimeShare: null } };
}

export async function storePod(user: AuthUser, orderId: string) {
  const r = await one<any>(`SELECT p.receiver, p.photo_id AS "photoId", p.signature_id AS "signatureId", p.photo, p.signature, p.device_time AS "at", p.delivered_units AS "deliveredUnits", e.payload->>'outcome' AS outcome
    FROM pods p JOIN stop_events e ON e.id = p.event_id JOIN trip_orders tor ON tor.trip_id = p.trip_id JOIN orders o ON o.id = tor.order_id AND o.outlet_id = p.outlet_id
    WHERE o.id = $1 AND ($2::text IS NULL OR o.outlet_id = $2) ORDER BY p.id DESC LIMIT 1`, [orderId, user.role === 'store_manager' ? user.outletId : null]);
  if (!r && user.role === 'store_manager') {
    const own = await one(`SELECT 1 FROM orders WHERE id = $1 AND outlet_id = $2`, [orderId, user.outletId]);
    if (!own) throw forbidden();
  }
  if (!r) return {};
  return { receiver: r.receiver, at: r.at, outcome: r.outcome, deliveredUnits: r.deliveredUnits, photoUrl: r.photoId ? `/api/files/${r.photoId}` : r.photo, signatureUrl: r.signatureId ? `/api/files/${r.signatureId}` : r.signature };
}
