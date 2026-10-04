import { nowSync } from './clock.js';
import { q, type Db } from './db.js';
import { publishAction } from './lib/events.js';

export async function audit(db: Db, userId: number | null, action: string, entity: string | null, data: unknown = {}) {
  await q(`INSERT INTO audit_log (user_id, action, entity, data, at) VALUES ($1, $2, $3, $4, $5)`, [userId, action, entity, JSON.stringify(redact(data)), nowSync()], db);
  publishAction(action);
}
/** Never write secrets or image data into the audit log. */
function redact(data: unknown): unknown {
  if (!data || typeof data !== 'object') return data;
  if (Array.isArray(data)) return data.map(redact);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
    if (/password|pin|token|secret/i.test(k)) out[k] = '[redacted]';
    else if (typeof v === 'string' && v.startsWith('data:')) out[k] = `[${v.slice(5, v.indexOf(';'))} ${Math.round(v.length * 0.75 / 1024)} KB]`;
    else out[k] = redact(v);
  }
  return out;
}

export type Tone = 'grey' | 'green' | 'amber' | 'blue' | 'red' | 'violet';
/** Audiences: role:dispatcher · depot:Kandy · outlet:OUT116 · vehicle:VEH041 · user:<id> */
export async function notify(db: Db, audience: string, kind: string, title: string, body = '', opts: { tone?: Tone; link?: string } = {}) {
  await q(`INSERT INTO notifications (audience, kind, title, body, tone, link, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [audience, kind, title, body, opts.tone ?? 'blue', opts.link ?? null, nowSync()], db);
}

export interface Notice { audience: string; kind: string; title: string; body?: string; tone?: Tone; link?: string }
/** Many notifications in one statement (publishing a plan sends hundreds; one round trip each is slow on a remote database). */
export async function notifyMany(db: Db, list: Notice[]) {
  if (!list.length) return;
  await q(`INSERT INTO notifications (audience, kind, title, body, tone, link, created_at)
    SELECT a, k, t, b, tn, l, $7 FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[]) WITH ORDINALITY AS x(a, k, t, b, tn, l, n) ORDER BY n`,
    [list.map(n => n.audience), list.map(n => n.kind), list.map(n => n.title), list.map(n => n.body ?? ''), list.map(n => n.tone ?? 'blue'), list.map(n => n.link ?? null), nowSync()], db);
}
