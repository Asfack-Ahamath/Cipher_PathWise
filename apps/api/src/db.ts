import pg from 'pg';
import { config } from './config.js';

pg.types.setTypeParser(1700, v => (v === null ? null : Number(v))); // numeric → number
pg.types.setTypeParser(1082, v => v);                                // date → 'YYYY-MM-DD'

// Managed Postgres (Supabase, Neon) needs TLS: set DATABASE_SSL=true. We drop any sslmode in the URL so
// the explicit TLS settings below always apply (Supabase's pooler certificate is not in Node's CA store).
const url = config.databaseSsl ? config.databaseUrl.replace(/([?&])sslmode=[^&]*&?/, '$1').replace(/[?&]$/, '') : config.databaseUrl;
export const pool = new pg.Pool({ connectionString: url, max: Number(process.env.DATABASE_POOL_MAX ?? 10), idleTimeoutMillis: 30_000, connectionTimeoutMillis: 10_000, ssl: config.databaseSsl ? { rejectUnauthorized: false } : undefined });
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
