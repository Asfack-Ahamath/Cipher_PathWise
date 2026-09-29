import type { ReactNode } from "react";
interface Props {
  label: ReactNode;
  used: number;
  total: number;
  unit?: string;
  decimals?: number;
  warn?: boolean;
  critical?: boolean;
  compact?: boolean;
}

/* Amber from 90 % (or when warn is set), red over the limit. The numbers are always printed — never colour alone. */
export default function CapacityBar({ label, used, total, unit = '', decimals = 1, warn, critical, compact }: Props) {
  const ratio = total > 0 ? used / total : 0;
  const over = critical ?? ratio > 1;
  const amber = !over && (warn ?? ratio >= 0.9);
  const pct = Math.min(ratio * 100, 100);
  const bar = over ? '#DC2626' : amber ? '#D97706' : '#0F766E';
  const fmt = (n: number) => n.toLocaleString('en-GB', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return (
    <div className={compact ? 'space-y-1' : 'space-y-1.5'}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[12px] text-slate-600 truncate">{label}</span>
        <span className="text-[12px] tabular whitespace-nowrap">
          <span className={`font-semibold ${over ? 'text-red-700' : amber ? 'text-amber-700' : 'text-slate-900'}`}>{fmt(used)}</span>
          <span className="text-slate-400"> / {fmt(total)}{unit}</span>
          {over && <span className="ml-1.5 font-semibold text-red-700">Over</span>}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden" role="meter" aria-valuenow={used} aria-valuemax={total}>
        <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${pct}%`, background: bar }} />
      </div>
    </div>
  );
}
