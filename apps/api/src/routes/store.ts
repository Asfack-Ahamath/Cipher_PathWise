import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ackDeferral, cancelOrder, confirmReceipt, HistoryQuery, OrderBody, OrderEditBody, orderWindow, placeOrder, ReceiptBody, storeHistory, storeOverview, storePod, updateOrder } from '../services/store.js';
import { guard, IdParam, parse, params } from './util.js';

export async function storeRoutes(app: FastifyInstance) {
  const S = guard.store;
  app.get('/api/store/overview', S, async req => storeOverview(req.user.outletId!));
  app.get('/api/store/order-window', S, async () => orderWindow());
  app.post('/api/store/orders', S, async req => placeOrder(req.user, req.user.outletId!, parse(OrderBody, req.body)));
  app.patch('/api/store/orders/:orderId', S, async req => updateOrder(req.user, params(req).orderId, parse(OrderEditBody, req.body)));
  app.delete('/api/store/orders/:orderId', S, async req => cancelOrder(req.user, params(req).orderId, parse(z.object({ reason: z.string().trim().min(3, 'Say why you are cancelling.').max(300) }), req.body).reason));
  app.post('/api/store/deferrals/:id/ack', S, async req => ackDeferral(req.user.outletId!, parse(IdParam, req.params).id, req.user.id));
  app.post('/api/store/receipts', { ...S, bodyLimit: 24 * 1024 * 1024 }, async req => confirmReceipt(req.user, req.user.outletId!, parse(ReceiptBody, req.body)));
  app.get('/api/store/history', S, async req => storeHistory(req.user.outletId!, parse(HistoryQuery, req.query)));
  app.get('/api/store/pod/:orderId', S, async req => storePod(req.user, params(req).orderId));
}
