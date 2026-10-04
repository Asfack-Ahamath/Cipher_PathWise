import { useMemo, useState, type ReactNode } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import {
  Home, ShoppingCart, CalendarClock, ClipboardCheck, History, Truck, CheckCircle2, Clock, WifiOff,
  Snowflake, Package, Minus, Plus, AlertTriangle, CloudRain, Camera, PenLine,
  Lock, Pencil, Ban, X, TrendingUp, CalendarDays, ShieldAlert,
  AlertOctagon, Users, ChevronRight, Info, Phone, FileText
} from 'lucide-react';
import { FieldHeader, BigButton } from '../../components/FieldShell';
import { Segmented, Modal, Field, inputCls, Empty, Button, cx, Pill } from '../../components/ds';
import { AuthImage, compressImage, ErrorState, Loading, Status, useAct, useApi, useToast, fmt } from '../../components/common';
import { OutletBadges, TempTag } from '../../components/tags';
import { STATUS } from '../../components/StatusChip';
import { del, patch, post } from '../../lib/api';
import { useLiveUpdates } from '../../lib/live';
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
  const nav = useNavigate();
  const activeIdx = Math.max(0, TABS.findIndex(t => t.end ? pathname === t.to : pathname.startsWith(t.to)));
  const q = useApi<any>(['store'], '/store/overview', { refetchInterval: 30_000 });
  const o = q.data;
  const badge: Record<string, number> = o ? { '/s/receipt': o.toConfirm.length, '/s/deferrals': o.deferrals.filter((d: any) => !d.acknowledgedAt).length } : {};

  const pageTitle = useMemo(() => {
    if (!o) return 'Store';
    if (pathname.startsWith('/s/order')) return `Order for ${o.window?.deliveryLabel || 'Next Run'} (${o.outlet?.brand || 'Fresh'})`;
    if (pathname.startsWith('/s/track')) return 'Track delivery';
    if (pathname.startsWith('/s/receipt')) return 'Confirm receipt';
    if (pathname.startsWith('/s/deferrals')) return 'Deferral notice';
    if (pathname.startsWith('/s/history')) return 'Orders and deferrals';
    return o.outlet.name.replace(/ · OUT\d+$/, '');
  }, [pathname, o]);

  const pageSubtitle = useMemo(() => {
    if (!o) return '…';
    return `${o.outlet.id} · ${o.outlet.manager || o.outlet.district} · window ${o.outlet.open}–${o.outlet.close}`;
  }, [o]);

  const backAction = pathname !== '/s' ? () => nav('/s') : undefined;

  return (
    <div className="min-h-[100dvh] bg-[#F4F6FA] flex justify-center">
      <div className="relative w-full max-w-[1024px] h-[100dvh] bg-white flex flex-col shadow-[0_0_0_1px_#E6E9F0]">
        <FieldHeader
          role="store"
          title={pageTitle}
          subtitle={pageSubtitle}
          back={backAction}
        />
        <div className="flex-1 overflow-y-auto pb-[calc(92px+env(safe-area-inset-bottom))]">
          {q.isLoading ? <Loading /> : q.error ? <ErrorState error={q.error} retry={q.refetch} /> : (
            <div key={pathname} className="anim-page w-full">
              <Routes>
                <Route index element={<Today o={o} />} />
                <Route path="track" element={<Track o={o} />} />
                <Route path="order" element={<Order o={o} />} />
                <Route path="receipt" element={<Receive o={o} />} />
                <Route path="deferrals" element={<Notices o={o} />} />
                <Route path="history" element={<HistoryView />} />
                <Route path="*" element={<Navigate to="/s" replace />} />
              </Routes>
            </div>
          )}
        </div>
        <GlassTabs activeIdx={activeIdx} badge={badge} />
      </div>
    </div>
  );
}

/* Liquid-glass tab bar: floating pill pinned to bottom */
function GlassTabs({ activeIdx, badge }: { activeIdx: number; badge: Record<string, number> }) {
  return (
    <nav
      className="absolute inset-x-3 sm:inset-x-auto sm:left-1/2 sm:-translate-x-1/2 sm:w-[560px] z-30 grid grid-cols-5 gap-0.5 p-1.5 rounded-[32px] glass"
      style={{ bottom: 'max(12px, env(safe-area-inset-bottom))' }} aria-label="Store">
      <span aria-hidden="true" className="absolute top-1.5 bottom-1.5 left-1.5 rounded-[26px] bg-white/75 shadow-[inset_0_0_0_1px_rgba(255,255,255,.9),0_2px_10px_rgba(15,23,42,.12)] transition-transform duration-[420ms] ease-[cubic-bezier(.3,1.25,.4,1)]" style={{ width: 'calc((100% - 12px - 8px) / 5)', transform: `translateX(calc(${activeIdx} * (100% + 2px)))` }} />
      {TABS.map(t => (
        <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => cx('relative z-10 flex flex-col items-center justify-center gap-[2px] py-1.5 rounded-[26px] text-[10px] sm:text-[11px] font-semibold select-none transition-[color,transform] duration-300 active:scale-90', isActive ? 'text-[#0F766E]' : 'text-slate-600 hover:text-slate-900')}>
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

/* Round stepper buttons matching Designathon StoreManagerApp */
function RoundStepper({
  value,
  onChange,
  min = 0,
  max = 500,
  step = 1,
  label,
  color = '#0F766E',
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  label?: string;
  color?: string;
}) {
  const isZero = value <= min;
  const isMax = value >= max;
  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        disabled={isZero}
        onClick={() => onChange(Math.max(min, value - step))}
        aria-label={`Fewer ${label || 'units'}`}
        className={cx(
          'w-11 h-11 rounded-full border border-slate-200 flex items-center justify-center transition-all duration-150',
          isZero ? 'opacity-30 cursor-not-allowed text-slate-300' : 'cursor-pointer hover:bg-slate-50 text-slate-700 active:scale-90'
        )}
      >
        <Minus size={15} />
      </button>

      <input
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        value={value}
        onChange={e => {
          const raw = e.target.value;
          if (raw === '') onChange(min);
          else {
            const n = Number(raw);
            if (!isNaN(n)) onChange(Math.max(min, Math.min(max, n)));
          }
        }}
        className="text-[16px] font-bold tabular w-8 text-center bg-transparent outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
        aria-label={`${label || 'Category'} units`}
      />

      <button
        type="button"
        disabled={isMax}
        onClick={() => onChange(Math.min(max, value + step))}
        aria-label={`More ${label || 'units'}`}
        className={cx(
          'w-11 h-11 rounded-full flex items-center justify-center text-white transition-all duration-150 shadow-xs active:scale-90',
          isMax ? 'opacity-30 cursor-not-allowed' : 'cursor-pointer hover:opacity-90'
        )}
        style={{ background: color }}
      >
        <Plus size={15} />
      </button>
    </div>
  );
}

const mins = (t?: string | null) => { if (!t) return null; const [h, m] = t.split(':').map(Number); return h * 60 + m; };

/* ETA Card matching Designathon etaCard */
function EtaCard({
  d,
  dateLabel,
  outletClose,
  ambOrder,
  chiOrder,
  onConfirmReceipt,
}: {
  d: any;
  dateLabel: string;
  outletClose?: string;
  ambOrder?: any;
  chiOrder?: any;
  onConfirmReceipt?: () => void;
}) {
  const delivered = !!d?.delivered;
  const isOffline = d?.estimate;

  const open = mins((d?.mallWindow ?? d?.window ?? '06:00–18:00').split('–')[0]);
  const close = mins((d?.mallWindow ?? d?.window ?? '06:00–18:00').split('–')[1]);
  const planStart = Math.max(mins(d?.plannedEta) ?? 0, open ?? 0);
  const expStart = Math.max(mins(d?.eta) ?? 0, open ?? 0);
  const behind = expStart - planStart;
  const breach = close !== null && (mins(d?.eta) ?? 0) > close;

  const isLate = d?.late || breach;
  const isModRisk = behind > 0 && !isLate;
  const lateIndicator = (
    <div className={cx('inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-semibold mt-1',
      isLate ? 'bg-red-100 text-red-700' : isModRisk ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700')}>
      {isLate ? <AlertOctagon size={11} /> : isModRisk ? <AlertTriangle size={11} /> : <CheckCircle2 size={11} />}
      {isLate ? 'High Delay Risk — Near window close' : isModRisk ? 'Moderate Transit Risk' : 'High On-Time Confidence'}
    </div>
  );

  if (!d) {
    return (
      <div className="rounded-2xl p-4 sm:p-5 bg-teal-50/60 border border-teal-200/80">
        <div className="text-[14px] font-bold text-slate-900">Today · {dateLabel}</div>
        <div className="mt-1 text-[15px] text-slate-700">{ambOrder || chiOrder ? 'Your order is confirmed. Arrival time appears when the plan is published.' : 'Nothing planned for today.'}</div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl p-4 sm:p-5" style={{ background: isOffline ? '#F3F4F6' : delivered ? '#F0FDF4' : '#F0FDFA', border: `1px solid ${isOffline ? '#D1D5DB' : delivered ? '#BBF7D0' : '#99F6E4'}` }}>
      <div className="flex items-center justify-between mb-2">
        <div className="text-[14px] font-bold text-slate-900">Today · {dateLabel}</div>
        <Pill
          label={delivered ? 'Delivered' : ['in_progress', 'completed'].includes(d.tripStatus) ? 'Out for delivery' : 'Planned'}
          color={delivered ? STATUS.delivered.color : ['in_progress', 'completed'].includes(d.tripStatus) ? STATUS.outForDel.color : STATUS.planned.color}
          bg={delivered ? STATUS.delivered.bg : ['in_progress', 'completed'].includes(d.tripStatus) ? STATUS.outForDel.bg : STATUS.planned.bg}
        />
      </div>
      {delivered ? (
        <>
          <div className="text-[26px] font-bold tabular text-green-900">Delivered {d.delivered.at}</div>
          <div className="text-[13px] text-green-800">Received by {d.delivered.receiver ?? '—'} · {d.vehicleId} · please confirm what arrived</div>
          {onConfirmReceipt && (
            <button onClick={onConfirmReceipt} className="mt-3 w-full rounded-xl text-[15px] font-bold text-white cursor-pointer active:scale-95 transition-all shadow-sm" style={{ background: '#0F766E', minHeight: 48 }}>Confirm receipt</button>
          )}
        </>
      ) : isOffline ? (
        <>
          <div className="text-[26px] font-bold tabular text-slate-800">Estimated {d.eta}</div>
          <div className="text-[13px] text-slate-600 flex items-center gap-1.5 mt-0.5"><WifiOff size={13} style={{ color: STATUS.offline.color }} />Last update {d.lastUpdate ? hhmm(d.lastUpdate) : '05:40'} · low coverage area</div>
          <div className="text-[12px] text-slate-500 mt-1">The driver is in a low-coverage stretch of road. This time is an estimate from the plan; it updates as soon as the phone has signal.</div>
        </>
      ) : (
        <>
          <div className="text-[26px] font-bold tabular text-teal-900">ETA {d.eta}</div>
          <div className="text-[13px] text-teal-800">
            Your window {d.mallWindow ?? d.window} · stop {d.stop} of {d.stops} · {d.vehicleId} · {d.driverName}
          </div>
          <div className="mt-1">{lateIndicator}</div>
          <div className="text-[12px] text-teal-700 mt-2 flex items-center gap-1">
            <Users size={12} />Estimated handling: 15 min (Standard allowance: 15 min) — Recommend 2 receiving staff (pred_service_min)
          </div>
          {breach && (
            <div className="mt-2.5 rounded-lg bg-red-100 border border-red-300 p-2 text-[12px] font-semibold text-red-900 flex items-center gap-1.5">
              <AlertOctagon size={14} className="text-red-700 flex-shrink-0" />
              Warning: Delivery is projected to arrive after your {outletClose || 'closing'} window closes.
            </div>
          )}
        </>
      )}

      <div className="mt-3 grid grid-cols-2 gap-2 text-[12px]">
        <div className="rounded-lg bg-white/70 px-2.5 py-2"><TempTag temp="ambient" /> <span className="ml-1 text-slate-700 font-mono text-[11px]">{ambOrder?.id ?? 'ORD0093174'}</span></div>
        <div className="rounded-lg bg-white/70 px-2.5 py-2"><TempTag temp="chilled" /> <span className="ml-1 text-slate-700 font-mono text-[11px]">{chiOrder?.id ?? 'ORD0093173'}</span></div>
      </div>
    </div>
  );
}

/* ─── SCREEN 1: TODAY (DASHBOARD) ────────────────────────── */
function Today({ o }: { o: any }) {
  const nav = useNavigate();
  const now = useNow();
  const [edit, setEdit] = useState<any | null>(null);
  const [cancel, setCancel] = useState<any | null>(null);
  const pendingNotices = o.deferrals.filter((x: any) => !x.acknowledgedAt);
  const d = o.deliveries[0];

  const ambOrder = o.orders.find((x: any) => x.temp === 'ambient');
  const chiOrder = o.orders.find((x: any) => x.temp === 'chilled');
  const minsLeft = Math.max(0, Math.round((new Date(o.window.cutoffAt).getTime() - now.getTime()) / 60000));
  const countdown = `${Math.floor(minsLeft / 60)}h ${String(minsLeft % 60).padStart(2, '0')}m`;

  return (
    <div className="w-full px-4 sm:px-6 md:px-8 py-4 sm:py-6 space-y-4 pb-12 text-left">
      <EtaCard
        d={d}
        dateLabel={o.dateLabel}
        outletClose={o.outlet.close}
        ambOrder={ambOrder}
        chiOrder={chiOrder}
        onConfirmReceipt={() => nav('/s/receipt')}
      />

      {/* Deferral Notice Card matching Designathon */}
      {pendingNotices.length > 0 && (
        <button onClick={() => nav('/s/deferrals')} className="w-full text-left rounded-xl border border-orange-200 bg-orange-50 px-4 py-3 flex items-start gap-3 active:scale-95 transition-all cursor-pointer">
          <Package size={17} className="text-orange-700 mt-0.5 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-[14px] font-bold text-orange-900">{pendingNotices[0].units ? `${pendingNotices[0].units} units arrive ${pendingNotices[0].toLabel}` : pendingNotices[0].storeText}</div>
            {pendingNotices[0].escalated && <div className="text-[11px] font-semibold text-red-700 mt-0.5 mb-1 flex items-center gap-1"><ShieldAlert size={12}/> Escalated: deferred twice</div>}
            <div className="text-[12px] text-orange-800 line-clamp-2">{pendingNotices[0].storeText}</div>
          </div>
          <ChevronRight size={16} className="text-orange-400 mt-1 flex-shrink-0" />
        </button>
      )}

      {/* 4-Card Action Grid matching Designathon */}
      <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
        <button onClick={() => nav('/s/order')} className="p-4 rounded-2xl border text-left flex flex-col h-full active:scale-95 transition-all cursor-pointer" style={{ background: 'linear-gradient(135deg,#0F766E,#0E7490)', borderColor: 'transparent', boxShadow: '0 10px 24px -12px rgba(15,118,110,.6)' }}>
          <Package size={20} className="text-white" />
          <div className="mt-2 text-[14px] font-bold text-white">Order for {o.window.deliveryLabel}</div>
          <div className="text-[12px] mt-auto pt-1 text-white/75">Closes {o.window.cutoffTime || '16:00'} · {countdown} left</div>
        </button>

        <button onClick={() => nav('/s/track')} className="p-4 rounded-2xl border border-slate-200 bg-white text-left flex flex-col h-full hover:bg-slate-50 active:scale-95 transition-all cursor-pointer shadow-2xs">
          <Truck size={20} className="text-[#0F766E]" />
          <div className="mt-2 text-[14px] font-bold text-slate-900">Track delivery</div>
          <div className="text-[12px] mt-auto pt-1 text-slate-400">{d?.delivered ? `Delivered ${d.delivered.at}` : d ? `ETA ${d.eta}` : 'No delivery today'}</div>
        </button>

        <button onClick={() => nav('/s/receipt')} className="p-4 rounded-2xl border border-slate-200 bg-white text-left flex flex-col h-full hover:bg-slate-50 active:scale-95 transition-all cursor-pointer shadow-2xs">
          <CheckCircle2 size={20} className="text-[#0F766E]" />
          <div className="mt-2 text-[14px] font-bold text-slate-900">Confirm receipt</div>
          <div className="text-[12px] mt-auto pt-1 text-slate-400">{o.toConfirm.length > 0 ? `${o.toConfirm.length} waiting for you` : 'After delivery'}</div>
        </button>

        <button onClick={() => nav('/s/history')} className="p-4 rounded-2xl border border-slate-200 bg-white text-left flex flex-col h-full hover:bg-slate-50 active:scale-95 transition-all cursor-pointer shadow-2xs">
          <FileText size={20} className="text-[#0F766E]" />
          <div className="mt-2 text-[14px] font-bold text-slate-900">Orders and deferrals</div>
          <div className="text-[12px] mt-auto pt-1 text-slate-400">Last 30 days</div>
        </button>
      </div>

      <div className="rounded-xl bg-slate-50 px-3 py-2 text-[12px] text-slate-500 flex items-center gap-2">
        <CalendarDays size={13} className="text-slate-400 flex-shrink-0" />
        Payday today and Vesak tomorrow — {o.window.deliveryLabel}'s order covers two trading days.
      </div>

      <Section title="Orders for today">
        {o.orders.length === 0 && <div className="text-[13px] text-slate-500">No orders for {o.dateLabel}.</div>}
        {o.orders.map((x: any) => (
          <div key={x.id} className="rounded-xl border border-slate-200 px-4 py-3 flex items-center gap-3 bg-white shadow-2xs">
            <div className="flex-1 min-w-0">
              <div className="text-[14px] font-semibold text-slate-900 flex items-center gap-2">{x.description}<TempTag temp={x.temp} /></div>
              <div className="text-[12px] text-slate-500 font-mono mt-0.5">{x.id} · {x.units} units · {fmt(x.kg)} kg{x.deferredYesterday ? ' · carried over, goes first' : ''}</div>
            </div>
            <Status s={x.receipts ? (x.status === 'disputed' ? 'disputed' : 'received') : x.status} size="sm" />
          </div>
        ))}
      </Section>

      {o.upcoming.length > 0 && (
        <Section title="Coming up">
          {o.upcoming.map((x: any) => (
            <div key={x.id} className="rounded-xl border border-slate-200 px-4 py-3 flex flex-wrap items-center gap-3 bg-white shadow-2xs">
              <div className="flex-1 min-w-[180px]">
                <div className="text-[14px] font-semibold text-slate-900 flex items-center gap-2">{x.dateLabel} · {x.description}<TempTag temp={x.temp} /></div>
                <div className="text-[12px] text-slate-500 mt-0.5">{x.id} · {x.units} units{x.afterCutoff ? ' · came after cutoff' : ''}</div>
              </div>
              {x.editable ? (
                <div className="flex gap-2">
                  <Button size="sm" icon={<Pencil size={13} />} onClick={() => setEdit(x)}>Change</Button>
                  <Button size="sm" variant="danger" icon={<Ban size={13} />} onClick={() => setCancel(x)}>Cancel</Button>
                </div>
              ) : (
                <span className="text-[12px] text-slate-500 inline-flex items-center gap-1"><Lock size={12} />Closed — call the dispatcher</span>
              )}
            </div>
          ))}
        </Section>
      )}

      <div className="text-[12px] text-slate-500 pt-1">
        <OutletBadges o={o.outlet} /> <span className="ml-1">Receiving hours {o.outlet.open}–{o.outlet.close}{o.outlet.mallWindow ? ` · mall bay ${o.outlet.mallWindow}` : ''}</span>
      </div>

      {edit && <EditOrder order={edit} cats={o.categories?.[edit.temp] ?? []} onClose={() => setEdit(null)} />}
      {cancel && <CancelOrder order={cancel} onClose={() => setCancel(null)} />}
    </div>
  );
}

/* ─── SCREEN 1B: TRACK DELIVERY ──────────────────────────── */
function Track({ o }: { o: any }) {
  const nav = useNavigate();
  const d = o.deliveries[0];
  const delivered = !!d?.delivered;
  const isOffline = d?.estimate;
  const ambOrder = o.orders.find((x: any) => x.temp === 'ambient');
  const chiOrder = o.orders.find((x: any) => x.temp === 'chilled');

  const timelineSteps = [
    { label: 'Submitted', time: ambOrder?.dateLabel ? `${ambOrder.dateLabel} 11:20` : `${o.dateLabel} 11:20`, done: true },
    { label: 'Confirmed (orders closed)', time: '16:00 cutoff reached', done: true },
    { label: `Planned on ${d?.vehicleId ?? 'VEH041'} Trip ${d?.trip ?? 1}`, time: d ? 'Route scheduled' : 'Pending dispatch plan', done: !!d },
    { label: 'Loaded', time: d?.tripStatus === 'in_progress' || delivered ? 'Loaded onto vehicle' : 'Waiting for dock release', done: d?.tripStatus === 'in_progress' || delivered },
    { label: 'Out for delivery', time: d?.tripStatus === 'in_progress' || delivered ? 'In transit on route' : 'Waiting for departure', done: d?.tripStatus === 'in_progress' || delivered },
    { label: 'Arrived', time: delivered ? (d?.delivered?.at ? `Arrived ${d.delivered.at}` : 'Arrived at outlet') : isOffline ? 'Waiting for driver signal' : d ? `ETA ${d.eta}` : '—', done: delivered },
    { label: 'Delivered', time: delivered ? `Delivered ${d?.delivered?.at ?? ''} · signed by ${d?.delivered?.receiver ?? 'Staff'}` : '—', done: delivered },
    { label: 'Received by you', time: o.toConfirm.length === 0 && delivered ? 'Receipt confirmed' : delivered ? 'Waiting for confirmation' : '—', done: o.toConfirm.length === 0 && delivered },
  ];

  return (
    <div className="w-full px-4 sm:px-6 md:px-8 py-4 sm:py-6 space-y-4 pb-12 text-left">
      <EtaCard
        d={d}
        dateLabel={o.dateLabel}
        outletClose={o.outlet.close}
        ambOrder={ambOrder}
        chiOrder={chiOrder}
        onConfirmReceipt={() => nav('/s/receipt')}
      />

      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3 shadow-2xs">
        <div className="text-[13px] font-semibold text-slate-700">Order timeline</div>
        <div className="space-y-3 pt-1">
          {timelineSteps.map(step => (
            <div key={step.label} className="flex items-center gap-3">
              <div className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: step.done ? '#DCFCE7' : '#F1F5F9' }}>
                {step.done ? <CheckCircle2 size={13} className="text-green-600" /> : <Clock size={12} className="text-slate-400" />}
              </div>
              <div className="flex-1">
                <div className="text-[13px] font-medium text-slate-800">{step.label}</div>
                <div className="text-[12px] text-slate-500">{step.time}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ─── SCREEN 2: ORDER SCREEN ─────────────────────────────── */
function Order({ o }: { o: any }) {
  const toast = useToast();
  const now = useNow();
  const w = o.window;
  const brand = o.outlet.brand || 'Fresh';
  const cats = o.categories || {};
  const [units, setUnits] = useState<Record<string, number>>({});
  const [done, setDone] = useState<any[] | null>(null);
  const [isPending, setIsPending] = useState(false);

  const minsLeft = Math.max(0, Math.round((new Date(w.cutoffAt).getTime() - now.getTime()) / 60000));
  const countdown = `${Math.floor(minsLeft / 60)}h ${String(minsLeft % 60).padStart(2, '0')}m`;
  const isPostCutoff = w.afterCutoff || minsLeft === 0;

  const set = (k: string, v: number) => setUnits(u => ({ ...u, [k]: Math.max(0, Math.min(500, v)) }));

  const ambList: any[] = cats.ambient ?? [];
  const chiList: any[] = cats.chilled ?? [];
  const ambUnits = ambList.reduce((a, c) => a + (units[c.k] ?? 0), 0);
  const chiUnits = chiList.reduce((a, c) => a + (units[c.k] ?? 0), 0);
  const totalUnits = ambUnits + chiUnits;

  const dayPills = useMemo(() => {
    const base = new Date(w.now || now);
    const list = [];
    for (let i = 0; i < 6; i++) {
      const d = new Date(base);
      d.setDate(base.getDate() + i + 1);
      const dayName = d.toLocaleDateString('en-GB', { weekday: 'short' });
      const dayNum = d.getDate();
      const isSun = d.getDay() === 0;
      list.push({ label: `${dayName} ${dayNum}`, disabled: isSun });
    }
    return list;
  }, [w.now, now]);

  const handleOrderSubmit = async () => {
    if (!totalUnits) return;
    setIsPending(true);
    try {
      const requests = [];
      if (ambUnits > 0) {
        requests.push(post('/store/orders', {
          temp: 'ambient',
          lines: ambList.map(c => ({ category: c.k, units: units[c.k] ?? 0 })).filter(l => l.units > 0),
        }));
      }
      if (chiUnits > 0) {
        requests.push(post('/store/orders', {
          temp: 'chilled',
          lines: chiList.map(c => ({ category: c.k, units: units[c.k] ?? 0 })).filter(l => l.units > 0),
        }));
      }
      const results = await Promise.all(requests);
      setDone(results);
      setUnits({});
      toast('success', 'Order submitted successfully');
    } catch (err: any) {
      toast('error', err.message || 'Failed to submit order');
    } finally {
      setIsPending(false);
    }
  };

  /* ORDERED CONFIRMATION SCREEN matching Designathon screen === 'ordered' */
  if (done) {
    return (
      <div className="w-full px-4 sm:px-6 md:px-8 py-4 sm:py-6 space-y-4 pb-12 text-left">
        <div className="text-center pt-2">
          <CheckCircle2 size={44} className="mx-auto text-teal-600" />
          <div className="text-[20px] font-bold text-slate-900 mt-3">Order sent</div>
          <div className="text-[13px] text-slate-500">{o.dateLabel} · for {done[0]?.deliveryLabel ?? w.deliveryLabel}</div>
        </div>

        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-800 flex items-start gap-2">
          <Clock size={15} className="mt-0.5 flex-shrink-0 text-amber-600" />
          <span>Your order is queued. The dispatcher confirms all orders at the {w.cutoffTime || '16:00'} cutoff — you will see "Confirmed" in your history once the plan is published.</span>
        </div>

        <div className="space-y-2">
          {done.map((res: any, idx: number) => (
            <div key={res.id || idx} className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2.5 text-left bg-white shadow-2xs">
              <TempTag temp={idx === 0 && ambUnits > 0 ? 'ambient' : 'chilled'} />
              <span className="flex-1 font-mono text-[13px] text-slate-700 font-semibold">{res.id} · {res.units} units</span>
              <Pill label={res.afterCutoff ? 'Queued next run' : 'Unconfirmed'} color={res.afterCutoff ? STATUS.deferred.color : STATUS.unconfirmed.color} bg={res.afterCutoff ? STATUS.deferred.bg : STATUS.unconfirmed.bg} />
            </div>
          ))}
        </div>

        <div className="rounded-xl bg-slate-50 px-4 py-3 text-[13px] text-slate-600 text-left space-y-1">
          <div className="font-semibold text-slate-800">What happens next</div>
          <div>• {w.cutoffTime || '16:00'} — orders close, dispatcher publishes the plan</div>
          <div>• By about 18:30 — status changes to "Confirmed" with your ETA, or you get a deferral notice</div>
          <div>• Any carried over deferred items are scheduled automatically</div>
        </div>

        <button onClick={() => setDone(null)} className="w-full rounded-xl text-[15px] font-bold text-white cursor-pointer active:scale-95 transition-all shadow-sm" style={{ background: '#0F766E', minHeight: 48 }}>
          Done
        </button>
      </div>
    );
  }

  return (
    <div className="w-full px-4 sm:px-6 md:px-8 py-4 sm:py-6 space-y-4 pb-12 text-left">
      {/* Calendar Alerts matching Designathon */}
      <div className="flex flex-wrap gap-2 mb-1">
        {w.calendar?.isPayday && (
          <span className="px-2 py-1 bg-amber-100 text-amber-800 rounded-md text-[11px] font-bold flex items-center gap-1">
            <TrendingUp size={12} /> Payday Surge Expected
          </span>
        )}
        {w.skipped.map((s: any) => (
          <span key={s.date} className="px-2 py-1 bg-purple-100 text-purple-800 rounded-md text-[11px] font-bold flex items-center gap-1">
            <CalendarDays size={12} /> {s.holiday}
          </span>
        ))}
        {w.calendar?.monsoon && (
          <span className="px-2 py-1 bg-sky-100 text-sky-800 rounded-md text-[11px] font-bold flex items-center gap-1">
            <CloudRain size={12} /> Monsoon Alert
          </span>
        )}
      </div>

      {/* Date & Cutoff Info Bar */}
      <div className="flex items-center justify-between rounded-xl bg-slate-50 px-3.5 py-2.5">
        <div>
          <div className="text-[12px] text-slate-500">Delivery date</div>
          <div className="text-[15px] font-bold text-slate-900">{w.deliveryLabel}</div>
        </div>
        <div className="text-right">
          <div className="text-[12px] text-slate-500">Cutoff {w.cutoffTime || '16:00'}</div>
          <div className="text-[15px] font-bold tabular text-teal-700">{countdown} left</div>
        </div>
      </div>

      {isPostCutoff && (
        <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-[12px] text-amber-800 font-medium">
          Submitted after {w.cutoffTime || '16:00'} cutoff — Queued for subsequent operating run.
        </div>
      )}

      {/* Operating day pills matching Designathon */}
      <div className="flex gap-1.5 overflow-x-auto pb-0.5">
        {dayPills.map((d, i) => (
          <button
            key={d.label}
            disabled={d.disabled}
            className="flex-1 min-w-[50px] rounded-lg border text-[12px] font-semibold py-2 transition-all"
            style={{
              borderColor: i === 0 ? '#0F766E' : '#E2E8F0',
              background: i === 0 ? '#F0FDFA' : d.disabled ? '#F1F5F9' : '#fff',
              color: d.disabled ? '#CBD5E1' : i === 0 ? '#0F766E' : '#334155',
            }}
          >
            {d.label}
          </button>
        ))}
      </div>
      <div className="text-[11px] text-slate-400">
        Public holidays and Sundays are non-operating days. Orders after the 16:00 cutoff go to the following run.
      </div>

      {/* Fresh Brand Order Forms: Ambient + Chilled separate cards */}
      {brand === 'Fresh' ? (
        <>
          {(['ambient', 'chilled'] as const).filter(t => cats[t]).map(t => {
            const list = cats[t] || [];
            const e = list.reduce((a: any, c: any) => ({
              kg: a.kg + (units[c.k] ?? 0) * c.kg,
              m3: a.m3 + (units[c.k] ?? 0) * c.m3,
              u: a.u + (units[c.k] ?? 0),
            }), { kg: 0, m3: 0, u: 0 });

            return (
              <div key={t} className="rounded-xl border border-slate-200 overflow-hidden bg-white shadow-2xs">
                <div className="px-4 py-2.5 flex items-center justify-between" style={{ background: t === 'chilled' ? '#E0F2FE' : '#F8FAFC' }}>
                  <span className="text-[14px] font-bold text-slate-800 flex items-center gap-1.5">
                    {t === 'chilled' ? <><Snowflake size={14} className="text-sky-600" />Chilled order</> : <><Package size={14} className="text-slate-500" />Ambient (dry) order</>}
                  </span>
                  <span className="text-[11px] text-slate-500 tabular">
                    {e.u} cases · ~{Math.round(e.kg)} kg · ~{e.m3.toFixed(1)} m³
                  </span>
                </div>
                {list.map((c: any) => (
                  <div key={c.k} className="px-4 py-2.5 border-t border-slate-100 flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="text-[14px] font-semibold text-slate-800">{c.k}</div>
                      <div className="text-[11px] text-slate-400">about {c.kg} kg · {c.m3} m³ per unit</div>
                    </div>
                    <RoundStepper
                      value={units[c.k] ?? 0}
                      onChange={v => set(c.k, v)}
                      label={c.k}
                      color="#0F766E"
                    />
                  </div>
                ))}
              </div>
            );
          })}

          <div className="text-[11px] text-slate-400 flex items-start gap-1.5">
            <Info size={12} className="mt-0.5 flex-shrink-0" />
            Two separate orders, each with its own confirmation and receipt. Weight and volume are estimates from case sizes.
          </div>

          <button
            onClick={handleOrderSubmit}
            disabled={!totalUnits || isPending}
            className="w-full rounded-xl text-[16px] font-bold text-white transition-all shadow-sm flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed active:scale-95"
            style={{ background: '#0F766E', minHeight: 56 }}
            data-testid="place-order"
          >
            {isPending ? 'Submitting...' : ambUnits > 0 && chiUnits > 0 ? 'Submit both orders' : ambUnits > 0 ? 'Submit ambient order' : chiUnits > 0 ? 'Submit chilled order' : `Place order for ${w.deliveryLabel}`}
          </button>
        </>
      ) : brand === 'Style' ? (
        /* Style Brand Card */
        <div className="rounded-xl border border-purple-200 overflow-hidden bg-white shadow-2xs">
          <div className="px-4 py-3 bg-purple-50 border-b border-purple-100 flex items-center justify-between">
            <div>
              <div className="text-[14px] font-bold text-purple-900">Weekly Apparel Bulk Order</div>
              <div className="text-[11px] text-purple-700 font-semibold mt-0.5">Volume Binding — Apparel fills vehicle volume before weight</div>
            </div>
            <span className="text-[12px] font-bold text-purple-800 tabular bg-white px-2 py-1 rounded border border-purple-200">
              {ambUnits} cases
            </span>
          </div>
          {(cats.ambient || []).map((c: any) => (
            <div key={c.k} className="px-4 py-2.5 border-t border-slate-100 flex items-center justify-between gap-3">
              <div>
                <div className="text-[14px] font-semibold text-slate-800">{c.k}</div>
                <div className="text-[11px] text-slate-400">{(units[c.k] ?? 0) * c.kg} kg · {((units[c.k] ?? 0) * c.m3).toFixed(1)} m³</div>
              </div>
              <RoundStepper
                value={units[c.k] ?? 0}
                onChange={v => set(c.k, v)}
                label={c.k}
                color="#7C3AED"
              />
            </div>
          ))}
          <div className="p-3 bg-slate-50 border-t border-slate-100 text-[12px] text-slate-600">
            Style bulk replenishment runs once weekly. Orders submitted before Friday 16:00 are scheduled for Monday delivery.
          </div>
          <div className="p-3">
            <button
              onClick={handleOrderSubmit}
              disabled={!totalUnits || isPending}
              className="w-full rounded-xl text-[16px] font-bold text-white transition-all shadow-sm cursor-pointer disabled:opacity-50"
              style={{ background: '#7C3AED', minHeight: 56 }}
              data-testid="place-order"
            >
              {isPending ? 'Submitting...' : 'Submit Style bulk order'}
            </button>
          </div>
        </div>
      ) : (
        /* Tech Brand Card */
        <div className="rounded-xl border border-sky-200 overflow-hidden bg-white shadow-2xs">
          <div className="px-4 py-3 bg-sky-50 border-b border-sky-100 flex items-center justify-between">
            <div>
              <div className="text-[14px] font-bold text-sky-900">Major Appliances Commercial Order</div>
              <div className="text-[11px] text-sky-700 font-semibold mt-0.5">Weight Binding — Heavy appliances bind vehicle payload before volume</div>
            </div>
            <span className="text-[12px] font-bold text-sky-800 tabular bg-white px-2 py-1 rounded border border-sky-200">
              {ambUnits} units
            </span>
          </div>
          {(cats.ambient || []).map((c: any) => (
            <div key={c.k} className="px-4 py-2.5 border-t border-slate-100 flex items-center justify-between gap-3">
              <div>
                <div className="text-[14px] font-semibold text-slate-800">{c.k}</div>
                <div className="text-[11px] text-slate-400">{(units[c.k] ?? 0) * c.kg} kg · {((units[c.k] ?? 0) * c.m3).toFixed(1)} m³</div>
              </div>
              <RoundStepper
                value={units[c.k] ?? 0}
                onChange={v => set(c.k, v)}
                label={c.k}
                color="#0284C7"
              />
            </div>
          ))}
          <div className="p-3 bg-slate-50 border-t border-slate-100 text-[12px] text-slate-600">
            Tech units are staged on heavy-duty pallet trucks with hydraulic tailgate lift required.
          </div>
          <div className="p-3">
            <button
              onClick={handleOrderSubmit}
              disabled={!totalUnits || isPending}
              className="w-full rounded-xl text-[16px] font-bold text-white transition-all shadow-sm cursor-pointer disabled:opacity-50"
              style={{ background: '#0284C7', minHeight: 56 }}
              data-testid="place-order"
            >
              {isPending ? 'Submitting...' : 'Submit Tech appliance order'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── SCREEN 3: RECEIVE (POD RECONCILIATION) ─────────────── */
type Line = { orderId: string; status: 'ok' | 'short' | 'damaged' | 'temperature'; received: number; expected: number };
function Receive({ o }: { o: any }) {
  const toast = useToast();
  const list: any[] = o.toConfirm;
  const [lines, setLines] = useState<Record<string, Line>>({});
  const [lineCheck, setLineCheck] = useState<Record<string, string>>({});
  const [damageCat, setDamageCat] = useState<Record<string, string>>({});
  const [note, setNote] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [pod, setPod] = useState<string | null>(null);
  const [done, setDone] = useState<any>(null);

  const get = (x: any): Line => lines[x.id] ?? (x.driverUnits != null && x.driverUnits < x.units ? { orderId: x.id, status: 'short', received: x.driverUnits, expected: x.units } : { orderId: x.id, status: 'ok', received: x.units, expected: x.units });
  const upd = (x: any, p: Partial<Line>) => setLines(l => ({ ...l, [x.id]: { ...get(x), ...p } }));
  const send = useAct(() => post('/store/receipts', { orderId: list[0]?.id, lines: list.map(get), note: note || undefined, photos: photos.length ? photos : undefined }), { invalidate: ['store', 'store-history'], onDone: r => setDone(r) });

  const d = o.deliveries.find((x: any) => x.delivered && x.orderIds.some((id: string) => list.some(l => l.id === id)));

  if (!list.length) {
    return (
      <div className="w-full px-4 sm:px-6 md:px-8 py-10 text-center space-y-2">
        <Clock size={32} className="mx-auto text-slate-400" />
        <div className="text-[15px] font-semibold text-slate-700">Nothing to confirm yet</div>
        <div className="text-[13px] text-slate-500">You can confirm once the driver records the delivery.</div>
      </div>
    );
  }

  if (done) {
    return (
      <div className="w-full px-4 sm:px-6 md:px-8 py-10 text-center space-y-3">
        <CheckCircle2 size={40} className="mx-auto text-green-600" />
        <div className="text-[18px] font-bold text-slate-900">{done.issues ? 'Confirmed with an issue' : 'Receipt confirmed'}</div>
        <div className="text-[13px] text-slate-500">
          {done.issues ? "The dispatcher has your report and the driver's proof of delivery side by side. A dispute record has been opened." : 'The delivery is closed. Thank you.'}
        </div>
      </div>
    );
  }

  const allChecked = list.length > 0 && list.every(x => !!lineCheck[x.id]);
  const anyIssue = list.map(get).some(l => l.status !== 'ok');

  return (
    <div className="w-full px-4 sm:px-6 md:px-8 py-4 sm:py-6 space-y-4 pb-12 text-left">
      {/* Driver's Proof Card matching Designathon */}
      <div className="rounded-xl border border-slate-200 p-3 bg-white shadow-2xs">
        <div className="text-[12px] text-slate-500 uppercase font-semibold">Driver's proof of delivery</div>
        <div className="flex items-center gap-3 mt-2">
          <div className="w-16 h-16 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0 cursor-pointer" onClick={() => setPod(list[0]?.id)}>
            <Camera size={20} className="text-slate-400" />
          </div>
          <div className="text-[13px] text-slate-700">
            <div className="font-semibold">Received by {d?.delivered?.receiver ?? 'Staff'}</div>
            <div>Arrived {d?.delivered?.at ? '06:01' : '06:00'} · done {d?.delivered?.at ?? '06:15'} · signed</div>
            <div className="text-[12px] mt-1 text-slate-600">
              <span className="font-semibold">{list[0]?.units ?? 0}</span> cases delivered
            </div>
            <div className="text-slate-500 mt-0.5">{d?.driverName ?? 'Driver'} · {d?.vehicleId ?? 'VEH041'}</div>
          </div>
        </div>
      </div>

      <div className="text-[13px] font-semibold text-slate-700 pt-1">Check each line</div>

      {list.map(x => {
        const l = get(x);
        return (
          <div key={x.id} className="rounded-xl border border-slate-200 p-3 space-y-2.5 bg-white shadow-2xs">
            <div className="flex items-center gap-2">
              <TempTag temp={x.temp} />
              <span className="text-[14px] font-semibold text-slate-800">{x.temp[0].toUpperCase() + x.temp.slice(1)} · {x.units} cases</span>
            </div>

            {x.driverUnits != null && x.driverUnits < x.units && (
              <div className="text-[12px] text-orange-700 bg-orange-50 px-2 py-1 rounded">
                Depot shortfall noted: loader marked {x.units - x.driverUnits} cases short before truck left. Please verify {x.driverUnits} units received.
              </div>
            )}

            <div className="flex flex-wrap gap-1.5 mt-2">
              {(['ok', 'short', 'damaged', 'temperature'] as const).filter(s => s !== 'temperature' || x.temp === 'chilled').map(s => {
                const label = s === 'ok' ? 'OK' : s === 'temperature' ? 'Temperature issue' : s[0].toUpperCase() + s.slice(1);
                const isSelected = lineCheck[x.id] === s;
                return (
                  <button
                    key={s}
                    onClick={() => {
                      setLineCheck(c => ({ ...c, [x.id]: s }));
                      upd(x, { status: s, received: s === 'ok' ? x.units : Math.min(l.received, Math.max(0, x.units - 1)) });
                    }}
                    className="px-3 rounded-full border text-[13px] font-medium transition-colors cursor-pointer"
                    style={{
                      minHeight: 40,
                      borderColor: isSelected ? (s === 'ok' ? '#16A34A' : '#EA580C') : '#E2E8F0',
                      background: isSelected ? (s === 'ok' ? '#F0FDF4' : '#FFF7ED') : '#fff',
                      color: isSelected ? (s === 'ok' ? '#16A34A' : '#EA580C') : '#334155',
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>

            {l.status !== 'ok' && (
              <div className="mt-3 p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-3">
                <div className="flex items-center justify-between text-[13px] text-slate-700">
                  <span>Actual cases received:</span>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => upd(x, { received: Math.max(0, l.received - 1) })}
                      className="w-8 h-8 rounded-full border border-slate-300 flex items-center justify-center bg-white cursor-pointer active:scale-90"
                    >
                      <Minus size={14} />
                    </button>
                    <span className="font-bold tabular w-6 text-center">{l.received}</span>
                    <button
                      onClick={() => upd(x, { received: Math.min(x.units, l.received + 1) })}
                      className="w-8 h-8 rounded-full border border-slate-300 flex items-center justify-center bg-white cursor-pointer active:scale-90"
                    >
                      <Plus size={14} />
                    </button>
                  </div>
                </div>

                {x.driverUnits != null && l.received !== x.driverUnits && (
                  <div className="text-[11px] text-red-600 font-medium bg-red-50 p-1.5 rounded">
                    Driver reported {x.driverUnits} cases. Both numbers are preserved; dispatcher will review.
                  </div>
                )}

                {(l.status === 'damaged' || l.status === 'temperature') && (
                  <div className="text-[12px] text-slate-600">
                    Damage category:
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {['packaging_tear', 'crushed_carton', 'temp_spoilage', 'seal_broken'].map(cat => (
                        <button
                          key={cat}
                          onClick={() => setDamageCat(d => ({ ...d, [x.id]: cat }))}
                          className={`px-2 py-1 rounded border text-[11px] cursor-pointer ${damageCat[x.id] === cat ? 'bg-orange-100 border-orange-300 text-orange-800 font-semibold' : 'bg-white border-slate-200 text-slate-700'}`}
                        >
                          {cat.replace(/_/g, ' ')}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <textarea
                  placeholder="Store notes..."
                  value={note}
                  onChange={e => setNote(e.target.value)}
                  className="w-full text-[13px] p-2 border border-slate-200 rounded-md bg-white focus:outline-teal-600 h-16 resize-none"
                />

                <div className="flex flex-wrap gap-2">
                  {photos.map((p, i) => (
                    <div key={i} className="relative">
                      <img src={p} alt={`Receipt photo ${i + 1}`} className="w-20 h-20 object-cover rounded-lg" />
                      <button onClick={() => setPhotos(photos.filter((_, j) => j !== i))} className="absolute top-1 right-1 w-5 h-5 rounded-full bg-white/90 flex items-center justify-center shadow-xs" aria-label="Remove photo">
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                  {photos.length < 3 && (
                    <label className="flex items-center justify-center gap-1.5 w-full py-2 border border-dashed border-slate-300 rounded-md text-[13px] text-slate-600 bg-white cursor-pointer hover:bg-slate-50">
                      <Camera size={14} /> Add photo
                      <input
                        type="file"
                        accept="image/*"
                        capture="environment"
                        className="sr-only"
                        onChange={async e => {
                          const f = e.target.files?.[0];
                          e.target.value = '';
                          if (!f) return;
                          try {
                            const p = await compressImage(f);
                            setPhotos(ps => [...ps, p].slice(0, 3));
                          } catch (err: any) {
                            toast('error', err.message);
                          }
                        }}
                      />
                    </label>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}

      <button
        onClick={() => send.mutate()}
        disabled={!allChecked || send.isPending}
        className={cx(
          'w-full rounded-xl text-[16px] font-bold text-white transition-all shadow-sm flex items-center justify-center',
          !allChecked || send.isPending ? 'cursor-not-allowed opacity-80' : 'cursor-pointer active:scale-95'
        )}
        style={{
          background: !allChecked ? '#CBD5E1' : anyIssue ? '#EA580C' : '#0F766E',
          minHeight: 56,
        }}
        data-testid="confirm-receipt"
      >
        {send.isPending ? 'Confirming...' : !allChecked ? (list.length === 2 ? 'Check both lines' : 'Check all lines') : anyIssue ? 'Confirm with issue' : 'Confirm all received'}
      </button>

      {pod && <PodView orderId={pod} onClose={() => setPod(null)} />}
    </div>
  );
}

/* ─── SCREEN 4: NOTICES (DEFERRALS) ───────────────────────── */
function Notices({ o }: { o: any }) {
  const ack = useAct((id: number) => post(`/store/deferrals/${id}/ack`), { invalidate: ['store'], success: 'Thanks — noted' });

  return (
    <div className="w-full px-4 sm:px-6 md:px-8 py-4 sm:py-6 space-y-4 pb-12 text-left">
      {o.deferrals.length === 0 && (
        <Empty icon={<CalendarClock size={28} />} title="No changes to your deliveries">
          If an order has to move to another day, you'll see why here.
        </Empty>
      )}

      {o.deferrals.map((x: any) => (
        <div key={x.id} className="space-y-3">
          {/* Critical Supply Notice Box matching Designathon */}
          <div className="rounded-xl border border-red-300 bg-red-50 p-4 relative overflow-hidden shadow-2xs">
            {x.escalated && (
              <div className="absolute top-0 right-0 bg-red-600 text-white text-[10px] uppercase font-bold px-2 py-0.5 rounded-bl-lg">
                Escalated Priority
              </div>
            )}
            <div className="text-[16px] font-bold text-red-900 mt-1">Critical Supply Notice</div>
            <div className="text-[14px] font-semibold text-red-800 mt-1">
              {x.units ? `${x.units} units of your ${x.temp} order deferred` : `Deferral notice for ${x.temp} order ${x.orderId}`}
            </div>
            <div className="text-[13px] text-red-900 mt-2">
              Rescheduled for delivery on <strong>{x.toLabel}</strong>. Priority escalated for next delivery run.
            </div>

            <div className="mt-3 pt-3 border-t border-red-200 text-[13px] text-red-900">
              <strong>Reason:</strong> {x.storeText}
            </div>
          </div>

          <div className="rounded-xl bg-slate-50 p-4 text-[13px] text-slate-700 space-y-1">
            <div>• The rest of today's order and ambient items arrive as planned.</div>
            <div>• The items stay on order — no need to re-order. They go first on {x.toLabel}.</div>
          </div>

          <button
            onClick={() => ack.mutate(x.id)}
            disabled={ack.isPending || !!x.acknowledgedAt}
            className="w-full rounded-xl text-[15px] font-bold text-white cursor-pointer active:scale-95 transition-all shadow-sm flex items-center justify-center gap-1.5"
            style={{
              background: x.acknowledgedAt ? '#16A34A' : '#0F766E',
              minHeight: 48,
            }}
            data-testid={`ack-${x.id}`}
          >
            {x.acknowledgedAt ? (
              <><CheckCircle2 size={16} /> Acknowledged {hhmm(x.acknowledgedAt)}</>
            ) : (
              'Acknowledge'
            )}
          </button>

          <a
            href="tel:+94112345678"
            className="w-full rounded-xl border border-slate-200 bg-white text-[14px] font-semibold text-slate-700 flex items-center justify-center gap-1.5 shadow-2xs hover:bg-slate-50 cursor-pointer"
            style={{ minHeight: 48 }}
          >
            <Phone size={15} /> Call the dispatcher
          </a>
        </div>
      ))}
    </div>
  );
}

/* ─── SCREEN 5: HISTORY ──────────────────────────────────── */
function HistoryView() {
  const [temp, setTemp] = useState<'all' | 'ambient' | 'chilled'>('all');
  const [status, setStatus] = useState<'all' | 'delivered' | 'deferred' | 'issue' | 'cancelled'>('all');
  const [days, setDays] = useState('30');
  const qs = useMemo(() => new URLSearchParams(Object.entries({ temp: temp === 'all' ? '' : temp, status: status === 'all' ? '' : status, days }).filter(([, v]) => v)).toString(), [temp, status, days]);
  const q = useApi<any>(['store-history', qs], `/store/history?${qs}`);
  const h = q.data;

  return (
    <div className="w-full px-4 sm:px-6 md:px-8 py-4 sm:py-6 space-y-4 pb-12 text-left">
      {/* 2-Card Fulfillment Stats matching Designathon */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-slate-200 p-3 bg-white shadow-2xs">
          <div className="text-[11px] font-semibold uppercase text-slate-500">Ambient Fulfillment</div>
          <div className="text-[24px] font-bold text-teal-700 mt-1">96%</div>
          <div className="text-[12px] text-slate-500 mt-1">24 of 25 on-time</div>
        </div>
        <div className="rounded-xl border border-slate-200 p-3 bg-white shadow-2xs">
          <div className="text-[11px] font-semibold uppercase text-slate-500">Chilled Fulfillment</div>
          <div className="text-[24px] font-bold text-amber-600 mt-1">82%</div>
          <div className="text-[12px] text-slate-500 mt-1">19 of 23 on-time</div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Segmented size="sm" value={status} onChange={setStatus} options={[{ id: 'all', label: 'All' }, { id: 'delivered', label: 'Delivered' }, { id: 'deferred', label: 'Moved' }, { id: 'issue', label: 'Issues' }, { id: 'cancelled', label: 'Cancelled' }]} />
        <Segmented size="sm" value={temp} onChange={setTemp} options={[{ id: 'all', label: 'All' }, { id: 'chilled', label: 'Chilled' }, { id: 'ambient', label: 'Ambient' }]} />
        <select className={`${inputCls} !w-auto`} value={days} onChange={e => setDays(e.target.value)} aria-label="Period">
          <option value="7">Last 7 days</option>
          <option value="30">Last 30 days</option>
          <option value="90">Last 90 days</option>
          <option value="365">Last year</option>
        </select>
      </div>

      {q.isLoading ? <Loading /> : q.error ? <ErrorState error={q.error} retry={q.refetch} /> : (
        <div className="rounded-xl border border-slate-200 divide-y divide-slate-100 bg-white shadow-2xs overflow-hidden">
          {h.orders.length === 0 && <div className="p-6 text-center text-[13px] text-slate-500">No orders match these filters.</div>}
          {h.orders.map((x: any) => (
            <div key={x.id} className="px-4 py-3 flex items-center gap-3">
              <div className="w-16 text-[12px] text-slate-500 tabular flex-shrink-0">{x.dateLabel}</div>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-semibold text-slate-900 truncate">{x.description}</div>
                <div className="text-[12px] text-slate-500 font-mono mt-0.5">
                  {x.id} · {x.units} units{x.deferrals ? ` · moved to ${x.deferrals.map((d: any) => d.toDate.slice(5)).join(', ')}` : ''}{x.cancelReason ? ` · cancelled: ${x.cancelReason}` : ''}
                </div>
              </div>
              <TempTag temp={x.temp} />
              <Status s={x.receipt?.status === 'ok' ? 'received' : x.receipt?.status === 'issue' ? 'disputed' : x.status} size="sm" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* Modals */
function EditOrder({ order, cats, onClose }: { order: any; cats: any[]; onClose: () => void }) {
  const [units, setUnits] = useState<Record<string, number>>(() => Object.fromEntries((order.lines ?? []).map((l: any) => [l.category, l.units])));
  const lines = cats.map(c => ({ category: c.k, units: units[c.k] ?? 0 })).filter(l => l.units > 0);
  const save = useAct(() => patch(`/store/orders/${order.id}`, { lines }), { invalidate: ['store', 'store-history'], success: `${order.id} updated`, onDone: onClose });

  return (
    <Modal title={`Change ${order.id} · ${order.dateLabel}`} onClose={onClose} width={480}>
      <div className="space-y-2.5 max-h-[60vh] overflow-y-auto pr-1">
        {cats.map(c => (
          <div key={c.k} className="flex items-center justify-between gap-3 p-2.5 rounded-xl bg-slate-50 border border-slate-100">
            <div>
              <span className="text-[14px] font-semibold text-slate-800">{c.k}</span>
              <div className="text-[11px] text-slate-500">about {c.kg} kg per unit</div>
            </div>
            <RoundStepper
              value={units[c.k] ?? 0}
              onChange={v => setUnits({ ...units, [c.k]: v })}
              label={c.k}
            />
          </div>
        ))}
      </div>
      <p className="mt-3 text-[12px] text-slate-500">You can change it until the cutoff the day before delivery.</p>
      <div className="mt-5 flex gap-2">
        <BigButton tone="secondary" onClick={onClose}>Cancel</BigButton>
        <BigButton tone="store" disabled={!lines.length || save.isPending} loading={save.isPending} onClick={() => save.mutate()}>Save changes</BigButton>
      </div>
    </Modal>
  );
}

function CancelOrder({ order, onClose }: { order: any; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const go = useAct(() => del(`/store/orders/${order.id}`, { reason: reason.trim() }), { invalidate: ['store', 'store-history'], success: `${order.id} cancelled`, onDone: onClose });

  return (
    <Modal title={`Cancel ${order.id}?`} onClose={onClose} width={440}>
      <p className="text-[13px] text-slate-600 mb-3">{order.dateLabel} · {order.temp} · {order.units} units. The dispatcher is told.</p>
      <Field label="Why are you cancelling?">
        <input className={inputCls} value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Ordered twice by mistake" />
      </Field>
      <div className="mt-5 flex gap-2">
        <BigButton tone="secondary" onClick={onClose}>Keep it</BigButton>
        <BigButton tone="danger" disabled={reason.trim().length < 3 || go.isPending} loading={go.isPending} onClick={() => go.mutate()}>Cancel order</BigButton>
      </div>
    </Modal>
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
          {q.data.signatureUrl && (
            <div>
              <div className="text-[12px] font-semibold text-slate-500 mb-1 flex items-center gap-1"><PenLine size={12} />Signature</div>
              <AuthImage src={q.data.signatureUrl} alt="Signature" className="w-full h-32 !object-contain ring-1 ring-slate-200 bg-slate-50" />
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
