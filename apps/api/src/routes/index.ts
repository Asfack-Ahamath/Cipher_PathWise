import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { REASONS } from '@pathwise/core';
import { authenticate, login, loginWithPin, requireRole } from '../auth.js';
import { audit } from '../audit.js';
import { dayLabel, loadClock, nowSync, setClock } from '../clock.js';
import { one, pool, q } from '../db.js';
import { bad } from '../errors.js';
import { resetDay } from '../seed/seed.js';
import { myRun, sync, SyncBody } from '../services/driver.js';
import { listExceptions, resolve } from '../services/exceptions.js';
import { acknowledge, dockQueue, flagLine, release, reportFault, setLine } from '../services/loader.js';
import { activePlanDate, ORDER_COLS } from '../services/network.js';
import { discardDraft, moveInDraft, moveOptions, moveStopLive, planView, publish, runAutoPlan } from '../services/plans.js';
import { ackDeferral, confirmReceipt, OrderBody, orderWindow, placeOrder, ReceiptBody, storeHistory, storeOverview } from '../services/store.js';
import { tripDetail } from '../services/trips.js';
import { forecast, markRead, myNotifications, overview, reference, tracking } from '../services/views.js';

const parse = <T extends z.ZodTypeAny>(schema: T, data: unknown): z.infer<T> => {
  const r = schema.safeParse(data);
  if (!r.success) throw bad(r.error.issues.map(i => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '));
  return r.data;
};
const dateParam = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export async function routes(app: FastifyInstance) {
  const D = { preHandler: requireRole('dispatcher') };
  const L = { preHandler: requireRole('loader', 'dispatcher') };
  const R = { preHandler: requireRole('driver') };
  const S = { preHandler: requireRole('store_manager') };
  const ANY = { preHandler: authenticate };

  app.get('/api/health', async () => { await q('SELECT 1'); return { ok: true, clock: nowSync().toISOString() }; });

  /* ── auth ── */
  app.post('/api/auth/login', async (req, reply) => {
    const b = parse(z.object({ email: z.string().optional(), password: z.string().optional(), pin: z.string().optional(), depot: z.string().optional() }), req.body);
    const r = b.pin ? await loginWithPin(b.pin, b.depot) : b.email && b.password ? await login(b.email, b.password) : null;
    if (!r) return reply.code(401).send({ error: b.pin ? 'That PIN is not recognised.' : 'Email or password is wrong.' });
    return r;
  });
  app.get('/api/me', ANY, async req => ({ user: req.user }));

  /* ── shared ── */
  app.get('/api/clock', ANY, async () => { await loadClock(); return { now: nowSync().toISOString(), planDate: await activePlanDate(), planDateLabel: dayLabel(await activePlanDate()) }; });
  app.put('/api/clock', D, async req => {
    const b = parse(z.object({ at: z.string() }), req.body);
    if (Number.isNaN(new Date(b.at).getTime())) throw bad('Invalid time.');
    await setClock(b.at); await audit(pool, req.user.id, 'clock.set', null, b);
    return { now: nowSync().toISOString() };
  });
  app.get('/api/reference', ANY, async () => reference());
  app.get('/api/notifications', ANY, async req => myNotifications(req.user));
  app.post('/api/notifications/read', ANY, async req => markRead(req.user, parse(z.object({ ids: z.array(z.number()).optional() }), req.body ?? {}).ids));

  /* ── dispatcher ── */
  app.get('/api/overview', D, async () => overview());
  app.get('/api/orders', D, async req => {
    const date = (req.query as any).date ?? await activePlanDate();
    const rows = await q<any>(`SELECT ${ORDER_COLS}, ot.brand, ot.district, ot.depot, ot.dock, ot.van_only AS "vanOnly", ot.mall_window AS "mallWindow", ot.open_time AS open, ot.close_time AS close,
        (SELECT t.vehicle_id || ' · Trip ' || t.trip_no FROM trip_orders tor JOIN trips t ON t.id = tor.trip_id WHERE tor.order_id = o.id AND tor.moved_at IS NULL AND tor.load_status <> 'removed' AND t.status <> 'cancelled' LIMIT 1) AS placement,
        (SELECT json_build_object('reason', d.reason, 'kind', d.kind, 'toDate', to_char(d.to_date,'YYYY-MM-DD')) FROM deferrals d WHERE d.order_id = o.id AND d.from_date = $1 LIMIT 1) AS deferral
      FROM orders o JOIN outlets ot ON ot.id = o.outlet_id
      WHERE (o.delivery_date = $1 OR o.id IN (SELECT order_id FROM deferrals WHERE from_date = $1)) AND o.status <> 'cancelled' ORDER BY o.id`, [date]);
    const late = await q<any>(`SELECT ${ORDER_COLS} FROM orders o WHERE o.after_cutoff AND o.submitted_at::date <= $1 AND o.delivery_date > $1 ORDER BY o.submitted_at`, [date]);
    return { date, dateLabel: dayLabel(date), orders: rows, afterCutoff: late };
  });
  app.post('/api/orders/phone', D, async req => {
    const b = parse(OrderBody.extend({ outletId: z.string() }), req.body);
    const r = await placeOrder(req.user.id, b.outletId, b);
    await q(`UPDATE orders SET source = 'phone' WHERE id = $1`, [r.id]);
    return r;
  });
  app.get('/api/plans/:date', D, async req => planView(parse(dateParam, (req.params as any).date)));
  app.post('/api/plans/:date/auto', D, async req => { const d = parse(dateParam, (req.params as any).date); const stats = await runAutoPlan(d, req.user.id); return { stats, view: await planView(d) }; });
  app.post('/api/plans/:date/move', D, async req => {
    const d = parse(dateParam, (req.params as any).date);
    const b = parse(z.object({ orderId: z.string(), target: z.object({ vehicleId: z.string(), trip: z.number().int().min(1).max(3) }).nullable(), reason: z.object({ reason: z.enum(Object.keys(REASONS) as [string, ...string[]]), why: z.string().optional() }).optional() }), req.body);
    await moveInDraft(d, req.user.id, b.orderId, b.target, b.reason as any);
    return planView(d);
  });
  app.delete('/api/plans/:date/draft', D, async req => { const d = parse(dateParam, (req.params as any).date); await discardDraft(d, req.user.id); return planView(d); });
  app.post('/api/plans/:date/publish', D, async req => { const d = parse(dateParam, (req.params as any).date); const r = await publish(d, req.user.id); return { ...r, view: await planView(d) }; });
  app.post('/api/trips/:id/move-stop', D, async req => {
    const b = parse(z.object({ outletId: z.string(), toVehicleId: z.string(), toTrip: z.number().int().optional(), reason: z.string().default('Moved by the dispatcher.') }), req.body);
    return moveStopLive(await activePlanDate(), req.user.id, Number((req.params as any).id), b.outletId, { vehicleId: b.toVehicleId, trip: b.toTrip }, b.reason);
  });
  app.get('/api/trips/:id/move-options', D, async req => moveOptions(await activePlanDate(), Number((req.params as any).id), String((req.query as any).outletId)));
  app.get('/api/deferrals', D, async req => {
    const date = (req.query as any).date ?? await activePlanDate();
    const today = await q<any>(`SELECT d.*, to_char(d.from_date,'YYYY-MM-DD') AS "fromDate", to_char(d.to_date,'YYYY-MM-DD') AS "toDate", o.outlet_id AS "outletId", o.temp, o.units AS "orderUnits", o.kg, o.m3, o.description, ot.brand, ot.district
      FROM deferrals d JOIN orders o ON o.id = d.order_id JOIN outlets ot ON ot.id = o.outlet_id WHERE d.from_date = $1 ORDER BY d.kind, d.id`, [date]);
    const history = await q<any>(`SELECT to_char(d.from_date,'YYYY-MM-DD') AS "fromDate", to_char(d.to_date,'YYYY-MM-DD') AS "toDate", d.order_id AS "orderId", o.outlet_id AS "outletId", d.reason, d.kind, d.why,
        (SELECT o2.status FROM orders o2 WHERE o2.outlet_id = o.outlet_id AND o2.delivery_date = d.to_date AND o2.temp = o.temp ORDER BY o2.id LIMIT 1) AS "nextStatus"
      FROM deferrals d JOIN orders o ON o.id = d.order_id WHERE d.from_date < $1 ORDER BY d.from_date DESC LIMIT 50`, [date]);
    // outlets deferred on the previous run that this plan serves first
    const protectedOutlets = await q<any>(`SELECT DISTINCT o.outlet_id AS "outletId" FROM orders o WHERE o.delivery_date = $1 AND o.deferred_yesterday AND o.status NOT IN ('deferred','cancelled') AND o.parent_order_id IS NULL`, [date]);
    return { date, dateLabel: dayLabel(date), deferrals: today, history, protectedOutlets: protectedOutlets.map(p => p.outletId) };
  });
  app.get('/api/tracking', D, async () => tracking());
  app.get('/api/trips/:id', ANY, async req => tripDetail(Number((req.params as any).id)));
  app.get('/api/exceptions', D, async () => listExceptions(await activePlanDate()));
  app.post('/api/exceptions/:id/resolve', D, async req => resolve(Number((req.params as any).id), req.user.id, parse(z.object({ decision: z.string(), note: z.string().optional(), vehicleId: z.string().optional() }), req.body)));
  app.get('/api/forecast', D, async () => forecast());
  app.patch('/api/vehicles/:id', D, async req => {
    const b = parse(z.object({ status: z.enum(['available', 'in_workshop']), note: z.string().optional() }), req.body);
    const r = await one(`UPDATE vehicles SET status = $2, status_note = $3 WHERE id = $1 RETURNING id`, [(req.params as any).id, b.status, b.note ?? null]);
    if (!r) throw bad('Unknown vehicle.');
    await audit(pool, req.user.id, 'vehicle.status', `vehicle:${(req.params as any).id}`, b);
    return { ok: true };
  });
  app.post('/api/demo/reset', D, async req => { await resetDay(); await audit(pool, req.user.id, 'demo.reset', null); return { ok: true }; });

  /* ── loader ── */
  app.get('/api/loader/queue', L, async req => dockQueue((req.query as any).depot ?? req.user.depot ?? 'Kandy'));
  app.get('/api/loader/trips/:id', L, async req => tripDetail(Number((req.params as any).id)));
  app.post('/api/loader/trips/:id/ack', L, async req => acknowledge(Number((req.params as any).id), req.user.id));
  app.post('/api/loader/trips/:id/lines/:orderId', L, async req => {
    const b = parse(z.object({ state: z.enum(['loaded', 'pending']) }), req.body);
    return setLine(Number((req.params as any).id), (req.params as any).orderId, req.user.id, req.user.role === 'loader' ? req.user.depot : null, b.state);
  });
  app.post('/api/loader/trips/:id/lines/:orderId/flag', L, async req => {
    const b = parse(z.object({ reason: z.enum(['missing', 'damaged', 'wrong_item']), loadedUnits: z.number().int().min(0), item: z.string().max(80).optional(), note: z.string().max(300).optional() }), req.body);
    return flagLine(Number((req.params as any).id), (req.params as any).orderId, req.user.id, req.user.role === 'loader' ? req.user.depot : null, b);
  });
  app.post('/api/loader/trips/:id/release', L, async req => release(Number((req.params as any).id), req.user.id, req.user.role === 'loader' ? req.user.depot : null));
  app.post('/api/loader/trips/:id/fault', L, async req => reportFault(Number((req.params as any).id), req.user.id, req.user.role === 'loader' ? req.user.depot : null, parse(z.object({ type: z.string().min(2).max(80), severity: z.enum(['blocking', 'advisory']), note: z.string().max(300).optional() }), req.body)));

  /* ── driver ── */
  app.get('/api/driver/run', R, async req => myRun(req.user));
  app.post('/api/driver/sync', R, async req => sync(req.user, parse(SyncBody, req.body).events));

  /* ── store manager ── */
  app.get('/api/store/overview', S, async req => storeOverview(req.user.outletId!));
  app.get('/api/store/order-window', S, async () => orderWindow());
  app.post('/api/store/orders', S, async req => placeOrder(req.user.id, req.user.outletId!, parse(OrderBody, req.body)));
  app.post('/api/store/deferrals/:id/ack', S, async req => ackDeferral(req.user.outletId!, Number((req.params as any).id), req.user.id));
  app.post('/api/store/receipts', S, async req => confirmReceipt(req.user.id, req.user.outletId!, parse(ReceiptBody, req.body)));
  app.get('/api/store/history', S, async req => storeHistory(req.user.outletId!));
  app.get('/api/store/pod/:orderId', S, async req => {
    const r = await one<any>(`SELECT p.receiver, p.photo, p.signature, p.device_time AS "at" FROM pods p JOIN trip_orders tor ON tor.trip_id = p.trip_id JOIN orders o ON o.id = tor.order_id AND o.outlet_id = p.outlet_id
      WHERE o.id = $1 AND o.outlet_id = $2 ORDER BY p.id DESC LIMIT 1`, [(req.params as any).orderId, req.user.outletId]);
    return r ?? {};
  });
}
