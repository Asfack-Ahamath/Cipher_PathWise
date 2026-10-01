/* Live updates over Server-Sent Events. The server sends the names of the screens that changed
   ("plan", "tracking", …); we refetch only the queries behind them. Reconnects with a fresh ticket. */
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { post, session } from './api';
import { syncClock } from './clock';

const KEYS: Record<string, string[]> = {
  plan: ['plan', 'plan-versions'], orders: ['orders'], overview: ['overview'], deferrals: ['deferrals'],
  tracking: ['tracking', 'trip', 'move-options'], loader: ['loader-queue', 'loader-trip'], driver: ['driver-run'],
  store: ['store', 'store-history', 'pod'], forecast: ['forecast'], exceptions: ['exceptions'],
  admin: ['admin-users', 'admin-vehicles', 'admin-outlets', 'admin-settings', 'admin-data', 'admin-audit'], reference: ['reference'],
  notifications: ['notifications'], clock: ['clock'],
};

export type LiveState = 'connecting' | 'live' | 'offline';

export function useLiveUpdates(enabled = true): LiveState {
  const qc = useQueryClient();
  const [state, setState] = useState<LiveState>('connecting');
  useEffect(() => {
    if (!enabled || typeof EventSource === 'undefined') return;
    let es: EventSource | null = null;
    let stopped = false;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let backoff = 2000;
    const connect = async () => {
      if (stopped || !session.token()) return;
      setState('connecting');
      try {
        const { ticket } = await post<{ ticket: string }>('/events/ticket');
        if (stopped) return;
        es = new EventSource(`/api/events?ticket=${encodeURIComponent(ticket)}`);
        es.addEventListener('hello', () => { setState('live'); backoff = 2000; });
        es.onmessage = e => {
          try {
            const { topics } = JSON.parse(e.data) as { topics: string[] };
            if (topics.includes('clock')) void syncClock(); // the dispatcher moved the demo clock
            const keys = new Set(topics.flatMap(t => KEYS[t] ?? []));
            keys.forEach(k => qc.invalidateQueries({ queryKey: [k] }));
          } catch { /* ignore malformed */ }
        };
        es.onerror = () => { es?.close(); es = null; setState('offline'); schedule(); };
      } catch { setState('offline'); schedule(); }
    };
    const schedule = () => { if (stopped) return; retry = setTimeout(connect, backoff); backoff = Math.min(backoff * 2, 30_000); };
    void connect();
    const onOnline = () => { if (!es) { if (retry) clearTimeout(retry); backoff = 2000; void connect(); } };
    window.addEventListener('online', onOnline);
    return () => { stopped = true; es?.close(); if (retry) clearTimeout(retry); window.removeEventListener('online', onOnline); };
  }, [enabled, qc]);
  return state;
}
