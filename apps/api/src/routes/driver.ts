import type { FastifyInstance } from 'fastify';
import { myRun, sync, SyncBody } from '../services/driver.js';
import { guard, parse } from './util.js';

export async function driverRoutes(app: FastifyInstance) {
  app.get('/api/driver/run', guard.driver, async req => myRun(req.user));
  // proof photos travel in these batches, so the body limit is larger than elsewhere
  app.post('/api/driver/sync', { ...guard.driver, bodyLimit: 24 * 1024 * 1024 }, async req => sync(req.user, parse(SyncBody, req.body).events));
}
