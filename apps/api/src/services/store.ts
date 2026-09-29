import { REASONS, scheduleTrip, toHHMM, toMin, type Order } from '@pathwise/core';
import { z } from 'zod';
import { audit, notify } from '../audit.js';
import { dayLabel, localDate, minutesOfDay, nowSync } from '../clock.js';
import { one, pool, q, tx } from '../db.js';
import { bad, conflict, notFound } from '../errors.js';
import { activePlanDate, loadNetwork, nextOperatingDay, ORDER_COLS } from './network.js';

/* Estimated kg and m³ per unit, per category (the datasets have no product master). */
export const CATEGORIES = {
  Fresh: {
    ambient: [{ k: 'Dry grocery', kg: 22, m3: 0.14 }, { k: 'Beverages', kg: 26, m3: 0.12 }, { k: 'Household', kg: 12, m3: 0.15 }],
    chilled: [{ k: 'Dairy', kg: 28, m3: 0.19 }, { k: 'Meat and fish', kg: 30, m3: 0.2 }, { k: 'Fresh produce', kg: 25, m3: 0.22 }],
  },
  Style: { ambient: [{ k: 'Casualwear (cartons)', kg: 14, m3: 0.28 }, { k: 'Denim and trousers (cartons)', kg: 22, m3: 0.32 }, { k: 'Footwear (boxes)', kg: 16, m3: 0.36 }, { k: 'Hanging garments (rails)', kg: 9, m3: 0.45 }] },
  Tech: { ambient: [{ k: 'Double-door refrigerators', kg: 95, m3: 0.85 }, { k: '65" TVs', kg: 38, m3: 0.45 }, { k: 'Front-load washing machines', kg: 72, m3: 0.55 }, { k: 'Small appliances (cartons)', kg: 8, m3: 0.06 }] },
} as const;

/** Which delivery day an order placed now goes to: the next operating day, unless it is after 16:00. */
export async function orderWindow() {
  const now = nowSync();
  const planDate = await activePlanDate();
  const today = localDate(now);
  const base = today > planDate ? today : planDate;          // the plan date itself is already closed
  const dayBefore = (d: string) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() - 1); return x.toISOString().slice(0, 10); };
  let delivery = await nextOperatingDay(base);
  let cutoffAt = new Date(`${dayBefore(delivery)}T16:00:00+05:30`); // orders close at 16:00 the day before
  let afterCutoff = false;
  if (now > cutoffAt) { afterCutoff = true; delivery = await nextOperatingDay(delivery); cutoffAt = new Date(`${dayBefore(delivery)}T16:00:00+05:30`); }
  const skipped = await q<any>(`SELECT to_char(date,'YYYY-MM-DD') AS date, holiday FROM calendar WHERE date > $1 AND date < $2 AND NOT is_operating ORDER BY date`, [base, delivery]);
  const cal = await one<any>(`SELECT is_payday AS "isPayday", holiday, festival_ramp AS "festivalRamp", monsoon FROM calendar WHERE date = $1`, [delivery]);
  const upcoming = await q<any>(`SELECT to_char(date,'YYYY-MM-DD') AS date, is_operating AS "isOperating", holiday FROM calendar WHERE date >= $1 ORDER BY date LIMIT 7`, [delivery]);
  return { now: now.toISOString(), deliveryDate: delivery, deliveryLabel: dayLabel(delivery), cutoffAt: cutoffAt.toISOString(), minutesLeft: Math.max(0, Math.round((cutoffAt.getTime() - now.getTime()) / 60000)), afterCutoff, skipped, calendar: cal, upcoming };
}

export const OrderBody = z.object({
  temp: z.enum(['ambient', 'chilled']),
  lines: z.array(z.object({ category: z.string(), units: z.number().int().min(0).max(500) })).min(1),
  note: z.string().max(300).optional(),
});

export async function placeOrder(userId: number, outletId: string, body: z.infer<typeof OrderBody>) {
  const ot = await one<any>(`SELECT * FROM outlets WHERE id = $1`, [outletId]);
  if (!ot) throw notFound('Outlet not found.');
  if (body.temp === 'chilled' && ot.brand !== 'Fresh') throw bad('Only Fresh outlets order chilled goods.');
  const cats = (CATEGORIES as any)[ot.brand][body.temp] as { k: string; kg: number; m3: number }[];
  let units = 0, kg = 0, m3 = 0;
  const lines = body.lines.filter(l => l.units > 0).map(l => {
    const c = cats.find(x => x.k === l.category); if (!c) throw bad(`Unknown category ${l.category}.`);
    units += l.units; kg += l.units * c.kg; m3 += l.units * c.m3; return { category: l.category, units: l.units };
  });
  if (!units) throw bad('Add at least one item.');
  const w = await orderWindow();
  return tx(async c => {
    const n = (await one<{ n: number }>(`SELECT nextval('order_number')::int AS n`, [], c))!.n;
    const id = `ORD${String(n).padStart(7, '0')}`;
    await c.query(`INSERT INTO orders (id, outlet_id, delivery_date, temp, units, kg, m3, description, lines, source, status, submitted_at, after_cutoff, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'app','confirmed',$10,$11,$12)`,
      [id, outletId, w.deliveryDate, body.temp, units, Math.round(kg), Math.round(m3 * 10) / 10, lines.map(l => `${l.units} ${l.category}`).join(', '), JSON.stringify(lines), nowSync(), w.afterCutoff, userId]);
    await notify(c, `outlet:${outletId}`, 'order_confirmed', `Order ${id} confirmed for ${w.deliveryLabel}`, `${units} ${body.temp} units · ~${Math.round(kg)} kg · ~${(Math.round(m3 * 10) / 10)} m³.${w.afterCutoff ? ' It came after the 16:00 cutoff, so it goes on the following run.' : ''}`, { tone: 'green', link: '/s/history' });
    await audit(c, userId, 'order.place', `order:${id}`, { outletId, units });
    return { id, deliveryDate: w.deliveryDate, deliveryLabel: w.deliveryLabel, units, kg: Math.round(kg), m3: Math.round(m3 * 10) / 10, afterCutoff: w.afterCutoff };
  });
}

/** The store's home: today's delivery with an honest ETA, deferrals, what to confirm. */
export async function storeOverview(outletId: string) {
  const date = await activePlanDate();
  const net = await loadNetwork();
  const ot = net.outlets.get(outletId);
  if (!ot) throw notFound('Outlet not found.');
  const now = nowSync();
  const orders = await q<any>(`SELECT ${ORDER_COLS}, (SELECT count(*) FROM receipts r WHERE r.order_id = o.id)::int AS receipts FROM orders o WHERE o.outlet_id = $1 AND o.delivery_date = $2 AND o.status <> 'cancelled' ORDER BY o.id`, [outletId, date]);
  // the stop for this outlet in today's live plan
  const trip = await one<any>(`SELECT t.* FROM trips t JOIN trip_orders tor ON tor.trip_id = t.id JOIN orders o ON o.id = tor.order_id
    WHERE t.plan_date = $1 AND o.outlet_id = $2 AND tor.moved_at IS NULL AND tor.load_status <> 'removed' AND t.status <> 'cancelled' ORDER BY t.id DESC LIMIT 1`, [date, outletId]);
  let delivery: any = null;
  if (trip) {
    const tripOrders = await q<any>(`SELECT o.id, o.outlet_id AS "outletId", o.temp, o.units, o.kg, o.m3 FROM trip_orders tor JOIN orders o ON o.id = tor.order_id WHERE tor.trip_id = $1 AND tor.moved_at IS NULL AND tor.load_status <> 'removed' ORDER BY tor.seq`, [trip.id]);
    const om = new Map<string, Order>(tripOrders.map((o: any) => [o.id, { ...o, date }]));
    const s = scheduleTrip(net, { vehicleId: trip.vehicle_id, trip: trip.trip_no, depart: trip.depart, orderIds: tripOrders.map((o: any) => o.id) }, om);
    const stop = s.stops.find(x => x.outletId === outletId)!;
    const events = await q<any>(`SELECT type, outlet_id, device_time, received_at, payload FROM stop_events WHERE trip_id = $1 ORDER BY device_time`, [trip.id]);
    const presence = await one<any>(`SELECT last_seen FROM vehicle_presence WHERE vehicle_id = $1`, [trip.vehicle_id]);
    const delivered = events.find(e => e.type === 'delivered' && e.outlet_id === outletId);
    const lastSeen = presence?.last_seen ? new Date(presence.last_seen) : null;
    const offline = trip.status === 'in_progress' && (!lastSeen || now.getTime() - lastSeen.getTime() > 10 * 60000);
    // carry the delay of the last synced stop forward
    const lastDone = [...events].reverse().find(e => e.type === 'delivered');
    let delay = 0;
    if (lastDone) { const ps = s.stops.find(x => x.outletId === lastDone.outlet_id); if (ps) delay = Math.max(0, minutesOfDay(new Date(lastDone.device_time)) - ps.leave); }
    const pod = delivered ? await one<any>(`SELECT receiver FROM pods WHERE trip_id = $1 AND outlet_id = $2 ORDER BY id DESC LIMIT 1`, [trip.id, outletId]) : null;
    delivery = {
      tripId: trip.id, vehicleId: trip.vehicle_id, trip: trip.trip_no, tripStatus: trip.status, stop: stop.seq, stops: s.stops.length,
      plannedEta: toHHMM(stop.arrive), eta: toHHMM(stop.arrive + delay), delayMin: delay, window: `${ot.open}–${ot.close}`, mallWindow: ot.mallWindow,
      estimate: offline, lastUpdate: lastSeen?.toISOString() ?? null, handlingMin: stop.allowance,
      delivered: delivered ? { at: toHHMM(minutesOfDay(new Date(delivered.device_time))), outcome: delivered.payload.outcome, receiver: pod?.receiver ?? null, syncedAt: delivered.received_at } : null,
      driverName: net.vehicles.get(trip.vehicle_id)?.driverName ?? null,
    };
  }
  const deferrals = await q<any>(`SELECT d.id, d.order_id AS "orderId", d.reason, d.kind, d.why, d.units, to_char(d.from_date,'YYYY-MM-DD') AS "fromDate", to_char(d.to_date,'YYYY-MM-DD') AS "toDate", d.created_at AS "createdAt", d.acknowledged_at AS "acknowledgedAt", d.escalated,
      o.temp, o.units AS "orderUnits", o.description FROM deferrals d JOIN orders o ON o.id = d.order_id WHERE o.outlet_id = $1 AND d.to_date >= $2::date - 7 ORDER BY d.created_at DESC`, [outletId, date]);
  return {
    date, dateLabel: dayLabel(date), now: now.toISOString(), outlet: ot, orders, delivery,
    deferrals: deferrals.map(d => ({ ...d, reasonLabel: REASONS[d.reason as keyof typeof REASONS]?.label ?? d.reason, storeText: REASONS[d.reason as keyof typeof REASONS]?.store ?? d.why, toLabel: dayLabel(d.toDate) })),
    toConfirm: orders.filter(o => ['delivered', 'partial'].includes(o.status) && !o.receipts),
    window: await orderWindow(),
    categories: (CATEGORIES as any)[ot.brand],
  };
}

export async function ackDeferral(outletId: string, id: number, userId: number) {
  const r = await one<any>(`UPDATE deferrals d SET acknowledged_at = $3 FROM orders o WHERE d.id = $1 AND o.id = d.order_id AND o.outlet_id = $2 RETURNING d.id`, [id, outletId, nowSync()]);
  if (!r) throw notFound('Deferral not found.');
  await audit(pool, userId, 'deferral.ack', `deferral:${id}`);
  return { ok: true };
}

export const ReceiptBody = z.object({ orderId: z.string(), lines: z.array(z.object({ orderId: z.string(), status: z.enum(['ok', 'short', 'damaged', 'temperature']), received: z.number().int().min(0), expected: z.number().int().min(0) })).min(1), note: z.string().max(500).optional() });

export async function confirmReceipt(userId: number, outletId: string, body: z.infer<typeof ReceiptBody>) {
  return tx(async c => {
    const ids = [...new Set(body.lines.map(l => l.orderId))];
    const rows = await q<any>(`SELECT id, status, to_char(delivery_date,'YYYY-MM-DD') AS d FROM orders WHERE id = ANY($1) AND outlet_id = $2`, [ids, outletId], c);
    if (rows.length !== ids.length) throw notFound('Order not found for this outlet.');
    if (rows.some(r => !['delivered', 'partial', 'failed'].includes(r.status))) throw conflict('Only delivered orders can be confirmed.');
    const issues = body.lines.filter(l => l.status !== 'ok');
    for (const id of ids) {
      const ls = body.lines.filter(l => l.orderId === id);
      await c.query(`INSERT INTO receipts (order_id, outlet_id, lines, status, confirmed_by, confirmed_at) VALUES ($1,$2,$3,$4,$5,$6)`, [id, outletId, JSON.stringify(ls), ls.some(l => l.status !== 'ok') ? 'issue' : 'ok', userId, nowSync()]);
      await c.query(`UPDATE orders SET status = $2 WHERE id = $1`, [id, ls.some(l => l.status !== 'ok') ? 'disputed' : 'received']);
    }
    if (issues.length) {
      await c.query(`INSERT INTO exceptions (type, severity, plan_date, order_id, outlet_id, title, detail, raised_by, raised_at) VALUES ('receipt_issue','medium',$1,$2,$3,$4,$5,$6,$7)`,
        [rows[0].d, issues[0].orderId, outletId, `${outletId} reported ${issues.map(i => i.status).join(', ')} on receipt`, JSON.stringify({ lines: issues, note: body.note ?? null }), userId, nowSync()]);
      await notify(c, 'role:dispatcher', 'exception', `Receipt issue at ${outletId}`, issues.map(i => `${i.orderId}: ${i.status} (${i.received}/${i.expected})`).join(' · '), { tone: 'amber', link: '/d/exceptions' });
    }
    await audit(c, userId, 'receipt.confirm', `outlet:${outletId}`, { ids, issues: issues.length });
    return { ok: true, issues: issues.length };
  });
}

export async function storeHistory(outletId: string) {
  const rows = await q<any>(`SELECT ${ORDER_COLS}, (SELECT json_agg(json_build_object('reason', d.reason, 'toDate', to_char(d.to_date,'YYYY-MM-DD'), 'units', d.units)) FROM deferrals d WHERE d.order_id = o.id) AS deferrals,
      (SELECT status FROM receipts r WHERE r.order_id = o.id ORDER BY id DESC LIMIT 1) AS receipt
    FROM orders o WHERE o.outlet_id = $1 AND o.delivery_date >= (SELECT (value #>> '{}')::date - 30 FROM settings WHERE key = 'plan_date') ORDER BY o.delivery_date DESC, o.id`, [outletId]);
  const done = rows.filter(r => ['delivered', 'received', 'partial', 'disputed'].includes(r.status));
  const deferred = rows.filter(r => r.deferrals);
  return { orders: rows.map(r => ({ ...r, dateLabel: dayLabel(r.date) })), stats: { orders: rows.length, delivered: done.length, deferred: deferred.length, issues: rows.filter(r => r.status === 'disputed').length } };
}
