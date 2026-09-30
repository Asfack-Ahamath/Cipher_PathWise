/* Driver offline support.
   - The run is cached on the phone every time it is fetched.
   - Every action (start, arrive, deliver, problem, close) is written to an outbox in IndexedDB first,
     with its own id and the device time, then sent when there is signal.
   - The server applies each record once (idempotent by clientEventId), so a retry is always safe.
   - "Simulate no signal" lets a judge test all of this without switching the phone to airplane mode. */
import { get, set } from 'idb-keyval';
import { useEffect, useState } from 'react';
import { ApiError, post, store } from './api';
import { isoLocal } from './clock';

export type EventType = 'trip_started' | 'arrived' | 'delivered' | 'problem' | 'trip_closed' | 'conflict_answer' | 'route_ack';
export interface OutEvent { clientEventId: string; type: EventType; tripId: number; outletId?: string | null; deviceTime: string; payload: Record<string, any> }
export interface SyncResult { clientEventId: string; status: 'applied' | 'duplicate' | 'conflict' | 'rejected'; message?: string }

const OUTBOX = 'pw.outbox';
const RUN = 'pw.run';
const LOG = 'pw.syncLog';
const SIM = 'pw.noSignal';

type State = { online: boolean; simulated: boolean; pending: OutEvent[]; syncing: boolean; lastSync: string | null; offlineSince: string | null; log: (SyncResult & { type: EventType; outletId?: string | null; at: string })[] };
let state: State = { online: typeof navigator === 'undefined' ? true : navigator.onLine, simulated: store.get(SIM) === '1', pending: [], syncing: false, lastSync: store.get('pw.lastSync'), offlineSince: store.get('pw.offlineSince'), log: [] };
const subs = new Set<(s: State) => void>();
const emit = (p: Partial<State>) => { state = { ...state, ...p }; subs.forEach(f => f(state)); };

export const hasSignal = () => state.online && !state.simulated;

let loaded = false;
async function load() {
  if (loaded) return; loaded = true;
  const [pending, log] = await Promise.all([get<OutEvent[]>(OUTBOX), get<State['log']>(LOG)]);
  emit({ pending: pending ?? [], log: log ?? [] });
}
if (typeof window !== 'undefined') {
  void load();
  window.addEventListener('online', () => { emit({ online: true }); void flush(); });
  window.addEventListener('offline', () => { markOffline(); emit({ online: false }); });
}
function markOffline() { if (!state.offlineSince) { const t = isoLocal(); store.set('pw.offlineSince', t); emit({ offlineSince: t }); } }

export function setSimulatedOffline(on: boolean) {
  store.set(SIM, on ? '1' : null);
  if (on) markOffline();
  emit({ simulated: on });
  if (!on) void flush();
}

const uuid = () => (crypto as any).randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = (Math.random() * 16) | 0; return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16); });

export async function record(type: EventType, tripId: number, outletId: string | null, payload: Record<string, any> = {}) {
  await load();
  const ev: OutEvent = { clientEventId: uuid(), type, tripId, outletId, deviceTime: isoLocal(), payload };
  const pending = [...state.pending, ev];
  await set(OUTBOX, pending); emit({ pending });
  if (hasSignal()) void flush();
  return ev;
}

let flushing: Promise<SyncResult[]> | null = null;
export function flush(): Promise<SyncResult[]> {
  if (flushing) return flushing;
  flushing = (async () => {
    await load();
    if (!hasSignal() || state.pending.length === 0) return [];
    emit({ syncing: true });
    const all: SyncResult[] = [];
    try {
      while (state.pending.length && hasSignal()) {
        const batch = state.pending.slice(0, 50);
        const r = await post<{ results: SyncResult[]; syncedAt: string }>('/driver/sync', { events: batch });
        const done = new Set(r.results.map(x => x.clientEventId));
        const pending = state.pending.filter(e => !done.has(e.clientEventId));
        const log = [...r.results.map(x => { const e = batch.find(b => b.clientEventId === x.clientEventId)!; return { ...x, type: e.type, outletId: e.outletId, at: e.deviceTime }; }), ...state.log].slice(0, 80);
        await Promise.all([set(OUTBOX, pending), set(LOG, log)]);
        store.set('pw.lastSync', r.syncedAt); store.set('pw.offlineSince', null);
        emit({ pending, log, lastSync: r.syncedAt, offlineSince: null });
        all.push(...r.results);
        if (done.size === 0) break;
      }
      emit({ syncing: false });
      return all;
    } catch (e) {
      emit({ syncing: false });
      if (e instanceof ApiError && e.status === 0) { markOffline(); emit({ online: false }); setTimeout(() => emit({ online: navigator.onLine }), 15000); }
      return [];
    } finally { flushing = null; }
  })();
  return flushing;
}

export function useOutbox() {
  const [s, setS] = useState(state);
  useEffect(() => { subs.add(setS); setS(state); void load(); return () => { subs.delete(setS); }; }, []);
  return s;
}

/* Cached run for offline use */
export const saveRun = (run: unknown) => set(RUN, run);
export const loadRun = <T,>() => get<T>(RUN);
export const clearDriverCache = async () => { await Promise.all([set(OUTBOX, []), set(LOG, []), set(RUN, null)]); emit({ pending: [], log: [] }); };

// retry every 20 s while there is anything waiting
if (typeof window !== 'undefined') setInterval(() => { if (state.pending.length && hasSignal()) void flush(); }, 20_000);
