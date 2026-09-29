/* The business clock. The server runs a demo clock (it starts at 02:30 on Thu 30 Apr 2026 and moves in
   real time; the dispatcher can set it). Every client keeps the offset so times stay right offline. */
import { useEffect, useState } from 'react';
import { api, store } from './api';

const KEY = 'pw.clockOffset';
let offset = Number(store.get(KEY) ?? 0) || 0;
const listeners = new Set<() => void>();

export function businessNow(): Date { return new Date(Date.now() + offset); }

export async function syncClock(): Promise<{ now: string; planDate: string; planDateLabel: string } | null> {
  try {
    const t0 = Date.now();
    const r = await api<{ now: string; planDate: string; planDateLabel: string }>('/clock');
    const rtt = Date.now() - t0;
    offset = new Date(r.now).getTime() + rtt / 2 - Date.now();
    store.set(KEY, String(offset));
    store.set('pw.planDate', JSON.stringify({ planDate: r.planDate, planDateLabel: r.planDateLabel }));
    listeners.forEach(l => l());
    return r;
  } catch { return null; }
}

export function useNow(intervalMs = 10_000): Date {
  const [, force] = useState(0);
  useEffect(() => {
    const tick = () => force(n => n + 1);
    listeners.add(tick);
    const id = setInterval(tick, intervalMs);
    return () => { listeners.delete(tick); clearInterval(id); };
  }, [intervalMs]);
  return businessNow();
}

const TZ = 'Asia/Colombo';
export const hhmm = (d: Date | string | null | undefined) => {
  if (!d) return '—';
  const x = typeof d === 'string' ? new Date(d) : d;
  return x.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ });
};
export const dayLabel = (d: Date | string) => {
  const x = typeof d === 'string' ? new Date(d.length === 10 ? `${d}T12:00:00+05:30` : d) : d;
  return x.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: TZ });
};
/** Device time in Sri Lanka local offset, e.g. 2026-04-30T05:17:00+05:30 */
export const isoLocal = (d: Date = businessNow()) => {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).formatToParts(d);
  const g = (t: string) => parts.find(p => p.type === t)?.value ?? '00';
  return `${g('year')}-${g('month')}-${g('day')}T${g('hour') === '24' ? '00' : g('hour')}:${g('minute')}:${g('second')}+05:30`;
};
export const minsAgo = (d: string | null | undefined, now = businessNow()) => d ? Math.max(0, Math.round((now.getTime() - new Date(d).getTime()) / 60000)) : null;
