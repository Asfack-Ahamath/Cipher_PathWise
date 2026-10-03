import { useMemo, useState, type ReactNode } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { Home, ShoppingCart, CalendarClock, ClipboardCheck, History, Truck, CheckCircle2, Clock, WifiOff, Snowflake, Package, Minus, Plus, AlertTriangle, PartyPopper, Wallet, CloudRain, Camera, PenLine, Lock, Timer, Construction, Pencil, Ban, X, ImagePlus } from 'lucide-react';
import { FieldHeader, BigButton } from '../../components/FieldShell';
import { Callout, Segmented, Modal, Field, inputCls, Empty, Pill, cx } from '../../components/ds';
import { AuthImage, compressImage, ErrorState, Loading, Status, useAct, useApi, useToast, fmt } from '../../components/common';
import { OutletBadges, TempTag } from '../../components/tags';
import { del, patch, post } from '../../lib/api';
import { useLiveUpdates } from '../../lib/live';
import { Button } from '../../components/ds';
import { hhmm, useNow } from '../../lib/clock';

const TABS = [
  { to: '/s', label: 'Today', icon: Home, end: true },
  { to: '/s/order', label: 'Order', icon: ShoppingCart },
  { to: '/s/receipt', label: 'Receive', icon: ClipboardCheck },
  { to: '/s/deferrals', label: 'Notices', icon: CalendarClock },
  { to: '/s/history', label: 'History', icon: History },
];

export default function StoreApp() {
  useLiveUpdates();
  const { pathname } = useLocation();
  const activeIdx = Math.max(0, TABS.findIndex(t => t.end ? pathname === t.to : pathname.startsWith(t.to)));
  const q = useApi<any>(['store'], '/store/overview', { refetchInterval: 30_000 });
  const o = q.data;
  const badge: Record<string, number> = o ? { '/s/receipt': o.toConfirm.length, '/s/deferrals': o.deferrals.filter((d: any) => !d.acknowledgedAt).length } : {};
  return (
    <div className="min-h-[100dvh] bg-[#F4F6FA] flex justify-center">
      <div className="relative w-full max-w-[1100px] h-[100dvh] bg-white flex flex-col shadow-[0_0_0_1px_#E6E9F0]">
        <FieldHeader role="store" title={o?.outlet.name.replace(/ · OUT\d+$/, '') ?? 'Store'} subtitle={o ? `${o.outlet.id} · ${o.outlet.district} · ${o.dateLabel}` : '…'}>
        </FieldHeader>
        <div className="flex-1 overflow-y-auto pb-[calc(92px+env(safe-area-inset-bottom))]">
          {q.isLoading ? <Loading /> : q.error ? <ErrorState error={q.error} retry={q.refetch} /> : (
            <div key={pathname} className="anim-page"><Routes>
              <Route index element={<Today o={o} />} />
              <Route path="track" element={<Navigate to="/s" replace />} />
              <Route path="order" element={<Order o={o} />} />
              <Route path="receipt" element={<Receive o={o} />} />
              <Route path="deferrals" element={<Notices o={o} />} />
              <Route path="history" element={<HistoryView />} />
              <Route path="*" element={<Navigate to="/s" replace />} />
            </Routes></div>
          )}
        </div>
        <GlassTabs activeIdx={activeIdx} badge={badge} />
      </div>
    </div>
  );
}

/* Liquid-glass tab bar: a floating pill pinned to the bottom on every screen size (centred and capped in width on tablets).
   One glass capsule slides behind the active tab. */
function GlassTabs({ activeIdx, badge }: { activeIdx: number; badge: Record<string, number> }) {
  return (
    <nav
      className="absolute inset-x-3 sm:inset-x-auto sm:left-1/2 sm:-translate-x-1/2 sm:w-[560px] z-30 grid grid-cols-5 gap-0.5 p-1.5 rounded-[32px] glass"
      style={{ bottom: 'max(12px, env(safe-area-inset-bottom))' }} aria-label="Store">
      <span aria-hidden="true" className="absolute top-1.5 bottom-1.5 left-1.5 rounded-[26px] bg-white/75 shadow-[inset_0_0_0_1px_rgba(255,255,255,.9),0_2px_10px_rgba(15,23,42,.12)] transition-transform duration-[420ms] ease-[cubic-bezier(.3,1.25,.4,1)]" style={{ width: 'calc((100% - 12px - 8px) / 5)', transform: `translateX(calc(${activeIdx} * (100% + 2px)))` }} />
      {TABS.map(t => (
        <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => cx('relative z-10 flex flex-col items-center justify-center gap-[2px] py-1.5 rounded-[26px] text-[10px] sm:text-[11px] font-semibold select-none transition-[color,transform] duration-300 active:scale-90', isActive ? 'text-[#C2410C]' : 'text-slate-600 hover:text-slate-900')}>
          {({ isActive }) => (
            <>
              <t.icon size={23} strokeWidth={isActive ? 2.3 : 1.8} />
              {t.label}
              {badge[t.to] ? <span className="absolute top-0.5 left-1/2 ml-2 min-w-[18px] h-[18px] px-1 rounded-full bg-[#FF3B30] text-white text-[11px] font-semibold leading-none flex items-center justify-center ring-2 ring-white/80">{badge[t.to]}</span> : null}
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}

function Section({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return <section className="space-y-2"><div className="flex items-center justify-between"><h2 className="text-[12px] font-semibold uppercase tracking-[0.06em] text-slate-500">{title}</h2>{action}</div>{children}</section>;
}

function Today({ o }: { o: any }) {
  const nav = useNavigate();
  const now = useNow();
  const [edit, setEdit] = useState<any | null>(null);
  const [cancel, setCancel] = useState<any | null>(null);
  const pendingNotices = o.deferrals.filter((x: any) => !x.acknowledgedAt);
  const firstDelivered = o.deliveries.find((d: any) => d.delivered);
  const overdue = o.toConfirm.filter((x: any) => x.overdue).length;
  return (
    <div className="p-4 sm:p-6 space-y-5">
      {o.toConfirm.length > 0 && <Callout tone={overdue ? 'warning' : 'success'} title={overdue ? `${overdue} delivery${overdue > 1 ? ' is' : ' is'} waiting over ${o.receiptConfirmHours} h for your check` : `Delivered ${firstDelivered?.delivered?.at ?? ''} — please check what arrived`} action={<BigButton tone="store" className="!min-h-[44px] !text-[14px]" onClick={() => nav('/s/receipt')}>Confirm receipt</BigButton>}>Compare each line with the driver's proof. Report anything short, damaged or warm.</Callout>}
      {pendingNotices.length > 0 && <Callout tone="warning" title={`${pendingNotices.length} delivery change${pendingNotices.length > 1 ? 's' : ''} to read`} action={<button onClick={() => nav('/s/deferrals')} className="text-[13px] font-semibold underline">Read now</button>}>{pendingNotices[0].storeText}</Callout>}
      {o.deliveries.length === 0 && (
        <div className="rounded-2xl border border-[#E6E9F0] p-5" style={{ background: 'linear-gradient(135deg,#FFF7ED,#FFFBEB)' }}>
          <div className="text-[12px] font-semibold uppercase tracking-[0.06em] text-orange-800/80">Today's delivery · {o.dateLabel}</div>
          <div className="mt-2 text-[15px] text-slate-700">{o.orders.length ? 'Your order is confirmed. Arrival time appears when the plan is published.' : 'Nothing planned for today.'}</div>
        </div>
      )}
      {o.deliveries.map((d: any) => <DeliveryCard key={d.tripId} d={d} o={o} multi={o.deliveries.length > 1} />)}
      <Section title="Orders for today">
        {o.orders.length === 0 && <div className="text-[13px] text-slate-500">No orders for {o.dateLabel}.</div>}
        {o.orders.map((x: any) => (
          <div key={x.id} className="rounded-xl border border-slate-200 px-4 py-3 flex items-center gap-3">
            <div className="flex-1 min-w-0"><div className="text-[14px] font-semibold text-slate-900 flex items-center gap-2">{x.description}<TempTag temp={x.temp} /></div><div className="text-[12px] text-slate-500">{x.id} · {x.units} units · {fmt(x.kg)} kg{x.deferredYesterday ? ' · carried over, goes first' : ''}</div></div>
            <Status s={x.receipts ? (x.status === 'disputed' ? 'disputed' : 'received') : x.status} size="sm" />
          </div>
        ))}
      </Section>
      {o.upcoming.length > 0 && <Section title="Coming up">
        {o.upcoming.map((x: any) => (
          <div key={x.id} className="rounded-xl border border-slate-200 px-4 py-3 flex flex-wrap items-center gap-3">
            <div className="flex-1 min-w-[180px]"><div className="text-[14px] font-semibold text-slate-900 flex items-center gap-2">{x.dateLabel} · {x.description}<TempTag temp={x.temp} /></div><div className="text-[12px] text-slate-500">{x.id} · {x.units} units{x.afterCutoff ? ' · came after the cutoff' : ''}</div></div>
            {x.editable ? <div className="flex gap-2"><Button size="sm" icon={<Pencil size={13} />} onClick={() => setEdit(x)}>Change</Button><Button size="sm" variant="danger" icon={<Ban size={13} />} onClick={() => setCancel(x)}>Cancel</Button></div>
              : <span className="text-[12px] text-slate-500 inline-flex items-center gap-1"><Lock size={12} />Closed — call the dispatcher</span>}
          </div>
        ))}
      </Section>}
      <Section title="Next order" action={<button onClick={() => nav('/s/order')} className="text-[13px] font-semibold text-[#C2410C]">Place order</button>}>
        <OrderWindowCard w={o.window} now={now} />
      </Section>
      <div className="text-[12px] text-slate-500"><OutletBadges o={o.outlet} /> <span className="ml-1">Receiving hours {o.outlet.open}–{o.outlet.close}{o.outlet.mallWindow ? ` · mall bay ${o.outlet.mallWindow}` : ''}</span></div>
      {edit && <EditOrder order={edit} cats={o.categories?.[edit.temp] ?? []} onClose={() => setEdit(null)} />}
      {cancel && <CancelOrder order={cancel} onClose={() => setCancel(null)} />}
    </div>
  );
}

const mins = (t?: string | null) => { if (!t) return null; const [h, m] = t.split(':').map(Number); return h * 60 + m; };
function DeliveryCard({ d, o, multi }: { d: any; o: any; multi: boolean }) {
  // "late" only means something against when unloading could start: arriving early just means waiting for the window
  const open = mins((d.mallWindow ?? d.window).split('–')[0]);
  const planStart = Math.max(mins(d.plannedEta) ?? 0, open ?? 0), expStart = Math.max(mins(d.eta) ?? 0, open ?? 0);
  const behind = expStart - planStart;
  const early = (mins(d.eta) ?? 0) < (open ?? 0);
  const mine = o.orders.filter((x: any) => d.orderIds.includes(x.id));
  const steps = [
    ['Planned', true], ['Loaded', ['released', 'in_progress', 'completed'].includes(d.tripStatus)], ['On road', ['in_progress', 'completed'].includes(d.tripStatus)], ['Delivered', !!d.delivered], ['Confirmed', mine.length > 0 && mine.every((x: any) => x.receipts > 0)],
  ] as [string, boolean][];
  return (
    <div className="rounded-2xl border border-[#E6E9F0] overflow-hidden">
      <div className="p-5" style={{ background: 'linear-gradient(135deg,#FFF7ED,#FFFBEB)' }}>
        <div className="text-[12px] font-semibold uppercase tracking-[0.06em] text-orange-800/80">{multi ? `${d.temps.map((t: string) => t[0].toUpperCase() + t.slice(1)).join(' + ')} delivery` : "Today's delivery"} · {o.dateLabel}</div>
        {d.delivered ? (
          <div className="mt-2"><div className="text-[28px] font-bold text-slate-900 tabular flex items-center gap-2"><CheckCircle2 size={26} className="text-emerald-600" />Delivered {d.delivered.at}</div><div className="text-[13px] text-slate-600 mt-1">{d.delivered.outcome === 'partial' ? 'Partial delivery · ' : ['refused', 'no_access', 'closed'].includes(d.delivered.outcome) ? 'Not delivered · ' : ''}Received by {d.delivered.receiver ?? '—'} · {d.vehicleId}</div></div>
        ) : (
          <div className="mt-2">
            <div className="flex items-baseline gap-3 flex-wrap"><span className={cx('text-[40px] font-bold tabular leading-none', d.late ? 'text-red-700' : 'text-slate-900')} data-testid="eta">{d.estimate ? '~' : ''}{d.eta}</span><span className="text-[14px] text-slate-600">{d.estimate ? 'estimated' : 'expected arrival'}{behind > 0 ? ` · about ${behind} min later than planned` : ' · on time'}{early ? ` · unloading from ${(d.mallWindow ?? d.window).split('–')[0]}` : ''}</span></div>
            <div className="text-[13px] text-slate-600 mt-2">Your window {d.mallWindow ?? d.window} · stop {d.stop} of {d.stops} · {d.vehicleId} · {d.driverName}</div>
            {d.hold && <div className="mt-3 flex items-start gap-2 text-[13px] text-amber-900 bg-amber-100/60 rounded-lg px-3 py-2"><Construction size={15} className="text-amber-700 mt-0.5 flex-shrink-0" />The driver reported “{d.hold.label}” at {d.hold.at} (about {d.hold.minutes} min). The time above includes it.{d.late ? ' It may arrive after your window — the dispatcher is deciding whether another vehicle should bring it.' : ''}</div>}
            {d.estimate && <div className="mt-3 flex items-start gap-2 text-[13px] text-slate-700 bg-white/70 rounded-lg px-3 py-2"><WifiOff size={15} className="text-slate-500 mt-0.5 flex-shrink-0" />The driver is in an area with no signal (last update {d.lastUpdate ? hhmm(d.lastUpdate) : '—'}). This time is estimated from the plan and the last stop they reported. Deliveries continue as normal.</div>}
          </div>
        )}
      </div>
      <ol className="grid grid-cols-5 gap-1.5 px-5 py-4 bg-white">{steps.map(([l, on]) => (
        <li key={l} className="min-w-0"><span className={cx('block h-1.5 rounded-full', on ? 'bg-[#C2410C]' : 'bg-[#E4E7EC]')} /><span className={cx('mt-1.5 block text-[11px] font-semibold truncate', on ? 'text-slate-800' : 'text-slate-400')}>{l}</span></li>
      ))}</ol>
    </div>
  );
}

function EditOrder({ order, cats, onClose }: { order: any; cats: any[]; onClose: () => void }) {
  const [units, setUnits] = useState<Record<string, number>>(() => Object.fromEntries((order.lines ?? []).map((l: any) => [l.category, l.units])));
  const lines = cats.map(c => ({ category: c.k, units: units[c.k] ?? 0 })).filter(l => l.units > 0);
  const save = useAct(() => patch(`/store/orders/${order.id}`, { lines }), { invalidate: ['store', 'store-history'], success: `${order.id} updated`, onDone: onClose });
  return (
    <Modal title={`Change ${order.id} · ${order.dateLabel}`} onClose={onClose} width={480}>
      <div className="space-y-2">
        {cats.map(c => (
          <div key={c.k} className="flex items-center justify-between gap-3">
            <span className="text-[14px] text-slate-700">{c.k}</span>
            <input type="number" min={0} max={500} inputMode="numeric" className={`${inputCls} w-24 text-right`} value={units[c.k] ?? ''} placeholder="0" onChange={e => setUnits({ ...units, [c.k]: Math.max(0, Math.min(500, Number(e.target.value) || 0)) })} aria-label={`${c.k} units`} />
          </div>
        ))}
      </div>
      <p className="mt-3 text-[12px] text-slate-500">You can change it until the cutoff the day before delivery.</p>
      <div className="mt-5 flex gap-2"><BigButton tone="secondary" onClick={onClose}>Cancel</BigButton><BigButton tone="store" disabled={!lines.length || save.isPending} loading={save.isPending} onClick={() => save.mutate()}>Save changes</BigButton></div>
    </Modal>
  );
}

function CancelOrder({ order, onClose }: { order: any; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const go = useAct(() => del(`/store/orders/${order.id}`, { reason: reason.trim() }), { invalidate: ['store', 'store-history'], success: `${order.id} cancelled`, onDone: onClose });
  return (
    <Modal title={`Cancel ${order.id}?`} onClose={onClose} width={440}>
      <p className="text-[13px] text-slate-600 mb-3">{order.dateLabel} · {order.temp} · {order.units} units. The dispatcher is told.</p>
      <Field label="Why are you cancelling?"><input className={inputCls} value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Ordered twice by mistake" /></Field>
      <div className="mt-5 flex gap-2"><BigButton tone="secondary" onClick={onClose}>Keep it</BigButton><BigButton tone="danger" disabled={reason.trim().length < 3 || go.isPending} loading={go.isPending} onClick={() => go.mutate()}>Cancel order</BigButton></div>
    </Modal>
  );
}

function OrderWindowCard({ w, now }: { w: any; now: Date }) {
  const left = Math.max(0, Math.round((new Date(w.cutoffAt).getTime() - now.getTime()) / 60000));
  return (
    <div className="rounded-xl border border-slate-200 px-4 py-3">
      <div className="flex items-center justify-between gap-2"><span className="text-[14px] font-semibold text-slate-900">Delivers {w.deliveryLabel}</span><span className={cx('text-[12px] font-semibold tabular inline-flex items-center gap-1', left < 120 ? 'text-amber-700' : 'text-slate-600')}><Timer size={13} />{left > 0 ? `order by ${hhmm(w.cutoffAt)} ${new Date(w.cutoffAt).toDateString() !== now.toDateString() ? `(${Math.floor(left / 60)} h ${left % 60} min)` : `· ${Math.floor(left / 60)} h ${left % 60} min left`}` : 'cutoff passed'}</span></div>
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-slate-500">
        {w.skipped.map((s: any) => <span key={s.date} className="inline-flex items-center gap-1"><PartyPopper size={12} className="text-violet-600" />{s.holiday} — no delivery</span>)}
        {w.calendar?.isPayday && <span className="inline-flex items-center gap-1"><Wallet size={12} className="text-amber-600" />Payday — order a little more</span>}
        {w.calendar?.monsoon && <span className="inline-flex items-center gap-1"><CloudRain size={12} className="text-sky-600" />Monsoon — deliveries may run later</span>}
      </div>
    </div>
  );
}

function Order({ o }: { o: any }) {
  const now = useNow();
  const cats = o.categories;
  const [temp, setTemp] = useState<'ambient' | 'chilled'>(cats.chilled ? 'chilled' : 'ambient');
  const [units, setUnits] = useState<Record<string, number>>({});
  const [done, setDone] = useState<any>(null);
  const list: any[] = cats[temp] ?? [];
  const total = list.reduce((a, c) => a + (units[c.k] ?? 0), 0);
  const kg = list.reduce((a, c) => a + (units[c.k] ?? 0) * c.kg, 0);
  const m3 = list.reduce((a, c) => a + (units[c.k] ?? 0) * c.m3, 0);
  const place = useAct(() => post('/store/orders', { temp, lines: list.map(c => ({ category: c.k, units: units[c.k] ?? 0 })).filter(l => l.units > 0) }), { invalidate: ['store', 'store-history'], onDone: r => { setDone(r); setUnits({}); } });
  const set = (k: string, v: number) => setUnits(u => ({ ...u, [k]: Math.max(0, Math.min(500, v)) }));
  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-[640px]">
      <OrderWindowCard w={o.window} now={now} />
      {done && <Callout tone="success" title={`Order ${done.id} confirmed for ${done.deliveryLabel}`}>{done.units} units · about {fmt(done.kg)} kg · {done.m3} m³.{done.afterCutoff ? ` It came after the ${o.window.cutoffTime} cutoff, so it goes on the following run.` : ''}</Callout>}
      {cats.chilled && <Segmented value={temp} onChange={v => { setTemp(v); setUnits({}); }} options={[{ id: 'chilled', label: 'Chilled' }, { id: 'ambient', label: 'Ambient' }]} />}
      <div className="space-y-2">
        {list.map(c => (
          <div key={c.k} className="rounded-xl border border-slate-200 px-4 py-3 flex items-center gap-3">
            <div className="flex-1 min-w-0"><div className="text-[15px] font-semibold text-slate-900">{c.k}</div><div className="text-[12px] text-slate-500">about {c.kg} kg · {c.m3} m³ per unit</div></div>
            <button onClick={() => set(c.k, (units[c.k] ?? 0) - 1)} className="w-11 h-11 rounded-xl ring-1 ring-[#D0D5DD] flex items-center justify-center" aria-label={`Fewer ${c.k}`}><Minus size={16} /></button>
            <input type="number" inputMode="numeric" value={units[c.k] ?? 0} onChange={e => set(c.k, Number(e.target.value) || 0)} className="w-14 h-11 text-center text-[16px] font-bold tabular rounded-xl ring-1 ring-[#D0D5DD] outline-none focus:ring-2 focus:ring-orange-500" aria-label={`${c.k} units`} />
            <button onClick={() => set(c.k, (units[c.k] ?? 0) + 1)} className="w-11 h-11 rounded-xl ring-1 ring-[#D0D5DD] flex items-center justify-center" aria-label={`More ${c.k}`}><Plus size={16} /></button>
          </div>
        ))}
      </div>
      <div className="rounded-xl bg-slate-50 px-4 py-3 text-[13px] text-slate-700 flex justify-between tabular"><span>{total} units</span><span>≈ {fmt(kg)} kg · {fmt(m3, 1)} m³</span></div>
      <BigButton tone="store" disabled={!total || place.isPending} loading={place.isPending} icon={<ShoppingCart size={18} />} onClick={() => place.mutate()} data-testid="place-order">Place order for {o.window.deliveryLabel}</BigButton>
      <p className="text-[12px] text-slate-500">Orders placed after {o.window.cutoffTime} go on the following delivery day. One chilled and one ambient order per day — change an existing order from Today. You'll get a message if anything changes.</p>
    </div>
  );
}

function Notices({ o }: { o: any }) {
  const ack = useAct((id: number) => post(`/store/deferrals/${id}/ack`), { invalidate: ['store'], success: 'Thanks — noted' });
  return (
    <div className="p-4 sm:p-6 space-y-3 max-w-[720px]">
      {o.deferrals.length === 0 && <Empty icon={<CalendarClock size={28} />} title="No changes to your deliveries">If an order has to move to another day, you'll see why here.</Empty>}
      {o.deferrals.map((x: any) => (
        <div key={x.id} className={cx('rounded-xl border p-4', x.acknowledgedAt ? 'border-slate-200' : 'border-amber-300 bg-amber-50/40')}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[15px] font-bold text-slate-900">{x.units ? `${x.units} units of your ${x.temp} order` : `Your ${x.temp} order ${x.orderId}`} move{x.units ? '' : 's'} to {x.toLabel}</div>
              <div className="text-[13px] text-slate-700 mt-1">{x.storeText}</div>
              <div className="text-[12px] text-slate-500 mt-1">It stays confirmed — no need to re-order. It goes first on the next run.{x.escalated ? ' This order was moved before, so it has been escalated.' : ''}</div>
            </div>
            <TempTag temp={x.temp} />
          </div>
          <div className="mt-3 flex items-center justify-between gap-2">
            <span className="text-[12px] text-slate-500">{x.reasonLabel} · {x.reason === 'dock_shortfall' ? 'found by the loader before the truck left' : x.units ? 'the rest of your order came today' : x.kind === 'forced' ? 'no vehicle could take it' : 'capacity went to stores waiting longer'}</span>
            {x.acknowledgedAt ? <span className="text-[12px] font-semibold text-emerald-700 inline-flex items-center gap-1"><CheckCircle2 size={13} />Read {hhmm(x.acknowledgedAt)}</span> : <button disabled={ack.isPending} onClick={() => ack.mutate(x.id)} className="h-10 px-4 rounded-lg bg-[#C2410C] text-white text-[13px] font-bold whitespace-nowrap flex-shrink-0" data-testid={`ack-${x.id}`}>Got it</button>}
          </div>
        </div>
      ))}
    </div>
  );
}

type Line = { orderId: string; status: 'ok' | 'short' | 'damaged' | 'temperature'; received: number; expected: number };
function Receive({ o }: { o: any }) {
  const toast = useToast();
  const list: any[] = o.toConfirm;
  const [lines, setLines] = useState<Record<string, Line>>({});
  const [note, setNote] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [pod, setPod] = useState<string | null>(null);
  const [done, setDone] = useState<any>(null);
  // start from the driver's count: if they handed over fewer, the line starts as "short"
  const get = (x: any): Line => lines[x.id] ?? (x.driverUnits != null && x.driverUnits < x.units ? { orderId: x.id, status: 'short', received: x.driverUnits, expected: x.units } : { orderId: x.id, status: 'ok', received: x.units, expected: x.units });
  const upd = (x: any, p: Partial<Line>) => setLines(l => ({ ...l, [x.id]: { ...get(x), ...p } }));
  const send = useAct(() => post('/store/receipts', { orderId: list[0].id, lines: list.map(get), note: note || undefined, photos: photos.length ? photos : undefined }), { invalidate: ['store', 'store-history'], onDone: r => setDone(r) });
  const needsProof = list.map(get).some(l => l.status === 'damaged') && !note.trim() && photos.length === 0;
  if (done) return <div className="p-6 max-w-[640px]"><Callout tone={done.issues ? 'warning' : 'success'} title={done.issues ? 'Receipt sent with an issue' : 'Receipt confirmed'}>{done.issues ? 'The dispatcher has been told and will decide on a replacement or credit. You will get a message.' : 'Thank you. Everything matched the driver’s proof.'}</Callout></div>;
  if (!list.length) return <div className="p-6"><Empty icon={<ClipboardCheck size={28} />} title="Nothing to confirm">When the driver delivers, the lines to check appear here.</Empty></div>;
  const issues = list.map(get).filter(l => l.status !== 'ok').length;
  const d = o.deliveries.find((x: any) => x.delivered && x.orderIds.some((id: string) => list.some(l => l.id === id)));
  return (
    <div className="p-4 sm:p-6 space-y-4 max-w-[720px]">
      <Callout tone={list.some(x => x.overdue) ? 'warning' : 'info'} title={`Delivered ${d?.delivered?.at ?? ''} by ${d?.vehicleId ?? ''}`}>{list.some(x => x.overdue) ? `Please confirm — it has been more than ${o.receiptConfirmHours} hours. ` : ''}Check each line. If something is short, damaged or not cold enough, mark it — the dispatcher sees it straight away.</Callout>
      {list.map(x => { const l = get(x); return (
        <div key={x.id} className="rounded-xl border border-slate-200 p-4 space-y-3" data-testid={`receipt-${x.id}`}>
          <div className="flex items-center justify-between gap-2"><div className="min-w-0"><div className="text-[15px] font-bold text-slate-900">{x.description}</div><div className="text-[12px] text-slate-500">{x.id} · {x.units} units ordered{x.driverUnits != null ? ` · driver recorded ${x.driverUnits} handed over` : ''}{x.overdue ? ' · overdue' : ''}</div></div><TempTag temp={x.temp} /></div>
          <div className="grid grid-cols-4 gap-1.5">{(['ok', 'short', 'damaged', 'temperature'] as const).filter(s => s !== 'temperature' || x.temp === 'chilled').map(s => (
            <button key={s} onClick={() => upd(x, { status: s, received: s === 'ok' ? x.units : Math.min(l.received, Math.max(0, x.units - 1)) })} className={cx('min-h-[44px] rounded-lg text-[12px] font-semibold ring-1', l.status === s ? (s === 'ok' ? 'bg-emerald-600 text-white ring-emerald-600' : 'bg-orange-600 text-white ring-orange-600') : 'ring-slate-200 text-slate-700')}>{s === 'ok' ? 'All OK' : s === 'temperature' ? 'Too warm' : s[0].toUpperCase() + s.slice(1)}</button>
          ))}</div>
          {l.status !== 'ok' && <div className="flex items-center gap-3"><span className="text-[13px] text-slate-600 flex-1">Units received in good condition</span>
            <button onClick={() => upd(x, { received: Math.max(0, l.received - 1) })} className="w-10 h-10 rounded-lg ring-1 ring-[#D0D5DD] flex items-center justify-center" aria-label="Fewer"><Minus size={15} /></button>
            <span className="w-10 text-center text-[16px] font-bold tabular">{l.received}</span>
            <button onClick={() => upd(x, { received: Math.min(x.units, l.received + 1) })} className="w-10 h-10 rounded-lg ring-1 ring-[#D0D5DD] flex items-center justify-center" aria-label="More"><Plus size={15} /></button>
            <span className="text-[12px] text-slate-500">of {x.units}</span></div>}
          {x.driverUnits != null && l.status !== 'ok' && l.received !== x.driverUnits && <div className="text-[12px] text-amber-800 bg-amber-50 rounded-lg px-3 py-2">Your count ({l.received}) differs from the driver's ({x.driverUnits}). Both are kept; the dispatcher sees both.</div>}
          <button onClick={() => setPod(x.id)} className="text-[12px] font-semibold text-slate-600 inline-flex items-center gap-1"><Camera size={13} />See the driver's proof</button>
        </div>
      ); })}
      <div>
        <div className="text-[12px] font-semibold text-slate-700 mb-1.5">Photos (up to 3){list.map(get).some(l => l.status === 'damaged') ? ' — a photo or a note is needed for damaged goods' : ''}</div>
        <div className="flex flex-wrap gap-2">
          {photos.map((p, i) => <div key={i} className="relative"><img src={p} alt={`Receipt photo ${i + 1}`} className="w-24 h-24 object-cover rounded-lg" /><button onClick={() => setPhotos(photos.filter((_, j) => j !== i))} className="absolute top-1 right-1 w-6 h-6 rounded-full bg-white/90 flex items-center justify-center" aria-label="Remove photo"><X size={13} /></button></div>)}
          {photos.length < 3 && <label className="w-24 h-24 rounded-lg border-2 border-dashed border-slate-300 flex flex-col items-center justify-center gap-1 text-slate-500 cursor-pointer hover:bg-slate-50 text-[11px] font-semibold"><ImagePlus size={18} />Add photo
            <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={async e => { const f = e.target.files?.[0]; e.target.value = ''; if (!f) return; try { const p = await compressImage(f); setPhotos(ps => [...ps, p].slice(0, 3)); } catch (err: any) { toast('error', err.message); } }} /></label>}
        </div>
      </div>
      <Field label="Note (optional)"><textarea className={`${inputCls} h-auto py-2`} rows={2} value={note} onChange={e => setNote(e.target.value)} /></Field>
      <BigButton tone="store" disabled={send.isPending || needsProof} loading={send.isPending} icon={<ClipboardCheck size={18} />} onClick={() => send.mutate()} data-testid="confirm-receipt">{issues ? `Send receipt with ${issues} issue${issues > 1 ? 's' : ''}` : 'Confirm everything arrived'}</BigButton>
      {pod && <PodView orderId={pod} onClose={() => setPod(null)} />}
    </div>
  );
}

function PodView({ orderId, onClose }: { orderId: string; onClose: () => void }) {
  const q = useApi<any>(['pod', orderId], `/store/pod/${orderId}`);
  return (
    <Modal title="Driver's proof of delivery" onClose={onClose} width={440}>
      {q.isLoading ? <Loading /> : !q.data?.at ? <p className="text-[13px] text-slate-500">No proof recorded yet.</p> : (
        <div className="space-y-3 text-[13px]">
          <div>Received by <b>{q.data.receiver ?? '—'}</b> at {hhmm(q.data.at)} (phone time)</div>
          {q.data.deliveredUnits && Object.keys(q.data.deliveredUnits).length > 0 && <div className="text-[12px] text-slate-600">Driver's count: {Object.entries(q.data.deliveredUnits).map(([k, v]) => `${k} ${v}`).join(' · ')}</div>}
          {q.data.photoUrl && <AuthImage src={q.data.photoUrl} alt="Delivery photo" className="w-full max-h-72" />}
          {q.data.signatureUrl && <div><div className="text-[12px] font-semibold text-slate-500 mb-1 flex items-center gap-1"><PenLine size={12} />Signature</div><AuthImage src={q.data.signatureUrl} alt="Signature" className="w-full h-32 !object-contain ring-1 ring-slate-200 bg-slate-50" /></div>}
        </div>
      )}
    </Modal>
  );
}

function HistoryView() {
  const [temp, setTemp] = useState<'all' | 'ambient' | 'chilled'>('all');
  const [status, setStatus] = useState<'all' | 'delivered' | 'deferred' | 'issue' | 'cancelled'>('all');
  const [days, setDays] = useState('30');
  const qs = useMemo(() => new URLSearchParams(Object.entries({ temp: temp === 'all' ? '' : temp, status: status === 'all' ? '' : status, days }).filter(([, v]) => v)).toString(), [temp, status, days]);
  const q = useApi<any>(['store-history', qs], `/store/history?${qs}`);
  const h = q.data;
  return (
    <div className="p-4 sm:p-6 space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented size="sm" value={status} onChange={setStatus} options={[{ id: 'all', label: 'All' }, { id: 'delivered', label: 'Delivered' }, { id: 'deferred', label: 'Moved' }, { id: 'issue', label: 'Issues' }, { id: 'cancelled', label: 'Cancelled' }]} />
        <Segmented size="sm" value={temp} onChange={setTemp} options={[{ id: 'all', label: 'All' }, { id: 'chilled', label: 'Chilled' }, { id: 'ambient', label: 'Ambient' }]} />
        <select className={`${inputCls} !w-auto`} value={days} onChange={e => setDays(e.target.value)} aria-label="Period"><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option><option value="365">Last year</option></select>
      </div>
      {q.isLoading ? <Loading /> : q.error ? <ErrorState error={q.error} retry={q.refetch} /> : <>
        <div className="grid grid-cols-4 gap-2">{[['Orders', h.stats.orders], ['Delivered', h.stats.delivered], ['Moved', h.stats.deferred], ['Issues', h.stats.issues]].map(([l, n]) => <div key={l} className="rounded-xl bg-slate-50 px-3 py-2.5"><div className="text-[11px] text-slate-500">{l}</div><div className="text-[20px] font-bold tabular">{n}</div></div>)}</div>
        <div className="rounded-xl border border-slate-200 divide-y divide-slate-100">
          {h.orders.length === 0 && <div className="p-6 text-center text-[13px] text-slate-500">No orders match these filters.</div>}
          {h.orders.map((x: any) => (
            <div key={x.id} className="px-4 py-3 flex items-center gap-3">
              <div className="w-16 text-[12px] text-slate-500 tabular flex-shrink-0">{x.dateLabel}</div>
              <div className="flex-1 min-w-0"><div className="text-[13px] font-semibold text-slate-900 truncate">{x.description}</div><div className="text-[12px] text-slate-500">{x.id} · {x.units} units{x.deferrals ? ` · moved to ${x.deferrals.map((d: any) => d.toDate.slice(5)).join(', ')}` : ''}{x.cancelReason ? ` · cancelled: ${x.cancelReason}` : ''}</div></div>
              <TempTag temp={x.temp} />
              <Status s={x.receipt?.status === 'ok' ? 'received' : x.receipt?.status === 'issue' ? 'disputed' : x.status} size="sm" />
            </div>
          ))}
        </div>
      </>}
    </div>
  );
}
