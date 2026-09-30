import { useMemo, useState } from 'react';
import { CheckCircle2, FlaskConical, Info, Search, ShieldAlert, Snowflake, Timer, Truck } from 'lucide-react';
import { Callout, Card, CardHeader, IconChip, Metric, Segmented, Toolbar, cx, inputCls } from '../../components/ds';
import { DownloadButton, ErrorState, Loading, fmt, useApi } from '../../components/common';
import { BrandTag, TempTag } from '../../components/tags';

/* Task 2B, scenario S1: a Peliyagoda peak day with 85 orders and only part of the fleet.
   The same planning engine allocates it, then the official feasibility rules (a port of
   check_allocation.py) are run on the result. The CSV is the submission file. */
export default function PeakDay() {
  const q = useApi<any>(['peak-day'], '/peak-day', { staleTime: Infinity });
  const [filter, setFilter] = useState<'all' | 'served' | 'deferred'>('all');
  const [text, setText] = useState('');
  const rows = useMemo(() => (q.data?.allocation ?? []).filter((a: any) => (filter === 'all' || a.decision === filter) && (!text || `${a.orderId} ${a.outletId} ${a.vehicleId ?? ''} ${a.district}`.toLowerCase().includes(text.toLowerCase()))), [q.data, filter, text]);
  if (q.isLoading) return <Loading label="Allocating the peak day…" />;
  if (q.error) return <ErrorState error={q.error} retry={q.refetch} />;
  const p = q.data;
  const s = p.summary;
  return (
    <div className="flex flex-col flex-1 min-h-0">
      <Toolbar icon={<FlaskConical size={18} />} hue="indigo" title="Peak-day lab · Task 2B (S1)" subtitle={`${p.depot} · ${s.orders} orders · ${s.fleetAvailable} of ${s.fleetListed} listed vehicles available`}
        actions={<DownloadButton path="/peak-day.csv" name="submission_task2b.csv">Download submission CSV</DownloadButton>} />
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[1200px] px-4 sm:px-6 py-6 space-y-6">
          {p.feasibility.passed
            ? <Callout tone="success" icon={<CheckCircle2 size={16} className="text-emerald-600" />} title="Feasible under every official rule">Checked with the same rules as check_allocation.py: vehicle availability and depot, refrigeration for chilled orders, van-only outlets, one brand and one district per trip, weight and volume limits, at most two trips per vehicle, and the trip-time budgets (270 min Fresh, 480 min Style/Tech). Planned in {p.ms} ms.</Callout>
            : <Callout tone="danger" icon={<ShieldAlert size={16} className="text-red-600" />} title={`${p.feasibility.errors.length} rule violation(s)`}><ul className="list-disc pl-4">{p.feasibility.errors.slice(0, 8).map((e: string) => <li key={e}>{e}</li>)}</ul></Callout>}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Card><Metric label="Orders served" value={`${s.served} / ${s.orders}`} tone="good" hint={`${s.deferred} deferred with a reason`} /></Card>
            <Card><Metric label="Trips" value={s.trips} hint={`${s.vehiclesUsed} vehicles used`} /></Card>
            <Card><Metric label="Chilled served" value={`${fmt(s.chilledServedM3, 1)}`} unit={`of ${fmt(s.chilledDemandM3, 1)} m³`} tone={s.chilledServedM3 < s.chilledDemandM3 ? 'warn' : 'good'} /></Card>
            <Card><Metric label="Reefers available" value={s.reefersAvailable} hint="Peliyagoda" /></Card>
          </div>
          {p.limiting && <Callout tone="warning" icon={<Snowflake size={15} className="text-amber-600" />} title="What limits the day">{p.limiting}</Callout>}

          <Card pad={false}>
            <div className="p-4 sm:p-5"><CardHeader icon={<IconChip hue="teal" size={32}><Truck size={16} /></IconChip>} title="Trips" subtitle="Booklet trip time: outbound + inter-stop × (orders − 1) + service allowance per order" /></div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-[13px]">
                <thead className="bg-[#F9FAFB] border-y border-[#E4E7EC]"><tr>{['Vehicle', 'Trip', 'Brand', 'District', 'Orders', 'kg', 'm³', 'Minutes', 'Budget'].map(h => <th key={h} className="text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500 px-4 h-10">{h}</th>)}</tr></thead>
                <tbody>
                  {p.trips.map((t: any) => (
                    <tr key={`${t.vehicleId}-${t.trip}`} className="border-t border-[#EEF0F3]">
                      <td className="px-4 py-2.5 font-semibold text-slate-900">{t.vehicleId}</td><td className="px-4 py-2.5 tabular">{t.trip}</td>
                      <td className="px-4 py-2.5"><BrandTag brand={t.brand} /></td><td className="px-4 py-2.5">{t.district}</td>
                      <td className="px-4 py-2.5 tabular">{t.orders}</td><td className="px-4 py-2.5 tabular">{fmt(t.kg)}</td><td className="px-4 py-2.5 tabular">{fmt(t.m3, 1)}</td>
                      <td className="px-4 py-2.5 tabular font-semibold"><span className="inline-flex items-center gap-1"><Timer size={12} className="text-slate-400" />{t.minutes}</span></td>
                      <td className="px-4 py-2.5"><div className="w-28 h-1.5 rounded-full bg-slate-100 overflow-hidden"><div className={cx('h-full rounded-full', t.minutes / t.budget > 0.9 ? 'bg-amber-500' : 'bg-teal-600')} style={{ width: `${Math.min(100, (t.minutes / t.budget) * 100)}%` }} /></div><div className="text-[11px] text-slate-500 mt-1 tabular">{t.minutes} of {t.budget} min</div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card pad={false}>
            <div className="p-4 sm:p-5 flex flex-wrap items-center justify-between gap-3">
              <CardHeader className="!mb-0" title="Allocation" subtitle="Every order, where it goes, and why deferred orders wait" />
              <div className="flex flex-wrap items-center gap-2">
                <span className="relative"><Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" /><input value={text} onChange={e => setText(e.target.value)} placeholder="Order, outlet, vehicle" className={cx(inputCls, 'pl-8 w-52')} aria-label="Search allocation" /></span>
                <Segmented size="sm" value={filter} onChange={setFilter} options={[{ id: 'all', label: 'All' }, { id: 'served', label: `Served ${s.served}` }, { id: 'deferred', label: `Deferred ${s.deferred}` }]} />
              </div>
            </div>
            <div className="overflow-x-auto max-h-[560px]">
              <table className="w-full min-w-[860px] text-[13px]">
                <thead className="sticky top-0 bg-[#F9FAFB] border-y border-[#E4E7EC]"><tr>{['Order', 'Outlet', 'Brand', 'District', 'Temp', 'kg / m³', 'Decision', 'Vehicle · trip', 'Why'].map(h => <th key={h} className="text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500 px-4 h-10">{h}</th>)}</tr></thead>
                <tbody>
                  {rows.length === 0 && <tr><td colSpan={9} className="px-4 py-8 text-center text-slate-500">No orders match.</td></tr>}
                  {rows.map((a: any) => (
                    <tr key={a.orderId} className="border-t border-[#EEF0F3]">
                      <td className="px-4 py-2.5 font-semibold text-slate-900 tabular">{a.orderId}{a.deferredYesterday && <span className="ml-1.5 text-[11px] font-semibold text-amber-700" title="Deferred yesterday — served first">↺</span>}</td>
                      <td className="px-4 py-2.5">{a.outletId}</td><td className="px-4 py-2.5"><BrandTag brand={a.brand} /></td><td className="px-4 py-2.5">{a.district}</td>
                      <td className="px-4 py-2.5"><TempTag temp={a.temp} /></td><td className="px-4 py-2.5 tabular text-slate-600">{fmt(a.kg)} / {fmt(a.m3, 1)}</td>
                      <td className="px-4 py-2.5"><span className={cx('inline-flex h-6 px-2 items-center rounded-full text-[11px] font-semibold', a.decision === 'served' ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800')}>{a.decision === 'served' ? 'Served' : 'Deferred'}</span></td>
                      <td className="px-4 py-2.5 tabular">{a.vehicleId ? `${a.vehicleId} · ${a.trip}` : '—'}</td>
                      <td className="px-4 py-2.5 text-slate-600 max-w-[280px]">{a.why ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          <Callout tone="neutral" icon={<Info size={15} className="text-slate-500" />}>Orders deferred yesterday (↺) and long-unserved outlets are placed first. The CSV has the exact columns of submission_task2b.csv: scenario, order_ref, outlet_id, decision, vehicle_id, trip_id.</Callout>
        </div>
      </div>
    </div>
  );
}
