import bcrypt from 'bcryptjs';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { jwtVerify, SignJWT } from 'jose';
import type { Role } from '@pathwise/core';
import { config } from './config.js';
import { one, q } from './db.js';

export interface AuthUser { id: number; email: string; name: string; role: Role; depot: string | null; outletId: string | null; vehicleId: string | null }
declare module 'fastify' { interface FastifyRequest { user: AuthUser } }

const key = new TextEncoder().encode(config.jwtSecret);

export async function login(email: string, password: string): Promise<{ token: string; user: AuthUser } | null> {
  const u = await one<any>(`SELECT * FROM users WHERE lower(email) = lower($1)`, [email.trim()]);
  if (!u || !(await bcrypt.compare(password, u.password_hash))) return null;
  return issue(u);
}
/** Shared dock tablets: a loader can sign in with a 4-digit PIN. */
export async function loginWithPin(pin: string, depot?: string): Promise<{ token: string; user: AuthUser } | null> {
  const loaders = await q<any>(`SELECT * FROM users WHERE role = 'loader' AND pin_hash IS NOT NULL ${depot ? 'AND depot = $1' : ''}`, depot ? [depot] : []);
  for (const u of loaders) if (await bcrypt.compare(pin, u.pin_hash)) return issue(u);
  return null;
}

async function issue(u: any) {
  const user: AuthUser = { id: u.id, email: u.email, name: u.name, role: u.role, depot: u.depot, outletId: u.outlet_id, vehicleId: u.vehicle_id };
  const token = await new SignJWT({ ...user }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('7d').sign(key);
  return { token, user };
}

export async function authenticate(req: FastifyRequest, reply: FastifyReply) {
  const h = req.headers.authorization;
  if (!h?.startsWith('Bearer ')) return reply.code(401).send({ error: 'Sign in first.' });
  try {
    const { payload } = await jwtVerify(h.slice(7), key);
    req.user = payload as unknown as AuthUser;
  } catch {
    return reply.code(401).send({ error: 'Your session has expired. Sign in again.' });
  }
}

export const requireRole = (...roles: Role[]) => async (req: FastifyRequest, reply: FastifyReply) => {
  await authenticate(req, reply);
  if (reply.sent) return;
  if (!roles.includes(req.user.role)) return reply.code(403).send({ error: `This needs the ${roles.join(' or ')} role.` });
};
