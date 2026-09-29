import fs from 'node:fs';
import path from 'node:path';
import cors from '@fastify/cors';
import fstatic from '@fastify/static';
import Fastify from 'fastify';
import { config } from './config.js';
import { HttpError } from './errors.js';
import { routes } from './routes/index.js';

export async function buildServer() {
  const app = Fastify({ logger: { level: config.logLevel }, bodyLimit: 8 * 1024 * 1024 }); // proof-of-delivery photos travel in sync batches
  await app.register(cors, { origin: true });
  app.setErrorHandler((err: any, req, reply) => {
    if (err instanceof HttpError) return reply.code(err.status).send({ error: err.message, details: err.details });
    if (err.validation) return reply.code(400).send({ error: err.message });
    req.log.error(err);
    return reply.code(500).send({ error: 'Something went wrong on the server.' });
  });
  await app.register(routes);
  // the built web app (single-container deployment)
  if (fs.existsSync(path.join(config.webDist, 'index.html'))) {
    await app.register(fstatic, { root: config.webDist, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'Not found' });
      return reply.type('text/html').send(fs.readFileSync(path.join(config.webDist, 'index.html')));
    });
  }
  return app;
}
