import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { WifiOff, Wifi, CheckCircle2, Clock, Package, Camera, AlertTriangle, RefreshCw, Snowflake, Navigation, PenLine, Lock, Truck, Hourglass, CircleSlash, DoorClosed, Ban, ShieldAlert, MapPin, ChevronRight, ArrowRightLeft, Flag, CloudUpload, X, Phone } from 'lucide-react';
import { FieldHeader, BigButton } from '../../components/FieldShell';
import { Callout, cx, inputCls } from '../../components/ds';
import { ErrorState, Loading, useToast } from '../../components/common';
import { OutletBadges, TempTag } from '../../components/tags';
import { api, ApiError } from '../../lib/api';
import { hhmm, useNow } from '../../lib/clock';
import { flush, hasSignal, loadRun, record, saveRun, setSimulatedOffline, useOutbox, type OutEvent } from '../../lib/outbox';

type Screen = { k: 'run' } | { k: 'stop'; outletId: string } | { k: 'outcome'; outletId: string } | { k: 'pod'; outletId: string; outcome: string; recommendation?: string; note?: string } | { k: 'problem'; outletId?: string } | { k: 'summary' };

const OUTCOMES = [
  { id: 'full', label: 'Delivered in full', icon: CheckCircle2, tone: 'text-emerald-700 bg-emerald-50 ring-emerald-200' },
  { id: 'partial', label: 'Partial delivery', icon: Package, tone: 'text-orange-700 bg-orange-50 ring-orange-200' },
  { id: 'refused', label: 'Store refused goods', icon: Ban, tone: 'text-red-700 bg-red-50 ring-red-200' },
  { id: 'no_access', label: 'Could not access', icon: CircleSlash, tone: 'text-red-700 bg-red-50 ring-red-200' },
  { id: 'closed', label: 'Outlet closed', icon: DoorClosed, tone: 'text-red-700 bg-red-50 ring-red-200' },
];
const OUTCOME_LABEL = Object.fromEntries(OUTCOMES.map(o => [o.id, o.label]));

/** The run: fresh from the server when there is signal, otherwise the copy saved on this phone. */
function useRun() {
  return useQuery<{ run: any; cached: boolean }>({
    queryKey: ['driver-run'],
    queryFn: async () => {
      try {
        const run = await api('/driver/run');
        await saveRun(run);
        return { run, cached: false };
      } catch (e) {
        const run = await loadRun<any>();
        if (run && e instanceof ApiError && e.status === 0) return { run, cached: true };
        throw e;
      }
    },
    refetchInterval: 15_000, retry: false, networkMode: 'always',
  });
}

export default function DriverApp() {
  const q = useRun();
  const qc = useQueryClient();
  const box = useOutbox();
  const toast = useToast();
  const now = useNow(15_000);
  const [screen, setScreen] = useState<Screen>({ k: 'run' });
  const [tripIdx, setTripIdx] = useState(0);
  const [answered, setAnswered] = useState<string | null>(null);
  const [syncReport, setSyncReport] = useState<{ applied: number; conflicts: any[]; rejected: any[] } | null>(null);
  const online = !box.simulated && box.online;

  // when signal returns: upload the outbox, then refresh the run and report what happened
  const wasOnline = useRef(online);
  useEffect(() => {
    if (online && !wasOnline.current) void doSync(true);
    wasOnline.current = online;
  }, [online]);
  async function doSync(report: boolean) {
    const had = box.pending.length;
    const res = await flush();
    await qc.invalidateQueries({ queryKey: ['driver-run'] });
    if (report && (had || res.length)) {
      setSyncReport({ applied: res.filter(r => r.status === 'applied' || r.status === 'duplicate').length, conflicts: res.filter(r => r.status === 'conflict'), rejected: res.filter(r => r.status === 'rejected') });
    }
  }

  if (q.isLoading) return <Shell><FieldHeader role="driver" title="Today's run" /><Loading /></Shell>;
  if (q.error || !q.data) return <Shell><FieldHeader role="driver" title="Today's run" offline={!online} /><ErrorState error={q.error ?? 'No run saved on this phone yet. Connect once to download it.'} retry={q.refetch} /></Shell>;
  const run = q.data.run;
  const trips: any[] = run.trips;
  if (!trips.length) return <Shell><FieldHeader role="driver" title="Today's run" subtitle={`${run.vehicle?.id ?? ''} · ${run.date}`} offline={!online} /><div className="p-5"><Callout tone="info" title="No trip assigned yet">Your run appears here when the dispatcher publishes the plan. It is saved to this phone so it works without signal.</Callout></div></Shell>;
  const idx = Math.min(tripIdx, trips.length - 1);
  const trip = trips[idx];

  // local view = server state + records still waiting in the outbox
  const pendingFor = (type: string, outletId?: string) => box.pending.find(e => e.tripId === trip.id && e.type === type && (!outletId || e.outletId === outletId));
  const started = ['in_progress', 'completed'].includes(trip.status) || !!pendingFor('trip_started');
  const closed = trip.status === 'completed' || !!pendingFor('trip_closed');
  const released = ['released', 'in_progress', 'completed'].includes(trip.status);
  const movedOutlets = new Map<string, any>(trip.movedAway.map((m: any) => [m.outletId, m]));
  const stopState = (s: any): 'synced' | 'saved' | 'arrived' | 'todo' => s.outcome ? 'synced' : pendingFor('delivered', s.outletId) ? 'saved' : (s.arrivedAt || pendingFor('arrived', s.outletId)) ? 'arrived' : 'todo';
  const stops: any[] = trip.stops;
  const allStops = [...stops, ...trip.movedAway.filter((m: any, i: number, a: any[]) => a.findIndex(x => x.outletId === m.outletId) === i).map((m: any) => ({ outletId: m.outletId, moved: m, seq: '–', lines: [] }))];
  const current = stops.find(s => stopState(s) === 'todo' || stopState(s) === 'arrived');
  const doneCount = stops.filter(s => ['synced', 'saved'].includes(stopState(s))).length;
  const short = trip.lines.filter((l: any) => l.loadStatus === 'flagged' || (l.loadedUnits != null && l.loadedUnits < l.units));
  const conflicts = trip.exceptions.filter((e: any) => e.type === 'sync_conflict' && e.status === 'open');
  const decidedConflicts = trip.exceptions.filter((e: any) => e.type === 'sync_conflict' && e.status !== 'open');
  const answeredOutlets = new Set<string>([...trip.events.filter((e: any) => e.type === 'conflict_answer').map((e: any) => e.outletId), ...box.pending.filter(e => e.type === 'conflict_answer').map(e => e.outletId as string)]);
  const alreadyAnswered = answered ?? (conflicts.length && conflicts.every((c: any) => answeredOutlets.has(c.outletId)) ? 'sent' : null);

  const act = async (type: OutEvent['type'], outletId: string | null, payload: Record<string, any> = {}, msg?: string) => {
    await record(type, trip.id, outletId, payload);
    toast(hasSignal() ? 'success' : 'info', msg ?? (hasSignal() ? 'Sent' : 'Saved on this phone — it will sync when you have signal'));
    if (hasSignal()) setTimeout(() => qc.invalidateQueries({ queryKey: ['driver-run'] }), 600);
  };
  const stopOf = (id: string) => allStops.find(s => s.outletId === id);
  const title = screen.k === 'run' ? "Today's run" : screen.k === 'stop' ? `Stop ${stopOf(screen.outletId)?.seq} · ${screen.outletId}` : screen.k === 'outcome' ? 'Delivery outcome' : screen.k === 'pod' ? 'Proof of delivery' : screen.k === 'problem' ? 'Report a problem' : 'Trip summary';
  const back = screen.k === 'run' ? undefined : () => setScreen(screen.k === 'pod' ? { k: 'outcome', outletId: screen.outletId } : screen.k === 'outcome' ? { k: 'stop', outletId: screen.outletId } : { k: 'run' });

  return (
    <Shell>
      <FieldHeader role="driver" offline={!online} back={back} title={title} subtitle={`${trip.vehicleId} · Trip ${trip.trip} · ${trip.brand} · ${trip.district}`}
        right={<span className="w-9 h-9 rounded-full bg-white/15 ring-1 ring-white/25 flex items-center justify-center" title={online ? 'Online' : 'No signal'}>{online ? <Wifi size={17} /> : <WifiOff size={17} />}</span>} />
      {/* connectivity strip: always visible, grey (never red) when offline */}
      <div className={cx('flex-shrink-0 px-4 py-2 flex items-center gap-2 text-[12px]', online ? 'bg-slate-50 text-slate-600' : 'bg-[#E5E7EB] text-slate-700')}>
        {online ? <Wifi size={13} className="text-emerald-600" /> : <WifiOff size={13} className="text-[#6B7280]" />}
        <span className="flex-1 min-w-0 truncate">{online ? (box.syncing ? 'Syncing…' : box.pending.length ? `${box.pending.length} waiting to send` : `Online · synced ${box.lastSync ? hhmm(box.lastSync) : hhmm(now)}`) : <><b>No signal{box.offlineSince ? ` since ${hhmm(box.offlineSince)}` : ''}</b> · your work is saved on this phone</>}</span>
        {box.pending.length > 0 && <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-white text-slate-700 tabular">{box.pending.length} waiting</span>}
        <label className="flex items-center gap-1.5 font-semibold cursor-pointer select-none" title="For the demo: behave as if the phone had no signal">
          <input type="checkbox" className="accent-slate-700" checked={box.simulated} onChange={e => setSimulatedOffline(e.target.checked)} data-testid="no-signal" />No signal
        </label>
      </div>
      {q.data.cached && online && <div className="px-4 py-1.5 text-[11px] bg-amber-50 text-amber-800">Showing the run saved on this phone ({hhmm(run.fetchedAt)}).</div>}

      <div className="flex-1 overflow-y-auto">
        {syncReport && (
          <div className="m-4 rounded-xl ring-1 ring-sky-200 bg-sky-50 p-4 text-[13px] text-sky-900">
            <div className="flex items-start justify-between gap-2"><div className="font-bold flex items-center gap-2"><CloudUpload size={16} />Back online · {syncReport.applied + syncReport.conflicts.length} records synced</div><button onClick={() => setSyncReport(null)} aria-label="Dismiss"><X size={16} /></button></div>
            {syncReport.conflicts.length > 0 && <div className="mt-1">{syncReport.conflicts.length} delivery needs the dispatcher: the stop was moved while you had no signal. Your record and proof are kept.</div>}
            {syncReport.rejected.map(r => <div key={r.clientEventId} className="mt-1 text-red-800">Not accepted: {r.message}</div>)}
          </div>
        )}

        {screen.k === 'run' && (
          <div className="pb-6">
            {trips.length > 1 && <div className="px-4 pt-4 flex gap-2">{trips.map((t, i) => <button key={t.id} onClick={() => setTripIdx(i)} className={cx('h-9 px-3 rounded-full text-[13px] font-semibold ring-1', i === idx ? 'bg-[#1D4ED8] text-white ring-[#1D4ED8]' : 'bg-white text-slate-700 ring-[#D0D5DD]')}>Trip {t.trip} · {t.depart}</button>)}</div>}
            {!started && (
              <div className="p-4 space-y-3">
                <div className="rounded-xl border border-slate-200 p-4">
                  <div className="text-[16px] font-bold text-slate-900">Trip {trip.trip} · {stops.length} stops · departs {trip.depart}</div>
                  <div className="text-[13px] text-slate-500 mt-1">{trip.vehicle.depot} DC · plan v{trip.planVersion} · back about {trip.returnAt}</div>
                  {released ? <div className="mt-3 flex items-center gap-2 px-3 py-2 rounded-lg bg-green-50 text-[13px] text-green-800"><CheckCircle2 size={15} />Loaded and released {trip.releasedAt ? `at ${hhmm(trip.releasedAt)}` : ''}</div>
                    : <div className="mt-3 flex items-center gap-2 px-3 py-2 rounded-lg bg-violet-50 text-[13px] text-violet-800"><Hourglass size={15} />Loading at the dock — {trip.lines.filter((l: any) => l.loadStatus !== 'pending').length} of {trip.lines.length} lines</div>}
                  {short.map((l: any) => <div key={l.orderId} className="mt-2 flex items-center gap-2 px-3 py-2 rounded-lg bg-orange-50 text-[13px] text-orange-800"><Package size={15} />Short from depot: {l.outletId} gets {l.loadedUnits} of {l.units}. The store knows.</div>)}
                  <div className="mt-2 flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-50 text-[13px] text-slate-700"><WifiOff size={15} />Run saved to this phone for offline use</div>
                </div>
                {!released && <div className="text-[12px] text-slate-500 flex items-start gap-2"><Lock size={13} className="mt-0.5" />Start stays locked until the loader releases the vehicle — no verbal handoffs.</div>}
                <BigButton tone="driver" disabled={!released} icon={<Truck size={18} />} onClick={() => act('trip_started', null, {}, 'Trip started')} data-testid="start-trip">Start trip</BigButton>
              </div>
            )}
            {started && (
              <>
                <div className="px-4 pt-4 pb-2 flex items-center justify-between"><span className="text-[13px] font-semibold text-slate-700">{doneCount} of {stops.length} stops done</span><span className="text-[12px] text-slate-500 tabular">{hhmm(now)}</span></div>
                <div className="px-4"><div className="h-2 rounded-full bg-slate-100 overflow-hidden"><div className="h-full bg-[#1D4ED8] rounded-full transition-all" style={{ width: `${stops.length ? doneCount / stops.length * 100 : 0}%` }} /></div></div>
                {conflicts.length > 0 && <div className="mx-4 mt-3"><Callout tone="warning" title={`Check one stop: ${conflicts.map((c: any) => c.outletId).join(', ')}`}
                  action={alreadyAnswered ? <span className="text-[12px] font-semibold">Answer sent{answered ? `: ${answered}` : ''} · waiting for the dispatcher</span> : <div className="flex flex-wrap gap-2">{['Goods handed to the store', 'Goods still on my truck'].map(a => <button key={a} onClick={async () => { setAnswered(a); for (const c of conflicts) await act('conflict_answer', c.outletId, { answer: a }, 'Answer sent to the dispatcher'); }} className="h-9 px-3 rounded-lg bg-white ring-1 ring-amber-300 text-[12px] font-semibold text-amber-900">{a}</button>)}</div>}>
                  You recorded a delivery offline for a stop the dispatcher had moved to another vehicle. Your record and proof are kept. Where are the goods now?</Callout></div>}
                {decidedConflicts.map((c: any) => <div key={c.id} className="mx-4 mt-3"><Callout tone="success" title={`${c.outletId}: dispatcher decided`}>{c.decision}</Callout></div>)}
                <ol className="p-4 space-y-2">
                  {allStops.map(s => {
                    if (s.moved) return (
                      <li key={`m${s.outletId}`} className="rounded-xl border border-dashed border-slate-300 px-4 py-3 text-[13px] text-slate-500 flex items-center gap-3"><ArrowRightLeft size={16} /><span className="flex-1"><b className="text-slate-700">{s.outletId}</b> moved to {s.moved.move?.toVehicle ?? 'another vehicle'} at {hhmm(s.moved.movedAt)} — skip it</span></li>
                    );
                    const st = stopState(s); const isCur = current?.outletId === s.outletId;
                    return (
                      <li key={s.outletId}>
                        <button onClick={() => setScreen({ k: 'stop', outletId: s.outletId })} data-testid={`stop-${s.outletId}`} className={cx('w-full text-left rounded-xl border px-4 py-3 flex items-center gap-3 min-h-[64px]', isCur ? 'border-[#1D4ED8] ring-1 ring-[#1D4ED8] bg-blue-50/40' : 'border-slate-200 bg-white')}>
                          <span className={cx('w-8 h-8 rounded-full flex items-center justify-center text-[13px] font-bold flex-shrink-0', st === 'synced' ? 'bg-emerald-600 text-white' : st === 'saved' ? 'bg-slate-500 text-white' : isCur ? 'bg-[#1D4ED8] text-white' : 'bg-slate-100 text-slate-700')}>{st === 'synced' ? <CheckCircle2 size={16} /> : st === 'saved' ? <Clock size={15} /> : s.seq}</span>
                          <span className="flex-1 min-w-0">
                            <span className="block text-[15px] font-bold text-slate-900 truncate">{s.outletId} · {s.outlet.district}</span>
                            <span className="block text-[12px] text-slate-500">{st === 'synced' ? `${OUTCOME_LABEL[s.outcome.outcome] ?? 'Done'} · ${hhmm(s.outcome.at)}` : st === 'saved' ? 'Saved on phone · waiting to sync' : `ETA ${s.start} · window ${s.outlet.mallWindow ?? `${s.outlet.open}–${s.outlet.close}`}`}</span>
                          </span>
                          {s.lines.some((l: any) => l.temp === 'chilled') && <Snowflake size={15} className="text-sky-600" />}
                          <ChevronRight size={16} className="text-slate-300" />
                        </button>
                      </li>
                    );
                  })}
                </ol>
                <div className="px-4 space-y-2">
                  {current && <BigButton tone="driver" icon={<Navigation size={18} />} onClick={() => setScreen({ k: 'stop', outletId: current.outletId })}>Next: {current.outletId}</BigButton>}
                  {!current && !closed && <BigButton tone="driver" icon={<CheckCircle2 size={18} />} onClick={() => setScreen({ k: 'summary' })} data-testid="to-summary">All stops done · close trip</BigButton>}
                  {closed && <div className="rounded-xl bg-emerald-50 text-emerald-900 px-4 py-3 text-[14px] font-semibold flex items-center gap-2"><CheckCircle2 size={18} className="text-emerald-600" />Trip closed{trips[idx + 1] ? ` · Trip ${trips[idx + 1].trip} departs ${trips[idx + 1].depart}` : ''}</div>}
                  <BigButton tone="secondary" icon={<AlertTriangle size={17} />} onClick={() => setScreen({ k: 'problem' })}>Report a problem</BigButton>
                </div>
              </>
            )}
          </div>
        )}

        {screen.k === 'stop' && (() => {
          const s = stopOf(screen.outletId); if (!s || s.moved) return null;
          const st = stopState(s);
          return (
            <div className="p-4 space-y-4">
              <div className="rounded-xl border border-slate-200 p-4 space-y-2">
                <div className="text-[17px] font-bold text-slate-900">{s.outlet.name}</div>
                <OutletBadges o={s.outlet} />
                <div className="grid grid-cols-3 gap-2 pt-1 text-[12px]">
                  <Info label="ETA" value={s.start} />
                  <Info label="Window" value={s.outlet.mallWindow ?? `${s.outlet.open}–${s.outlet.close}`} warn={s.lateRisk} />
                  <Info label="Unload" value={`${s.allowance} min`} />
                </div>
                {s.outlet.vanOnly && <div className="text-[12px] text-amber-800 bg-amber-50 rounded-lg px-3 py-2">Narrow street access — park on the main road if the lane is blocked.</div>}
                {s.outlet.mallWindow && <div className="text-[12px] text-violet-800 bg-violet-50 rounded-lg px-3 py-2">Mall delivery bay only open {s.outlet.mallWindow}.</div>}
              </div>
              <div>
                <div className="text-[12px] font-semibold uppercase tracking-[0.06em] text-slate-500 mb-2">What to hand over</div>
                <div className="space-y-2">{s.lines.map((l: any) => (
                  <div key={l.orderId} className="rounded-xl border border-slate-200 px-4 py-3 flex items-center gap-3">
                    <div className="flex-1 min-w-0"><div className="text-[14px] font-semibold text-slate-900">{l.description}</div><div className="text-[12px] text-slate-500">{l.orderId} · {l.loadedUnits != null && l.loadedUnits < l.units ? <b className="text-orange-700">{l.loadedUnits} of {l.units} units (short by plan)</b> : `${l.units} units`}</div></div>
                    <TempTag temp={l.temp} />
                  </div>
                ))}</div>
              </div>
              {st === 'synced' || st === 'saved' ? (
                <Callout tone={st === 'synced' ? 'success' : 'neutral'} title={st === 'synced' ? `${OUTCOME_LABEL[s.outcome.outcome]} · ${hhmm(s.outcome.at)}` : 'Saved on this phone'}>{st === 'synced' ? `Received by ${s.outcome.receiver ?? '—'}. The store has been asked to confirm.` : 'It will be sent automatically when you have signal.'}</Callout>
              ) : (
                <div className="space-y-2">
                  {st === 'todo' && <BigButton tone="secondary" icon={<MapPin size={18} />} onClick={() => act('arrived', s.outletId, {}, 'Arrival recorded')} data-testid="arrived">I've arrived</BigButton>}
                  <BigButton tone="driver" icon={<CheckCircle2 size={18} />} onClick={() => setScreen({ k: 'outcome', outletId: s.outletId })} data-testid="record-outcome">Record delivery</BigButton>
                  <BigButton tone="secondary" icon={<AlertTriangle size={17} />} onClick={() => setScreen({ k: 'problem', outletId: s.outletId })}>Problem at this stop</BigButton>
                </div>
              )}
            </div>
          );
        })()}

        {screen.k === 'outcome' && <OutcomeScreen onNext={(outcome, recommendation, note) => setScreen({ k: 'pod', outletId: screen.outletId, outcome, recommendation, note })} />}

        {screen.k === 'pod' && <PodScreen outcome={screen.outcome} stop={stopOf(screen.outletId)} onSave={async p => {
          await act('delivered', screen.outletId, { outcome: screen.outcome, recommendation: screen.recommendation, note: screen.note, ...p }, hasSignal() ? 'Sent · store asked to confirm receipt' : 'Saved on this phone — it will sync when you have signal');
          setScreen({ k: 'run' });
        }} />}

        {screen.k === 'problem' && <ProblemScreen onSend={async (kind, label, note) => { await act('problem', screen.outletId ?? null, { kind, label, note }, hasSignal() ? 'Sent to the dispatcher' : 'Saved — sends when you have signal'); setScreen({ k: 'run' }); }} />}

        {screen.k === 'summary' && (
          <div className="p-4 space-y-4">
            <div className="rounded-xl border border-slate-200 divide-y divide-slate-100">
              {stops.map(s => { const st = stopState(s); const o = s.outcome?.outcome ?? pendingFor('delivered', s.outletId)?.payload.outcome; return (
                <div key={s.outletId} className="px-4 py-3 flex items-center justify-between text-[14px]"><span className="font-semibold">{s.seq}. {s.outletId}</span><span className={cx('text-[13px]', o === 'full' ? 'text-emerald-700' : o ? 'text-orange-700' : 'text-slate-400')}>{o ? OUTCOME_LABEL[o] : 'Not recorded'}{st === 'saved' ? ' · on phone' : ''}</span></div>
              ); })}
            </div>
            {box.pending.length > 0 && <Callout tone="neutral" icon={<WifiOff size={15} className="text-slate-500" />} title={`${box.pending.length} records still on this phone`}>You can close the trip now; everything is sent together when you have signal.</Callout>}
            <BigButton tone="driver" icon={<CheckCircle2 size={18} />} onClick={async () => { await act('trip_closed', null, {}, 'Trip closed'); setScreen({ k: 'run' }); }} data-testid="close-trip">Close trip</BigButton>
          </div>
        )}
      </div>
      {online && box.pending.length > 0 && !box.syncing && (
        <div className="flex-shrink-0 p-3 border-t border-[#E4E7EC] bg-white safe-bottom"><BigButton tone="secondary" icon={<RefreshCw size={16} />} onClick={() => doSync(true)}>Send {box.pending.length} waiting records now</BigButton></div>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return <div className="min-h-[100dvh] bg-[#F4F6FA] flex justify-center"><div className="w-full max-w-[480px] h-[100dvh] bg-white flex flex-col shadow-[0_0_0_1px_#E6E9F0]">{children}</div></div>;
}
function Info({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return <div className={cx('rounded-lg px-2.5 py-2', warn ? 'bg-amber-50' : 'bg-slate-50')}><div className="text-slate-500">{label}</div><div className={cx('font-bold tabular', warn ? 'text-amber-800' : 'text-slate-900')}>{value}</div></div>;
}

function OutcomeScreen({ onNext }: { onNext: (o: string, rec?: string, note?: string) => void }) {
  const [o, setO] = useState<string | null>(null);
  const [rec, setRec] = useState<'return_to_depot' | 'retry_today'>('return_to_depot');
  const [note, setNote] = useState('');
  const failed = o && !['full', 'partial'].includes(o);
  return (
    <div className="p-4 space-y-3">
      <div className="space-y-2" role="radiogroup">{OUTCOMES.map(x => (
        <button key={x.id} role="radio" aria-checked={o === x.id} onClick={() => setO(x.id)} data-testid={`outcome-${x.id}`} className={cx('w-full rounded-xl ring-1 px-4 min-h-[56px] flex items-center gap-3 text-[15px] font-semibold', o === x.id ? `${x.tone} ring-2` : 'ring-slate-200 text-slate-800 bg-white')}><x.icon size={19} />{x.label}</button>
      ))}</div>
      {o === 'partial' && <textarea className={`${inputCls} h-auto py-2`} rows={2} placeholder="What was not handed over (optional)" value={note} onChange={e => setNote(e.target.value)} />}
      {failed && <div className="space-y-2">
        <div className="text-[13px] font-semibold text-slate-700">What do you suggest?</div>
        <div className="grid grid-cols-2 gap-2">{[['return_to_depot', 'Bring it back · next run'], ['retry_today', 'Try again later today']].map(([k, l]) => <button key={k} onClick={() => setRec(k as any)} className={cx('min-h-[48px] rounded-xl ring-1 text-[13px] font-semibold px-2', rec === k ? 'ring-2 ring-[#1D4ED8] text-[#1D4ED8] bg-blue-50' : 'ring-slate-200 text-slate-700')}>{l}</button>)}</div>
        <textarea className={`${inputCls} h-auto py-2`} rows={2} placeholder="Note for the dispatcher (optional)" value={note} onChange={e => setNote(e.target.value)} />
      </div>}
      <BigButton tone="driver" disabled={!o} onClick={() => o && onNext(o, failed ? rec : undefined, note || undefined)} data-testid="outcome-next">{o && failed ? 'Next: photo of the outlet' : 'Next: proof of delivery'}</BigButton>
    </div>
  );
}

async function compress(file: File): Promise<string> {
  const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file); });
  const s = Math.min(1, 800 / Math.max(img.width, img.height));
  const c = document.createElement('canvas'); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.6);
}

function PodScreen({ outcome, stop, onSave }: { outcome: string; stop: any; onSave: (p: { receiver?: string; photo?: string; signature?: string }) => Promise<void> }) {
  const [receiver, setReceiver] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);
  const [signed, setSigned] = useState(false);
  const [busy, setBusy] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const failed = !['full', 'partial'].includes(outcome);
  useEffect(() => {
    const c = canvas.current; if (!c) return;
    const ctx = c.getContext('2d')!; const r = c.getBoundingClientRect(); c.width = r.width * 2; c.height = r.height * 2; ctx.scale(2, 2);
    ctx.lineWidth = 2.2; ctx.lineCap = 'round'; ctx.strokeStyle = '#0F172A';
    let draw = false;
    const pos = (e: PointerEvent) => { const b = c.getBoundingClientRect(); return [e.clientX - b.left, e.clientY - b.top]; };
    const down = (e: PointerEvent) => { draw = true; const [x, y] = pos(e); ctx.beginPath(); ctx.moveTo(x, y); c.setPointerCapture(e.pointerId); };
    const move = (e: PointerEvent) => { if (!draw) return; const [x, y] = pos(e); ctx.lineTo(x, y); ctx.stroke(); setSigned(true); };
    const up = () => { draw = false; };
    c.addEventListener('pointerdown', down); c.addEventListener('pointermove', move); c.addEventListener('pointerup', up); c.addEventListener('pointercancel', up);
    return () => { c.removeEventListener('pointerdown', down); c.removeEventListener('pointermove', move); c.removeEventListener('pointerup', up); c.removeEventListener('pointercancel', up); };
  }, [failed]);
  const clear = () => { const c = canvas.current; if (c) { c.getContext('2d')!.clearRect(0, 0, c.width, c.height); setSigned(false); } };
  const ok = failed ? !!photo : receiver.trim().length > 1 && signed;
  return (
    <div className="p-4 space-y-4">
      <div className="text-[13px] text-slate-600">{stop?.outletId} · {OUTCOME_LABEL[outcome]}</div>
      {!failed && <label className="block"><span className="block text-[13px] font-semibold text-slate-700 mb-1.5">Received by</span>
        <input className={`${inputCls} h-12 text-[15px]`} value={receiver} onChange={e => setReceiver(e.target.value)} placeholder="Name of the person who signed" data-testid="receiver" /></label>}
      <div>
        <span className="block text-[13px] font-semibold text-slate-700 mb-1.5">{failed ? 'Photo of the outlet (required)' : 'Photo of the goods (optional)'}</span>
        {photo ? <div className="relative"><img src={photo} alt="Proof" className="w-full max-h-56 object-cover rounded-xl" /><button onClick={() => setPhoto(null)} className="absolute top-2 right-2 w-8 h-8 rounded-full bg-white/90 flex items-center justify-center" aria-label="Remove photo"><X size={16} /></button></div>
          : <label className="w-full min-h-[96px] rounded-xl border-2 border-dashed border-slate-300 flex flex-col items-center justify-center gap-1 text-slate-500 cursor-pointer hover:bg-slate-50"><Camera size={22} /><span className="text-[13px] font-semibold">Take photo</span>
              <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={async e => { const f = e.target.files?.[0]; if (f) setPhoto(await compress(f)); }} data-testid="photo" /></label>}
      </div>
      {!failed && <div>
        <div className="flex items-center justify-between mb-1.5"><span className="text-[13px] font-semibold text-slate-700 flex items-center gap-1.5"><PenLine size={14} />Signature</span>{signed && <button onClick={clear} className="text-[12px] font-semibold text-slate-500">Clear</button>}</div>
        <canvas ref={canvas} className="w-full h-40 rounded-xl ring-1 ring-slate-300 bg-slate-50 touch-none" aria-label="Signature pad" data-testid="signature" />
      </div>}
      <BigButton tone="driver" disabled={!ok || busy} icon={<CheckCircle2 size={18} />} data-testid="save-pod" onClick={async () => { setBusy(true); await onSave({ receiver: receiver.trim() || undefined, photo: photo ?? undefined, signature: signed ? canvas.current?.toDataURL('image/png') : undefined }); }}>
        {hasSignal() ? 'Save and send' : 'Save on this phone'}
      </BigButton>
      <p className="text-[12px] text-slate-500 text-center">The time on the record is the time on this phone, even if it sends later.</p>
    </div>
  );
}

function ProblemScreen({ onSend }: { onSend: (kind: string, label: string, note: string) => void }) {
  const [k, setK] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const KINDS: [string, string, any][] = [['road', 'Road closed or blocked', Flag], ['traffic', 'Heavy traffic / delay', Clock], ['vehicle', 'Vehicle problem', Truck], ['reefer_alarm', 'Reefer temperature alarm', Snowflake], ['safety', 'Safety or security', ShieldAlert], ['call', 'Call me back', Phone]];
  return (
    <div className="p-4 space-y-3">
      <div className="grid grid-cols-2 gap-2">{KINDS.map(([id, label, I]) => <button key={id} onClick={() => setK(id)} className={cx('min-h-[76px] rounded-xl ring-1 px-3 py-2 flex flex-col items-start justify-center gap-1 text-left text-[13px] font-semibold', k === id ? 'ring-2 ring-[#1D4ED8] bg-blue-50 text-[#1D4ED8]' : 'ring-slate-200 text-slate-800')}><I size={18} />{label}</button>)}</div>
      <textarea className={`${inputCls} h-auto py-2`} rows={3} placeholder="What happened (optional)" value={note} onChange={e => setNote(e.target.value)} />
      <BigButton tone="driver" disabled={!k} onClick={() => k && onSend(k, KINDS.find(x => x[0] === k)![1], note)}>Send to dispatcher</BigButton>
    </div>
  );
}
