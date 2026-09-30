import { EventEmitter } from 'node:events';

/* Live updates. Every write is audited (audit.ts); the audit action decides which screens are stale.
   Browsers hold a Server-Sent Events stream (/api/events) and refetch only those screens.
   Single-instance by design (one app container); scale out by swapping this for Postgres LISTEN/NOTIFY. */
export interface LiveEvent { topics: string[]; at: string }
export const bus = new EventEmitter();
bus.setMaxListeners(500);

const TOPICS: [RegExp, string[]][] = [
  [/^(demo|clock)\./, ['clock', 'plan', 'orders', 'overview', 'deferrals', 'tracking', 'loader', 'driver', 'store', 'forecast', 'exceptions']],
  [/^(plan|order)\./, ['plan', 'orders', 'overview', 'deferrals', 'tracking', 'loader', 'driver', 'store', 'forecast']],
  [/^(load|loader)\./, ['loader', 'plan', 'overview', 'tracking', 'driver', 'exceptions']],
  [/^driver\./, ['driver', 'tracking', 'overview', 'store', 'exceptions', 'plan']],
  [/^(exception|trip)\./, ['exceptions', 'overview', 'tracking', 'loader', 'driver', 'store', 'plan', 'deferrals']],
  [/^(store|receipt|deferral)\./, ['store', 'overview', 'exceptions', 'deferrals', 'orders']],
  [/^(vehicle|outlet|settings|admin|user)\./, ['admin', 'reference', 'overview', 'plan']],
];

let pending: Set<string> | null = null;
export function publishAction(action: string) {
  const topics = TOPICS.find(([re]) => re.test(action))?.[1] ?? [];
  if (!topics.length) return;
  // coalesce bursts (e.g. auto-plan writes many rows) into one message; wait for the transaction to commit
  if (!pending) { pending = new Set(); setTimeout(() => { const t = [...pending!]; pending = null; bus.emit('live', { topics: [...t, 'notifications'], at: new Date().toISOString() } satisfies LiveEvent); }, 350); }
  topics.forEach(t => pending!.add(t));
}
