import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { changeOwnPassword, completeRecovery, issueTicket, login, loginWithPin, requestRecovery, signOutEverywhere } from '../auth.js';
import { audit } from '../audit.js';
import { config } from '../config.js';
import { pool } from '../db.js';
import { unauthorized } from '../errors.js';
import { guard, parse } from './util.js';

// per address (or per person when signed in): stops password guessing without blocking a busy depot at shift start
const strict = { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } };

export async function authRoutes(app: FastifyInstance) {
  /** What the sign-in screen needs to know before anyone signs in. */
  app.get('/api/auth/config', async () => ({ demoMode: config.demoMode, passwordRecovery: config.authProvider === 'supabase' ? 'email' : 'admin' }));
  app.post('/api/auth/login', strict, async req => {
    const b = parse(z.object({ email: z.string().trim().email('Enter your work email.').max(120), password: z.string().min(1, 'Enter your password.').max(128) }), req.body);
    const r = await login(b.email, b.password, req.ip);
    if (!r) throw unauthorized('Email or password is wrong.', 'bad_credentials');
    return r;
  });
  app.post('/api/auth/pin', strict, async req => {
    const b = parse(z.object({ pin: z.string().regex(/^\d{4,6}$/, 'Enter your 4-digit PIN.'), depot: z.enum(['Peliyagoda', 'Kandy']) }), req.body);
    const r = await loginWithPin(b.pin, b.depot, req.ip);
    if (!r) throw unauthorized('That PIN is not recognised at this depot.', 'bad_pin');
    return r;
  });
  app.post('/api/auth/forgot', strict, async req => requestRecovery(parse(z.object({ email: z.string().trim().email().max(120) }), req.body).email, req.ip));
  app.post('/api/auth/recover', strict, async req => {
    const b = parse(z.object({ accessToken: z.string().min(20).max(4000), password: z.string().max(128) }), req.body);
    return completeRecovery(b.accessToken, b.password, req.ip);
  });
  app.post('/api/auth/logout', guard.any, async req => {
    const b = parse(z.object({ everywhere: z.boolean().default(false) }), req.body);
    if (b.everywhere) await signOutEverywhere(req.user.id);
    await audit(pool, req.user.id, b.everywhere ? 'auth.logout_everywhere' : 'auth.logout', `user:${req.user.id}`);
    return { ok: true };
  });
  app.get('/api/me', guard.any, async req => ({ user: req.user }));
  app.post('/api/me/password', { ...strict, preHandler: guard.any.preHandler }, async req => {
    const b = parse(z.object({ current: z.string().min(1, 'Enter your current password.').max(128), next: z.string().max(128) }), req.body);
    return changeOwnPassword(req.user.id, b.current, b.next, req.ip);
  });
  /** A 60-second ticket for the live-update stream (EventSource cannot send headers). */
  app.post('/api/events/ticket', guard.any, async req => ({ ticket: await issueTicket(req.user, 'events') }));
}
