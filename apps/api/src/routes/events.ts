import type { FastifyInstance } from 'fastify';
import { userFromTicket } from '../auth.js';
import { bus, type LiveEvent } from '../lib/events.js';

/* Server-Sent Events: GET /api/events?ticket=… keeps a stream open and sends
   `{"topics":["plan","tracking",…]}` whenever something the screens show has changed. */
export async function eventRoutes(app: FastifyInstance) {
  app.get('/api/events', { config: { rateLimit: false } }, async (req, reply) => {
    const ticket = String((req.query as any)?.ticket ?? '');
    const user = await userFromTicket(ticket, 'events');
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write(`retry: 5000\nevent: hello\ndata: ${JSON.stringify({ userId: user.id, role: user.role })}\n\n`);
    const onLive = (e: LiveEvent) => res.write(`data: ${JSON.stringify(e)}\n\n`);
    bus.on('live', onLive);
    const ping = setInterval(() => res.write(`: ping\n\n`), 25_000);
    const close = () => { clearInterval(ping); bus.off('live', onLive); };
    req.raw.on('close', close);
    res.on('error', close);
  });
}
