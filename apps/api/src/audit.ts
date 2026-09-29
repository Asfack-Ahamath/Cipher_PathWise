import { nowSync } from './clock.js';
import { q, type Db } from './db.js';

export async function audit(db: Db, userId: number | null, action: string, entity: string | null, data: unknown = {}) {
  await q(`INSERT INTO audit_log (user_id, action, entity, data, at) VALUES ($1, $2, $3, $4, $5)`, [userId, action, entity, JSON.stringify(data), nowSync()], db);
}

export type Tone = 'grey' | 'green' | 'amber' | 'blue' | 'red' | 'violet';
/** Audiences: role:dispatcher · depot:Kandy · outlet:OUT116 · vehicle:VEH041 · user:<id> */
export async function notify(db: Db, audience: string, kind: string, title: string, body = '', opts: { tone?: Tone; link?: string } = {}) {
  await q(`INSERT INTO notifications (audience, kind, title, body, tone, link, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [audience, kind, title, body, opts.tone ?? 'blue', opts.link ?? null, nowSync()], db);
}
