import { useState } from 'react';
import { BarChart3, Info, Wallet, PartyPopper, CloudRain, Snowflake } from 'lucide-react';
import { Toolbar, Card, CardHeader, Callout, Metric, IconChip, cx } from '../../components/ds';
import { ErrorState, Loading, useApi, fmt } from '../../components/common';
import { dayLabel } from '../../lib/clock';
import { useDepot } from './DispatcherApp';

const KIND: Record<string, { label: string; fill: string; opacity: number }> = {
  actual: { label: 'Actual', fill: '#0369A1', opacity: 1 },
  forecast: { label: 'Forecast', fill: '#0369A1', opacity: 0.5 },
  imported: { label: 'Datathon forecast', fill: '#6D28D9', opacity: 0.85 },
};

/* Weekly chilled demand against the chilled capacity the planner can actually use.
   One unit (m³) on one axis; demand and capacity are two bars per week, the gap is printed. */
export default function Forecast() {
  const q = useApi<any>(['forecast'], '/forecast', { staleTime: 60_000 });
  const depot = useDepot();
  const [hover, setHover] = useState<number | null>(null);
  if (q.isLoading) return <Loading label="Running the planner to size capacity…" />;
  if (q.error) return <ErrorState error={q.error} retry={q.refetch} />;
  const f = q.data;
  // the depot switch in the top bar narrows demand and capacity to one depot
  const weeks: any[] = f.weeks.map((w: any) => {
    if (depot === 'all') return w;
    const d = w.byDepot.find((x: any) => x.depot === depot);
    return { ...w, chilled: d.chilled, total: d.total, reeferCap: d.reeferCap, gap: d.reeferCap - d.chilled };
  });
  const todayDemand = depot === 'all' ? f.today.chilledDemandM3 : null;
  const raw = Math.max(...weeks.flatMap(w => [w.chilled, w.reeferCap])) * 1.08;
  const step = [50, 100, 200, 250, 500, 1000].find(s => raw / s <= 5) ?? 1000;
  const max = Math.ceil(raw / step) * step;
  const short = weeks.filter(w => w.gap < 0);
  const perTrip = f.today.chilledServedM3 / Math.max(1, f.today.reefersWorking);
  const W = 1000, H = 300, P = { l: 44, r: 12, t: 12, b: 36 };
  const bw = (W - P.l - P.r) / weeks.length;
  const y = (v: number) => P.t + (H - P.t - P.b) * (1 - v / max);
  const ticks = Array.from({ length: max / step + 1 }, (_, i) => i * step);
  return (
    <div className="flex flex-col flex-1 min-h-0">
      <Toolbar icon={<BarChart3 size={18} />} hue="violet" title="Capacity forecast" subtitle={`Chilled demand against refrigerated capacity, week by week${depot === 'all' ? '' : ` · ${depot} DC`}`} />
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[1200px] px-4 sm:px-6 py-6 space-y-6">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Card><Metric label="Chilled demand today" value={todayDemand == null ? '—' : fmt(todayDemand, 1)} unit={todayDemand == null ? '' : 'm³'} hint={todayDemand == null ? 'Shown for all depots' : undefined} /></Card>
            <Card><Metric label="Planner can carry per day" value={fmt(depot === 'all' ? f.today.chilledServedM3 : f.today.byDepot[depot], 1)} unit="m³" hint={`on ${f.today.reefersWorking} working reefers`} /></Card>
            <Card><Metric label="Weeks short" value={short.length} unit={`of ${weeks.length}`} tone={short.length ? 'bad' : 'good'} /></Card>
            <Card><Metric label="Worst week" value={short.length ? fmt(Math.min(...short.map(w => w.gap))) : '0'} unit="m³" tone={short.length ? 'bad' : 'good'} hint={short.length ? `${short.reduce((a, w) => w.gap < a.gap ? w : a).week}` : 'No shortfall'} /></Card>
          </div>
          <Card>
            <CardHeader icon={<IconChip hue="sky" size={32}><Snowflake size={16} /></IconChip>} title="Chilled m³ per week" subtitle="Demand (dark) vs usable reefer capacity (light). Hover a week for details." />
            <div className="flex flex-wrap gap-4 text-[12px] text-slate-600 mb-2">
              <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded-[3px] bg-[#0369A1]" />Chilled demand (actual)</span>
              <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded-[3px] bg-[#0369A1] opacity-50" />Baseline forecast</span>
              {weeks.some(w => w.kind === 'imported') && <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded-[3px] bg-[#6D28D9]" />Datathon forecast (imported)</span>}
              <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded-[3px] bg-[#7DD3FC]" />Reefer capacity</span>
            </div>
            <div className="overflow-x-auto">
              <svg viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[560px]" role="img" aria-label="Weekly chilled demand and capacity">
                {ticks.map(t => <g key={t}><line x1={P.l} x2={W - P.r} y1={y(t)} y2={y(t)} stroke="#EEF1F5" /><text x={P.l - 6} y={y(t) + 4} textAnchor="end" fontSize="10" fill="#94A3B8">{t}</text></g>)}
                {weeks.map((w, i) => {
                  const x = P.l + i * bw; const b = Math.min(22, bw / 3.2);
                  return (
                    <g key={w.week} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                      <rect x={x} y={P.t} width={bw} height={H - P.t - P.b} fill={hover === i ? '#F8FAFC' : 'transparent'} />
                      <rect x={x + bw / 2 - b - 1} y={y(w.chilled)} width={b} height={y(0) - y(w.chilled)} rx={4} fill={KIND[w.kind]?.fill ?? '#0369A1'} opacity={KIND[w.kind]?.opacity ?? 1} />
                      <rect x={x + bw / 2 + 1} y={y(w.reeferCap)} width={b} height={y(0) - y(w.reeferCap)} rx={4} fill="#7DD3FC" />
                      {w.gap < 0 && <text x={x + bw / 2} y={y(Math.max(w.chilled, w.reeferCap)) - 5} textAnchor="middle" fontSize="10" fontWeight="600" fill="#BE123C">{w.gap}</text>}
                      <text x={x + bw / 2} y={H - P.b + 14} textAnchor="middle" fontSize="11" fontWeight="600" fill="#334155">{w.week}</text>
                      <text x={x + bw / 2} y={H - P.b + 27} textAnchor="middle" fontSize="9" fill="#94A3B8">{dayLabel(w.start).split(' ').slice(1).join(' ')}</text>
                    </g>
                  );
                })}
              </svg>
            </div>
            {hover !== null && (() => { const w = weeks[hover]; return (
              <div className="mt-2 rounded-lg bg-slate-900 text-white text-[12px] px-3 py-2 inline-block">
                <b>{w.week}</b> · {KIND[w.kind]?.label} · {dayLabel(w.start)}–{dayLabel(w.end)} · {w.opDays} operating days · demand {fmt(w.chilled)} m³ · capacity {fmt(w.reeferCap)} m³ · {w.gap < 0 ? `short ${-w.gap} m³ (~${Math.ceil(-w.gap / Math.max(1, perTrip))} extra reefer-days)` : `spare ${w.gap} m³`}
              </div>); })()}
          </Card>
          <Card pad={false}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[960px] text-[13px]">
                <thead className="bg-[#F9FAFB] border-b border-[#E4E7EC]"><tr>{['Week', 'Source', 'Dates', 'Operating days', 'Calendar', 'All volume', 'Chilled demand', 'Capacity', 'Gap'].map(h => <th key={h} className="text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500 px-4 h-10">{h}</th>)}</tr></thead>
                <tbody>
                  {weeks.map(w => (
                    <tr key={w.week} className="border-t border-[#EEF0F3]">
                      <td className="px-4 py-3 font-semibold text-slate-900">{w.week}</td>
                      <td className="px-4 py-3"><span className={cx('inline-flex h-6 px-2 items-center rounded-full text-[11px] font-semibold', w.kind === 'actual' ? 'bg-sky-50 text-sky-800' : w.kind === 'imported' ? 'bg-violet-50 text-violet-800' : 'bg-slate-100 text-slate-600')}>{KIND[w.kind]?.label}</span></td>
                      <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{dayLabel(w.start)} – {dayLabel(w.end)}</td>
                      <td className="px-4 py-3 tabular">{w.opDays}</td>
                      <td className="px-4 py-3"><span className="flex flex-wrap gap-2 text-[12px] text-slate-600">
                        {w.paydays > 0 && <span className="inline-flex items-center gap-1"><Wallet size={12} className="text-amber-600" />{w.paydays} payday{w.paydays > 1 ? 's' : ''}</span>}
                        {Number(w.ramp) > 0 && <span className="inline-flex items-center gap-1"><PartyPopper size={12} className="text-violet-600" />festival ramp {w.ramp}</span>}
                        {w.holidays.map((h: string) => <span key={h}>{h}</span>)}
                        {w.monsoon && <span className="inline-flex items-center gap-1"><CloudRain size={12} className="text-sky-600" />monsoon</span>}</span></td>
                      <td className="px-4 py-3 tabular text-slate-600">{fmt(w.total)} m³</td>
                      <td className="px-4 py-3 tabular">{fmt(w.chilled)} m³</td>
                      <td className="px-4 py-3 tabular">{fmt(w.reeferCap)} m³</td>
                      <td className={cx('px-4 py-3 tabular font-semibold', w.gap < 0 ? 'text-rose-700' : 'text-emerald-700')}>{w.gap > 0 ? '+' : ''}{fmt(w.gap)} m³</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          {short.length > 0 && <Callout tone="warning" title="Refrigerated capacity is the binding limit">At today's fill, {short.length} of the next {weeks.length} weeks need more chilled space than the reefers can carry. Options: hire reefer vans for payday and festival weeks, bring workshop reefers back sooner, or agree larger, less frequent chilled drops with low-volume outlets.</Callout>}
          <Callout tone="neutral" icon={<Info size={15} className="text-slate-500" />}>{f.method} {f.capacityMethod}</Callout>
        </div>
      </div>
    </div>
  );
}
