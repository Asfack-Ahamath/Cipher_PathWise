import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient, type UseQueryOptions } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Info, Loader2, X } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { STATUS } from './StatusChip';
import { cx } from './ds';

/* ── Toasts ── */
type ToastT = { id: number; tone: 'success' | 'error' | 'info'; text: string };
const ToastCtx = createContext<(tone: ToastT['tone'], text: string) => void>(() => {});
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastT[]>([]);
  const push = useCallback((tone: ToastT['tone'], text: string) => {
    const id = Date.now() + Math.random();
    setItems(i => [...i.slice(-3), { id, tone, text }]);
    setTimeout(() => setItems(i => i.filter(x => x.id !== id)), tone === 'error' ? 7000 : 4000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="fixed z-[70] bottom-4 left-1/2 -translate-x-1/2 w-[min(440px,calc(100vw-24px))] space-y-2 pointer-events-none" aria-live="polite">
        {items.map(t => (
          <div key={t.id} className={cx('pointer-events-auto flex items-start gap-2.5 rounded-xl px-4 py-3 text-[13px] font-medium shadow-[0_16px_40px_-12px_rgba(15,23,42,.35)]',
            t.tone === 'success' ? 'bg-slate-900 text-white' : t.tone === 'error' ? 'bg-red-600 text-white' : 'bg-slate-800 text-white')}>
            {t.tone === 'success' ? <CheckCircle2 size={16} className="text-emerald-300 mt-[1px] flex-shrink-0" /> : t.tone === 'error' ? <AlertTriangle size={16} className="mt-[1px] flex-shrink-0" /> : <Info size={16} className="text-sky-300 mt-[1px] flex-shrink-0" />}
            <span className="flex-1">{t.text}</span>
            <button onClick={() => setItems(i => i.filter(x => x.id !== t.id))} aria-label="Dismiss" className="opacity-60 hover:opacity-100"><X size={14} /></button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

/* ── Data hooks ── */
export function useApi<T = any>(key: unknown[], path: string | null, opts: Partial<UseQueryOptions<T>> = {}) {
  return useQuery<T>({ queryKey: key, queryFn: ({ signal }) => api<T>(path!, { signal }), enabled: !!path, ...opts } as UseQueryOptions<T>);
}

/** A write that shows a toast and refreshes the listed queries (by key prefix). */
export function useAct<A = void, R = any>(fn: (a: A) => Promise<R>, opts: { success?: string | ((r: R, a: A) => string | null); invalidate?: string[]; onDone?: (r: R, a: A) => void; onError?: (e: ApiError) => void } = {}) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<R, ApiError, A>({
    mutationFn: fn,
    onSuccess: (r, a) => {
      const msg = typeof opts.success === 'function' ? opts.success(r, a) : opts.success;
      if (msg) toast('success', msg);
      (opts.invalidate ?? []).forEach(k => qc.invalidateQueries({ queryKey: [k] }));
      opts.onDone?.(r, a);
    },
    onError: e => { if (opts.onError) opts.onError(e); else toast('error', e.message); },
  });
}

export function useReference() {
  return useApi<any>(['reference'], '/reference', { staleTime: 5 * 60_000 });
}
export function useOutlets() {
  const r = useReference();
  const map = new Map<string, any>((r.data?.outlets ?? []).map((o: any) => [o.id, o]));
  return map;
}

/* ── States ── */
export function Loading({ label = 'Loading…', className }: { label?: string; className?: string }) {
  return <div className={cx('flex items-center justify-center gap-2 py-16 text-[13px] text-slate-500', className)}><Loader2 size={16} className="animate-spin" />{label}</div>;
}
export function ErrorState({ error, retry }: { error: unknown; retry?: () => void }) {
  return (
    <div className="m-6 rounded-xl border border-red-200 bg-red-50 p-4 text-[13px] text-red-900 flex items-start gap-2.5">
      <AlertTriangle size={16} className="text-red-600 mt-[1px]" />
      <div className="flex-1"><div className="font-semibold">Could not load this screen</div><div>{(error as any)?.message ?? String(error)}</div></div>
      {retry && <button onClick={retry} className="text-[12px] font-semibold underline">Try again</button>}
    </div>
  );
}

/* ── Status chip for any order / trip status ── */
const MAP: Record<string, keyof typeof STATUS> = {
  confirmed: 'confirmed', planned: 'planned', loading: 'loading', loaded: 'loaded', released: 'loaded', out_for_delivery: 'outForDel', in_progress: 'outForDel',
  delivered: 'delivered', received: 'received', deferred: 'deferred', partial: 'partial', failed: 'failed', disputed: 'disputed', completed: 'delivered', blocked: 'failed', cancelled: 'offline',
};
const LABEL: Record<string, string> = { released: 'Released', in_progress: 'On the road', completed: 'Completed', blocked: 'Blocked', cancelled: 'Cancelled' };
export function Status({ s, size = 'md' }: { s: string; size?: 'sm' | 'md' }) {
  const k = MAP[s] ?? 'offline';
  const st = STATUS[k];
  const pad = size === 'sm' ? 'px-1.5 py-0.5 text-[11px]' : 'px-2 py-1 text-[12px]';
  return <span className={`inline-flex items-center gap-1 rounded-full font-semibold leading-none whitespace-nowrap ${pad}`} style={{ color: st.color, background: st.bg }}>{LABEL[s] ?? st.label}</span>;
}

export const fmt = (n: number | null | undefined, d = 0) => n == null ? '—' : Number(n).toLocaleString('en-GB', { minimumFractionDigits: d, maximumFractionDigits: d });
export const shortOutlet = (name?: string) => (name ?? '').replace(/^Waypoint (Fresh|Style|Tech) /, '').replace(/ · OUT\d+$/, '');
