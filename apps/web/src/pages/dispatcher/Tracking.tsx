import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, List, Map as MapIcon, WifiOff, MapPin, Search, Snowflake, Truck, ArrowRightLeft, CheckCircle2, Clock, Maximize2, Printer, Construction } from 'lucide-react';
import { printRunSheet } from './runSheet';
import TripMap, { type MapTrip } from '../../components/TripMap';
import { IconChip, Button, Callout, Pill, Modal, Field, inputCls, Empty, Segmented, cx } from '../../components/ds';
import { ErrorState, Loading, Status, useAct, useApi, useReference } from '../../components/common';
import { post } from '../../lib/api';
import { hhmm, minsAgo, useNow } from '../../lib/clock';
import { useDepot } from './DispatcherApp';

type Group = 'attention' | 'road' | 'depot' | 'done';
const GROUP_LABEL: Record<Group, string> = { attention: 'Needs attention', road: 'On the road', depot: 'At the depot', done: 'Completed' };
const TONE_DOT: Record<Group, string> = { attention: 'bg-amber-500', road: 'bg-teal-600', depot: 'bg-indigo-500', done: 'bg-emerald-500' };
const groupOf = (t: any): Group => t.offline || t.conflicts || t.lateRisk.length || t.status === 'blocked' ? 'attention' : t.status === 'completed' ? 'done' : t.status === 'in_progress' ? 'road' : 'depot';

export default function Tracking() {
  const nav = useNavigate();
  const depot = useDepot();
  const now = useNow(15_000);
  const q = useApi<any>(['tracking'], '/tracking', { refetchInterval: 10_000 });
  const ref = useReference();
  const outlets = useMemo(() => new Map<string, any>((ref.data?.outlets ?? []).map((o: any) => [o.id, o])), [ref.data]);
  const [selId, setSelId] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [fit, setFit] = useState(0);
  const [moving, setMoving] = useState<{ tripId: number; outletId: string } | null>(null);
  // below lg the list, map and trip detail take turns on screen; from lg up they sit side by side
  const [view, setView] = useState<'list' | 'map' | 'detail'>('list');
  const pick = (id: number | null) => { setSelId(id); setView(id ? 'detail' : 'list'); };
  const detail = useApi<any>(['trip', selId], selId ? `/trips/${selId}` : null, { refetchInterval: 10_000 });

  const list: any[] = (q.data?.trips ?? []).filter((t: any) => depot === 'all' || t.vehicle.depot === depot);
  const mapTrips: MapTrip[] = useMemo(() => list.map(t => {
    const pos = Array.isArray(t.position) ? t.position : (t.position?.lat && t.position?.lng) ? [t.position.lat, t.position.lng] : null;
    const estimate = t.estimate && (Array.isArray(t.estimate) ? t.estimate : (t.estimate?.lat && t.estimate?.lng) ? [t.estimate.lat, t.estimate.lng] : null);
    return {
      key: String(t.id), label: `${t.vehicleId} · T${t.trip}`, depot: t.depot, pos: pos as any, estimate: estimate as any,
      tone: t.offline ? 'offline' : t.conflicts || t.lateRisk.length ? 'alert' : t.status === 'completed' ? 'done' : t.status === 'in_progress' ? 'road' : 'depot',
      stops: t.stops.map((s: any) => ({ id: s.outletId, seq: s.seq, pos: [s.lat, s.lng] as [number, number], state: s.done ? 'done' : 'next' })),
    };
  }), [q.data, depot]);
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorState error={q.error} retry={q.refetch} />;
  if (!list.length) return <div className="p-6"><Empty icon={<MapPin size={28} />} title="Nothing on the road yet">Trips appear here once a plan is published.</Empty></div>;

  const s2 = search.toLowerCase();
  const shown = list.filter(t => !s2 || `${t.vehicleId} ${t.driverName} ${t.district}`.toLowerCase().includes(s2));
  const groups = (['attention', 'road', 'depot', 'done'] as Group[]).map(g => ({ g, items: shown.filter(t => groupOf(t) === g) })).filter(x => x.items.length);
  const sel = list.find(t => t.id === selId) ?? null;
  const d = detail.data && detail.data.id === selId ? detail.data : null;
  const online = list.filter(t => !t.offline).length;
  const v = view === 'detail' && !sel ? 'list' : view;
  const switcher = <Segmented size="sm" value={v === 'map' ? 'map' : 'list'} onChange={x => setView(x)} options={[{ id: 'list', label: <span className="inline-flex items-center gap-1.5"><List size={13} />List</span> }, { id: 'map', label: <span className="inline-flex items-center gap-1.5"><MapIcon size={13} />Map</span> }]} />;

  return (
    <div className="under-nav flex flex-1 min-h-0 flex-col lg:flex-row">
      <div className={cx('lg:w-[300px] 2xl:w-[340px] lg:flex-shrink-0 flex-col min-h-0 bg-white lg:border-r border-[#E4E7EC] lg:flex', v === 'list' ? 'flex flex-1 lg:flex-none' : 'hidden')}>
        <div className="flex-shrink-0 px-5 pt-[calc(4rem+1rem)] pb-3 border-b border-[#E4E7EC]">
          <div className="flex items-center gap-3"><IconChip hue="sky" size={40}><MapPin size={18} /></IconChip>
            <div><h1 className="text-[20px] font-semibold text-slate-900 leading-7">Live tracking</h1>
              <p className="text-[13px] text-slate-500">{online} of {list.length} trips in contact · {hhmm(now)}</p></div></div>
          <label className="mt-3 relative block"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Vehicle, driver or district" className={`${inputCls} pl-9`} /></label>
          <div className="mt-3 lg:hidden">{switcher}</div>
        </div>
        <div className="flex-1 overflow-y-auto pb-3">
          {groups.map(({ g, items }) => (
            <div key={g}>
              <div className="sticky top-0 z-10 bg-white/95 backdrop-blur px-5 pt-4 pb-1 flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500"><span>{GROUP_LABEL[g]}</span><span className="tabular">{items.length}</span></div>
              {items.map(t => {
                const active = selId === t.id;
                const right = t.offline ? `Last seen ${t.lastSeen ? hhmm(t.lastSeen) : '—'}` : t.conflicts ? `${t.conflicts} conflict` : t.status === 'in_progress' ? `${t.done} of ${t.total} stops` : t.status === 'completed' ? `Closed ${hhmm(t.closedAt)}` : `Departs ${t.depart}`;
                return (
                  <button key={t.id} onClick={() => pick(active ? null : t.id)} data-testid={`track-${t.vehicleId}`} className={cx('w-[calc(100%-16px)] text-left mx-2 my-1 px-3 py-3 rounded-xl flex items-start gap-3 transition-colors', active ? 'bg-teal-50 ring-1 ring-teal-200' : 'hover:bg-slate-50')}>
                    <span className={cx('mt-1.5 w-2 h-2 rounded-full flex-shrink-0', t.offline ? 'bg-slate-400' : TONE_DOT[groupOf(t)])} />
                    <span className="flex-1 min-w-0">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="text-[14px] font-semibold text-slate-900 whitespace-nowrap">{t.vehicleId} <span className="font-normal text-slate-500 text-[12px]">T{t.trip}</span></span>
                        <span className={cx('text-[12px] tabular whitespace-nowrap', t.offline ? 'text-slate-500' : t.conflicts ? 'text-amber-700 font-semibold' : 'text-slate-500')}>{right}</span>
                      </span>
                      <span className="block text-[12px] text-slate-500 truncate">{t.driverName} · {t.brand} {t.district}{t.lateRisk.length ? ` · late risk ${t.lateRisk.join(', ')}` : ''}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <div className={cx('flex-1 min-w-0 min-h-[320px] relative lg:block', v === 'map' ? 'block' : 'hidden')}>
        <TripMap trips={mapTrips} selected={selId ? String(selId) : null} onSelect={k => pick(Number(k))} fitKey={fit} />
        <div className="absolute top-[4.75rem] left-3 z-[500] lg:hidden">{switcher}</div>
        <div className="absolute top-[4.75rem] right-3 z-[500] flex gap-2">
          {selId && <Button size="sm" onClick={() => pick(null)}>All trips</Button>}
          <Button size="sm" icon={<Maximize2 size={13} />} onClick={() => setFit(f => f + 1)}>Fit</Button>
        </div>
        <div className="absolute bottom-3 left-3 z-[500] bg-white/95 rounded-lg ring-1 ring-[#E4E7EC] px-3 py-2 text-[11px] text-slate-600 flex flex-wrap gap-x-3 gap-y-1 max-w-[calc(100%-24px)]">
          {[['#0F766E', 'On the road'], ['#4F46E5', 'At depot'], ['#64748B', 'No signal (estimate dashed)'], ['#D97706', 'Needs attention'], ['#059669', 'Completed']].map(([c, l]) => <span key={l} className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full" style={{ background: c }} />{l}</span>)}
        </div>
      </div>

      {sel && (
        <aside className={cx('lg:w-[380px] lg:flex-shrink-0 flex-col min-h-0 bg-white lg:border-l border-[#E4E7EC] lg:flex', v === 'detail' ? 'flex flex-1 lg:flex-none' : 'hidden')}>
          <div className="flex-shrink-0 px-5 pb-4 pt-[calc(4rem+1rem)] border-b border-[#E4E7EC]">
            <div className="lg:hidden mb-3 flex items-center justify-between gap-2">
              <button onClick={() => pick(null)} className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-slate-600 hover:text-slate-900"><ArrowLeft size={15} />All trips</button>
              <Button size="sm" icon={<MapIcon size={13} />} onClick={() => setView('map')}>Show on map</Button>
            </div>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5"><IconChip hue={sel.vehicle.temp === 'reefer' ? 'sky' : 'slate'} size={36}>{sel.vehicle.temp === 'reefer' ? <Snowflake size={16} /> : <Truck size={16} />}</IconChip>
                <div><div className="text-[16px] font-semibold text-slate-900">{sel.vehicleId} · Trip {sel.trip}</div><div className="text-[12px] text-slate-500">{sel.driverName} · {sel.brand} {sel.district}</div></div></div>
              <span className="flex items-center gap-1.5">
                {d && <button onClick={() => printRunSheet(d, outlets)} className="w-8 h-8 rounded-md flex items-center justify-center text-slate-500 hover:bg-slate-100" title="Print run sheet" aria-label="Print run sheet"><Printer size={15} /></button>}
                {sel.offline ? <Pill label="No signal" color="#4B5563" bg="#E5E7EB" icon={<WifiOff size={11} />} /> : <Status s={sel.status} size="sm" />}
              </span>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-[12px]">
              <div className="rounded-lg bg-slate-50 px-2.5 py-2"><div className="text-slate-500">Departs</div><div className="font-semibold tabular text-slate-900">{sel.depart}</div></div>
              <div className="rounded-lg bg-slate-50 px-2.5 py-2"><div className="text-slate-500">Progress</div><div className="font-semibold tabular text-slate-900">{sel.done}/{sel.total} stops</div></div>
              <div className="rounded-lg bg-slate-50 px-2.5 py-2"><div className="text-slate-500">Last contact</div><div className="font-semibold tabular text-slate-900">{sel.lastSeen ? `${minsAgo(sel.lastSeen, now)} min ago` : '—'}</div></div>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            {sel.hold && <Callout tone="warning" icon={<Construction size={15} className="text-amber-600" />} title={`${sel.hold.label} · reported ${sel.hold.at}, about ${sel.hold.minutes} min`}>{sel.hold.note ? `${sel.hold.note}. ` : ''}Expected times below include the hold until {sel.hold.until}.{sel.lateRisk.length ? ` ${sel.lateRisk.join(', ')} may miss the window — consider moving ${sel.lateRisk.length > 1 ? 'them' : 'it'}.` : ' Every remaining stop still fits its window.'}</Callout>}
            {sel.offline && <Callout tone="neutral" icon={<WifiOff size={15} className="text-slate-500" />} title={`No signal since ${sel.lastSeen ? hhmm(sel.lastSeen) : 'departure'}`}>The driver's phone keeps working and saves every stop — no signal on its own is not a reason to move a stop. The dashed marker is where the plan says the truck should be. Move a stop only if the expected time misses the window; if the driver delivers it anyway, you get a conflict to decide, not a silent overwrite.</Callout>}
            {sel.conflicts > 0 && <Callout tone="warning" title="A sync conflict needs a decision" action={<Button size="sm" onClick={() => nav('/d/exceptions')}>Open exceptions</Button>}>The phone uploaded a delivery for a stop that had been moved.</Callout>}
            <ol className="space-y-2">
              {(d?.stops ?? sel.stops).map((s: any) => {
                const tr = sel.stops.find((x: any) => x.outletId === s.outletId);
                const ot = outlets.get(s.outletId);
                const done = tr?.done;
                return (
                  <li key={s.outletId} className="rounded-lg border border-[#E4E7EC] px-3.5 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-2"><span className={cx('w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold', done ? 'bg-teal-700 text-white' : 'bg-slate-100 text-slate-700')}>{s.seq}</span><span className="text-[13px] font-semibold text-slate-900">{s.outletId}</span><span className="text-[12px] text-slate-500 truncate">{ot?.district}</span></span>
                      {done ? <span className="text-[12px] font-semibold text-emerald-700 inline-flex items-center gap-1"><CheckCircle2 size={13} />{tr.doneAt}</span>
                        : <span className={cx('text-[12px] tabular', tr?.late ? 'text-red-700 font-semibold' : tr?.lateRisk ? 'text-amber-700 font-semibold' : 'text-slate-600')} title={`Planned ${tr?.arrive ?? s.arrive}`}>ETA {tr?.expected ?? tr?.arrive ?? s.arrive}{tr?.delayMin > 0 ? ` (+${tr.delayMin})` : ''}</span>}
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-2 text-[12px] text-slate-500">
                      <span>Window {tr?.window ?? `${ot?.open}–${ot?.close}`}{tr?.outcome && tr.outcome !== 'full' ? ` · ${tr.outcome.replace('_', ' ')}` : ''}{sel.lateRisk.includes(s.outletId) ? ' · late risk' : ''}</span>
                      {!done && sel.status !== 'completed' && <button onClick={() => setMoving({ tripId: sel.id, outletId: s.outletId })} className="inline-flex items-center gap-1 font-semibold text-teal-700 hover:text-teal-900"><ArrowRightLeft size={12} />Move stop</button>}
                    </div>
                  </li>
                );
              })}
              {(d?.movedAway ?? []).map((m: any) => (
                <li key={m.orderId} className="rounded-lg border border-dashed border-[#D0D5DD] px-3.5 py-2.5 text-[12px] text-slate-500 flex items-center gap-2"><ArrowRightLeft size={13} />{m.outletId} ({m.orderId}) moved{m.move ? ` to ${m.move.toVehicle} · Trip ${m.move.toTrip}` : ''} at {hhmm(m.movedAt)}</li>
              ))}
            </ol>
            {d?.events?.length > 0 && <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500 mb-2">Phone records</div>
              <ul className="space-y-1.5 text-[12px]">
                {d.events.slice().reverse().slice(0, 10).map((e: any, i: number) => <li key={i} className="flex items-center justify-between gap-2"><span className="text-slate-700">{e.type.replace('_', ' ')}{e.outletId ? ` · ${e.outletId}` : ''}{e.conflict ? ' · conflict' : ''}</span><span className="tabular text-slate-400 inline-flex items-center gap-1"><Clock size={11} />{hhmm(e.deviceTime)}{e.receivedAt && Math.abs(new Date(e.receivedAt).getTime() - new Date(e.deviceTime).getTime()) > 5 * 60000 ? ` · synced ${hhmm(e.receivedAt)}` : ''}</span></li>)}
              </ul>
            </div>}
          </div>
        </aside>
      )}
      {moving && <MoveStop {...moving} onClose={() => setMoving(null)} />}
    </div>
  );
}

function MoveStop({ tripId, outletId, onClose }: { tripId: number; outletId: string; onClose: () => void }) {
  const opts = useApi<any>(['move-options', tripId, outletId], `/trips/${tripId}/move-options?outletId=${outletId}`);
  const [pick, setPick] = useState<string>('keep');
  const [reason, setReason] = useState<string | null>(null);
  const move = useAct((b: any) => post(`/trips/${tripId}/move-stop`, b), { invalidate: ['tracking', 'trip', 'plan', 'overview'], success: () => `${outletId} moved · driver, loader and store told`, onDone: onClose });
  const data = opts.data;
  const options: any[] = data?.options ?? [];
  const chosen = options.find(o => `${o.vehicleId}|${o.trip}` === pick);
  const text = reason ?? (data?.why ?? '');
  const k = data?.keep;
  return (
    <Modal title={`${outletId}: keep it, or move it?`} onClose={onClose} width={600}>
      {opts.isLoading ? <Loading /> : opts.error ? <ErrorState error={opts.error} retry={opts.refetch} /> : (
        <div className="space-y-4">
          {data.why
            ? <Callout tone={data.recommendMove ? 'warning' : 'info'} title={data.recommendMove ? 'Moving would reach the store in time' : 'Worth watching'}>{data.why}</Callout>
            : <Callout tone="success" title="No reason to move this stop">{k.vehicleId} is expected at {k.eta} (window closes {k.closeAt}). {k.lastSeenMinAgo != null && k.lastSeenMinAgo > 10 ? `The phone has had no signal for ${k.lastSeenMinAgo} min, but it keeps working offline.` : ''}</Callout>}
          <div className="max-h-[320px] overflow-y-auto rounded-lg border border-[#E4E7EC] divide-y divide-[#EEF0F3]">
            <label className={cx('flex items-center gap-3 px-4 py-3 text-[13px] cursor-pointer hover:bg-slate-50', pick === 'keep' && 'bg-teal-50')}>
              <input type="radio" name="opt" checked={pick === 'keep'} onChange={() => setPick('keep')} />
              <span className="flex-1 min-w-0"><span className="font-semibold text-slate-900">Keep on {k.vehicleId} · Trip {k.trip}</span>
                <span className="block text-[12px] text-slate-500">Planned {k.planned ?? '—'}{k.hold ? ` · held ${k.hold.minutes} min (${k.hold.label})` : ''}</span></span>
              <span className={cx('tabular whitespace-nowrap font-semibold', k.late ? 'text-red-700' : k.lateRisk ? 'text-amber-700' : 'text-slate-700')}>ETA {k.eta ?? '—'} · closes {k.closeAt}</span>
            </label>
            {options.length === 0 && <div className="p-4 text-[13px] text-slate-500">No other vehicle at this depot can take it.</div>}
            {options.slice(0, 20).map(o => {
              const key = `${o.vehicleId}|${o.trip}`;
              return (
                <label key={key} className={cx('flex items-center gap-3 px-4 py-3 text-[13px]', o.ok ? 'cursor-pointer hover:bg-slate-50' : 'opacity-60', pick === key && 'bg-teal-50')}>
                  <input type="radio" name="opt" disabled={!o.ok} checked={pick === key} onChange={() => setPick(key)} />
                  <span className="flex-1 min-w-0"><span className="font-semibold text-slate-900">{o.vehicleId} · {o.newTrip ? 'new ' : ''}Trip {o.trip}</span> <span className="text-slate-500">· {o.temp} {o.type} · {o.driverName}</span>
                    {!o.ok && <span className="block text-[12px] text-red-700">{o.problem}</span>}</span>
                  <span className="tabular text-slate-700 whitespace-nowrap">{o.depart ? `dep ${o.depart} · ` : ''}ETA {o.eta ?? '—'}</span>
                </label>
              );
            })}
          </div>
          {pick !== 'keep' && <Field label="Reason (the driver, the loader and the store see it)" hint="The goods are picked again from depot stock and loaded on the new vehicle."><input className={inputCls} value={text} onChange={e => setReason(e.target.value)} placeholder="e.g. VEH041 held by a road closure; the store would miss its window" /></Field>}
          <div className="flex justify-end gap-2">
            <Button onClick={onClose}>{pick === 'keep' ? 'Keep it' : 'Cancel'}</Button>
            {pick !== 'keep' && <Button variant="primary" disabled={!chosen || text.trim().length < 3 || move.isPending} loading={move.isPending} onClick={() => chosen && move.mutate({ outletId, to: { vehicleId: chosen.vehicleId, trip: chosen.trip }, reason: text.trim() })}>Move to {chosen?.vehicleId}</Button>}
          </div>
        </div>
      )}
    </Modal>
  );
}
