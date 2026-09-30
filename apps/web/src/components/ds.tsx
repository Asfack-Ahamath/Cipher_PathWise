/* ────────────────────────────────────────────────────────────
   Pathwise design system — the primitives every screen uses.
   Type scale: 11 overline · 12 meta · 13 body · 14 emphasis ·
   16 card title (mobile body) · 20 page title · 28 metric.
   Spacing: 4 / 8 / 12 / 16 / 24 / 32. Radius: 6 controls,
   8 cards, 12 sheets, full chips. One border colour: #E4E7EC.
   ──────────────────────────────────────────────────────────── */
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';

const cx = (...c: (string | false | undefined | null)[]) => c.filter(Boolean).join(' ');

/* ── Button ── */
type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'warning';
type Size = 'sm' | 'md' | 'lg' | 'xl';
const V: Record<Variant, string> = {
  primary: 'text-white bg-gradient-to-b from-teal-500 to-teal-700 shadow-[0_1px_2px_rgba(15,118,110,.3),inset_0_1px_0_rgba(255,255,255,.18)] hover:from-teal-600 hover:to-teal-800 disabled:from-slate-200 disabled:to-slate-200 disabled:text-slate-400 disabled:shadow-none',
  secondary: 'bg-white text-slate-700 border border-[#D9DEE7] shadow-[0_1px_2px_rgba(16,24,40,.05)] hover:bg-slate-50 disabled:text-slate-300',
  ghost: 'bg-transparent text-slate-600 hover:bg-slate-100 disabled:text-slate-300',
  danger: 'bg-white text-red-700 border border-red-200 hover:bg-red-50',
  warning: 'bg-amber-600 text-white hover:bg-amber-700',
};
const S: Record<Size, string> = {
  sm: 'h-8 px-3 text-[12px] gap-1.5 rounded-md',
  md: 'h-9 px-3.5 text-[13px] gap-2 rounded-md',
  lg: 'h-11 px-4 text-[14px] gap-2 rounded-lg',
  xl: 'h-14 px-5 text-[16px] gap-2 rounded-xl',
};
export function Button({ variant = 'secondary', size = 'md', icon, full, className, children, ...rest }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; icon?: ReactNode; full?: boolean }) {
  return (
    <button {...rest} className={cx('inline-flex items-center justify-center font-semibold whitespace-nowrap transition-colors disabled:cursor-not-allowed', V[variant], S[size], full && 'w-full', className)}>
      {icon}{children}
    </button>
  );
}

/* ── Surfaces ── */
export function Card({ children, className, pad = true }: { children: ReactNode; className?: string; pad?: boolean }) {
  return <section className={cx('bg-white rounded-xl border border-[#E6E9F0] shadow-[0_1px_2px_rgba(16,24,40,.04),0_12px_32px_-20px_rgba(16,24,40,.18)]', pad && 'p-5', className)}>{children}</section>;
}
export function CardHeader({ title, subtitle, icon, action, className }: { title: ReactNode; subtitle?: ReactNode; icon?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cx('flex items-start justify-between gap-3 mb-4', className)}>
      <div className="flex items-start gap-2.5 min-w-0">
        {icon && <span className="mt-0.5 text-slate-500 flex-shrink-0">{icon}</span>}
        <div className="min-w-0">
          <h3 className="text-[14px] font-semibold text-slate-900 leading-5">{title}</h3>
          {subtitle && <p className="text-[12px] text-slate-500 leading-4 mt-0.5">{subtitle}</p>}
        </div>
      </div>
      {action && <div className="flex-shrink-0">{action}</div>}
    </div>
  );
}

/* ── Page frame: centred, fluid up to 1600 px so wide screens never leave a gap on one side ── */
export function Page({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('mx-auto w-full max-w-[1600px] px-6 py-6 space-y-6', className)}>{children}</div>;
}
export function PageHeader({ title, subtitle, actions, children, icon, hue = 'teal' }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children?: ReactNode; icon?: ReactNode; hue?: Hue }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0 flex items-center gap-3">{icon && <IconChip hue={hue} size={40}>{icon}</IconChip>}<div className="min-w-0">
        <h1 className="text-[20px] font-semibold text-slate-900 leading-7 tracking-[-0.01em]">{title}</h1>
        {subtitle && <p className="text-[13px] text-slate-500 leading-5 mt-0.5">{subtitle}</p>}
        {children}
      </div></div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
/* Full-height split views (queue, board, tracking, exceptions) use a toolbar strip instead */
export function Toolbar({ title, subtitle, actions, children, icon, hue = 'teal' }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children?: ReactNode; icon?: ReactNode; hue?: Hue }) {
  return (
    <div className="flex-shrink-0 bg-white border-b border-[#E4E7EC] px-6 py-4">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 flex items-center gap-3">{icon && <IconChip hue={hue} size={40}>{icon}</IconChip>}<div className="min-w-0">
          <h1 className="text-[20px] font-semibold text-slate-900 leading-7 tracking-[-0.01em]">{title}</h1>
          {subtitle && <p className="text-[13px] text-slate-500 leading-5">{subtitle}</p>}
        </div></div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </div>
  );
}

/* ── Callout: one pattern for every advisory, never a random tint ── */
type Tone = 'neutral' | 'info' | 'warning' | 'danger' | 'success';
const TONE: Record<Tone, { box: string; icon: ReactNode }> = {
  neutral: { box: 'bg-slate-50 border-[#E4E7EC] text-slate-700', icon: <Info size={15} className="text-slate-500" /> },
  info: { box: 'bg-sky-50 border-sky-200 text-sky-900', icon: <Info size={15} className="text-sky-600" /> },
  warning: { box: 'bg-amber-50 border-amber-200 text-amber-900', icon: <AlertTriangle size={15} className="text-amber-600" /> },
  danger: { box: 'bg-red-50 border-red-200 text-red-900', icon: <XCircle size={15} className="text-red-600" /> },
  success: { box: 'bg-emerald-50 border-emerald-200 text-emerald-900', icon: <CheckCircle2 size={15} className="text-emerald-600" /> },
};
export function Callout({ tone = 'neutral', title, children, icon, action, className }: { tone?: Tone; title?: ReactNode; children?: ReactNode; icon?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cx('flex items-start gap-2.5 rounded-lg border px-3.5 py-3', TONE[tone].box, className)}>
      <span className="mt-[1px] flex-shrink-0">{icon ?? TONE[tone].icon}</span>
      <div className="flex-1 min-w-0 text-[13px] leading-5">
        {title && <div className="font-semibold">{title}</div>}
        {children && <div className={title ? 'opacity-90' : ''}>{children}</div>}
        {action && <div className="mt-2">{action}</div>}
      </div>
    </div>
  );
}

/* ── Overline label ── */
export function Overline({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500', className)}>{children}</div>;
}

/* ── Metric ── */
export function Metric({ label, value, unit, tone = 'default', hint }: { label: string; value: ReactNode; unit?: string; tone?: 'default' | 'good' | 'warn' | 'bad'; hint?: ReactNode }) {
  const c = { default: 'text-slate-900', good: 'text-teal-700', warn: 'text-amber-700', bad: 'text-red-600' }[tone];
  return (
    <div className="min-w-0">
      <Overline>{label}</Overline>
      <div className={cx('mt-1 text-[24px] font-semibold leading-8 tabular tracking-[-0.01em]', c)}>{value}{unit && <span className="text-[13px] font-medium text-slate-500 ml-1">{unit}</span>}</div>
      {hint && <div className="text-[12px] text-slate-500 leading-4 mt-0.5">{hint}</div>}
    </div>
  );
}

/* ── Tabs (underline) and segmented filter ── */
export function Tabs<T extends string>({ items, value, onChange, className }: { items: { id: T; label: ReactNode }[]; value: T; onChange: (v: T) => void; className?: string }) {
  return (
    <div role="tablist" className={cx('flex items-center gap-5 border-b border-[#E4E7EC]', className)}>
      {items.map(i => (
        <button key={i.id} role="tab" aria-selected={value === i.id} onClick={() => onChange(i.id)}
          className={cx('-mb-px h-10 border-b-2 text-[13px] font-semibold whitespace-nowrap transition-colors', value === i.id ? 'border-teal-700 text-teal-800' : 'border-transparent text-slate-500 hover:text-slate-800')}>
          {i.label}
        </button>
      ))}
    </div>
  );
}
export function Segmented<T extends string>({ options, value, onChange, size = 'md' }: { options: { id: T; label: ReactNode }[]; value: T; onChange: (v: T) => void; size?: 'sm' | 'md' }) {
  return (
    <div className="inline-flex items-center rounded-lg bg-slate-100 p-0.5">
      {options.map(o => (
        <button key={o.id} onClick={() => onChange(o.id)}
          className={cx('rounded-md font-semibold whitespace-nowrap transition-colors', size === 'sm' ? 'h-7 px-2.5 text-[12px]' : 'h-8 px-3 text-[12px]', value === o.id ? 'bg-white text-slate-900 shadow-[0_1px_2px_rgba(16,24,40,.08)]' : 'text-slate-500 hover:text-slate-800')}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ── Key/value list ── */
export function KeyValues({ items, cols = 2 }: { items: [ReactNode, ReactNode][]; cols?: 2 | 3 }) {
  return (
    <dl className={cx('grid gap-x-4 gap-y-3', cols === 3 ? 'grid-cols-3' : 'grid-cols-2')}>
      {items.map(([k, v], i) => (
        <div key={i} className="min-w-0"><dt className="text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500">{k}</dt><dd className="mt-0.5 text-[13px] font-medium text-slate-900 tabular">{v}</dd></div>
      ))}
    </dl>
  );
}

/* ── Split panes ── */
export function Split({ children }: { children: ReactNode }) {
  return <div className="flex flex-1 min-h-0 overflow-hidden">{children}</div>;
}
export function Pane({ children, className, side }: { children: ReactNode; className?: string; side?: 'left' | 'right' }) {
  return <div className={cx('flex flex-col min-h-0 overflow-hidden bg-white', side === 'left' && 'border-r border-[#E4E7EC]', side === 'right' && 'border-l border-[#E4E7EC]', className)}>{children}</div>;
}
export function PaneHeader({ title, meta, children }: { title: ReactNode; meta?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex-shrink-0 px-5 py-3.5 border-b border-[#E4E7EC]">
      <div className="flex items-center justify-between gap-2"><h2 className="text-[14px] font-semibold text-slate-900">{title}</h2>{meta}</div>
      {children}
    </div>
  );
}

export function Count({ n, tone = 'neutral' }: { n: number | string; tone?: 'neutral' | 'warn' | 'bad' | 'good' }) {
  const c = { neutral: 'bg-slate-100 text-slate-600', warn: 'bg-amber-100 text-amber-800', bad: 'bg-red-100 text-red-700', good: 'bg-emerald-100 text-emerald-700' }[tone];
  return <span className={cx('inline-flex min-w-[22px] h-[20px] items-center justify-center rounded-full px-1.5 text-[11px] font-semibold tabular', c)}>{n}</span>;
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-12 px-6 text-slate-500">
      {icon && <div className="mb-3 text-slate-300">{icon}</div>}
      <div className="text-[14px] font-semibold text-slate-700">{title}</div>
      {children && <div className="text-[13px] mt-1 max-w-[320px]">{children}</div>}
    </div>
  );
}

export { cx };

/* ── Detail panel: docked on wide screens, slides over the content below 1280 px ── */
export function DetailPanel({ open, onClose, children, width = 380 }: { open: boolean; onClose: () => void; children: ReactNode; width?: number }) {
  if (!open) return null;
  return (
    <>
      <div className="xl:hidden fixed inset-0 z-30 bg-slate-900/20" onClick={onClose} />
      <aside style={{ width }} className="fixed xl:static right-0 top-0 bottom-12 z-40 flex-shrink-0 flex flex-col bg-white border-l border-[#E4E7EC] shadow-[-12px_0_32px_-16px_rgba(15,23,42,.25)] xl:shadow-none min-h-0">
        {children}
      </aside>
    </>
  );
}

/* ── Modal ── */
export function Modal({ title, onClose, children, width = 480 }: { title: ReactNode; onClose: () => void; children: ReactNode; width?: number }) {
  return (
    <div className="fixed inset-0 z-[1100] flex items-center justify-center p-4 bg-slate-900/40" onClick={onClose}>
      <div role="dialog" aria-modal="true" style={{ width }} className="max-w-full bg-white rounded-xl shadow-[0_24px_48px_-12px_rgba(15,23,42,.35)]" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 h-14 border-b border-[#E4E7EC]">
          <h3 className="text-[16px] font-semibold text-slate-900">{title}</h3>
          <button onClick={onClose} aria-label="Close" className="w-8 h-8 -mr-2 flex items-center justify-center rounded-md text-slate-400 hover:bg-slate-100">✕</button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}

/* ── Form field ── */
export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="block text-[12px] font-semibold text-slate-700 mb-1.5">{label}</span>
      {children}
      {hint && <span className="block text-[12px] text-slate-500 mt-1">{hint}</span>}
    </label>
  );
}
export const inputCls = 'w-full h-9 px-3 text-[13px] text-slate-900 bg-white border border-[#D0D5DD] rounded-md placeholder:text-slate-400 focus:outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-600/15';

/* ── Status pill (lifecycle + connectivity) ── */
export function Pill({ label, color, bg, icon }: { label: string; color: string; bg: string; icon?: ReactNode }) {
  return <span className="inline-flex items-center gap-1 h-[22px] px-2 rounded-full text-[12px] font-semibold whitespace-nowrap" style={{ color, background: bg }}>{icon}{label}</span>;
}

/* ── Colour identity. Each area of the product owns one hue; status colours stay reserved. ── */
export type Hue = 'teal' | 'indigo' | 'violet' | 'sky' | 'amber' | 'rose' | 'emerald' | 'slate';
export const HUE: Record<Hue, { from: string; to: string; soft: string; ink: string; ring: string }> = {
  teal:    { from: '#14B8A6', to: '#0F766E', soft: '#E6FAF7', ink: '#0F766E', ring: '#99F6E4' },
  indigo:  { from: '#818CF8', to: '#4F46E5', soft: '#EEF0FF', ink: '#4338CA', ring: '#C7D2FE' },
  violet:  { from: '#A78BFA', to: '#7C3AED', soft: '#F3EEFF', ink: '#6D28D9', ring: '#DDD6FE' },
  sky:     { from: '#38BDF8', to: '#0284C7', soft: '#E8F6FE', ink: '#0369A1', ring: '#BAE6FD' },
  amber:   { from: '#FBBF24', to: '#D97706', soft: '#FFF6E5', ink: '#B45309', ring: '#FDE68A' },
  rose:    { from: '#FB7185', to: '#E11D48', soft: '#FFEEF1', ink: '#BE123C', ring: '#FECDD3' },
  emerald: { from: '#34D399', to: '#059669', soft: '#E8FBF3', ink: '#047857', ring: '#A7F3D0' },
  slate:   { from: '#94A3B8', to: '#475569', soft: '#F1F4F8', ink: '#334155', ring: '#E2E8F0' },
};
export function IconChip({ hue = 'teal', children, size = 36, soft = false }: { hue?: Hue; children: ReactNode; size?: number; soft?: boolean }) {
  const h = HUE[hue];
  return (
    <span className="inline-flex items-center justify-center flex-shrink-0 rounded-[10px]" style={{ width: size, height: size, color: soft ? h.ink : '#fff', background: soft ? h.soft : `linear-gradient(135deg, ${h.from}, ${h.to})`, boxShadow: soft ? undefined : `0 6px 14px -6px ${h.to}99` }}>
      {children}
    </span>
  );
}

/** Role colours: one gradient per app, used on the app header and sign-in. Offline is always slate. */
export const ROLE_GRAD = {
  dispatcher: 'linear-gradient(120deg,#0F766E,#0E7490 45%,#4338CA)',
  loader: 'linear-gradient(120deg,#6D28D9,#4338CA)',
  driver: 'linear-gradient(120deg,#0369A1,#1D4ED8)',
  store: 'linear-gradient(120deg,#B45309,#C2410C)',
  offline: 'linear-gradient(120deg,#334155,#475569)',
} as const;
export const ROLE_SOLID = { dispatcher: '#0F766E', loader: '#6D28D9', driver: '#0369A1', store: '#B45309', offline: '#334155' } as const;
