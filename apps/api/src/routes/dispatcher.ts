import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { dayLabel } from '../clock.js';
import { q } from '../db.js';
import { listExceptions, resolve, ResolveBody } from '../services/exceptions.js';
import { activePlanDate, ORDER_COLS } from '../services/network.js';
import { discardDraft, LiveMoveBody, MoveBody, moveInDraft, moveOptions, moveStopLive, planVersions, planView, publish, runAutoPlan } from '../services/plans.js';
import { cancelOrder, OrderBody, OrderEditBody, placeOrder, updateOrder } from '../services/store.js';
import { tripDetail } from '../services/trips.js';
import { updateVehicle } from '../services/admin.js';
import { forecast, overview, peakDay, peakDayCsv, tracking } from '../services/views.js';
import { assertTripAccess, DateParam, guard, IdParam, parse, params } from './util.js';

const csvCell = (v: unknown) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const toCsv = (rows: Record<string, unknown>[], cols: string[]) => [cols.join(','), ...rows.map(r => cols.map(c => csvCell(r[c])).join(','))].join('\n') + '\n';
const DateQuery = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() });

async function ordersFor(date: string) {
  return q<any>(`SELECT ${ORDER_COLS}, o.note, o.lines, ot.brand, ot.district, ot.depot, ot.dock, ot.van_only AS "vanOnly", ot.mall_window AS "mallWindow", ot.open_time AS open, ot.close_time AS close,
      (SELECT t.vehicle_id || ' · Trip ' || t.trip_no FROM trip_orders tor JOIN trips t ON t.id = tor.trip_id WHERE tor.order_id = o.id AND tor.moved_at IS NULL AND tor.load_status <> 'removed' AND t.status <> 'cancelled' LIMIT 1) AS placement,
      (SELECT json_build_object('reason', d.reason, 'kind', d.kind, 'toDate', to_char(d.to_date,'YYYY-MM-DD')) FROM deferrals d WHERE d.order_id = o.id AND d.from_date = $1 LIMIT 1) AS deferral
    FROM orders o JOIN outlets ot ON ot.id = o.outlet_id
    WHERE (o.delivery_date = $1 OR o.id IN (SELECT order_id FROM deferrals WHERE from_date = $1)) AND o.status <> 'cancelled' ORDER BY o.id`, [date]);
}

export async function dispatcherRoutes(app: FastifyInstance) {
  const D = guard.office;
  app.get('/api/overview', D, async () => overview());
  app.get('/api/tracking', D, async () => tracking());
  app.get('/api/forecast', D, async () => forecast());
  app.get('/api/peak-day', D, async () => peakDay());
  app.get('/api/peak-day.csv', D, async (_req, reply) => reply.type('text/csv; charset=utf-8').header('Content-Disposition', 'attachment; filename="submission_task2b.csv"').send(peakDayCsv(await peakDay())));

  /* orders */
  app.get('/api/orders', D, async req => {
    const date = parse(DateQuery, req.query).date ?? await activePlanDate();
    const late = await q<any>(`SELECT ${ORDER_COLS} FROM orders o WHERE o.after_cutoff AND o.submitted_at::date <= $1 AND o.delivery_date > $1 AND o.status <> 'cancelled' ORDER BY o.submitted_at`, [date]);
    const cancelled = await q<any>(`SELECT ${ORDER_COLS}, o.cancel_reason AS "cancelReason", o.cancelled_at AS "cancelledAt" FROM orders o WHERE o.delivery_date = $1 AND o.status = 'cancelled' ORDER BY o.cancelled_at DESC`, [date]);
    return { date, dateLabel: dayLabel(date), orders: await ordersFor(date), afterCutoff: late, cancelled };
  });
  app.get('/api/orders.csv', D, async (req, reply) => {
    const date = parse(DateQuery, req.query).date ?? await activePlanDate();
    const rows = await ordersFor(date);
    return reply.type('text/csv; charset=utf-8').header('Content-Disposition', `attachment; filename="pathwise-orders-${date}.csv"`)
      .send(toCsv(rows.map(r => ({ ...r, deferredTo: r.deferral?.toDate ?? '', deferralReason: r.deferral?.reason ?? '' })), ['id', 'outletId', 'brand', 'district', 'depot', 'temp', 'units', 'kg', 'm3', 'status', 'source', 'placement', 'deferredTo', 'deferralReason', 'description']));
  });
  app.post('/api/orders/phone', D, async req => {
    const b = parse(OrderBody.extend({ outletId: z.string().regex(/^OUT\d{3}$/, 'Pick the outlet.') }), req.body);
    return placeOrder(req.user, b.outletId, b, 'phone');
  });
  app.patch('/api/orders/:orderId', D, async req => updateOrder(req.user, params(req).orderId, parse(OrderEditBody, req.body)));
  app.post('/api/orders/:orderId/cancel', D, async req => cancelOrder(req.user, params(req).orderId, parse(z.object({ reason: z.string().trim().min(3, 'Say why the order is cancelled.').max(300) }), req.body).reason));

  /* plans */
  app.get('/api/plans/:date', D, async req => planView(parse(DateParam, req.params).date));
  app.get('/api/plans/:date/versions', D, async req => planVersions(parse(DateParam, req.params).date));
  app.post('/api/plans/:date/auto', D, async req => { const { date } = parse(DateParam, req.params); const stats = await runAutoPlan(date, req.user.id); return { stats, view: await planView(date) }; });
  app.post('/api/plans/:date/move', D, async req => {
    const { date } = parse(DateParam, req.params);
    const b = parse(MoveBody, req.body);
    await moveInDraft(date, req.user.id, b.orderId, b.target, b.reason as any);
    return planView(date);
  });
  app.delete('/api/plans/:date/draft', D, async req => { const { date } = parse(DateParam, req.params); await discardDraft(date, req.user.id); return planView(date); });
  app.post('/api/plans/:date/publish', D, async req => { const { date } = parse(DateParam, req.params); const r = await publish(date, req.user.id); return { ...r, view: await planView(date) }; });

  /* the day */
  app.get('/api/trips/:id', guard.any, async req => { const { id } = parse(IdParam, req.params); await assertTripAccess(req.user, id); return tripDetail(id); });
  app.get('/api/trips/:id/move-options', D, async req => {
    const { id } = parse(IdParam, req.params);
    const { outletId } = parse(z.object({ outletId: z.string().regex(/^OUT\d{3}$/) }), req.query);
    return moveOptions(await activePlanDate(), id, outletId);
  });
  app.post('/api/trips/:id/move-stop', D, async req => {
    const { id } = parse(IdParam, req.params);
    const b = parse(LiveMoveBody, req.body);
    return moveStopLive(await activePlanDate(), req.user.id, id, b.outletId, b.to, b.reason);
  });
  app.get('/api/deferrals', D, async req => {
    const date = parse(DateQuery, req.query).date ?? await activePlanDate();
    const today = await q<any>(`SELECT d.*, to_char(d.from_date,'YYYY-MM-DD') AS "fromDate", to_char(d.to_date,'YYYY-MM-DD') AS "toDate", o.outlet_id AS "outletId", o.temp, o.units AS "orderUnits", o.kg, o.m3, o.description, ot.brand, ot.district
      FROM deferrals d JOIN orders o ON o.id = d.order_id JOIN outlets ot ON ot.id = o.outlet_id WHERE d.from_date = $1 ORDER BY d.kind, d.id`, [date]);
    const history = await q<any>(`SELECT to_char(d.from_date,'YYYY-MM-DD') AS "fromDate", to_char(d.to_date,'YYYY-MM-DD') AS "toDate", d.order_id AS "orderId", o.outlet_id AS "outletId", d.reason, d.kind, d.why,
        (SELECT o2.status FROM orders o2 WHERE o2.outlet_id = o.outlet_id AND o2.delivery_date = d.to_date AND o2.temp = o.temp ORDER BY o2.id LIMIT 1) AS "nextStatus"
      FROM deferrals d JOIN orders o ON o.id = d.order_id WHERE d.from_date < $1 ORDER BY d.from_date DESC LIMIT 50`, [date]);
    const protectedOutlets = await q<any>(`SELECT DISTINCT o.outlet_id AS "outletId" FROM orders o WHERE o.delivery_date = $1 AND o.deferred_yesterday AND o.status NOT IN ('deferred','cancelled') AND o.parent_order_id IS NULL`, [date]);
    return { date, dateLabel: dayLabel(date), deferrals: today, history, protectedOutlets: protectedOutlets.map(p => p.outletId) };
  });
  app.get('/api/exceptions', D, async () => listExceptions(await activePlanDate()));
  app.post('/api/exceptions/:id/resolve', D, async req => resolve(parse(IdParam, req.params).id, req.user.id, parse(ResolveBody, req.body)));
  /** Dispatchers take a vehicle in or out of service; full fleet edits are in Admin. */
  app.patch('/api/vehicles/:id', D, async req => {
    const b = parse(z.object({ status: z.enum(['available', 'in_workshop']), note: z.string().trim().max(120).optional() }), req.body);
    return updateVehicle(req.user, params(req).id, { status: b.status, statusNote: b.note ?? null });
  });
}
