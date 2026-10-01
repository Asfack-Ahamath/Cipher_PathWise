import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { requireRole, authenticate, type AuthUser } from '../auth.js';
import { one } from '../db.js';
import { bad, forbidden, notFound } from '../errors.js';

/** Validate input with zod; every message names the field so forms can show it next to the input. */
export const parse = <T extends z.ZodTypeAny>(schema: T, data: unknown): z.infer<T> => {
  const r = schema.safeParse(data ?? {});
  if (!r.success) throw bad(r.error.issues.map(i => `${i.path.join('.') || 'input'}: ${i.message}`).join('; '), r.error.issues.map(i => ({ field: i.path.join('.'), message: i.message })));
  return r.data;
};
export const DateParam = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.') });
export const IdParam = z.object({ id: z.coerce.number().int().positive() });
export const OrderIdParam = z.object({ orderId: z.string().trim().min(3).max(40) });
export const params = (req: FastifyRequest) => req.params as Record<string, string>;

export const guard = {
  admin: { preHandler: requireRole('admin') },
  office: { preHandler: requireRole('dispatcher') },            // dispatcher (and admin)
  loader: { preHandler: requireRole('loader', 'dispatcher') },
  driver: { preHandler: requireRole('driver') },
  store: { preHandler: requireRole('store_manager') },
  any: { preHandler: authenticate },
};

/** Who may read a trip: office roles; loaders of its depot; its driver (or the driver whose vehicle it replaced). */
export async function assertTripAccess(user: AuthUser, tripId: number) {
  if (user.role === 'admin' || user.role === 'dispatcher') return;
  const t = await one<any>(`SELECT t.vehicle_id, t.swapped_from, v.depot FROM trips t JOIN vehicles v ON v.id = t.vehicle_id WHERE t.id = $1`, [tripId]);
  if (!t) throw notFound('Trip not found.');
  if (user.role === 'loader' && user.depot === t.depot) return;
  if (user.role === 'driver' && user.vehicleId && [t.vehicle_id, t.swapped_from].includes(user.vehicleId)) return;
  throw forbidden('This trip is not yours.');
}

/** Loaders act for their own depot; a dispatcher at the dock acts for any. */
export const scopeDepot = (u: AuthUser) => (u.role === 'loader' ? u.depot : null);
export const clientIp = (req: FastifyRequest) => req.ip;
