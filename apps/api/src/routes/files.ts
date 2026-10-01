import type { FastifyInstance } from 'fastify';
import type { AuthUser } from '../auth.js';
import { one } from '../db.js';
import { forbidden } from '../errors.js';
import { getAttachment, readAttachment, type AttachmentRow } from '../lib/storage.js';
import { guard, params } from './util.js';

/** Proof photos and signatures are private: office roles see all; a store sees its own outlet's;
 *  a driver sees their own trips'; a loader those of trips from their depot. */
async function canSee(u: AuthUser, a: AttachmentRow) {
  if (u.role === 'admin' || u.role === 'dispatcher') return true;
  if (u.role === 'store_manager') return !!a.outlet_id && a.outlet_id === u.outletId;
  if (!a.trip_id) return false;
  const t = await one<any>(`SELECT t.vehicle_id, t.swapped_from, v.depot FROM trips t JOIN vehicles v ON v.id = t.vehicle_id WHERE t.id = $1`, [a.trip_id]);
  if (!t) return false;
  if (u.role === 'driver') return [t.vehicle_id, t.swapped_from].includes(u.vehicleId);
  if (u.role === 'loader') return t.depot === u.depot;
  return false;
}

export async function fileRoutes(app: FastifyInstance) {
  app.get('/api/files/:id', guard.any, async (req, reply) => {
    const a = await getAttachment(params(req).id);
    if (!(await canSee(req.user, a))) throw forbidden('You cannot open this file.');
    const r = await readAttachment(a);
    reply.header('Cache-Control', 'private, max-age=300').header('X-Content-Type-Options', 'nosniff').header('Content-Disposition', 'inline');
    if (r.redirect) return reply.redirect(r.redirect, 302);
    return reply.type(a.mime).send(r.bytes);
  });
}
