import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Search } from 'lucide-react';
import { cx } from './ds';

export type SelectOption<T extends string = string> = { value: T; label: ReactNode; text?: string; hint?: ReactNode; icon?: ReactNode; disabled?: boolean };

type Props<T extends string> = {
  value: T;
  onChange: (v: T) => void;
  options: SelectOption<T>[];
  placeholder?: string;
  'aria-label'?: string;
  size?: 'sm' | 'md';
  disabled?: boolean;
  invalid?: boolean;
  /** Show a search box in the list; defaults to on when there are more than 10 options. */
  searchable?: boolean;
  className?: string;
  /** Width of the list when it should be wider than the trigger. */
  menuWidth?: number;
  /** Replace the field-style trigger with your own content (e.g. a ⋮ icon); styled by triggerClassName. */
  trigger?: ReactNode;
  triggerClassName?: string;
};

const coarse = () => typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;
const plain = (o: SelectOption) => o.text ?? (typeof o.label === 'string' ? o.label : String(o.value));

/** A dropdown that matches the design system on desktop and falls back to the native picker on touch screens,
 *  where the phone's own wheel or sheet is easier to use. Keyboard: arrows, Home/End, Enter, Escape, type to jump. */
export function Select<T extends string>({ value, onChange, options, placeholder = 'Choose…', size = 'md', disabled, invalid, searchable, className, menuWidth, trigger, triggerClassName, ...aria }: Props<T>) {
  const [touch] = useState(coarse);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [query, setQuery] = useState('');
  const [pos, setPos] = useState<{ left: number; top: number; width: number; up: boolean; maxH: number; vh: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const typed = useRef({ s: '', t: 0 });
  const id = useId();
  const current = options.find(o => o.value === value);
  const search = searchable ?? options.length > 10;
  const shown = useMemo(() => (query ? options.filter(o => plain(o).toLowerCase().includes(query.toLowerCase())) : options), [options, query]);
  const h = size === 'sm' ? 'h-8 text-[12px]' : 'h-9 text-[13px]';
  const frame = cx('w-full flex items-center gap-2 pl-3 pr-2.5 bg-white border rounded-md text-left transition-colors focus:outline-none focus-visible:ring-2 disabled:bg-slate-50 disabled:text-slate-400 disabled:cursor-not-allowed', h,
    invalid ? 'border-red-400 focus-visible:ring-red-500/15' : 'border-[#D0D5DD] hover:border-slate-400 focus-visible:border-indigo-500 focus-visible:ring-indigo-500/15', className);

  /* Inside a CSS-zoomed shell, rects are in screen pixels but fixed positions are in the shell's own (smaller) pixels. */
  const host = () => (btn.current?.closest('.pw-zoom') as HTMLElement | null) ?? document.body;
  const place = () => {
    const el = btn.current, r = el?.getBoundingClientRect();
    if (!el || !r) return;
    const z = host() === document.body ? 1 : parseFloat(getComputedStyle(host()).zoom) || 1;
    const vw = window.innerWidth / z, vh = window.innerHeight / z;
    const left = r.left / z, top = r.top / z, bottom = r.bottom / z;
    const below = vh - bottom - 12, above = top - 12;
    const up = below < 240 && above > below;
    const width = Math.max(r.width / z, menuWidth ?? 0);
    setPos({ left: Math.max(8, Math.min(left, vw - width - 8)), top: up ? top - 4 : bottom + 4, width, up, maxH: Math.min(320, up ? above : below), vh });
  };
  const show = () => { if (disabled) return; place(); setQuery(''); setActive(Math.max(0, options.findIndex(o => o.value === value))); setOpen(true); };
  const close = (focus = true) => { setOpen(false); if (focus) btn.current?.focus(); };
  const pick = (o?: SelectOption<T>) => { if (!o || o.disabled) return; onChange(o.value); close(); };

  useLayoutEffect(() => { if (open) place(); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!list.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) close(false); };
    const onMove = (e: Event) => { if (!list.current?.contains(e.target as Node)) place(); };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', onMove, true);
    return () => { document.removeEventListener('mousedown', onDown); window.removeEventListener('resize', place); window.removeEventListener('scroll', onMove, true); };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (open) list.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' }); }, [active, open]);

  const step = (from: number, dir: 1 | -1) => {
    for (let i = 1; i <= shown.length; i++) { const n = (from + dir * i + shown.length) % shown.length; if (!shown[n].disabled) return n; }
    return from;
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); show(); }
      return;
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => step(a, 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => step(a, -1)); }
    else if (e.key === 'Home') { e.preventDefault(); setActive(step(-1, 1)); }
    else if (e.key === 'End') { e.preventDefault(); setActive(step(shown.length, -1)); }
    else if (e.key === 'Enter') { e.preventDefault(); pick(shown[active]); }
    else if (e.key === 'Escape' || e.key === 'Tab') { if (e.key === 'Escape') e.preventDefault(); close(e.key === 'Escape'); }
    else if (!search && e.key.length === 1) {
      const t = typed.current, now = Date.now();
      t.s = now - t.t > 600 ? e.key.toLowerCase() : t.s + e.key.toLowerCase(); t.t = now;
      const i = shown.findIndex(o => !o.disabled && plain(o).toLowerCase().startsWith(t.s));
      if (i >= 0) setActive(i);
    }
  };

  if (touch && trigger) {
    // the native picker opens from an invisible select laid over the custom trigger
    return (
      <span className={cx('relative inline-flex items-center justify-center', triggerClassName)}>{trigger}
        <select value={value} disabled={disabled} aria-label={aria['aria-label']} onChange={e => onChange(e.target.value as T)} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer">
          <option value="" disabled>{placeholder}</option>
          {options.map(o => <option key={o.value} value={o.value} disabled={o.disabled}>{plain(o)}</option>)}
        </select>
      </span>
    );
  }
  if (touch) {
    return (
      <span className={cx('relative block', size === 'sm' ? 'min-w-[120px]' : '')}>
        <select value={value} disabled={disabled} aria-label={aria['aria-label']} onChange={e => onChange(e.target.value as T)} className={cx(frame, 'appearance-none pr-8')}>
          {!current && <option value="" disabled>{placeholder}</option>}
          {options.map(o => <option key={o.value} value={o.value} disabled={o.disabled}>{plain(o)}</option>)}
        </select>
        <ChevronDown size={15} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
      </span>
    );
  }

  return (
    <>
      <button ref={btn} type="button" disabled={disabled} onClick={() => (open ? close() : show())} onKeyDown={onKey}
        role="combobox" aria-haspopup="listbox" aria-expanded={open} aria-controls={`${id}-list`} aria-label={aria['aria-label']} className={trigger ? cx('inline-flex items-center justify-center rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/30 disabled:opacity-40', triggerClassName) : frame}>
        {trigger ?? <>
          {current?.icon && <span className="flex-shrink-0 text-slate-500">{current.icon}</span>}
          <span className={cx('flex-1 min-w-0 truncate', !current && 'text-slate-400')}>{current ? current.label : placeholder}</span>
          <ChevronDown size={15} className={cx('flex-shrink-0 text-slate-400 transition-transform', open && 'rotate-180')} />
        </>}
      </button>
      {open && pos && createPortal(
        <div ref={list} onKeyDown={onKey}
          style={{ left: pos.left, width: pos.width, ...(pos.up ? { bottom: pos.vh - pos.top } : { top: pos.top }) }}
          className="fixed z-[1200] bg-white rounded-lg border border-[#E4E7EC] shadow-[0_16px_40px_-12px_rgba(15,23,42,.28)] overflow-hidden anim-menu">
          {search && (
            <div className="p-1.5 border-b border-[#EEF0F3]">
              <span className="relative block"><Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input autoFocus value={query} onChange={e => { setQuery(e.target.value); setActive(0); }} placeholder="Search…" aria-label="Search options"
                  className="w-full h-8 pl-7 pr-2 text-[13px] rounded-md bg-slate-50 border border-transparent focus:outline-none focus:border-indigo-300 focus:bg-white" /></span>
            </div>
          )}
          <div id={`${id}-list`} role="listbox" tabIndex={-1} ref={el => { if (el && !search) el.focus(); }} style={{ maxHeight: pos.maxH - (search ? 46 : 0) }} className="overflow-y-auto p-1 focus:outline-none">
            {shown.length === 0 && <div className="px-3 py-2 text-[13px] text-slate-400">No match</div>}
            {shown.map((o, i) => {
              const sel = o.value === value;
              return (
                <div key={o.value} data-i={i} role="option" aria-selected={sel} aria-disabled={o.disabled || undefined}
                  onMouseEnter={() => !o.disabled && setActive(i)} onMouseDown={e => e.preventDefault()} onClick={() => pick(o)}
                  className={cx('flex items-center gap-2 px-2.5 rounded-md cursor-pointer select-none', size === 'sm' ? 'min-h-8 py-1 text-[12px]' : 'min-h-9 py-1.5 text-[13px]',
                    o.disabled ? 'text-slate-300 cursor-not-allowed' : i === active ? 'bg-indigo-50 text-indigo-900' : 'text-slate-700')}>
                  {o.icon && <span className="flex-shrink-0 text-slate-500">{o.icon}</span>}
                  <span className="flex-1 min-w-0"><span className={cx('block truncate', sel && 'font-semibold')}>{o.label}</span>{o.hint && <span className="block text-[11px] text-slate-500 truncate">{o.hint}</span>}</span>
                  {sel && <Check size={14} className="flex-shrink-0 text-indigo-600" />}
                </div>
              );
            })}
          </div>
        </div>,
        host(),
      )}
    </>
  );
}
