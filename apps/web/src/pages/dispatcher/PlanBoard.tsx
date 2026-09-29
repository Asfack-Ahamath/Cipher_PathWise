import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { KanbanSquare, ChevronDown, Package, AlertTriangle, XCircle, Snowflake, Search, Truck, Wand2, RotateCcw, X, CheckCircle2, Send, Clock, ShieldCheck, ListChecks, Loader2, MoreVertical } from 'lucide-react';
import CapacityBar from '../../components/CapacityBar';
import { TempTag, OutletBadges, BRAND_COLOR } from '../../components/tags';
import { Toolbar, Button, Callout, Segmented, Pill, Modal, Count, inputCls, Overline, IconChip, HUE, cx, Field } from '../../components/ds';
import { ErrorState, Loading, Status, useAct, useApi, useReference, useToast, fmt } from '../../components/common';
import { del, post, ApiError } from '../../lib/api';
import { hhmm } from '../../lib/clock';
import { useDepot } from './DispatcherApp';

const RULES = ['Weight and volume per trip', 'Chilled goods on reefers only', 'Van-only outlets on vans only', 'Home depot only', 'One brand and one district per trip', 'At most 2 trips per vehicle', 'Fresh ≤ 270 min per vehicle (03:30–08:00)', 'Style + Tech ≤ 480 min per vehicle', 'Delivery windows (mall windows for mall outlets)', 'Weekly fuel quota', 'No vehicle in the workshop'];
const vLabel = (v: any) => `${v.temp === 'reefer' ? 'Reefer' : 'Dry'} ${v.type}`;

function IssueRow({ i }: { i: any }) {
  const err = i.severity === 'error';
  return (
    <div className="flex items-start gap-2.5 py-3 border-b border-[#EEF0F3] last:border-0">
      {err ? <XCircle size={16} className="text-red-600 mt-0.5 flex-shrink-0" /> : <AlertTriangle size={16} className="text-amber-600 mt-0.5 flex-shrink-0" />}
      <div className="min-w-0">
        <div className={cx('text-[13px] font-semibold leading-5', err ? 'text-red-800' : 'text-amber-800')}>{i.title}</div>
        <div className="text-[12px] text-slate-500 leading-4 mt-0.5">{i.vehicleId}{i.trip ? ` · Trip ${i.trip}` : ''} — {i.detail}</div>
      </div>
    </div>
  );
}

export default function PlanBoard() {
  const nav = useNavigate();
  const toast = useToast();
  const depot = useDepot();
  const clock = useApi<any>(['clock'], '/clock');
  const date = clock.data?.planDate as string | undefined;
  const q = useApi<any>(['plan', date], date ? `/plans/${date}` : null, { refetchInterval: 30_000 });
  const ref = useReference();
  const outlets = useMemo(() => new Map<string, any>((ref.data?.outlets ?? []).map((o: any) => [o.id, o])), [ref.data]);
  const [filter, setFilter] = useState<'all' | 'Fresh' | 'Style' | 'Tech'>('all');
  const [search, setSearch] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [published, setPublished] = useState<any>(null);
  const [showVal, setShowVal] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [deferFor, setDeferFor] = useState<string[] | null>(null);
  const [lastStats, setLastStats] = useState<any>(null);
  const inv = ['plan', 'overview', 'orders', 'deferrals', 'tracking'];
  const auto = useAct(() => post(`/plans/${date}/auto`), { invalidate: inv, onDone: r => { setLastStats(r.stats); setExpanded({}); }, success: r => `Auto-plan: ${r.stats.served} of ${r.stats.orders} orders on ${r.stats.trips} trips, ${r.stats.deferred} deferred` });
  // one stop can carry two orders (ambient + chilled); they move together, one request at a time
  const move = useAct(async (b: { orderIds: string[]; target: { vehicleId: string; trip: number } | null; reason?: any }) => {
    let r: any = null;
    for (const orderId of b.orderIds) r = await post(`/plans/${date}/move`, { orderId, target: b.target, reason: b.reason });
    return r;
  }, {
    invalidate: inv, success: (r, a) => {
      const errs = r.issues.filter((i: any) => i.severity === 'error' && (a.orderIds.includes(i.orderId) || (a.target && i.vehicleId === a.target.vehicleId)));
      if (a.target) {
        setExpanded(e => ({ ...e, [a.target!.vehicleId]: true }));
        setTimeout(() => document.querySelector(`[data-testid="vehicle-${a.target!.vehicleId}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 300);
      }
      if (errs.length) { setShowVal(true); toast('error', `Breaks a rule: ${errs[0].title}. Publishing is blocked until it is fixed.`); return null; }
      return a.target ? `${a.orderIds.join(' + ')} moved to ${a.target.vehicleId} · Trip ${a.target.trip}` : `${a.orderIds.join(' + ')} set to defer`;
    },
  });
  const discard = useAct(() => del(`/plans/${date}/draft`), { invalidate: inv, success: 'Draft discarded' });
  const publish = useAct(() => post(`/plans/${date}/publish`), { invalidate: inv, onDone: r => setPublished(r), onError: (e: ApiError) => { setConfirm(false); setShowVal(true); } });

  if (!date || q.isLoading) return <Loading />;
  if (q.error) return <ErrorState error={q.error} retry={q.refetch} />;
  const v = q.data;
  const vehicles = new Map<string, any>(v.vehicles.map((x: any) => [x.id, x]));
  const orders = new Map<string, any>(v.orders.map((o: any) => [o.id, o]));
  const trips: any[] = v.trips.filter((t: any) => depot === 'all' || t.vehicle.depot === depot);
  const errors = v.errors; const warns = v.warnings;
  const errorsList = v.issues.filter((i: any) => i.severity === 'error');
  const warnList = v.issues.filter((i: any) => i.severity === 'warn');
  const canPublish = v.mode === 'draft' && errors === 0;
  const assigned = new Set(v.trips.flatMap((t: any) => t.orderIds));
  const unassignedAll: any[] = v.unassigned.filter((o: any) => depot === 'all' || outlets.get(o.outletId)?.depot === depot);
  const s2 = search.trim().toLowerCase();
  const unassigned = unassignedAll
    .filter(o => filter === 'all' || outlets.get(o.outletId)?.brand === filter)
    .filter(o => !s2 || o.id.toLowerCase().includes(s2) || o.outletId.toLowerCase().includes(s2))
    .sort((a, b) => Number(b.deferredYesterday) - Number(a.deferredYesterday) || b.daysSinceServed - a.daysSinceServed);
  const reeferTrips = v.trips.filter((t: any) => t.vehicle.temp === 'reefer');
  const reeferUsed = reeferTrips.reduce((a: number, t: any) => a + t.m3, 0);
  const reeferCap = reeferTrips.reduce((a: number, t: any) => a + t.vehicle.volumeCap, 0);
  const groups: Record<string, any[]> = {};
  unassigned.forEach(o => { const ot = outlets.get(o.outletId); (groups[`${ot?.brand} · ${ot?.district}`] ??= []).push(o); });
  const locked = (t: any) => ['released', 'in_progress', 'completed'].includes(t.status);

  const targetsFor = (o: any) => {
    const ot = outlets.get(o.outletId); if (!ot) return [];
    const existing = v.trips.filter((t: any) => t.vehicle.depot === ot.depot && !locked(t)).map((t: any) => ({ id: `${t.vehicleId}|${t.trip}`, label: `${t.vehicleId} · Trip ${t.trip} · ${t.brand} ${t.district} · ${vLabel(t.vehicle)}` }));
    const used = new Map<string, number>(); v.trips.forEach((t: any) => used.set(t.vehicleId, Math.max(used.get(t.vehicleId) ?? 0, t.trip)));
    const fresh = [...vehicles.values()].filter(x => x.depot === ot.depot && x.status === 'available' && (used.get(x.id) ?? 0) < v.rules.maxTripsPerVehicle)
      .map(x => ({ id: `${x.id}|${(used.get(x.id) ?? 0) + 1}`, label: `${x.id} · new Trip ${(used.get(x.id) ?? 0) + 1} · ${vLabel(x)} ${x.volumeCap} m³` }));
    return [...existing, ...fresh];
  };
  const doMove = (orderIds: string[], val: string) => {
    if (val === 'defer') { setDeferFor(orderIds); return; }
    const [vehicleId, trip] = val.split('|'); move.mutate({ orderIds, target: { vehicleId, trip: Number(trip) } });
  };

  const statusPill = v.mode === 'live' ? <Pill label={`Published v${v.published.version} · ${hhmm(v.published.publishedAt)}`} color="#047857" bg="#D1FAE5" icon={<CheckCircle2 size={12} />} />
    : v.mode === 'draft' ? <Pill label={`Draft v${v.draft.version} · ${v.draft.source === 'auto' ? 'auto-plan' : v.draft.source}`} color={v.draft.source === 'auto' ? '#115E59' : '#475569'} bg={v.draft.source === 'auto' ? '#CCFBF1' : '#F1F5F9'} icon={v.draft.source === 'auto' ? <Wand2 size={12} /> : undefined} />
    : <Pill label="No plan yet" color="#475569" bg="#F1F5F9" />;

  const validation = (
    <>
      <div className="flex-shrink-0 px-5 h-14 border-b border-[#E4E7EC] flex items-center justify-between">
        <h2 className="text-[14px] font-semibold text-slate-900 flex items-center gap-2"><ListChecks size={16} className="text-slate-500" />Validation</h2>
        <div className="flex items-center gap-2">
          <Pill label={errors ? `${errors} violation${errors === 1 ? '' : 's'}` : 'All rules pass'} color={errors ? '#B91C1C' : '#047857'} bg={errors ? '#FEE2E2' : '#D1FAE5'} />
          <button onClick={() => setShowVal(false)} className="2xl:hidden w-8 h-8 flex items-center justify-center rounded-md text-slate-400 hover:bg-slate-100" aria-label="Close"><X size={16} /></button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-5 py-2" data-testid="validation">
        {v.issues.length === 0 && <div className="py-6 flex flex-col items-center text-center"><ShieldCheck size={28} className="text-emerald-600" /><div className="mt-2 text-[13px] font-semibold text-slate-900">Every rule passes</div><div className="text-[12px] text-slate-500">{v.mode === 'draft' ? 'This plan can be published.' : v.mode === 'live' ? 'The published plan is valid.' : 'Nothing planned yet.'}</div></div>}
        {errorsList.map((i: any, k: number) => <IssueRow key={`e${k}`} i={i} />)}
        {warns > 0 && <><Overline className="mt-4 mb-1">Warnings · don't block publishing</Overline>{warnList.map((i: any, k: number) => <IssueRow key={`w${k}`} i={i} />)}</>}
        <div className="mt-5 pt-4 border-t border-[#E4E7EC]">
          <Overline className="mb-2.5">Rules checked on every change</Overline>
          <ul className="space-y-2">{RULES.map(r => <li key={r} className="flex items-start gap-2 text-[12px] text-slate-600"><CheckCircle2 size={13} className="text-teal-600 mt-0.5 flex-shrink-0" />{r}</li>)}</ul>
          <p className="text-[12px] text-slate-500 mt-4 leading-5">Trip time = outbound + inter-stop × (stops − 1) + handling per stop, from district_travel.csv and service_allowance.csv. An early vehicle waits for the window to open.</p>
        </div>
      </div>
      <div className="flex-shrink-0 p-4 border-t border-[#E4E7EC] space-y-2">
        <Button full onClick={() => nav('/d/deferrals')}>Review deferrals · {unassignedAll.length} not on a trip</Button>
        <Button full variant="primary" disabled={!canPublish} onClick={() => setConfirm(true)} title={canPublish ? undefined : 'Resolve every violation first'}>Publish plan</Button>
      </div>
    </>
  );

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <Toolbar icon={<KanbanSquare size={18} />} hue="teal"
        title={<span className="inline-flex flex-wrap items-center gap-3">Plan board {statusPill}</span>}
        subtitle={`${v.dateLabel} · assisted planning — let Auto-plan build it, then move orders by hand; every change is re-checked`}
        actions={<>
          {v.mode === 'draft' && <Button icon={<RotateCcw size={15} />} disabled={discard.isPending} onClick={() => discard.mutate()}>{v.published ? 'Discard changes' : 'Discard draft'}</Button>}
          <Button icon={auto.isPending ? <Loader2 size={15} className="animate-spin" /> : <Wand2 size={15} />} className="!border-teal-600 !text-teal-800" disabled={auto.isPending} onClick={() => auto.mutate()} data-testid="auto-plan">Auto-plan</Button>
          <Button className="2xl:hidden" icon={<ListChecks size={15} />} onClick={() => setShowVal(true)}>Validation {errors > 0 && <Count n={errors} tone="bad" />}</Button>
          <Button variant="primary" disabled={!canPublish} onClick={() => setConfirm(true)} title={canPublish ? undefined : v.mode !== 'draft' ? 'Nothing new to publish' : `Resolve ${errors} violation${errors === 1 ? '' : 's'} first`} data-testid="publish">Publish plan</Button>
        </>}>
        <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-x-6 gap-y-3 border-t border-[#EEF0F3] pt-4">
          {[
            { l: 'On trips', v: assigned.size, c: 'text-slate-900' },
            { l: 'Not on a trip', v: v.unassigned.length, c: v.unassigned.length ? 'text-amber-700' : 'text-slate-900' },
            { l: 'Violations', v: errors, c: errors ? 'text-red-600' : 'text-emerald-700' },
            { l: 'Warnings', v: warns, c: warns ? 'text-amber-700' : 'text-slate-900' },
            { l: 'Reefer volume used', v: `${reeferCap ? Math.round(reeferUsed / reeferCap * 100) : 0}%`, c: 'text-slate-900' },
          ].map(x => <div key={x.l}><Overline>{x.l}</Overline><div className={cx('text-[20px] font-semibold tabular leading-7 mt-0.5', x.c)}>{x.v}</div></div>)}
        </div>
      </Toolbar>

      <div className="flex flex-1 min-h-0 flex-col md:flex-row">
        {/* Unassigned */}
        <div className="md:w-[300px] 2xl:w-[340px] max-h-[45vh] md:max-h-none flex-shrink-0 flex flex-col min-h-0 bg-[#F9FAFB] border-b md:border-b-0 md:border-r border-[#E4E7EC]">
          <div className="flex-shrink-0 px-4 py-3.5 bg-white border-b border-[#E4E7EC] space-y-3">
            <div className="flex items-center justify-between"><h2 className="text-[14px] font-semibold text-slate-900">Not on a trip</h2><Count n={unassignedAll.length} tone={unassignedAll.length ? 'warn' : 'good'} /></div>
            <div className="relative"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input value={search} onChange={e => setSearch(e.target.value)} className={`${inputCls} pl-9`} placeholder="Order or outlet ID" aria-label="Search unassigned" /></div>
            <Segmented size="sm" value={filter} onChange={setFilter} options={[{ id: 'all', label: 'All' }, { id: 'Fresh', label: 'Fresh' }, { id: 'Style', label: 'Style' }, { id: 'Tech', label: 'Tech' }]} />
            <p className="text-[12px] text-slate-500">Priority: skipped last run, then days since last served.</p>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-4">
            {Object.keys(groups).length === 0 && <div className="py-10 text-center"><CheckCircle2 size={24} className="mx-auto text-emerald-600" /><div className="mt-2 text-[13px] font-semibold text-slate-800">{v.mode === 'empty' ? 'Press Auto-plan to start' : 'Everything is placed'}</div></div>}
            {v.mode === 'empty' && unassignedAll.length > 0 && <Callout tone="info" title={`${unassignedAll.length} orders to plan`}>Press Auto-plan. It fills vehicles by priority, keeps every rule, and explains each order it cannot fit.</Callout>}
            {Object.entries(groups).map(([g, list]) => (
              <div key={g} className="space-y-2">
                <div className="px-1 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500"><span className="w-2 h-2 rounded-full" style={{ background: BRAND_COLOR[g.split(' · ')[0]] }} />{g}</div>
                {(v.mode === 'empty' ? list.slice(0, 25) : list).map(o => {
                  const ot = outlets.get(o.outletId);
                  const def = o.proposal ?? v.deferrals.find((d: any) => d.orderId === o.id);
                  return (
                    <div key={o.id} className="bg-white border border-[#E4E7EC] rounded-lg p-3.5 space-y-2.5" data-testid={`unassigned-${o.id}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0"><div className="text-[14px] font-semibold text-slate-900">{o.outletId}</div><div className="font-mono text-[11px] text-slate-500">{o.id}</div></div>
                        <TempTag temp={o.temp} />
                      </div>
                      {ot && <OutletBadges o={ot} />}
                      <div className="flex items-center gap-3 text-[12px] text-slate-600 tabular"><span>{fmt(o.kg)} kg</span><span className="text-slate-300">·</span><span>{fmt(o.m3, 1)} m³</span><span className="text-slate-300">·</span><span className="inline-flex items-center gap-1"><Clock size={12} className="text-slate-400" />{ot?.open}–{ot?.close}</span></div>
                      {o.deferredYesterday && <div className="text-[12px] font-semibold text-red-700 flex items-center gap-1.5"><AlertTriangle size={13} />Skipped last run — serve first</div>}
                      {def && <div className="text-[12px] text-amber-900 bg-amber-50 border border-amber-200 rounded-md px-2.5 py-1.5"><span className="font-semibold">Defer · {ref.data?.reasons?.[def.reason]?.label ?? def.reason}</span> <span className="text-amber-700">({def.kind})</span><div className="mt-0.5 text-amber-800">{def.why}</div></div>}
                      {(
                        <select value="" onChange={e => e.target.value && doMove([o.id], e.target.value)} className={`${inputCls} h-8 text-[12px]`} aria-label={`Assign ${o.id}`} disabled={move.isPending}>
                          <option value="">Assign to vehicle and trip…</option>
                          {targetsFor(o).map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                        </select>
                      )}
                    </div>
                  );
                })}
                {v.mode === 'empty' && list.length > 25 && <div className="text-[12px] text-slate-500 px-1">+ {list.length - 25} more</div>}
              </div>
            ))}
          </div>
        </div>

        {/* Vehicles */}
        <div className="flex-1 min-w-0 overflow-y-auto @container">
          <div className="mx-auto max-w-[1280px] p-4 sm:p-5 space-y-4">
            {v.mode === 'live' && <Callout tone="success" title={`Plan v${v.published.version} is live`}>Loaders, drivers and stores are working from it. Any change here opens a new draft; when you republish, everyone affected gets a "what changed" list. Trips already released or on the road are locked.</Callout>}
            {v.mode === 'draft' && v.published && <Callout tone="warning" title="You are editing a new version">Nobody sees these changes until you publish. Trips already released stay as they are.</Callout>}
            {lastStats && v.mode === 'draft' && <Callout tone="info" title={`Auto-plan result: ${lastStats.served} of ${lastStats.orders} orders served on ${lastStats.trips} trips`}>Chilled demand {fmt(lastStats.chilledDemandM3, 1)} m³, served {fmt(lastStats.chilledServedM3, 1)} m³ on {lastStats.reeferTrips} reefer trips. {lastStats.deferred} orders are proposed for deferral, each with a reason on the left.</Callout>}
            {trips.length === 0 && <div className="rounded-xl border border-dashed border-[#D0D5DD] bg-white p-10 text-center"><Wand2 size={26} className="mx-auto text-teal-600" /><div className="mt-2 text-[14px] font-semibold text-slate-900">No trips yet</div><p className="text-[13px] text-slate-500 mt-1">Auto-plan builds a full plan for {v.dateLabel} in about a second.</p><Button className="mt-4" variant="primary" icon={<Wand2 size={15} />} disabled={auto.isPending} onClick={() => auto.mutate()}>Run auto-plan</Button></div>}
            {[...new Set(trips.map(t => t.vehicleId))].map(vid => {
              const veh = vehicles.get(vid)!;
              const pv = v.usage[vid] ?? { fresh: 0, styleTech: 0, fuelAddL: 0, trips: 0, freshBudget: 270, styleTechBudget: 480 };
              const vErrs = errorsList.filter((i: any) => i.vehicleId === vid);
              const isOpen = expanded[vid] ?? vErrs.length > 0;
              const tripsOf = trips.filter(t => t.vehicleId === vid);
              const maxLoad = Math.max(0, ...tripsOf.map(t => Math.max(t.m3 / veh.volumeCap, t.kg / veh.weightCap)));
              return (
                <section key={vid} data-testid={`vehicle-${vid}`} className={cx('bg-white rounded-xl border overflow-hidden shadow-[0_1px_2px_rgba(16,24,40,.04),0_12px_32px_-22px_rgba(16,24,40,.2)]', vErrs.length ? 'border-rose-300 ring-1 ring-rose-100' : 'border-[#E6E9F0]')}>
                  <button onClick={() => setExpanded(e => ({ ...e, [vid]: !isOpen }))} aria-expanded={isOpen} className="w-full text-left flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4 hover:bg-slate-50/70">
                    <IconChip hue={veh.temp === 'reefer' ? 'sky' : 'slate'} size={38}>{veh.temp === 'reefer' ? <Snowflake size={17} /> : <Truck size={17} />}</IconChip>
                    <span className="min-w-[150px] flex-1 @xl:flex-none">
                      <span className="block text-[15px] font-semibold text-slate-900">{vid} <span className="font-normal text-slate-500 text-[13px]">· {veh.driverName}</span></span>
                      <span className="block text-[12px] text-slate-500">{vLabel(veh)} · {veh.volumeCap} m³ · {fmt(veh.weightCap)} kg · {veh.depot}</span>
                    </span>
                    <span className="hidden @xl:flex flex-wrap gap-1.5 flex-1 min-w-0 overflow-hidden max-h-[60px]">
                      {tripsOf.map(t => <span key={t.trip} className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full text-[12px] font-semibold whitespace-nowrap bg-slate-50 ring-1 ring-[#E6E9F0] text-slate-700"><span className="w-2 h-2 rounded-full" style={{ background: BRAND_COLOR[t.brand] }} />T{t.trip} · {t.district} · {t.stops.length} stops</span>)}
                    </span>
                    <span className="hidden @3xl:flex items-center gap-5">
                      {pv.fresh > 0 && <Gauge label="Fresh time" pct={pv.fresh / pv.freshBudget} text={`${pv.fresh}/${pv.freshBudget}`} hue="teal" />}
                      <Gauge label="Load" pct={maxLoad} text={`${Math.round(maxLoad * 100)}%`} hue="indigo" />
                    </span>
                    {vErrs.length > 0 ? <Pill label={`${vErrs.length} issue${vErrs.length === 1 ? '' : 's'}`} color="#BE123C" bg="#FFE4E8" icon={<XCircle size={12} />} /> : <Pill label="All good" color="#047857" bg="#D1FAE5" icon={<CheckCircle2 size={12} />} />}
                    <ChevronDown size={18} className={cx('text-slate-400 transition-transform', isOpen && 'rotate-180')} />
                  </button>
                  {isOpen && <div className="border-t border-[#EEF1F5]">
                    <div className="px-5 pt-4 grid grid-cols-1 @2xl:grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-x-6 gap-y-3">
                      {pv.fresh > 0 && <CapacityBar label="Fresh time (all trips)" used={pv.fresh} total={pv.freshBudget} unit=" min" decimals={0} />}
                      {pv.styleTech > 0 && <CapacityBar label="Style + Tech time" used={pv.styleTech} total={pv.styleTechBudget} unit=" min" decimals={0} />}
                      <CapacityBar label="Weekly fuel" used={pv.fuelUsedL + pv.fuelAddL} total={pv.fuelQuotaL} unit=" L" />
                    </div>
                    <div className="p-5 grid grid-cols-1 @5xl:grid-cols-2 gap-4">
                      {[1, 2].map(n => {
                        const t = tripsOf.find(x => x.trip === n);
                        if (!t) return <div key={n} className="min-h-[88px] rounded-lg border border-dashed border-[#D0D5DD] flex items-center justify-center text-[13px] text-slate-400">Trip {n} available</div>;
                        const tIss = v.issues.filter((i: any) => i.vehicleId === vid && i.trip === n);
                        return (
                          <div key={n} className="rounded-lg border border-[#E4E7EC] overflow-hidden">
                            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-2.5 bg-[#F9FAFB] border-b border-[#EEF0F3]">
                              <span className="inline-flex items-center gap-2 text-[13px] font-semibold text-slate-900 min-w-0"><span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: BRAND_COLOR[t.brand] }} />Trip {n} · {t.district}<span className="font-normal text-slate-500">· {t.brand}</span>{v.mode === 'live' && <Status s={t.status} size="sm" />}</span>
                              <span className="text-[12px] tabular text-slate-500 whitespace-nowrap">{t.depart} → {t.returnAt} · {t.tripMinutes} min · {t.km} km</span>
                            </div>
                            <div className="px-4 py-2 overflow-x-auto">
                              <div className="grid grid-cols-[20px_minmax(70px,1fr)_auto_52px_92px_24px] gap-x-3 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-400 min-w-[380px]"><span>#</span><span>Outlet</span><span /><span>ETA</span><span>Window</span><span /></div>
                              {t.stops.map((st: any) => {
                                const ot = outlets.get(st.outletId);
                                return (
                                  <div key={st.outletId} className="grid grid-cols-[20px_minmax(70px,1fr)_auto_52px_92px_24px] gap-x-3 items-center h-9 text-[13px] border-t border-[#F2F4F7] min-w-[380px]">
                                    <span className="text-slate-400 tabular">{st.seq}</span>
                                    <span className="truncate text-slate-800 font-medium">{st.outletId}{ot?.vanOnly && <span className="ml-1.5 text-[12px] font-semibold text-amber-700">van only</span>}</span>
                                    <span className="flex gap-1">{st.orderIds.map((oid: string) => <span key={oid} title={`${oid} · ${orders.get(oid)?.temp}`}>{orders.get(oid)?.temp === 'chilled' ? <Snowflake size={13} className="text-sky-600" /> : <Package size={13} className="text-slate-400" />}</span>)}</span>
                                    <span className={cx('tabular', st.late ? 'text-red-600 font-semibold' : st.lateRisk ? 'text-amber-700 font-semibold' : 'text-slate-700')} title={st.waitMin ? `Waits ${st.waitMin} min for the window` : undefined}>{st.start}</span>
                                    <span className="tabular text-slate-500">{ot?.mallWindow ? <span className="text-violet-700 font-medium" title={`Mall window ${ot.mallWindow}`}>{ot.mallWindow} (M)</span> : `${ot?.open}–${ot?.close}`}</span>
                                    {!locked(t) ? (
                                      <span className="relative w-6 h-6 flex items-center justify-center text-slate-400 hover:text-slate-700" title="Move or defer this stop"><MoreVertical size={16} />
                                        <select value="" onChange={e => e.target.value && doMove(st.orderIds, e.target.value)} className="absolute inset-0 opacity-0 cursor-pointer" aria-label={`Move ${st.outletId}`}>
                                        <option value="">Move…</option>
                                        <option value="defer">Defer (not today)</option>
                                        {targetsFor(orders.get(st.orderIds[0]) ?? { outletId: st.outletId }).filter(x => x.id !== `${vid}|${n}`).map(x => <option key={x.id} value={x.id}>{x.label}</option>)}
                                      </select></span>
                                    ) : <span />}
                                  </div>
                                );
                              })}
                            </div>
                            <div className="px-4 pb-4 pt-2 grid grid-cols-2 gap-4">
                              <CapacityBar compact label="Volume" used={t.m3} total={t.vehicle.volumeCap} unit=" m³" />
                              <CapacityBar compact label="Weight" used={t.kg} total={t.vehicle.weightCap} unit=" kg" decimals={0} />
                            </div>
                            {tIss.length > 0 && <div className="px-4 pb-4 space-y-2">{tIss.map((i: any, k: number) => <Callout key={k} tone={i.severity === 'error' ? 'danger' : 'warning'} className="py-2" title={i.title}>{i.detail}</Callout>)}</div>}
                          </div>
                        );
                      })}
                    </div>
                    {vErrs.filter((i: any) => !i.trip).map((i: any, k: number) => <div key={k} className="px-5 pb-4"><Callout tone="danger" className="py-2" title={i.title}>{i.detail}</Callout></div>)}
                  </div>}
                </section>
              );
            })}
          </div>
        </div>

        <aside className="hidden 2xl:flex w-[360px] flex-shrink-0 flex-col min-h-0 bg-white border-l border-[#E4E7EC]">{validation}</aside>
        {showVal && <>
          <div className="2xl:hidden fixed inset-0 z-30 bg-slate-900/20" onClick={() => setShowVal(false)} />
          <aside className="2xl:hidden fixed right-0 top-0 bottom-0 z-40 w-[360px] max-w-full flex flex-col bg-white border-l border-[#E4E7EC] shadow-2xl">{validation}</aside>
        </>}
      </div>

      {deferFor && <DeferDialog orderId={deferFor.join(' + ')} reasons={ref.data?.reasons ?? {}} onClose={() => setDeferFor(null)} onDefer={(reason, why) => { move.mutate({ orderIds: deferFor, target: null, reason: { reason, why } }); setDeferFor(null); }} />}

      {confirm && (
        <Modal title={published ? 'Plan published' : `Publish plan for ${v.dateLabel}`} onClose={() => { setConfirm(false); setPublished(null); }} width={540}>
          {!published ? (
            <div className="space-y-5">
              <div className="grid grid-cols-3 gap-3">
                {[['On trips', assigned.size], ['To defer', v.unassigned.length], ['Violations', errors]].map(([l, n]) => (
                  <div key={l as string} className="rounded-lg border border-[#E4E7EC] px-4 py-3"><Overline>{l as string}</Overline><div className="text-[22px] font-semibold tabular mt-1">{n as number}</div></div>
                ))}
              </div>
              <div>
                <div className="text-[13px] font-semibold text-slate-900 mb-2">Who gets notified</div>
                <ul className="space-y-2 text-[13px] text-slate-600">
                  {['Loaders at Peliyagoda and Kandy — load lists in stop order', 'Drivers — runs saved to their phones for offline use', 'Store managers — arrival times for served orders', 'Store managers with deferred orders — the reason and the new date', ...(v.published ? ['Anyone whose trip changed — a "what changed" list to acknowledge'] : [])].map(t => <li key={t} className="flex items-start gap-2"><CheckCircle2 size={14} className="text-teal-600 mt-0.5 flex-shrink-0" />{t}</li>)}
                </ul>
              </div>
              <div className="flex justify-end gap-2">
                <Button onClick={() => setConfirm(false)}>Cancel</Button>
                <Button variant="primary" icon={publish.isPending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} disabled={publish.isPending} onClick={() => publish.mutate()} data-testid="publish-confirm">Publish and notify</Button>
              </div>
            </div>
          ) : (
            <div className="text-center space-y-3 py-2">
              <CheckCircle2 size={40} className="text-emerald-600 mx-auto" />
              <div className="text-[16px] font-semibold text-slate-900">Plan v{published.version} published · {published.trips} trips</div>
              <p className="text-[13px] text-slate-500">{published.deferred} orders moved to {published.nextRun} and their stores told why. If you republish, loaders and drivers get a "what changed" list — never a silent swap.</p>
              <div className="flex gap-2 justify-center pt-2">
                <Button onClick={() => { setConfirm(false); nav('/d/deferrals'); }}>See deferrals</Button>
                <Button variant="primary" onClick={() => { setConfirm(false); nav('/d/tracking'); }}>Go to live tracking</Button>
              </div>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}

function DeferDialog({ orderId, reasons, onClose, onDefer }: { orderId: string; reasons: Record<string, any>; onClose: () => void; onDefer: (r: string, why: string) => void }) {
  const [reason, setReason] = useState('capacity_volume');
  const [why, setWhy] = useState('');
  return (
    <Modal title={`Defer ${orderId}`} onClose={onClose} width={460}>
      <div className="space-y-4">
        <Field label="Reason" hint="The store sees the plain-language version of this reason."><select className={inputCls} value={reason} onChange={e => setReason(e.target.value)}>{Object.entries(reasons).filter(([k]) => k !== 'after_cutoff').map(([k, r]: any) => <option key={k} value={k}>{r.label}</option>)}</select></Field>
        {reasons[reason] && <Callout tone="neutral" title="Store will read">{reasons[reason].store}</Callout>}
        <Field label="Note for the record (optional)"><input className={inputCls} value={why} onChange={e => setWhy(e.target.value)} placeholder="e.g. Reefer space kept for OUT116" /></Field>
        <div className="flex justify-end gap-2"><Button onClick={onClose}>Cancel</Button><Button variant="warning" onClick={() => onDefer(reason, why || 'Deferred by the dispatcher.')}>Defer order</Button></div>
      </div>
    </Modal>
  );
}

function Gauge({ label, pct, text, hue }: { label: string; pct: number; text: string; hue: 'teal' | 'indigo' }) {
  const h = HUE[hue]; const over = pct > 1; const warn = pct >= 0.9;
  return (
    <span className="w-[112px] flex-shrink-0">
      <span className="flex justify-between text-[11px]"><span className="text-slate-500">{label}</span><span className={cx('font-semibold tabular', over ? 'text-rose-600' : warn ? 'text-amber-700' : 'text-slate-800')}>{text}</span></span>
      <span className="block mt-1 h-1.5 rounded-full overflow-hidden" style={{ background: over ? HUE.rose.soft : h.soft }}><span className="block h-full rounded-full" style={{ width: `${Math.min(pct, 1) * 100}%`, background: over ? HUE.rose.to : warn ? HUE.amber.to : h.to }} /></span>
    </span>
  );
}
