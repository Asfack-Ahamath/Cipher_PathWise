import pg from 'pg';
import { config } from './config.js';

pg.types.setTypeParser(1700, v => (v === null ? null : Number(v))); // numeric → number
pg.types.setTypeParser(1082, v => v);                                // date → 'YYYY-MM-DD'

// managed databases (Neon, Supabase, Railway public URLs) need TLS: set DATABASE_SSL=true
export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10, ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined });
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
