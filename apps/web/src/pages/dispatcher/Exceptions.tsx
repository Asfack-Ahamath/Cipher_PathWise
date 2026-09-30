import { useMemo, useState, type ElementType } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AlertTriangle, WifiOff, Package, CheckCircle2, RefreshCw, Wrench, ArrowRight, Store, MapPinOff, Loader2, Scale } from 'lucide-react';
import { IconChip, Button, Callout, KeyValues, Overline, Pill, Count, Field, inputCls, Empty, cx } from '../../components/ds';
import { AuthImage, ErrorState, Loading, useAct, useApi, useReference } from '../../components/common';
import { post } from '../../lib/api';
import { hhmm, useNow } from '../../lib/clock';

const TYPE_META: Record<string, { icon: ElementType; color: string; bg: string; label: string }> = {
  dock_shortfall: { icon: Package, color: '#EA580C', bg: '#FFEDD5', label: 'Dock shortfall' },
  vehicle_fault: { icon: Wrench, color: '#DC2626', bg: '#FEE2E2', label: 'Vehicle fault' },
  non_delivery: { icon: MapPinOff, color: '#DC2626', bg: '#FEE2E2', label: 'Not delivered' },
  sync_conflict: { icon: RefreshCw, color: '#D97706', bg: '#FEF3C7', label: 'Sync conflict' },
  receipt_issue: { icon: Store, color: '#DC2626', bg: '#FEE2E2', label: 'Receipt issue' },
  road_problem: { icon: AlertTriangle, color: '#D97706', bg: '#FEF3C7', label: 'Road problem' },
  size_divergence: { icon: Scale, color: '#7C3AED', bg: '#EDE9FE', label: 'Size differs' },
};

type Opt = { decision: string; label: string; effect: string; needsVehicle?: boolean; needsNote?: boolean };
function options(e: any): Opt[] {
  const d = e.detail ?? {};
  switch (e.type) {
    case 'dock_shortfall': return [
      { decision: 'send_partial', label: `Send partial · defer ${d.missing} ${d.item} to the next run`, effect: 'The line is marked loaded with what is on board, the loader can release, the driver sees "partial by plan", and the store is told the rest comes next run.' },
      { decision: 'substitute', label: 'Substitute from depot stock', effect: 'The loader loads the nearest equivalent item; the store sees the substitution on receipt.' },
      { decision: 'hold', label: 'Hold the vehicle up to 15 min', effect: 'The loader looks for the stock. Later stops may be at risk of missing their windows.' },
    ];
    case 'vehicle_fault': return [
      { decision: 'swap', label: 'Swap to another vehicle', effect: 'The faulty vehicle goes to the workshop. The loader moves every line to the new vehicle in stop order; the new driver gets the run.', needsVehicle: true },
      { decision: 'continue', label: 'Continue — advisory only', effect: 'The trip goes ahead; the fault is logged for maintenance.' },
    ];
    case 'non_delivery': return [
      { decision: 'return_to_depot', label: 'Return to depot · deliver next run', effect: 'The goods come back; a new order is created for the next run with top priority and the store is told.' },
      { decision: 'retry_today', label: 'Retry later today', effect: 'The driver goes back after the last stop if the window allows.' },
    ];
    case 'sync_conflict': return [
      { decision: 'keep_driver', label: `Keep ${e.vehicleId}'s delivery (proof at ${d.deliveredAt})`, effect: `The proven delivery stands. ${d.toVehicle ?? 'The other vehicle'} is told to skip the stop and keep the goods.` },
      { decision: 'keep_reassignment', label: `Let ${d.toVehicle ?? 'the other vehicle'} deliver`, effect: `${e.vehicleId}'s goods are marked to return to the depot.` },
    ];
    case 'receipt_issue': return [
      { decision: 'redeliver', label: 'Replace on the next run', effect: 'A replacement order for what was short or damaged goes on the next run with priority.' },
      { decision: 'credit', label: 'Credit the store', effect: 'The store is credited; nothing is re-sent.' },
    ];
    case 'size_divergence': return [
      { decision: 'remove_line', label: `Take ${e.orderId} off the truck · deliver on the next run`, effect: 'The loader leaves it at the depot, the order moves to the next run with priority, and the store is told why.' },
      { decision: 'accept', label: d.overCapacity ? 'Load anyway (override)' : 'Accept the new size', effect: d.overCapacity ? 'The truck leaves above its rated capacity. Say why — this is recorded.' : 'The line is loaded with its real size; nothing else changes.', needsNote: !!d.overCapacity },
    ];
    default: return [{ decision: 'acknowledge', label: 'Acknowledge', effect: 'Logged. The driver sees you have read it.' }];
  }
}

function summary(e: any) {
  const d = e.detail ?? {};
  switch (e.type) {
    case 'dock_shortfall': return `${d.reason === 'damaged' ? 'Damaged' : d.reason === 'wrong_item' ? 'Wrong item' : 'Missing'}: ${d.item}. ${d.loaded} of ${d.planned} loaded for ${e.outletId} (${e.orderId}, ${d.temp}). Vehicle departs ${d.departs}.${d.note ? ` Note: ${d.note}` : ''}`;
    case 'vehicle_fault': return `${d.type} reported at the dock (${d.severity}). ${d.vehicleId} departs ${d.departs}.${d.note ? ` ${d.note}` : ''}`;
    case 'non_delivery': return `${d.reasonLabel} at ${d.at}. Driver recommends ${d.recommendation === 'retry_today' ? 'retrying later today' : 'returning the goods to the depot'}.${d.note ? ` Note: ${d.note}` : ''}`;
    case 'sync_conflict': return `${e.vehicleId} recorded a delivery at ${e.outletId} at ${d.deliveredAt} (${d.outcome}, received by ${d.receiver ?? '—'}) while out of signal. You had moved this stop to ${d.toVehicle ?? 'another vehicle'} · Trip ${d.toTrip ?? '—'} at ${d.movedAt}.${d.driverAnswer ? ` Driver says: "${d.driverAnswer}".` : ''}`;
    case 'receipt_issue': return `The store checked the delivery against the driver's proof: ${(d.lines ?? []).map((l: any) => `${l.orderId} ${l.status} (store counted ${l.received} of ${l.expected}${l.driverUnits != null ? `; driver recorded ${l.driverUnits}` : ''})`).join('; ')}.${d.note ? ` Note: ${d.note}` : ''}`;
    case 'size_divergence': return `On the dock ${e.orderId} measured ${d.actual?.kg} kg / ${d.actual?.m3} m³ (the order said ${d.planned?.kg} kg / ${d.planned?.m3} m³). ${d.overCapacity ? `${e.vehicleId} would carry ${Math.round(d.truck?.kg)} of ${d.truck?.weightCap} kg and ${Number(d.truck?.m3).toFixed(1)} of ${d.truck?.volumeCap} m³ — over its limit, so the loader cannot release until you decide.` : 'The truck still fits.'} Departs ${d.departs}.${d.note ? ` Loader: ${d.note}` : ''}`;
    case 'road_problem': return `${d.label ?? d.kind ?? 'Problem'} at ${d.at ?? hhmm(e.raisedAt)}${d.delayMin ? `, about ${d.delayMin} min` : ''}.${d.note ? ` ${d.note}` : ''}${d.delayMin >= 30 ? ' The affected stores were told; live tracking shows the new arrival times — move a stop only if it would miss its window.' : ''}`;
    default: return `${d.label ?? d.kind ?? 'Problem'} at ${d.at ?? hhmm(e.raisedAt)}.${d.note ? ` ${d.note}` : ''}`;
  }
}

export default function Exceptions() {
  const [params, setParams] = useSearchParams();
  const now = useNow();
  const q = useApi<any[]>(['exceptions'], '/exceptions', { refetchInterval: 8_000 });
  const ref = useReference();
  const [pick, setPick] = useState<string | null>(null);
  const [vehicleId, setVehicleId] = useState('');
  const [note, setNote] = useState('');
  const list = q.data ?? [];
  const selId = Number(params.get('id')) || list.find(e => e.status === 'open')?.id || list[0]?.id;
  const sel = list.find(e => e.id === selId);
  const resolve = useAct((b: any) => post(`/exceptions/${sel!.id}/resolve`, b), { invalidate: ['exceptions', 'overview', 'tracking', 'plan', 'deferrals'], success: r => `Decided: ${r.decision} · everyone affected told`, onDone: () => { setPick(null); setNote(''); setVehicleId(''); } });
  const swapCandidates = useMemo(() => (ref.data?.vehicles ?? []).filter((v: any) => v.status === 'available'), [ref.data]);
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorState error={q.error} retry={q.refetch} />;
  const open = list.filter(e => e.status === 'open');
  const done = list.filter(e => e.status !== 'open');
  const select = (id: number) => { setParams({ id: String(id) }); setPick(null); };

  return (
    <div className="flex flex-1 min-h-0 flex-col md:flex-row">
      <div className="md:w-[320px] 2xl:w-[360px] max-h-[40vh] md:max-h-none flex-shrink-0 flex flex-col min-h-0 bg-white border-b md:border-b-0 md:border-r border-[#E4E7EC]">
        <div className="flex-shrink-0 px-5 py-4 border-b border-[#E4E7EC]">
          <div className="flex items-center gap-3"><IconChip hue="rose" size={40}><AlertTriangle size={18} /></IconChip><div className="flex-1 min-w-0"><div className="flex items-center justify-between"><h1 className="text-[20px] font-semibold text-slate-900 leading-7">Exceptions</h1><Count n={open.length} tone={open.length ? 'bad' : 'good'} /></div>
            <p className="text-[13px] text-slate-500 truncate">From loaders, drivers and stores · {hhmm(now)}</p></div></div>
        </div>
        <div className="flex-1 overflow-y-auto pb-3">
          <Overline className="px-5 pt-4 pb-2">Needs a decision</Overline>
          {open.length === 0 && <div className="px-5 pb-3 text-[13px] text-slate-500 flex items-center gap-2"><CheckCircle2 size={15} className="text-emerald-600" />All clear.</div>}
          {open.map(e => <Item key={e.id} e={e} selected={sel?.id === e.id} onClick={() => select(e.id)} />)}
          {done.length > 0 && <Overline className="px-5 pt-5 pb-2">Resolved</Overline>}
          {done.map(e => <Item key={e.id} e={e} selected={sel?.id === e.id} onClick={() => select(e.id)} />)}
        </div>
      </div>

      <div className="flex-1 min-w-0 overflow-y-auto bg-[#F4F6FA]">
        {!sel ? <Empty icon={<CheckCircle2 size={28} />} title="No exceptions yet">Shortfalls from the dock, faults, failed deliveries, sync conflicts and receipt problems land here for a decision.</Empty> : (
          <div className="mx-auto max-w-[1000px] px-4 sm:px-6 py-6">
            <div className="flex flex-wrap items-center gap-2">
              {(() => { const m = TYPE_META[sel.type] ?? TYPE_META.road_problem; const I = m.icon; return <span className="inline-flex items-center gap-1.5 h-6 px-2 rounded-md text-[12px] font-semibold" style={{ color: m.color, background: m.bg }}><I size={13} />{m.label}</span>; })()}
              {sel.status === 'open' ? <Pill label="Open" color="#B91C1C" bg="#FEE2E2" /> : <Pill label="Resolved" color="#047857" bg="#D1FAE5" icon={<CheckCircle2 size={12} />} />}
              <span className="text-[12px] text-slate-500 tabular">EX-{sel.id} · {hhmm(sel.raisedAt)}</span>
            </div>
            <h2 className="text-[20px] font-semibold text-slate-900 leading-7 mt-2">{sel.title}</h2>
            <p className="text-[13px] text-slate-500 mt-0.5">{sel.raisedBy ? `${sel.raisedByRole === 'store_manager' ? 'Store manager' : sel.raisedByRole?.[0].toUpperCase() + sel.raisedByRole?.slice(1)} · ${sel.raisedBy}` : 'System'}</p>
            <div className="mt-6 space-y-5">
              <div className="bg-white rounded-xl border border-[#E6E9F0] p-5 text-[14px] leading-6 text-slate-800">{summary(sel)}</div>
              {(sel.photoUrl || sel.photoUrls?.length > 0) && <div className="flex flex-wrap gap-2">{[sel.photoUrl, ...(sel.photoUrls ?? [])].filter(Boolean).map((u: string) => <AuthImage key={u} src={u} alt="Photo from the field" className="w-40 h-28" />)}</div>}
              <KeyValues cols={3} items={[['Vehicle', sel.vehicleId ? `${sel.vehicleId}${sel.tripNo ? ` · Trip ${sel.tripNo}` : ''}` : '—'], ['Outlet', sel.outletId ?? '—'], ['Order', sel.orderId ?? '—']]} />
              {sel.status !== 'open' ? (
                <Callout tone="success" title={`Decided: ${sel.decision}`}>{sel.resolvedBy} at {hhmm(sel.resolvedAt)}{sel.decisionNote ? ` · ${sel.decisionNote}` : ''}. Loader, driver and store were told.</Callout>
              ) : (
                <section className="bg-white rounded-xl border border-[#E6E9F0] p-5">
                  <h3 className="text-[14px] font-semibold text-slate-900">Your decision</h3>
                  <p className="text-[12px] text-slate-500 mt-0.5 mb-4">Each option shows what happens next. Nothing changes until you confirm.</p>
                  <div className="space-y-2" role="radiogroup">
                    {options(sel).map(o => (
                      <button key={o.decision} role="radio" aria-checked={pick === o.decision} onClick={() => setPick(o.decision)} data-testid={`decide-${o.decision}`}
                        className={cx('w-full text-left rounded-lg border px-4 py-3 transition-colors', pick === o.decision ? 'border-teal-600 bg-teal-50/60 ring-1 ring-teal-600' : 'border-[#E4E7EC] hover:bg-slate-50')}>
                        <div className="text-[13px] font-semibold text-slate-900 flex items-center gap-2"><span className={cx('w-4 h-4 rounded-full border-2 flex-shrink-0', pick === o.decision ? 'border-teal-700 bg-teal-700 shadow-[inset_0_0_0_2px_#fff]' : 'border-slate-300')} />{o.label}</div>
                        <div className="text-[12px] text-slate-600 mt-1 ml-6">{o.effect}</div>
                      </button>
                    ))}
                  </div>
                  {options(sel).find(o => o.decision === pick)?.needsVehicle && (
                    <Field label="Replacement vehicle"><select className={`${inputCls} mt-1`} value={vehicleId} onChange={e => setVehicleId(e.target.value)}><option value="">Choose…</option>{swapCandidates.map((v: any) => <option key={v.id} value={v.id}>{v.id} · {v.temp} {v.type} · {v.depot} · {v.volumeCap} m³</option>)}</select></Field>
                  )}
                  <div className="mt-4"><Field label={options(sel).find(o => o.decision === pick)?.needsNote ? "Why (required)" : "Note (optional)"}><input className={inputCls} value={note} onChange={e => setNote(e.target.value)} placeholder="Saved to the audit log" /></Field></div>
                  <div className="mt-4 flex justify-end">
                    <Button variant="primary" icon={resolve.isPending ? <Loader2 size={15} className="animate-spin" /> : <ArrowRight size={15} />} disabled={!pick || resolve.isPending || (options(sel).find(o => o.decision === pick)?.needsVehicle && !vehicleId) || (options(sel).find(o => o.decision === pick)?.needsNote && note.trim().length < 3)} onClick={() => resolve.mutate({ decision: pick, note: note || undefined, vehicleId: vehicleId || undefined })} data-testid="decide-confirm">Confirm decision</Button>
                  </div>
                </section>
              )}
              {sel.type === 'sync_conflict' && <Callout tone="info" icon={<WifiOff size={15} className="text-sky-600" />}>Nothing the phone recorded offline is thrown away. The delivery, its time and its proof are kept; you decide which plan wins.</Callout>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Item({ e, selected, onClick }: { e: any; selected: boolean; onClick: () => void }) {
  const m = TYPE_META[e.type] ?? TYPE_META.road_problem; const I = m.icon;
  return (
    <button onClick={onClick} className={cx('w-[calc(100%-16px)] text-left mx-2 my-1 px-3 py-3 rounded-xl flex items-start gap-3 transition-colors', selected ? 'bg-teal-50 ring-1 ring-teal-200' : 'hover:bg-slate-50')}>
      <span className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: m.bg, color: m.color }}><I size={15} /></span>
      <span className="flex-1 min-w-0">
        <span className="flex items-baseline justify-between gap-2"><span className={cx('text-[13px] truncate', e.status === 'open' ? 'font-semibold text-slate-900' : 'text-slate-600')}>{e.title}</span><span className="text-[12px] tabular text-slate-400 flex-shrink-0">{hhmm(e.raisedAt)}</span></span>
        <span className="block text-[12px] text-slate-500 truncate">{e.status === 'open' ? m.label : e.decision}</span>
      </span>
    </button>
  );
}
