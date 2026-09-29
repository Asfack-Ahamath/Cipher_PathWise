import { useState, type ReactNode } from 'react';
import { NavLink, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { Home, ShoppingCart, CalendarClock, ClipboardCheck, History, Truck, CheckCircle2, Clock, WifiOff, Snowflake, Package, Minus, Plus, AlertTriangle, PartyPopper, Wallet, CloudRain, Camera, PenLine, Lock, Timer } from 'lucide-react';
import { FieldHeader, BigButton } from '../../components/FieldShell';
import { Callout, Segmented, Modal, Field, inputCls, Empty, Pill, cx } from '../../components/ds';
import { ErrorState, Loading, Status, useAct, useApi, fmt } from '../../components/common';
import { OutletBadges, TempTag } from '../../components/tags';
import { api, post } from '../../lib/api';
import { hhmm, useNow } from '../../lib/clock';

const TABS = [
  { to: '/s', label: 'Today', icon: Home, end: true },
  { to: '/s/order', label: 'Order', icon: ShoppingCart },
  { to: '/s/receipt', label: 'Receive', icon: ClipboardCheck },
  { to: '/s/deferrals', label: 'Notices', icon: CalendarClock },
  { to: '/s/history', label: 'History', icon: History },
];

export default function StoreApp() {
  const q = useApi<any>(['store'], '/store/overview', { refetchInterval: 15_000 });
  const o = q.data;
  const badge: Record<string, number> = o ? { '/s/receipt': o.toConfirm.length, '/s/deferrals': o.deferrals.filter((d: any) => !d.acknowledgedAt).length } : {};
  return (
    <div className="min-h-[100dvh] bg-[#F4F6FA] flex justify-center">
      <div className="w-full max-w-[960px] h-[100dvh] bg-white flex flex-col shadow-[0_0_0_1px_#E6E9F0]">
        <FieldHeader role="store" title={o?.outlet.name.replace(/ · OUT\d+$/, '') ?? 'Store'} subtitle={o ? `${o.outlet.id} · ${o.outlet.district} · ${o.dateLabel}` : '…'}>
          <nav className="hidden sm:flex px-3 gap-1" aria-label="Store">
            {TABS.map(t => (
              <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => cx('h-10 px-3 rounded-t-lg text-[13px] font-semibold inline-flex items-center gap-1.5', isActive ? 'bg-white text-[#C2410C]' : 'text-white/85 hover:bg-white/10')}>
                <t.icon size={15} />{t.label}{badge[t.to] ? <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-red-600 text-white text-[10px] font-bold flex items-center justify-center">{badge[t.to]}</span> : null}
              </NavLink>
            ))}
          </nav>
        </FieldHeader>
        <div className="flex-1 overflow-y-auto">
          {q.isLoading ? <Loading /> : q.error ? <ErrorState error={q.error} retry={q.refetch} /> : (
            <Routes>
              <Route index element={<Today o={o} />} />
              <Route path="track" element={<Navigate to="/s" replace />} />
              <Route path="order" element={<Order o={o} />} />
              <Route path="receipt" element={<Receive o={o} />} />
              <Route path="deferrals" element={<Notices o={o} />} />
              <Route path="history" element={<HistoryView />} />
              <Route path="*" element={<Navigate to="/s" replace />} />
            </Routes>
          )}
        </div>
        <nav className="sm:hidden flex-shrink-0 grid grid-cols-5 border-t border-[#E4E7EC] bg-white safe-bottom" aria-label="Store">
          {TABS.map(t => (
            <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => cx('relative h-14 flex flex-col items-center justify-center gap-0.5 text-[11px] font-semibold', isActive ? 'text-[#C2410C]' : 'text-slate-500')}>
              <t.icon size={19} />{t.label}
              {badge[t.to] ? <span className="absolute top-1.5 left-1/2 ml-2 min-w-[16px] h-4 px-1 rounded-full bg-red-600 text-white text-[10px] font-bold flex items-center justify-center">{badge[t.to]}</span> : null}
            </NavLink>
          ))}
        </nav>
      </div>
    </div>
  );
}

function Section({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return <section className="space-y-2"><div className="flex items-center justify-between"><h2 className="text-[12px] font-semibold uppercase tracking-[0.06em] text-slate-500">{title}</h2>{action}</div>{children}</section>;
}

function Today({ o }: { o: any }) {
  const nav = useNavigate();
  const now = useNow();
  const d = o.delivery;
  const pendingNotices = o.deferrals.filter((x: any) => !x.acknowledgedAt);
  const steps = d ? [
    ['Planned', true], ['Loaded', ['released', 'in_progress', 'completed'].includes(d.tripStatus)], ['On road', ['in_progress', 'completed'].includes(d.tripStatus)], ['Delivered', !!d.delivered], ['Confirmed', o.orders.length > 0 && o.orders.every((x: any) => x.receipts > 0)],
  ] as [string, boolean][] : [];
  return (
    <div className="p-4 sm:p-6 space-y-5">
      {o.toConfirm.length > 0 && <Callout tone="success" title={`Delivered ${d?.delivered?.at ?? ''} — please check what arrived`} action={<BigButton tone="store" className="!min-h-[44px] !text-[14px]" onClick={() => nav('/s/receipt')}>Confirm receipt</BigButton>}>Compare each line with the driver's proof. Report anything short, damaged or warm.</Callout>}
      {pendingNotices.length > 0 && <Callout tone="warning" title={`${pendingNotices.length} delivery change${pendingNotices.length > 1 ? 's' : ''} to read`} action={<button onClick={() => nav('/s/deferrals')} className="text-[13px] font-semibold underline">Read now</button>}>{pendingNotices[0].storeText}</Callout>}
      <div className="rounded-2xl border border-[#E6E9F0] overflow-hidden">
        <div className="p-5" style={{ background: 'linear-gradient(135deg,#FFF7ED,#FFFBEB)' }}>
          <div className="text-[12px] font-semibold uppercase tracking-[0.06em] text-orange-800/80">Today's delivery · {o.dateLabel}</div>
          {!d ? <div className="mt-2 text-[15px] text-slate-700">{o.orders.length ? 'Your order is confirmed. Arrival time appears when the plan is published.' : 'Nothing planned for today.'}</div> : d.delivered ? (
            <div className="mt-2"><div className="text-[28px] font-bold text-slate-900 tabular flex items-center gap-2"><CheckCircle2 size={26} className="text-emerald-600" />Delivered {d.delivered.at}</div><div className="text-[13px] text-slate-600 mt-1">{d.delivered.outcome === 'partial' ? 'Partial delivery · ' : ''}Received by {d.delivered.receiver ?? '—'} · {d.vehicleId}</div></div>
          ) : (
            <div className="mt-2">
              <div className="flex items-baseline gap-3 flex-wrap"><span className="text-[40px] font-bold text-slate-900 tabular leading-none" data-testid="eta">{d.estimate ? '~' : ''}{d.eta}</span><span className="text-[14px] text-slate-600">{d.estimate ? 'estimated' : 'expected arrival'}{d.delayMin > 0 ? ` · ${d.delayMin} min behind plan (${d.plannedEta})` : ''}</span></div>
              <div className="text-[13px] text-slate-600 mt-2">Your window {d.mallWindow ?? d.window} · stop {d.stop} of {d.stops} · {d.vehicleId} · {d.driverName}</div>
              {d.estimate && <div className="mt-3 flex items-start gap-2 text-[13px] text-slate-700 bg-white/70 rounded-lg px-3 py-2"><WifiOff size={15} className="text-slate-500 mt-0.5 flex-shrink-0" />The driver is in an area with no signal (last update {d.lastUpdate ? hhmm(d.lastUpdate) : '—'}). This time is estimated from the plan and the last stop they reported. Deliveries continue as normal.</div>}
            </div>
          )}
        </div>
        {d && <ol className="grid grid-cols-5 gap-1.5 px-5 py-4 bg-white">{steps.map(([l, on], i) => (
          <li key={l} className="min-w-0"><span className={cx('block h-1.5 rounded-full', on ? 'bg-[#C2410C]' : 'bg-[#E4E7EC]')} /><span className={cx('mt-1.5 block text-[11px] font-semibold truncate', on ? 'text-slate-800' : 'text-slate-400')}>{l}</span></li>
        ))}</ol>}
      </div>
      <Section title="Orders for today">
        {o.orders.length === 0 && <div className="text-[13px] text-slate-500">No orders for {o.dateLabel}.</div>}
        {o.orders.map((x: any) => (
          <div key={x.id} className="rounded-xl border border-slate-200 px-4 py-3 flex items-center gap-3">
            <div className="flex-1 min-w-0"><div className="text-[14px] font-semibold text-slate-900 flex items-center gap-2">{x.description}<TempTag temp={x.temp} /></div><div className="text-[12px] text-slate-500">{x.id} · {x.units} units · {fmt(x.kg)} kg{x.deferredYesterday ? ' · carried over, goes first' : ''}</div></div>
            <Status s={x.receipts ? (x.status === 'disputed' ? 'disputed' : 'received') : x.status} size="sm" />
          </div>
        ))}
      </Section>
      <Section title="Next order" action={<button onClick={() => nav('/s/order')} className="text-[13px] font-semibold text-[#C2410C]">Place order</button>}>
        <OrderWindowCard w={o.window} now={now} />
      </Section>
      <div className="text-[12px] text-slate-500"><OutletBadges o={o.outlet} /> <span className="ml-1">Receiving hours {o.outlet.open}–{o.outlet.close}{o.outlet.mallWindow ? ` · mall bay ${o.outlet.mallWindow}` : ''}</span></div>
    </div>
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
      {done && <Callout tone="success" title={`Order ${done.id} confirmed for ${done.deliveryLabel}`}>{done.units} units · about {fmt(done.kg)} kg · {done.m3} m³.{done.afterCutoff ? ' It came after the 16:00 cutoff, so it goes on the following run.' : ''}</Callout>}
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
      <BigButton tone="store" disabled={!total || place.isPending} icon={<ShoppingCart size={18} />} onClick={() => place.mutate()} data-testid="place-order">Place order for {o.window.deliveryLabel}</BigButton>
      <p className="text-[12px] text-slate-500">Orders placed after 16:00 go on the following delivery day. You'll get a message if anything changes.</p>
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
  const list: any[] = o.toConfirm;
  const [lines, setLines] = useState<Record<string, Line>>({});
  const [note, setNote] = useState('');
  const [pod, setPod] = useState<string | null>(null);
  const [done, setDone] = useState<any>(null);
  const get = (x: any): Line => lines[x.id] ?? { orderId: x.id, status: 'ok', received: x.units, expected: x.units };
  const upd = (x: any, p: Partial<Line>) => setLines(l => ({ ...l, [x.id]: { ...get(x), ...p } }));
  const send = useAct(() => post('/store/receipts', { orderId: list[0].id, lines: list.map(get), note: note || undefined }), { invalidate: ['store', 'store-history'], onDone: r => setDone(r) });
  if (done) return <div className="p-6 max-w-[640px]"><Callout tone={done.issues ? 'warning' : 'success'} title={done.issues ? 'Receipt sent with an issue' : 'Receipt confirmed'}>{done.issues ? 'The dispatcher has been told and will decide on a replacement or credit. You will get a message.' : 'Thank you. Everything matched the driver’s proof.'}</Callout></div>;
  if (!list.length) return <div className="p-6"><Empty icon={<ClipboardCheck size={28} />} title="Nothing to confirm">When the driver delivers, the lines to check appear here.</Empty></div>;
  const issues = list.map(get).filter(l => l.status !== 'ok').length;
  return (
    <div className="p-4 sm:p-6 space-y-4 max-w-[720px]">
      <Callout tone="info" title={`Delivered ${o.delivery?.delivered?.at ?? ''} by ${o.delivery?.vehicleId ?? ''}`}>Check each line. If something is short, damaged or not cold enough, mark it — the dispatcher sees it straight away.</Callout>
      {list.map(x => { const l = get(x); return (
        <div key={x.id} className="rounded-xl border border-slate-200 p-4 space-y-3" data-testid={`receipt-${x.id}`}>
          <div className="flex items-center justify-between gap-2"><div className="min-w-0"><div className="text-[15px] font-bold text-slate-900">{x.description}</div><div className="text-[12px] text-slate-500">{x.id} · {x.units} units sent{x.status === 'partial' ? ' · partial delivery' : ''}</div></div><TempTag temp={x.temp} /></div>
          <div className="grid grid-cols-4 gap-1.5">{(['ok', 'short', 'damaged', 'temperature'] as const).filter(s => s !== 'temperature' || x.temp === 'chilled').map(s => (
            <button key={s} onClick={() => upd(x, { status: s, received: s === 'ok' ? x.units : Math.max(0, x.units - 1) })} className={cx('min-h-[44px] rounded-lg text-[12px] font-semibold ring-1', l.status === s ? (s === 'ok' ? 'bg-emerald-600 text-white ring-emerald-600' : 'bg-orange-600 text-white ring-orange-600') : 'ring-slate-200 text-slate-700')}>{s === 'ok' ? 'All OK' : s === 'temperature' ? 'Too warm' : s[0].toUpperCase() + s.slice(1)}</button>
          ))}</div>
          {l.status !== 'ok' && <div className="flex items-center gap-3"><span className="text-[13px] text-slate-600 flex-1">Units in good condition</span>
            <button onClick={() => upd(x, { received: Math.max(0, l.received - 1) })} className="w-10 h-10 rounded-lg ring-1 ring-[#D0D5DD] flex items-center justify-center" aria-label="Fewer"><Minus size={15} /></button>
            <span className="w-10 text-center text-[16px] font-bold tabular">{l.received}</span>
            <button onClick={() => upd(x, { received: Math.min(x.units, l.received + 1) })} className="w-10 h-10 rounded-lg ring-1 ring-[#D0D5DD] flex items-center justify-center" aria-label="More"><Plus size={15} /></button>
            <span className="text-[12px] text-slate-500">of {x.units}</span></div>}
          <button onClick={() => setPod(x.id)} className="text-[12px] font-semibold text-slate-600 inline-flex items-center gap-1"><Camera size={13} />See the driver's proof</button>
        </div>
      ); })}
      <Field label="Note (optional)"><textarea className={`${inputCls} h-auto py-2`} rows={2} value={note} onChange={e => setNote(e.target.value)} /></Field>
      <BigButton tone="store" disabled={send.isPending} icon={<ClipboardCheck size={18} />} onClick={() => send.mutate()} data-testid="confirm-receipt">{issues ? `Send receipt with ${issues} issue${issues > 1 ? 's' : ''}` : 'Confirm everything arrived'}</BigButton>
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
          {q.data.photo && <img src={q.data.photo} alt="Delivery photo" className="w-full rounded-lg" />}
          {q.data.signature && <div><div className="text-[12px] font-semibold text-slate-500 mb-1 flex items-center gap-1"><PenLine size={12} />Signature</div><img src={q.data.signature} alt="Signature" className="w-full rounded-lg ring-1 ring-slate-200 bg-slate-50" /></div>}
        </div>
      )}
    </Modal>
  );
}

function HistoryView() {
  const q = useApi<any>(['store-history'], '/store/history');
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorState error={q.error} retry={q.refetch} />;
  const h = q.data;
  return (
    <div className="p-4 sm:p-6 space-y-4">
      <div className="grid grid-cols-4 gap-2">{[['Orders', h.stats.orders], ['Delivered', h.stats.delivered], ['Moved', h.stats.deferred], ['Issues', h.stats.issues]].map(([l, n]) => <div key={l} className="rounded-xl bg-slate-50 px-3 py-2.5"><div className="text-[11px] text-slate-500">{l}</div><div className="text-[20px] font-bold tabular">{n}</div></div>)}</div>
      <div className="rounded-xl border border-slate-200 divide-y divide-slate-100">
        {h.orders.map((x: any) => (
          <div key={x.id} className="px-4 py-3 flex items-center gap-3">
            <div className="w-16 text-[12px] text-slate-500 tabular flex-shrink-0">{x.dateLabel}</div>
            <div className="flex-1 min-w-0"><div className="text-[13px] font-semibold text-slate-900 truncate">{x.description}</div><div className="text-[12px] text-slate-500">{x.id} · {x.units} units{x.deferrals ? ` · moved to ${x.deferrals.map((d: any) => d.toDate.slice(5)).join(', ')}` : ''}</div></div>
            <TempTag temp={x.temp} />
            <Status s={x.receipt === 'ok' ? 'received' : x.receipt === 'issue' ? 'disputed' : x.status} size="sm" />
          </div>
        ))}
      </div>
    </div>
  );
}
