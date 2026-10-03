import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient, type UseQueryOptions } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Download, ImageOff, Info, X } from 'lucide-react';
import { api, ApiError, download, fetchBlob } from '../lib/api';
import { STATUS } from './StatusChip';
import { Spinner, cx } from './ds';

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

/* ── States ── */
/* The one loading state. Default fills its container; `page` centres it on the whole screen; `inline` is a small spinner + label. */
export function Loading({ label = 'Loading…', className, variant = 'block' }: { label?: string; className?: string; variant?: 'block' | 'page' | 'inline' }) {
  if (variant === 'inline') return <span className={cx('inline-flex items-center gap-2 text-[13px] text-slate-500', className)}><Spinner size={14} />{label}</span>;
  return (
    <div className={cx('flex flex-col items-center justify-center gap-3 text-[13px] text-slate-500', variant === 'page' ? 'min-h-[100dvh]' : 'py-16', className)} role="status" aria-live="polite">
      <Spinner size={28} className="text-teal-700" />
      <span>{label}</span>
    </div>
  );
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

/* ── Live-update indicator ── */
export function LiveDot({ state }: { state: 'connecting' | 'live' | 'offline' }) {
  const label = state === 'live' ? 'Live' : state === 'connecting' ? 'Connecting' : 'Reconnecting';
  return (
    <span title={state === 'live' ? 'Screens update as soon as something changes' : 'Live updates paused — screens still refresh every few seconds'}
      className="hidden md:inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full text-[11px] font-semibold text-slate-600 bg-slate-100">
      <span className={cx('w-1.5 h-1.5 rounded-full', state === 'live' ? 'bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,.2)]' : state === 'connecting' ? 'bg-amber-400' : 'bg-slate-400')} />{label}
    </span>
  );
}

/* ── Protected images (proof photos, signatures): fetched with the session token ── */
export function AuthImage({ src, alt, className }: { src: string | null | undefined; alt: string; className?: string }) {
  const [state, setState] = useState<{ url?: string; error?: string }>({});
  useEffect(() => {
    if (!src) return;
    if (src.startsWith('data:')) { setState({ url: src }); return; }
    let revoked: string | null = null, live = true;
    setState({});
    fetchBlob(src).then(f => { revoked = f.url; if (live) setState({ url: f.url }); }).catch(e => live && setState({ error: e.message }));
    return () => { live = false; if (revoked) URL.revokeObjectURL(revoked); };
  }, [src]);
  if (!src) return null;
  if (state.error) return <div className={cx('flex items-center justify-center gap-1.5 bg-slate-50 text-[12px] text-slate-500 rounded-lg', className)}><ImageOff size={14} />Photo unavailable</div>;
  if (!state.url) return <div className={cx('flex items-center justify-center bg-slate-50 rounded-lg', className)}><Spinner size={16} className="text-slate-400" /></div>;
  return <a href={state.url} target="_blank" rel="noreferrer"><img src={state.url} alt={alt} className={cx('object-cover rounded-lg', className)} /></a>;
}

/* ── File download with the session token (CSV exports) ── */
export function DownloadButton({ path, name, children, className }: { path: string; name: string; children: ReactNode; className?: string }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <button type="button" disabled={busy} className={cx('inline-flex items-center gap-1.5 h-9 px-3 rounded-md text-[13px] font-semibold text-slate-700 bg-white ring-1 ring-[#D0D5DD] hover:bg-slate-50 disabled:opacity-60', className)}
      onClick={async () => { setBusy(true); try { await download(path, name); } catch (e: any) { toast('error', e.message); } finally { setBusy(false); } }}>
      {busy ? <Spinner size={14} /> : <Download size={14} />}{children}
    </button>
  );
}

/** Downscale a photo on the device before it is uploaded (keeps sync batches small on 3G). */
export async function compressImage(file: File, maxSide = 1280, quality = 0.72): Promise<string> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) && !file.type.startsWith('image/')) throw new Error('Choose a photo (JPEG, PNG or WebP).');
  const bmp = await createImageBitmap(file).catch(() => null);
  if (!bmp) throw new Error('That photo could not be read. Try another one.');
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', quality);
}
