import { config } from './config.js';
import { one, q, type Db } from './db.js';

/* ──────────────────────────────────────────────────────────────────────────
   Business clock. The seeded delivery day is Thu 30 Apr 2026, so the system
   runs on a clock that starts there and moves at real speed. A dispatcher can
   jump it (e.g. to 06:05 for the dead zone). Every server timestamp and every
   device timestamp (phones read the offset) uses this clock.
   ────────────────────────────────────────────────────────────────────────── */
interface ClockSetting { base: string; setAt: string }
let cache: ClockSetting | null = null;

export async function loadClock(db?: Db): Promise<ClockSetting> {
  const r = await one<{ value: ClockSetting }>(`SELECT value FROM settings WHERE key = 'clock'`, [], db);
  cache = r?.value ?? { base: config.demoClockStart, setAt: new Date().toISOString() };
  return cache;
}
export function nowSync(): Date {
  const c = cache ?? { base: config.demoClockStart, setAt: new Date().toISOString() };
  return new Date(new Date(c.base).getTime() + (Date.now() - new Date(c.setAt).getTime()));
}
export async function now(): Promise<Date> { if (!cache) await loadClock(); return nowSync(); }
export async function setClock(iso: string, db?: Db) {
  const v: ClockSetting = { base: new Date(iso).toISOString(), setAt: new Date().toISOString() };
  await q(`INSERT INTO settings (key, value) VALUES ('clock', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [v], db);
  cache = v;
}

const fmt = (d: Date, opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-GB', { timeZone: config.timeZone, ...opts }).format(d);
/** 'YYYY-MM-DD' in Sri Lanka time */
export const localDate = (d: Date) => { const p = new Intl.DateTimeFormat('en-CA', { timeZone: config.timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d); return p; };
export const localHHMM = (d: Date) => fmt(d, { hour: '2-digit', minute: '2-digit', hour12: false });
export const minutesOfDay = (d: Date) => { const [h, m] = localHHMM(d).split(':').map(Number); return h * 60 + m; };
/** Build a timestamp for a local date + minutes past midnight */
export const atLocal = (date: string, minutes: number) => new Date(`${date}T00:00:00+05:30`).getTime() + minutes * 60000;
export const dayLabel = (date: string) => fmt(new Date(`${date}T12:00:00+05:30`), { weekday: 'short', day: 'numeric', month: 'short' });
