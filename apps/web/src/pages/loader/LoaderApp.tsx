import { useEffect, useRef, useState } from 'react';
import { Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { CheckCircle2, Lock, Snowflake, Package, AlertTriangle, Flag, Truck, Wrench, RotateCcw, Hourglass, ChevronRight, Minus, Plus, ArrowDownToLine, Info, Scale, TabletSmartphone } from 'lucide-react';
import { FieldHeader, BigButton } from '../../components/FieldShell';
import { Callout, Modal, Field, inputCls, Segmented, cx } from '../../components/ds';
import { ErrorState, Loading, Status, useAct, useApi, useToast, fmt } from '../../components/common';
import { OutletBadges, TempTag } from '../../components/tags';
import { ApiError, del, post } from '../../lib/api';
import { useLiveUpdates } from '../../lib/live';
import { useAuth } from '../../lib/auth';
import { hhmm, useNow } from '../../lib/clock';

export default function LoaderApp() {
  useLiveUpdates();
  return (
    <div className="min-h-[100dvh] bg-[#F4F6FA] flex justify-center">
      <div className="w-full max-w-[860px] min-h-[100dvh] bg-white flex flex-col shadow-[0_0_0_1px_#E6E9F0]">
        <Routes>
          <Route index element={<Queue />} />
          <Route path="trip/:id" element={<TripLoad />} />
          <Route path="*" element={<Navigate to="/l" replace />} />
        </Routes>
      </div>
    </div>
  );
}

function Queue() {
  const { user } = useAuth();
  const nav = useNavigate();
  const now = useNow();
  const q = useApi<any>(['loader-queue'], '/loader/queue', { refetchInterval: 10_000 });
  const d = q.data;
  const tone = (t: any) => t.status === 'released' ? '#15803D' : t.status === 'blocked' ? '#DC2626' : t.changed ? '#B45309' : t.status === 'loading' ? '#6D28D9' : t.status === 'in_progress' || t.status === 'completed' ? '#64748B' : '#475569';
  const waiting = (t: any) => t.trip > 1 && (d?.trips ?? []).some((x: any) => x.vehicleId === t.vehicleId && x.trip === t.trip - 1 && x.status !== 'completed');
  const label = (t: any) => waiting(t) && !['released', 'in_progress', 'completed'].includes(t.status) ? `Truck on Trip ${t.trip - 1}` : t.status === 'released' ? 'Released' : t.status === 'blocked' ? 'Blocked · fault' : t.changed ? 'Plan changed' : t.flagged ? `${t.flagged} flagged` : t.status === 'loading' ? `${t.loaded}/${t.lines} loaded` : t.status === 'in_progress' ? 'On the road' : t.status === 'completed' ? 'Back' : 'Not started';
  const trip1 = (d?.trips ?? []).filter((t: any) => t.trip === 1);
  const trip2 = (d?.trips ?? []).filter((t: any) => t.trip !== 1);
  return (
    <>
      <FieldHeader role="loader" title={`${user?.depot ?? 'Kandy'} DC · Dock queue`} subtitle={d ? `${d.dateLabel} · plan v${d.planVersion ?? '—'} · ${hhmm(now)}` : '…'} />
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {q.isLoading && <Loading />}
        {q.error && <ErrorState error={q.error} retry={q.refetch} />}
        {d && !d.planVersion && <Callout tone="info" title="No published plan yet">Load lists appear here as soon as the dispatcher publishes the plan.</Callout>}
        {d && d.trips.length > 0 && <div className="text-[12px] font-semibold uppercase tracking-[0.06em] text-slate-500 px-1">First trips · by departure</div>}
        {trip1.map((t: any) => <QueueRow key={t.id} t={t} tone={tone(t)} label={label(t)} onClick={() => nav(`/l/trip/${t.id}`)} />)}
        {trip2.length > 0 && <div className="text-[12px] font-semibold uppercase tracking-[0.06em] text-slate-500 px-1 pt-3">Second trips · load when the vehicle is back</div>}
        {trip2.map((t: any) => <QueueRow key={t.id} t={t} tone={tone(t)} label={label(t)} onClick={() => nav(`/l/trip/${t.id}`)} />)}
        {d && <div className="text-[12px] text-slate-500 flex items-center gap-1.5 px-1 pt-2"><Info size={12} />Load in reverse stop order: the last stop goes in first, so the first stop is at the door.</div>}
      </div>
    </>
  );
}

function QueueRow({ t, tone, label, onClick }: { t: any; tone: string; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} data-testid={`queue-${t.vehicleId}-${t.trip}`} className="w-full text-left rounded-xl border border-slate-200 px-4 py-3 flex items-center gap-3 hover:bg-slate-50 min-h-[68px]">
      <div className="w-14 text-center flex-shrink-0">
        <div className="text-[11px] text-slate-400">Departs</div>
        <div className="text-[16px] font-bold tabular text-slate-800">{t.depart}</div>
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[15px] font-bold text-slate-900 truncate flex items-center gap-1.5">{t.temp === 'reefer' && <Snowflake size={14} className="text-sky-600" />}{t.vehicleId} · Trip {t.trip}{t.swappedFrom && <span className="text-[12px] font-semibold text-violet-700">(was {t.swappedFrom})</span>}</div>
        <div className="text-[12px] text-slate-500 truncate">{t.brand} · {t.district} · {t.stops} stops · {t.lines} lines · {t.temp} {t.type} · {t.driverName}</div>
      </div>
      <span className="text-[12px] font-semibold text-right max-w-[110px] leading-4" style={{ color: tone }}>{label}</span>
      <ChevronRight size={16} className="text-slate-300" />
    </button>
  );
}

function TripLoad() {
  const { id } = useParams();
  const tripId = Number(id);
  const toast = useToast();
  const q = useApi<any>(['loader-trip', tripId], `/loader/trips/${tripId}`, { refetchInterval: 5_000 });
  const claim = useClaim(tripId, q.data && !['released', 'in_progress', 'completed', 'cancelled'].includes(q.data.status));
  const [flag, setFlag] = useState<any>(null);
  const [size, setSize] = useState<any>(null);
  const [fault, setFault] = useState(false);
  const inv = ['loader-trip', 'loader-queue'];
  const setLine = useAct((b: { orderId: string; state: 'loaded' | 'pending' }) => post(`/loader/trips/${tripId}/lines/${b.orderId}`, { state: b.state }), { invalidate: inv });
  const ack = useAct(() => post(`/loader/trips/${tripId}/ack`), { invalidate: inv, success: 'Change acknowledged' });
  const release = useAct(() => post(`/loader/trips/${tripId}/release`), { invalidate: inv, success: 'Released — the driver can start the trip' });
  if (q.isLoading) return <><FieldHeader role="loader" title="Loading…" back="/l" /><Loading /></>;
  if (q.error) return <><FieldHeader role="loader" title="Trip" back="/l" /><ErrorState error={q.error} retry={q.refetch} /></>;
  const t = q.data;
  const reversed = [...t.stops].reverse();
  const lines = t.stops.flatMap((s: any) => s.lines);
  const done = lines.filter((l: any) => l.loadStatus !== 'pending').length;
  const kgOf = (l: any) => l.actualKg ?? l.kg, m3Of = (l: any) => l.actualM3 ?? l.m3;
  const loadedKg = lines.reduce((a: number, l: any) => a + (l.loadStatus === 'pending' ? 0 : kgOf(l) * ((l.loadedUnits ?? l.units) / Math.max(1, l.units))), 0);
  const loadedM3 = lines.reduce((a: number, l: any) => a + (l.loadStatus === 'pending' ? 0 : m3Of(l) * ((l.loadedUnits ?? l.units) / Math.max(1, l.units))), 0);
  const BLOCKING = (e: any) => ['dock_shortfall', 'vehicle_fault'].includes(e.type) || e.type === 'size_divergence';
  const openEx = t.exceptions.filter((e: any) => e.status === 'open' && BLOCKING(e));
  const decided = t.exceptions.filter((e: any) => e.status === 'resolved' && BLOCKING(e));
  const waitingForTruck = t.previousTrip && t.previousTrip.status !== 'completed';
  const otherTablet = claim.holder && !claim.mine;
  const locked = ['released', 'in_progress', 'completed', 'cancelled'].includes(t.status) || waitingForTruck || otherTablet;
  const blockers = [waitingForTruck && `The truck is still on Trip ${t.previousTrip.trip}`, otherTablet && `${claim.holder} is loading this trip on another tablet`, done < lines.length && `${lines.length - done} line${lines.length - done > 1 ? 's' : ''} still to load`, openEx.some((e: any) => e.type !== 'size_divergence' || e.severity === 'high') && 'Waiting for the dispatcher’s decision', t.changedAt && 'Acknowledge the plan change first'].filter(Boolean) as string[];
  const change = t.changeNote;
  return (
    <>
      <FieldHeader role="loader" back="/l" title={`${t.vehicleId} · Trip ${t.trip}`} subtitle={`${t.brand} · ${t.district} · ${t.stops.length} stops · departs ${t.depart} · ${t.vehicle.temp} ${t.vehicle.type}`}
        right={<Status s={t.status} size="sm" />}>
        <div className="px-4 sm:px-5 pb-4 grid grid-cols-3 gap-3">
          <HeadBar label="Weight" cur={Math.round(loadedKg)} total={t.vehicle.weightCap} unit=" kg" />
          <HeadBar label="Volume" cur={Math.round(loadedM3 * 10) / 10} total={t.vehicle.volumeCap} unit=" m³" />
          <HeadBar label="Lines" cur={done} total={lines.length} unit="" />
        </div>
      </FieldHeader>
      {waitingForTruck && <div className="px-4 py-3 bg-slate-100 border-b border-slate-200 text-[13px] text-slate-800 flex items-start gap-2.5"><Hourglass size={16} className="text-slate-500 mt-0.5 flex-shrink-0" /><div><div className="font-bold">{t.vehicleId} is still out on Trip {t.previousTrip.trip}</div>You can stage the goods now. Ticking lines and release open when the driver closes Trip {t.previousTrip.trip} — you get a notification.</div></div>}
      {otherTablet && <div className="px-4 py-3 bg-sky-50 border-b border-sky-200 text-[13px] text-sky-900 flex items-start gap-2.5"><TabletSmartphone size={16} className="text-sky-600 mt-0.5 flex-shrink-0" /><div className="flex-1"><div className="font-bold">{claim.holder} is loading this trip on another tablet</div>Two people ticking the same list leads to mistakes. Take over only if they have stopped.</div><button onClick={() => claim.takeOver()} className="h-9 px-3 rounded-lg bg-sky-700 text-white text-[13px] font-bold flex-shrink-0">Take over</button></div>}
      {t.swappedFrom && <div className="px-4 py-2.5 bg-violet-50 border-b border-violet-200 text-[13px] text-violet-900 flex items-center gap-2"><RotateCcw size={15} />Vehicle swapped: {t.swappedFrom} → {t.vehicleId}. Move every line across and tick it again.</div>}
      {t.changedAt && !locked && (
        <div className="px-4 py-3 bg-amber-50 border-b border-amber-200 flex items-start gap-2.5">
          <AlertTriangle size={17} className="text-amber-600 mt-0.5 flex-shrink-0" />
          <div className="flex-1 text-[13px] text-amber-900"><div className="font-bold">The plan changed at {hhmm(t.changedAt)}</div>{change?.moved ? <>Stop {change.moved} moved from {change.from} to {change.to}. {change.to === t.vehicleId ? 'Load its lines on this vehicle.' : 'Take its goods off and back to staging.'}</> : 'Check the list below — lines may have been added or removed.'}</div>
          <button onClick={() => ack.mutate()} disabled={ack.isPending} className="h-9 px-3 rounded-lg bg-amber-600 text-white text-[13px] font-bold flex-shrink-0">Got it</button>
        </div>
      )}
      {openEx.map((e: any) => (
        <div key={e.id} className="px-4 py-3 bg-orange-50 border-b border-orange-200 flex items-start gap-2.5 text-[13px] text-orange-900">
          <Hourglass size={16} className="text-orange-600 mt-0.5 flex-shrink-0 pulse-soft" />
          <div><div className="font-bold">{e.title}</div>Sent to the dispatcher at {hhmm(e.raisedAt)}. Keep loading the other lines; the decision appears here.</div>
        </div>
      ))}
      {decided.map((e: any) => <div key={e.id} className="px-4 py-2.5 bg-emerald-50 border-b border-emerald-200 text-[13px] text-emerald-900 flex items-center gap-2"><CheckCircle2 size={15} className="text-emerald-600" /><span><b>Decision:</b> {e.decision}</span></div>)}

      <div className="flex-1 overflow-y-auto">
        <div className="px-4 pt-3 pb-1 flex items-center gap-2 text-[12px] text-slate-500"><ArrowDownToLine size={13} />Load from the top: last stop first, first stop at the door.</div>
        {reversed.map((s: any, i: number) => (
          <section key={s.outletId} className="px-4 pt-3">
            <div className="flex items-center justify-between gap-2 pb-2">
              <div className="min-w-0">
                <div className="text-[13px] font-bold text-slate-900 flex items-center gap-2"><span className="w-6 h-6 rounded-full bg-slate-900 text-white text-[11px] flex items-center justify-center">{s.seq}</span>{s.outletId} · {s.outlet.district}{i === 0 && <span className="text-[11px] font-semibold text-violet-700 bg-violet-50 rounded px-1.5 py-0.5">load first</span>}{i === reversed.length - 1 && <span className="text-[11px] font-semibold text-teal-700 bg-teal-50 rounded px-1.5 py-0.5">at the door</span>}</div>
                <div className="mt-1 ml-8"><OutletBadges o={s.outlet} /></div>
              </div>
              <span className="text-[12px] tabular text-slate-500 whitespace-nowrap">ETA {s.start}</span>
            </div>
            <div className="space-y-2 pb-2">
              {s.lines.map((l: any) => {
                const isLoaded = l.loadStatus === 'loaded'; const flagged = l.loadStatus === 'flagged';
                return (
                  <div key={l.orderId} data-testid={`line-${l.orderId}`} className={cx('rounded-xl border p-3 flex items-center gap-3', isLoaded ? 'border-emerald-200 bg-emerald-50/50' : flagged ? 'border-orange-300 bg-orange-50/60' : 'border-slate-200 bg-white')}>
                    <button disabled={locked || setLine.isPending} onClick={() => setLine.mutate({ orderId: l.orderId, state: isLoaded ? 'pending' : 'loaded' })} aria-pressed={isLoaded} aria-label={isLoaded ? `Unmark ${l.orderId}` : `Mark ${l.orderId} loaded`}
                      className={cx('w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 border-2 transition-colors', isLoaded ? 'bg-emerald-600 border-emerald-600 text-white' : flagged ? 'bg-orange-500 border-orange-500 text-white' : 'border-slate-300 text-slate-300 hover:border-violet-500')}>
                      {flagged ? <Flag size={20} /> : <CheckCircle2 size={22} />}
                    </button>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap"><span className="text-[14px] font-bold text-slate-900">{l.description ?? (l.temp === 'chilled' ? 'Chilled crates' : 'Ambient cartons')}</span><TempTag temp={l.temp} /></div>
                      <div className="text-[12px] text-slate-500 tabular mt-0.5">{l.orderId} · {flagged ? <b className="text-orange-700">{l.loadedUnits} of {l.units} units</b> : `${l.units} units`} · {fmt(l.kg)} kg · {fmt(l.m3, 1)} m³</div>
                      {l.actualKg && <div className="text-[12px] text-violet-800 mt-0.5">Measured {fmt(l.actualKg)} kg · {fmt(l.actualM3, 1)} m³</div>}
                      {flagged && l.flagNote && <div className="text-[12px] text-orange-800 mt-0.5">{l.flagReason}: {l.flagNote}</div>}
                    </div>
                    {!locked && <button onClick={() => setSize(l)} aria-label={`Report real size of ${l.orderId}`} title="Bigger or heavier than ordered?" className={cx('h-11 w-11 rounded-lg ring-1 flex items-center justify-center', l.actualKg ? 'text-violet-700 ring-violet-300 bg-violet-50' : 'text-slate-500 ring-slate-200 hover:bg-slate-50')}><Scale size={15} /></button>}
                    {!locked && !flagged && <button onClick={() => setFlag({ ...l, reason: 'missing', loadedUnits: Math.max(0, l.units - 1), item: '', note: '' })} className="h-11 px-3 rounded-lg text-[13px] font-semibold text-orange-700 ring-1 ring-orange-200 hover:bg-orange-50 flex items-center gap-1.5"><Flag size={14} />Flag</button>}
                  </div>
                );
              })}
            </div>
          </section>
        ))}
        {t.movedAway.length > 0 && <div className="px-4 pt-2">{t.movedAway.map((m: any) => <div key={m.orderId} className="rounded-xl border border-dashed border-slate-300 p-3 text-[13px] text-slate-500 mb-2">{m.outletId} {m.orderId} moved {m.move ? `to ${m.move.toVehicle}` : ''} — take it off this vehicle.</div>)}</div>}
        <div className="px-4 py-4"><button onClick={() => setFault(true)} disabled={locked} className="text-[13px] font-semibold text-red-700 inline-flex items-center gap-1.5 disabled:text-slate-300"><Wrench size={14} />Report a vehicle fault</button></div>
      </div>

      <div className="flex-shrink-0 border-t border-[#E4E7EC] bg-white p-4 safe-bottom space-y-2">
        {['released', 'in_progress', 'completed', 'cancelled'].includes(t.status) ? (
          <div className="rounded-xl bg-emerald-50 text-emerald-900 px-4 py-3 text-[14px] font-semibold flex items-center gap-2"><CheckCircle2 size={18} className="text-emerald-600" />{t.status === 'cancelled' ? 'This trip was cancelled in the new plan' : `Released ${t.releasedAt ? hhmm(t.releasedAt) : ''} · the driver can start`}</div>
        ) : <>
          {blockers.length > 0 && <div className="text-[12px] text-slate-500 flex items-start gap-1.5"><Lock size={12} className="mt-0.5" />{blockers.join(' · ')}</div>}
          <BigButton tone="loader" icon={<Truck size={18} />} disabled={blockers.length > 0 || release.isPending} loading={release.isPending} onClick={() => release.mutate()} data-testid="release">Release vehicle to driver</BigButton>
        </>}
      </div>

      {flag && <FlagDialog line={flag} onClose={() => setFlag(null)} onSent={() => { setFlag(null); toast('info', 'Flag sent to the dispatcher'); q.refetch(); }} tripId={tripId} />}
      {fault && <FaultDialog tripId={tripId} onClose={() => setFault(false)} />}
      {size && <SizeDialog line={size} tripId={tripId} onClose={() => setSize(null)} />}
    </>
  );
}

function HeadBar({ label, cur, total, unit }: { label: string; cur: number; total: number; unit: string }) {
  const over = cur > total; const pct = Math.min(100, total ? cur / total * 100 : 0);
  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:justify-between text-[11px] text-white/80 mb-1"><span>{label}</span><span className="tabular font-semibold text-white whitespace-nowrap">{fmt(cur, unit === ' m³' ? 1 : 0)} / {fmt(total, unit === ' m³' ? 1 : 0)}{unit}</span></div>
      <div className="h-2 rounded-full bg-white/20 overflow-hidden"><div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: over ? '#FCA5A5' : 'rgba(255,255,255,.85)' }} /></div>
    </div>
  );
}

function FlagDialog({ line, tripId, onClose, onSent }: { line: any; tripId: number; onClose: () => void; onSent: () => void }) {
  const [reason, setReason] = useState<'missing' | 'damaged' | 'wrong_item'>('missing');
  const [units, setUnits] = useState(Math.max(0, line.units - 2));
  const [item, setItem] = useState(line.description?.toLowerCase().includes('yoghurt') ? 'yoghurt cases' : '');
  const [note, setNote] = useState('');
  const send = useAct(() => post(`/loader/trips/${tripId}/lines/${line.orderId}/flag`, { reason, loadedUnits: units, item: item || undefined, note: note || undefined }), { invalidate: ['loader-trip', 'loader-queue'], onDone: onSent });
  return (
    <Modal title={`Flag ${line.orderId}`} onClose={onClose} width={460}>
      <div className="space-y-4">
        <div className="text-[13px] text-slate-600">{line.description} · {line.units} units planned for {line.outletId}</div>
        <Segmented value={reason} onChange={setReason} options={[{ id: 'missing', label: 'Missing' }, { id: 'damaged', label: 'Damaged' }, { id: 'wrong_item', label: 'Wrong item' }]} />
        <Field label="Units actually loaded">
          <div className="flex items-center gap-3">
            <button onClick={() => setUnits(Math.max(0, units - 1))} className="w-12 h-12 rounded-xl ring-1 ring-[#D0D5DD] flex items-center justify-center" aria-label="One less"><Minus size={18} /></button>
            <span className="text-[24px] font-bold tabular w-16 text-center">{units}</span>
            <button onClick={() => setUnits(Math.min(line.units, units + 1))} className="w-12 h-12 rounded-xl ring-1 ring-[#D0D5DD] flex items-center justify-center" aria-label="One more"><Plus size={18} /></button>
            <span className="text-[13px] text-slate-500">of {line.units} · <b className="text-orange-700">{line.units - units} short</b></span>
          </div>
        </Field>
        <Field label="What is short (optional)"><input className={inputCls} value={item} onChange={e => setItem(e.target.value)} placeholder="e.g. yoghurt cases" /></Field>
        <Field label="Note (optional)"><input className={inputCls} value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. Checked cold room 2" /></Field>
        <Callout tone="info">The dispatcher decides: send what is here, substitute, or hold the vehicle. You can keep loading the other lines.</Callout>
        <div className="flex gap-2"><BigButton tone="secondary" onClick={onClose}>Cancel</BigButton><BigButton tone="warning" disabled={units >= line.units || send.isPending} loading={send.isPending} onClick={() => send.mutate()} icon={<Flag size={16} />} data-testid="flag-send">Send flag</BigButton></div>
      </div>
    </Modal>
  );
}

function FaultDialog({ tripId, onClose }: { tripId: number; onClose: () => void }) {
  const [type, setType] = useState('Reefer not cooling');
  const [severity, setSeverity] = useState<'blocking' | 'advisory'>('blocking');
  const [note, setNote] = useState('');
  const send = useAct(() => post(`/loader/trips/${tripId}/fault`, { type, severity, note: note || undefined }), { invalidate: ['loader-trip', 'loader-queue'], success: 'Fault sent to the dispatcher', onDone: onClose });
  return (
    <Modal title="Report a vehicle fault" onClose={onClose} width={460}>
      <div className="space-y-4">
        <Field label="What is wrong"><select className={inputCls} value={type} onChange={e => setType(e.target.value)}>{['Reefer not cooling', 'Flat or damaged tyre', 'Brakes', 'Engine warning light', 'Door or seal damaged', 'Other'].map(x => <option key={x}>{x}</option>)}</select></Field>
        <Segmented value={severity} onChange={setSeverity} options={[{ id: 'blocking', label: 'Cannot leave' }, { id: 'advisory', label: 'Can leave · advisory' }]} />
        <Field label="Note (optional)"><input className={inputCls} value={note} onChange={e => setNote(e.target.value)} /></Field>
        {severity === 'blocking' && <Callout tone="warning">The trip is frozen until the dispatcher swaps the vehicle. You then move every line to the new vehicle.</Callout>}
        <div className="flex gap-2"><BigButton tone="secondary" onClick={onClose}>Cancel</BigButton><BigButton tone="danger" disabled={send.isPending} loading={send.isPending} onClick={() => send.mutate()} icon={<Wrench size={16} />}>Send</BigButton></div>
      </div>
    </Modal>
  );
}

/** One loader per trip: claim it on open, keep it with a heartbeat, give it back on leaving. */
function useClaim(tripId: number, active: boolean) {
  const [state, setState] = useState<{ holder: string | null; mine: boolean }>({ holder: null, mine: true });
  const toast = useToast();
  const device = useRef(`${navigator.platform || 'Tablet'} · ${Math.random().toString(36).slice(2, 6)}`);
  const claim = async (takeOver = false) => {
    try { const r = await post<any>(`/loader/trips/${tripId}/claim`, { device: device.current, takeOver }); setState({ holder: r.holder, mine: true }); if (takeOver) toast('success', 'You are loading this trip now'); }
    catch (e) { if (e instanceof ApiError && e.code === 'TRIP_CLAIMED') setState({ holder: e.body?.details?.holder ?? 'Someone', mine: false }); }
  };
  useEffect(() => {
    if (!active) return;
    void claim();
    const id = setInterval(() => void claim(), 60_000);
    return () => { clearInterval(id); void del(`/loader/trips/${tripId}/claim`).catch(() => undefined); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripId, active]);
  return { ...state, takeOver: () => claim(true) };
}

function SizeDialog({ line, tripId, onClose }: { line: any; tripId: number; onClose: () => void }) {
  const [kg, setKg] = useState(String(line.actualKg ?? line.kg));
  const [m3, setM3] = useState(String(line.actualM3 ?? line.m3));
  const [note, setNote] = useState('');
  const send = useAct(() => post(`/loader/trips/${tripId}/lines/${line.orderId}/size`, { actualKg: Number(kg), actualM3: Number(m3), note: note || undefined }), { invalidate: ['loader-trip', 'loader-queue'], success: 'Size recorded — the dispatcher is told if the truck no longer fits', onDone: onClose });
  const ok = Number(kg) > 0 && Number(m3) > 0;
  return (
    <Modal title={`Real size of ${line.orderId}`} onClose={onClose} width={440}>
      <div className="space-y-4">
        <div className="text-[13px] text-slate-600">The order said {fmt(line.kg)} kg and {fmt(line.m3, 1)} m³. Enter what is actually on the dock.</div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Weight (kg)"><input className={inputCls} type="number" min={1} inputMode="decimal" value={kg} onChange={e => setKg(e.target.value)} /></Field>
          <Field label="Volume (m³)"><input className={inputCls} type="number" min={0.1} step={0.1} inputMode="decimal" value={m3} onChange={e => setM3(e.target.value)} /></Field>
        </div>
        <Field label="Note (optional)"><input className={inputCls} value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. Pallets double-stacked" /></Field>
        <Callout tone="info">Small differences are just recorded. If the truck goes over its weight or volume limit, release waits for the dispatcher.</Callout>
        <div className="flex gap-2"><BigButton tone="secondary" onClick={onClose}>Cancel</BigButton><BigButton tone="loader" disabled={!ok || send.isPending} loading={send.isPending} onClick={() => send.mutate()} icon={<Scale size={16} />}>Save size</BigButton></div>
      </div>
    </Modal>
  );
}
