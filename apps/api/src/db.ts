import pg from 'pg';
import { config } from './config.js';

pg.types.setTypeParser(1700, v => (v === null ? null : Number(v))); // numeric → number
pg.types.setTypeParser(1082, v => v);                                // date → 'YYYY-MM-DD'

// Managed Postgres (Supabase, Neon) needs TLS: set DATABASE_SSL=true. We drop any sslmode in the URL so
// the explicit TLS settings below always apply (Supabase's pooler certificate is not in Node's CA store).
const url = config.databaseSsl ? config.databaseUrl.replace(/([?&])sslmode=[^&]*&?/, '$1').replace(/[?&]$/, '') : config.databaseUrl;
// A new connection to a remote database costs several round trips (TCP, TLS, auth), so keep idle ones open
// for minutes rather than seconds, with TCP keep-alive so hosting proxies do not silently drop them.
export const pool = new pg.Pool({
  connectionString: url, max: Number(process.env.DATABASE_POOL_MAX ?? 10),
  idleTimeoutMillis: Number(process.env.DATABASE_IDLE_MS ?? 600_000), connectionTimeoutMillis: 10_000,
  keepAlive: true, keepAliveInitialDelayMillis: 10_000,
  ssl: config.databaseSsl ? { rejectUnauthorized: false } : undefined,
});
pool.on('error', err => console.error('database pool error:', err.message));
export type Db = pg.Pool | pg.PoolClient;

export async function q<T = any>(sql: string, params: unknown[] = [], db: Db = pool): Promise<T[]> {
  const r = await db.query(sql, params as any[]);
  return r.rows as T[];
}
export async function one<T = any>(sql: string, params: unknown[] = [], db: Db = pool): Promise<T | null> {
  const r = await q<T>(sql, params, db);
  return r[0] ?? null;
}

/** Run fn in a transaction. */
export async function tx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const r = await fn(c);
    await c.query('COMMIT');
    return r;
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}

/** Independent queries side by side on the pool (one wait for the database instead of several); one after
 *  another on a transaction client, which can only run one query at a time. */
export async function parallel<T extends readonly (() => Promise<unknown>)[]>(db: Db | undefined, fns: T): Promise<{ -readonly [K in keyof T]: Awaited<ReturnType<T[K]>> }> {
  if (!db || db === pool) return Promise.all(fns.map(f => f())) as any;
  const out: unknown[] = [];
  for (const f of fns) out.push(await f());
  return out as any;
}
