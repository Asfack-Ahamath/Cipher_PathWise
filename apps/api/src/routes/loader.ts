import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { acknowledge, claimTrip, dockQueue, FaultBody, FlagBody, flagLine, release, releaseClaim, reportFault, reportSize, setLine, SizeBody } from '../services/loader.js';
import { tripDetail } from '../services/trips.js';
import { assertTripAccess, guard, IdParam, parse, params, scopeDepot } from './util.js';

export async function loaderRoutes(app: FastifyInstance) {
  const L = guard.loader;
  app.get('/api/loader/queue', L, async req => {
    const { depot } = parse(z.object({ depot: z.enum(['Peliyagoda', 'Kandy']).optional() }), req.query);
    return dockQueue(req.user.role === 'loader' ? req.user.depot! : depot ?? 'Kandy');
  });
  app.get('/api/loader/trips/:id', L, async req => { const { id } = parse(IdParam, req.params); await assertTripAccess(req.user, id); return tripDetail(id); });
  app.post('/api/loader/trips/:id/claim', L, async req => {
    const { id } = parse(IdParam, req.params);
    return claimTrip(id, req.user, parse(z.object({ device: z.string().max(80).optional(), takeOver: z.boolean().optional() }), req.body));
  });
  app.delete('/api/loader/trips/:id/claim', L, async req => releaseClaim(parse(IdParam, req.params).id, req.user.id));
  app.post('/api/loader/trips/:id/ack', L, async req => { const { id } = parse(IdParam, req.params); await assertTripAccess(req.user, id); return acknowledge(id, req.user.id); });
  app.post('/api/loader/trips/:id/lines/:orderId', L, async req => {
    const { id } = parse(IdParam, req.params);
    return setLine(id, params(req).orderId, req.user.id, scopeDepot(req.user), parse(z.object({ state: z.enum(['loaded', 'pending']) }), req.body).state);
  });
  app.post('/api/loader/trips/:id/lines/:orderId/flag', L, async req => flagLine(parse(IdParam, req.params).id, params(req).orderId, req.user.id, scopeDepot(req.user), parse(FlagBody, req.body)));
  app.post('/api/loader/trips/:id/lines/:orderId/size', L, async req => reportSize(parse(IdParam, req.params).id, params(req).orderId, req.user.id, scopeDepot(req.user), parse(SizeBody, req.body)));
  app.post('/api/loader/trips/:id/release', L, async req => release(parse(IdParam, req.params).id, req.user.id, scopeDepot(req.user)));
  app.post('/api/loader/trips/:id/fault', L, async req => reportFault(parse(IdParam, req.params).id, req.user.id, scopeDepot(req.user), parse(FaultBody, req.body)));
}
