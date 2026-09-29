export const toMin = (hhmm: string): number => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + (m || 0); };
export const toHHMM = (min: number): string => {
  const m = Math.round(min);
  return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(((m % 60) + 60) % 60).padStart(2, '0')}`;
};
/** "10:30–12:30" → [630, 750] */
export const parseWindow = (w?: string | null): [number, number] | null => {
  if (!w) return null;
  const [a, b] = w.split(/[–-]/).map(s => s.trim());
  return a && b ? [toMin(a), toMin(b)] : null;
};
