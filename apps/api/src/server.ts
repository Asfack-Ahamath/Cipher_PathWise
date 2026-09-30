import fs from 'node:fs';
import path from 'node:path';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fstatic from '@fastify/static';
import Fastify from 'fastify';
import { config } from './config.js';
import { HttpError } from './errors.js';
import { routes } from './routes/index.js';

export async function buildServer() {
  const app = Fastify({
    logger: {
      level: config.logLevel,
      redact: { paths: ['req.headers.authorization', 'req.headers.cookie', 'req.query.ticket'], censor: '[redacted]' },
    },
    bodyLimit: 1024 * 1024,           // 1 MB by default; photo uploads raise it per route
    trustProxy: config.trustProxy,
  });

  // Security headers. The CSP allows only this origin, the map tiles, Google Fonts and (if used) Supabase Storage.
  const supabase = config.supabase.url ? [config.supabase.url] : [];
  await app.register(helmet, {
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        'default-src': ["'self'"],
        'script-src': ["'self'"],
        'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        'font-src': ["'self'", 'data:', 'https://fonts.gstatic.com'],
        'img-src': ["'self'", 'data:', 'blob:', 'https://*.basemaps.cartocdn.com', ...supabase],
        // the service worker fetches fonts and map tiles for offline use, so they count as connections too
        'connect-src': ["'self'", 'https://fonts.googleapis.com', 'https://fonts.gstatic.com', 'https://*.basemaps.cartocdn.com', ...supabase],
        'worker-src': ["'self'", 'blob:'],
        'manifest-src': ["'self'"],
        'frame-ancestors': ["'none'"],
        'upgrade-insecure-requests': config.isProd ? [] : null,
      },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'same-site' },
    hsts: config.isProd ? { maxAge: 15552000, includeSubDomains: true } : false,
  });

  // Same origin by default (the API serves the web app). List other origins in CORS_ORIGINS.
  await app.register(cors, {
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      const allowed = config.corsOrigins.includes(origin) || (!config.isProd && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin));
      cb(null, allowed);
    },
    credentials: false,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  });

  // API rate limit: 600 requests a minute per signed-in person (a whole depot can share one internet address),
  // or per address before sign-in. Static files are not limited. Sign-in routes are stricter (routes/auth.ts).
  await app.register(rateLimit, {
    global: true, max: 600, timeWindow: '1 minute',
    allowList: req => !req.url.startsWith('/api/'),
    keyGenerator: req => {
      const h = req.headers.authorization;
      if (h?.startsWith('Bearer ')) {
        try { const sub = JSON.parse(Buffer.from(h.slice(7).split('.')[1], 'base64url').toString()).sub; if (sub) return `u:${sub}`; } catch { /* fall back to the address */ }
      }
      return `ip:${req.ip}`;
    },
    errorResponseBuilder: (_req, ctx) => ({ statusCode: 429, error: `Too many requests. Try again in ${Math.ceil(ctx.ttl / 1000)} seconds.`, code: 'rate_limited' }),
  });

  app.setErrorHandler((err: any, req, reply) => {
    if (err instanceof HttpError) return reply.code(err.status).send({ error: err.message, code: err.code, details: err.details });
    if (err.statusCode === 429) return reply.code(429).send({ error: err.error ?? err.message, code: 'rate_limited' });
    if (err.code === 'FST_ERR_CTP_BODY_TOO_LARGE') return reply.code(413).send({ error: 'That upload is too large. Photos are compressed on the device — try again, or send fewer at once.', code: 'too_large' });
    if (err.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE' || err.code === 'FST_ERR_CTP_EMPTY_JSON_BODY') return reply.code(400).send({ error: 'Send JSON.', code: 'bad_request' });
    if (err.validation || err.statusCode === 400) return reply.code(400).send({ error: err.message, code: 'bad_request' });
    // database constraint violations are data problems, not crashes
    if (err.code === '23505') return reply.code(409).send({ error: 'That already exists.', code: 'duplicate' });
    if (err.code === '23503') return reply.code(409).send({ error: 'That refers to something that does not exist or is still in use.', code: 'reference' });
    if (err.code === '23514' || err.code === '22P02' || err.code === '22007') return reply.code(400).send({ error: 'A value is out of range or in the wrong format.', code: 'invalid_value' });
    req.log.error(err);
    return reply.code(500).send({ error: 'Something went wrong on the server. It has been logged.', code: 'server_error' });
  });

  await app.register(routes);

  // the built web app (single-container deployment)
  if (fs.existsSync(path.join(config.webDist, 'index.html'))) {
    await app.register(fstatic, {
      root: config.webDist, wildcard: false,
      setHeaders: (reply, file) => { reply.header('Cache-Control', /[\\/]assets[\\/]/.test(file) ? 'public, max-age=31536000, immutable' : 'no-cache'); },
    });
    const indexHtml = fs.readFileSync(path.join(config.webDist, 'index.html'));
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'Not found', code: 'not_found' });
      return reply.type('text/html').header('Cache-Control', 'no-cache').send(indexHtml);
    });
  } else {
    app.setNotFoundHandler((_req, reply) => reply.code(404).send({ error: 'Not found', code: 'not_found' }));
  }
  return app;
}
