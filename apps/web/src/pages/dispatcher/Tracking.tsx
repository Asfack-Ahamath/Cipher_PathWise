import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, WifiOff, MapPin, Search, Snowflake, Truck, ArrowRightLeft, CheckCircle2, Clock, Maximize2 } from 'lucide-react';
import TripMap, { type MapTrip } from '../../components/TripMap';
import { IconChip, Button, Callout, Pill, Modal, Field, inputCls, Empty, cx } from '../../components/ds';
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
  const detail = useApi<any>(['trip', selId], selId ? `/trips/${selId}` : null, { refetchInterval: 10_000 });

  const list: any[] = (q.data?.trips ?? []).filter((t: any) => depot === 'all' || t.vehicle.depot === depot);
  const mapTrips: MapTrip[] = useMemo(() => list.map(t => ({
    key: String(t.id), label: `${t.vehicleId} · T${t.trip}`, depot: t.depot, pos: t.position, estimate: t.estimate,
    tone: t.offline ? 'offline' : t.conflicts || t.lateRisk.length ? 'alert' : t.status === 'completed' ? 'done' : t.status === 'in_progress' ? 'road' : 'depot',
    stops: t.stops.map((s: any) => ({ id: s.outletId, seq: s.seq, pos: [s.lat, s.lng] as [number, number], state: s.done ? 'done' : 'next' })),
  })), [q.data, depot]);
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorState error={q.error} retry={q.refetch} />;
  if (!list.length) return <div className="p-6"><Empty icon={<MapPin size={28} />} title="Nothing on the road yet">Trips appear here once a plan is published.</Empty></div>;

  const s2 = search.toLowerCase();
  const shown = list.filter(t => !s2 || `${t.vehicleId} ${t.driverName} ${t.district}`.toLowerCase().includes(s2));
  const groups = (['attention', 'road', 'depot', 'done'] as Group[]).map(g => ({ g, items: shown.filter(t => groupOf(t) === g) })).filter(x => x.items.length);
  const sel = list.find(t => t.id === selId) ?? null;
  const d = detail.data && detail.data.id === selId ? detail.data : null;
  const online = list.filter(t => !t.offline).length;

  return (
    <div className="flex flex-1 min-h-0 flex-col lg:flex-row">
      <div className="lg:w-[300px] 2xl:w-[340px] max-h-[40vh] lg:max-h-none flex-shrink-0 flex flex-col min-h-0 bg-white border-b lg:border-b-0 lg:border-r border-[#E4E7EC]">
        <div className="flex-shrink-0 px-5 pt-4 pb-3 border-b border-[#E4E7EC]">
          <div className="flex items-center gap-3"><IconChip hue="sky" size={40}><MapPin size={18} /></IconChip>
            <div><h1 className="text-[20px] font-semibold text-slate-900 leading-7">Live tracking</h1>
              <p className="text-[13px] text-slate-500">{online} of {list.length} trips in contact · {hhmm(now)}</p></div></div>
          <label className="mt-3 relative block"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Vehicle, driver or district" className={`${inputCls} pl-9`} /></label>
        </div>
        <div className="flex-1 overflow-y-auto pb-3">
          {groups.map(({ g, items }) => (
            <div key={g}>
              <div className="sticky top-0 z-10 bg-white/95 backdrop-blur px-5 pt-4 pb-1 flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500"><span>{GROUP_LABEL[g]}</span><span className="tabular">{items.length}</span></div>
              {items.map(t => {
                const active = selId === t.id;
                const right = t.offline ? `Last seen ${t.lastSeen ? hhmm(t.lastSeen) : '—'}` : t.conflicts ? `${t.conflicts} conflict` : t.status === 'in_progress' ? `${t.done} of ${t.total} stops` : t.status === 'completed' ? `Closed ${hhmm(t.closedAt)}` : `Departs ${t.depart}`;
                return (
                  <button key={t.id} onClick={() => setSelId(active ? null : t.id)} data-testid={`track-${t.vehicleId}`} className={cx('w-[calc(100%-16px)] text-left mx-2 my-1 px-3 py-3 rounded-xl flex items-start gap-3 transition-colors', active ? 'bg-teal-50 ring-1 ring-teal-200' : 'hover:bg-slate-50')}>
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

      <div className="flex-1 min-w-0 min-h-[320px] relative">
        <TripMap trips={mapTrips} selected={selId ? String(selId) : null} onSelect={k => setSelId(Number(k))} fitKey={fit} />
        <div className="absolute top-3 right-3 z-[500] flex gap-2">
          {selId && <Button size="sm" onClick={() => setSelId(null)}>All trips</Button>}
          <Button size="sm" icon={<Maximize2 size={13} />} onClick={() => setFit(f => f + 1)}>Fit</Button>
        </div>
        <div className="absolute bottom-3 left-3 z-[500] bg-white/95 rounded-lg ring-1 ring-[#E4E7EC] px-3 py-2 text-[11px] text-slate-600 flex flex-wrap gap-x-3 gap-y-1 max-w-[calc(100%-24px)]">
          {[['#0F766E', 'On the road'], ['#4F46E5', 'At depot'], ['#64748B', 'No signal (estimate dashed)'], ['#D97706', 'Needs attention'], ['#059669', 'Completed']].map(([c, l]) => <span key={l} className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full" style={{ background: c }} />{l}</span>)}
        </div>
      </div>

      {sel && (
        <aside className="lg:w-[380px] flex-shrink-0 flex flex-col min-h-0 bg-white border-t lg:border-t-0 lg:border-l border-[#E4E7EC] max-h-[60vh] lg:max-h-none">
          <div className="flex-shrink-0 px-5 py-4 border-b border-[#E4E7EC]">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5"><IconChip hue={sel.vehicle.temp === 'reefer' ? 'sky' : 'slate'} size={36}>{sel.vehicle.temp === 'reefer' ? <Snowflake size={16} /> : <Truck size={16} />}</IconChip>
                <div><div className="text-[16px] font-semibold text-slate-900">{sel.vehicleId} · Trip {sel.trip}</div><div className="text-[12px] text-slate-500">{sel.driverName} · {sel.brand} {sel.district}</div></div></div>
              {sel.offline ? <Pill label="No signal" color="#4B5563" bg="#E5E7EB" icon={<WifiOff size={11} />} /> : <Status s={sel.status} size="sm" />}
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-[12px]">
              <div className="rounded-lg bg-slate-50 px-2.5 py-2"><div className="text-slate-500">Departs</div><div className="font-semibold tabular text-slate-900">{sel.depart}</div></div>
              <div className="rounded-lg bg-slate-50 px-2.5 py-2"><div className="text-slate-500">Progress</div><div className="font-semibold tabular text-slate-900">{sel.done}/{sel.total} stops</div></div>
              <div className="rounded-lg bg-slate-50 px-2.5 py-2"><div className="text-slate-500">Last contact</div><div className="font-semibold tabular text-slate-900">{sel.lastSeen ? `${minsAgo(sel.lastSeen, now)} min ago` : '—'}</div></div>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            {sel.offline && <Callout tone="neutral" icon={<WifiOff size={15} className="text-slate-500" />} title={`No signal since ${sel.lastSeen ? hhmm(sel.lastSeen) : 'departure'}`}>The driver's phone keeps working and saves every stop. The dashed marker is where the plan says the truck should be. You can still move a stop; if the driver delivers it anyway, you get a conflict to decide, not a silent overwrite.</Callout>}
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
                      {done ? <span className="text-[12px] font-semibold text-emerald-700 inline-flex items-center gap-1"><CheckCircle2 size={13} />{tr.doneAt}</span> : <span className="text-[12px] tabular text-slate-600">ETA {tr?.arrive ?? s.arrive}</span>}
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
  const opts = useApi<any[]>(['move-options', tripId, outletId], `/trips/${tripId}/move-options?outletId=${outletId}`);
  const [pick, setPick] = useState<string | null>(null);
  const [reason, setReason] = useState('Driver out of signal; another vehicle can reach the window.');
  const move = useAct((b: any) => post(`/trips/${tripId}/move-stop`, b), { invalidate: ['tracking', 'trip', 'plan', 'overview'], success: r => `${outletId} moved · driver, loader and store told`, onDone: onClose });
  const chosen = (opts.data ?? []).find(o => `${o.vehicleId}|${o.trip}` === pick);
  return (
    <Modal title={`Move ${outletId} to another vehicle`} onClose={onClose} width={560}>
      {opts.isLoading ? <Loading /> : (
        <div className="space-y-4">
          <p className="text-[13px] text-slate-600 -mt-1">Each option is checked against every rule, with the arrival time it would give. Only valid options can be picked.</p>
          <div className="max-h-[300px] overflow-y-auto rounded-lg border border-[#E4E7EC] divide-y divide-[#EEF0F3]">
            {(opts.data ?? []).length === 0 && <div className="p-4 text-[13px] text-slate-500">No other vehicle at this depot.</div>}
            {(opts.data ?? []).slice(0, 20).map(o => {
              const k = `${o.vehicleId}|${o.trip}`;
              return (
                <label key={k} className={cx('flex items-center gap-3 px-4 py-3 text-[13px]', o.ok ? 'cursor-pointer hover:bg-slate-50' : 'opacity-60', pick === k && 'bg-teal-50')}>
                  <input type="radio" name="opt" disabled={!o.ok} checked={pick === k} onChange={() => setPick(k)} />
                  <span className="flex-1 min-w-0"><span className="font-semibold text-slate-900">{o.vehicleId} · {o.newTrip ? 'new ' : ''}Trip {o.trip}</span> <span className="text-slate-500">· {o.temp} {o.type} · {o.driverName}</span>
                    {!o.ok && <span className="block text-[12px] text-red-700">{o.problem}</span>}</span>
                  <span className="tabular text-slate-700 whitespace-nowrap">{o.depart ? `dep ${o.depart} · ` : ''}ETA {o.eta ?? '—'}</span>
                </label>
              );
            })}
          </div>
          <Field label="Reason (sent to the driver and the store)"><input className={inputCls} value={reason} onChange={e => setReason(e.target.value)} /></Field>
          <div className="flex justify-end gap-2"><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!chosen || move.isPending} onClick={() => chosen && move.mutate({ outletId, toVehicleId: chosen.vehicleId, toTrip: chosen.trip, reason })}>Move stop</Button></div>
        </div>
      )}
    </Modal>
  );
}
