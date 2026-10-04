import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { audit } from '../audit.js';
import { dayLabel, loadClock, nowSync, setClock } from '../clock.js';
import { config } from '../config.js';
import { pool, q } from '../db.js';
import { bad, forbidden } from '../errors.js';
import { resetDay } from '../seed/seed.js';
import { activePlanDate } from '../services/network.js';
import { markRead, myNotifications, reference } from '../services/views.js';
import { guard, parse } from './util.js';

export async function sharedRoutes(app: FastifyInstance) {
  /** Liveness for the host's health check: no details, no auth. */
  app.get('/api/health', { config: { rateLimit: false } }, async (_req, reply) => {
    try { await q('SELECT 1'); return { ok: true }; }
    catch { return reply.code(503).send({ ok: false }); }
  });
  app.get('/api/clock', guard.any, async () => {
    const [, d] = await Promise.all([loadClock(), activePlanDate()]);
    return { now: nowSync().toISOString(), planDate: d, planDateLabel: dayLabel(d), demoMode: config.demoMode };
  });
  /** Demo clock: lets judges jump to 05:35 and replay the day. Off when DEMO_MODE=false. */
  app.put('/api/clock', guard.office, async req => {
    if (!config.demoMode) throw forbidden('The demo clock is turned off (DEMO_MODE=false).');
    const b = parse(z.object({ at: z.string().datetime({ offset: true, message: 'Use an ISO time with offset, e.g. 2026-04-30T05:35:00+05:30.' }) }), req.body);
    await setClock(b.at);
    await audit(pool, req.user.id, 'clock.set', null, b);
    return { now: nowSync().toISOString() };
  });
  app.post('/api/demo/reset', guard.office, async req => {
    if (!config.demoMode) throw forbidden('Resetting the demo day is turned off (DEMO_MODE=false).');
    await resetDay(m => req.log.info(m));
    await audit(pool, req.user.id, 'demo.reset', null);
    return { ok: true };
  });
  app.get('/api/reference', guard.any, async () => reference());
  app.get('/api/notifications', guard.any, async req => myNotifications(req.user));
  app.post('/api/notifications/read', guard.any, async req => {
    const b = parse(z.object({ ids: z.array(z.number().int().positive()).max(500).optional() }), req.body);
    if (b.ids && !b.ids.length) throw bad('ids must not be empty.');
    return markRead(req.user, b.ids);
  });
}
