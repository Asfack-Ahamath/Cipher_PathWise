import { createContext, useContext, useState, type ElementType } from 'react';
import { NavLink, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { LayoutDashboard, ClipboardList, KanbanSquare, CalendarClock, MapPin, AlertTriangle, BarChart3, Route as RouteIcon, PanelLeftClose, PanelLeftOpen, LogOut, Bell, Clock, X, ChevronRight, RotateCcw, Menu, FlaskConical, Settings2, KeyRound } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Modal, Segmented, Field, inputCls, cx } from '../../components/ds';
import { useAct, useApi, useToast } from '../../components/common';
import { post, put } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { dayLabel, hhmm, syncClock, useNow } from '../../lib/clock';
import Overview from './Overview';
import Orders from './Orders';
import PlanBoard from './PlanBoard';
import Deferrals from './Deferrals';
import Tracking from './Tracking';
import Exceptions from './Exceptions';
import Forecast from './Forecast';
import PeakDay from './PeakDay';
import { useLiveUpdates } from '../../lib/live';
import { LiveDot } from '../../components/common';

export type DepotFilter = 'all' | 'Peliyagoda' | 'Kandy';
const DepotCtx = createContext<DepotFilter>('all');
export const useDepot = () => useContext(DepotCtx);

export default function DispatcherApp() {
  const [depot, setDepot] = useState<DepotFilter>('all');
  const [mobileNav, setMobileNav] = useState(false);
  const live = useLiveUpdates();
  const [clockOpen, setClockOpen] = useState(false);
  const clock = useApi<any>(['clock'], '/clock', { refetchInterval: 60_000 });
  return (
    <DepotCtx.Provider value={depot}>
      <div className="h-[100dvh] flex bg-[#F4F6FA] overflow-hidden">
        <Sidebar mobileOpen={mobileNav} onClose={() => setMobileNav(false)} />
        <div className="flex-1 min-w-0 flex flex-col">
          <TopNav depot={depot} setDepot={setDepot} onMenu={() => setMobileNav(true)} live={live} clockOpen={clockOpen} setClockOpen={setClockOpen} />
          <main className="flex-1 min-h-0 overflow-y-auto flex flex-col">
            <Routes>
              <Route index element={<Overview />} />
              <Route path="orders" element={<Orders />} />
              <Route path="plan" element={<PlanBoard />} />
              <Route path="deferrals" element={<Deferrals />} />
              <Route path="tracking" element={<Tracking />} />
              <Route path="exceptions" element={<Exceptions />} />
              <Route path="forecast" element={<Forecast />} />
              <Route path="peak-day" element={<PeakDay />} />
              <Route path="*" element={<Navigate to="/d" replace />} />
            </Routes>
          </main>
        </div>
      </div>
      {clockOpen && <ClockDialog onClose={() => setClockOpen(false)} planDate={clock.data?.planDate} />}
    </DepotCtx.Provider>
  );
}

function Sidebar({ mobileOpen, onClose }: { mobileOpen: boolean; onClose: () => void }) {
  const { user, signOut } = useAuth();
  const ov = useApi<any>(['overview'], '/overview', { refetchInterval: 20_000 });
  const ex = useApi<any[]>(['exceptions'], '/exceptions', { refetchInterval: 15_000 });
  const openEx = (ex.data ?? []).filter(e => e.status === 'open').length;
  const [open, setOpen] = useState(() => typeof window === 'undefined' || window.innerWidth >= 1280);
  const expanded = open || mobileOpen;
  const show = expanded ? '' : 'hidden';
  const o = ov.data;
  const groups: { label: string; items: { to: string; label: string; icon: ElementType; badge?: number; tone?: 'warn' | 'bad' }[] }[] = [
    { label: 'Plan', items: [
      { to: '/d', label: 'Overview', icon: LayoutDashboard },
      { to: '/d/orders', label: 'Order queue', icon: ClipboardList, badge: o?.orders.confirmed },
      { to: '/d/plan', label: 'Plan board', icon: KanbanSquare },
      { to: '/d/deferrals', label: 'Deferrals', icon: CalendarClock, badge: o?.orders.deferred, tone: 'warn' },
    ] },
    { label: 'Operate', items: [
      { to: '/d/tracking', label: 'Live tracking', icon: MapPin },
      { to: '/d/exceptions', label: 'Exceptions', icon: AlertTriangle, badge: openEx, tone: 'bad' },
    ] },
    { label: 'Look ahead', items: [{ to: '/d/forecast', label: 'Capacity forecast', icon: BarChart3 }, { to: '/d/peak-day', label: 'Peak-day lab', icon: FlaskConical }] },
    ...(user?.role === 'admin' ? [{ label: 'Admin', items: [{ to: '/a', label: 'Administration', icon: Settings2 }] }] : []),
  ];
  const next = o?.nextDay;
  return (
    <>
      {mobileOpen && <div className="lg:hidden fixed inset-0 z-40 bg-slate-900/40" onClick={onClose} />}
      <aside className={cx('z-50 flex-shrink-0 flex-col text-slate-300 transition-[width] duration-200',
        mobileOpen ? 'fixed inset-y-0 left-0 flex w-[260px]' : 'hidden lg:flex relative', !mobileOpen && (open ? 'w-[240px]' : 'w-16'))}
        style={{ background: 'linear-gradient(180deg,#0B1324 0%,#0E1B2E 60%,#0B2A2E 100%)' }}>
        <div className={`group/head h-16 flex items-center gap-3 ${expanded ? 'px-5' : 'px-3.5'}`}>
          {expanded ? (
            <div className="w-9 h-9 rounded-[10px] flex items-center justify-center flex-shrink-0" style={{ background: 'linear-gradient(135deg,#2DD4BF,#0F766E)', boxShadow: '0 8px 20px -8px #14B8A6' }}><RouteIcon size={18} className="text-white" /></div>
          ) : (
            <button onClick={() => setOpen(true)} title="Expand sidebar" aria-label="Expand sidebar" className="w-9 h-9 rounded-[10px] flex items-center justify-center flex-shrink-0 bg-white/10 text-white hover:bg-white/20"><PanelLeftOpen size={18} /></button>
          )}
          {expanded && <div className="leading-tight flex-1 min-w-0">
            <div className="text-[16px] font-semibold text-white tracking-[-0.01em]">PathWise</div>
            <div className="text-[11px] text-slate-400">Waypoint Group</div>
          </div>}
          {expanded && !mobileOpen && <button onClick={() => setOpen(false)} title="Collapse sidebar" aria-label="Collapse sidebar" className="w-8 h-8 -mr-1 rounded-lg flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/10 opacity-0 group-hover/head:opacity-100 focus-visible:opacity-100 transition-opacity"><PanelLeftClose size={17} /></button>}
          {mobileOpen && <button onClick={onClose} aria-label="Close menu" className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-white"><X size={17} /></button>}
        </div>
        <nav className={`flex-1 overflow-y-auto ${expanded ? 'px-3' : 'px-2.5'} py-3 space-y-6`} aria-label="Dispatcher">
          {groups.map(g => (
            <div key={g.label}>
              <div className={`${show} px-3 mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500`}>{g.label}</div>
              <div className="space-y-1">
                {g.items.map(({ to, label, icon: Icon, badge, tone }) => (
                  <NavLink key={to} to={to} end={to === '/d'} onClick={onClose} title={label}
                    className={({ isActive }) => `relative w-full h-10 flex items-center ${expanded ? 'justify-start' : 'justify-center'} gap-3 px-3 rounded-lg text-left transition-all ${isActive ? 'text-white pw-active' : 'text-slate-400 hover:text-white hover:bg-white/5'}`}
                    style={({ isActive }) => isActive ? { background: 'linear-gradient(90deg,rgba(45,212,191,.22),rgba(45,212,191,.04))', boxShadow: 'inset 0 0 0 1px rgba(45,212,191,.25)' } : undefined}>
                    {({ isActive }) => <>
                      <Icon size={18} className={isActive ? 'text-teal-300' : ''} />
                      {expanded && <span className="flex-1 text-[13px] font-medium">{label}</span>}
                      {!!badge && badge > 0 && expanded && (
                        <span className={`inline-flex h-5 min-w-[22px] px-1.5 items-center justify-center rounded-full text-[11px] font-semibold tabular ${tone === 'bad' ? 'bg-rose-500 text-white' : tone === 'warn' ? 'bg-amber-400 text-slate-900' : 'bg-white/10 text-slate-200'}`}>{badge}</span>
                      )}
                      {!!badge && badge > 0 && tone && !expanded && <span className={`absolute top-2 right-2 w-2 h-2 rounded-full ${tone === 'bad' ? 'bg-rose-500' : 'bg-amber-400'}`} />}
                    </>}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>
        <div className={expanded ? 'p-4' : 'p-3'}>
          {next?.holiday && (
            <div className={`${show} rounded-xl p-3.5 mb-3`} style={{ background: 'linear-gradient(135deg,rgba(99,102,241,.25),rgba(45,212,191,.18))', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.08)' }}>
              <div className="text-[12px] font-semibold text-white">{next.holiday.replace(' Full Moon Poya', '')} on {dayLabel(next.date)}</div>
              <div className="text-[12px] text-slate-300 mt-0.5 leading-4">Not an operating day. Today's deferrals go to the next run.</div>
            </div>
          )}
          <div className={`flex items-center ${expanded ? 'justify-start' : 'justify-center'} gap-3`}>
            <div className="w-9 h-9 rounded-full flex items-center justify-center text-white text-[12px] font-semibold flex-shrink-0" style={{ background: 'linear-gradient(135deg,#818CF8,#4F46E5)' }}>{user?.name.split(' ').map(s => s[0]).join('')}</div>
            <div className={`${show} min-w-0 flex-1`}>
              <div className="text-[13px] font-semibold text-white truncate">{user?.name}</div>
              <div className="text-[12px] text-slate-400">{user?.role === 'admin' ? 'Administrator' : 'Dispatcher'} · both depots</div>
            </div>
            <NavLink to="/account" className={`${expanded ? 'flex' : 'hidden'} text-slate-500 hover:text-white`} aria-label="Account and password" title="Account and password"><KeyRound size={16} /></NavLink>
            <button onClick={() => void signOut()} className={`${expanded ? 'flex' : 'hidden'} text-slate-500 hover:text-white`} aria-label="Sign out" title="Sign out"><LogOut size={16} /></button>
          </div>
        </div>
      </aside>
    </>
  );
}

function TopNav({ depot, setDepot, onMenu, live, clockOpen, setClockOpen }: { depot: DepotFilter; setDepot: (d: DepotFilter) => void; onMenu: () => void; live: 'connecting' | 'live' | 'offline'; clockOpen: boolean; setClockOpen: (v: boolean) => void }) {
  const nav = useNavigate();
  const now = useNow(15_000);
  const [open, setOpen] = useState(false);
  const clock = useApi<any>(['clock'], '/clock', { refetchInterval: 60_000 });
  const notes = useApi<any>(['notifications'], '/notifications', { refetchInterval: 15_000 });
  const ex = useApi<any[]>(['exceptions'], '/exceptions', { refetchInterval: 15_000 });
  const openEx = (ex.data ?? []).filter(e => e.status === 'open');
  const markRead = useAct(() => post('/notifications/read', {}), { invalidate: ['notifications'] });
  const unread = notes.data?.unread ?? 0;
  const TONE: Record<string, [string, string]> = { grey: ['#F1F5F9', '#475569'], green: ['#ECFDF5', '#047857'], amber: ['#FFFBEB', '#B45309'], blue: ['#EEF2FF', '#4338CA'], red: ['#FEF2F2', '#B91C1C'], violet: ['#F5F3FF', '#6D28D9'] };
  return (
    <header className="relative z-30 h-16 flex-shrink-0 flex items-center justify-between gap-3 px-4 lg:px-6 bg-white/85 backdrop-blur border-b border-[#E6E9F0]">
      <div className="flex items-center gap-3 min-w-0">
        <button className="lg:hidden w-9 h-9 flex items-center justify-center rounded-md hover:bg-slate-100" onClick={onMenu} aria-label="Open menu"><Menu size={18} /></button>
        <div className="hidden sm:block"><Segmented size="sm" value={depot} onChange={setDepot} options={[{ id: 'all', label: 'All depots' }, { id: 'Peliyagoda', label: 'Peliyagoda' }, { id: 'Kandy', label: 'Kandy' }]} /></div>
        <div className="hidden xl:flex items-center gap-2 text-[13px] text-slate-500 min-w-0 truncate">
          <span>Delivery day</span><span className="font-semibold text-slate-900">{clock.data?.planDateLabel ?? '…'}</span>
          <span className="text-slate-300">·</span><span className="truncate">orders closed 16:00 the day before</span>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <LiveDot state={live} />
        <button onClick={(e) => { e.stopPropagation(); clock.data?.demoMode !== false && setClockOpen(true); }} disabled={clock.data?.demoMode === false} title={clock.data?.demoMode === false ? 'Business time' : 'Demo clock — change the business time'} className="flex flex-shrink-0 whitespace-nowrap items-center gap-1.5 h-8 px-3 rounded-full text-[12px] font-semibold text-slate-700 tabular bg-slate-100 hover:bg-slate-200"><Clock size={13} className="text-slate-500" /><span className="hidden sm:inline">{dayLabel(now)} ·</span>{hhmm(now)}</button>
        <button onClick={() => setOpen(!open)} className="relative w-9 h-9 flex items-center justify-center rounded-md hover:bg-slate-100" aria-label={`Notifications, ${unread + openEx.length} to read`}>
          <Bell size={17} className="text-slate-500" />
          {unread + openEx.length > 0 && <span className="absolute top-1 right-1 min-w-[16px] h-4 px-1 rounded-full text-[10px] font-bold text-white flex items-center justify-center tabular bg-red-600 ring-2 ring-white">{openEx.length || unread}</span>}
        </button>
      </div>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-4 top-[60px] z-40 w-[400px] max-w-[calc(100vw-32px)] bg-white border border-[#E4E7EC] rounded-xl shadow-[0_16px_40px_-12px_rgba(15,23,42,.25)] overflow-hidden">
            <div className="flex items-center justify-between px-4 h-12 border-b border-[#E4E7EC]">
              <span className="text-[14px] font-semibold text-slate-900">Notifications</span>
              <div className="flex items-center gap-2">
                {unread > 0 && <button className="text-[12px] font-semibold text-teal-700" onClick={() => markRead.mutate()}>Mark all read</button>}
                <button onClick={() => setOpen(false)} aria-label="Close"><X size={16} className="text-slate-400" /></button>
              </div>
            </div>
            <div className="px-4 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500">Needs a decision · {openEx.length}</div>
            {openEx.length === 0 && <div className="px-4 py-3 text-[13px] text-slate-500">Nothing needs you right now.</div>}
            <div className="max-h-[220px] overflow-y-auto">
              {openEx.map(n => (
                <button key={n.id} onClick={() => { setOpen(false); nav(`/d/exceptions?id=${n.id}`); }} className="w-full text-left px-4 py-3 border-b border-[#EEF0F3] last:border-0 hover:bg-slate-50 flex gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2"><span className="text-[13px] font-semibold text-slate-900 truncate">{n.title}</span><span className="text-[12px] tabular text-slate-400 flex-shrink-0">{hhmm(n.raisedAt)}</span></div>
                    <div className="text-[12px] text-slate-500 mt-0.5">{n.raisedBy ? `Raised by ${n.raisedBy}` : ''}</div>
                  </div>
                  <ChevronRight size={14} className="text-slate-300 mt-1" />
                </button>
              ))}
            </div>
            <div className="px-4 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500 border-t border-[#EEF0F3]">Updates</div>
            <div className="max-h-[320px] overflow-y-auto pb-2">
              {(notes.data?.items ?? []).length === 0 && <div className="px-4 py-3 text-[13px] text-slate-500">No updates yet.</div>}
              {(notes.data?.items ?? []).map((u: any) => {
                const t = TONE[u.tone] ?? TONE.grey;
                return (
                  <button key={u.id} onClick={() => { if (u.link) { setOpen(false); nav(u.link); } }} className="w-full text-left px-4 py-2.5 flex gap-3 hover:bg-slate-50">
                    <span className="w-2 h-2 rounded-full mt-1.5 flex-shrink-0" style={{ background: u.read ? '#CBD5E1' : t[1] }} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2"><span className={cx('text-[13px] truncate', u.read ? 'text-slate-600' : 'font-semibold text-slate-900')}>{u.title}</span><span className="text-[12px] tabular text-slate-400 flex-shrink-0">{hhmm(u.createdAt)}</span></div>
                      <div className="text-[12px] text-slate-500 mt-0.5">{u.body}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}
    </header>
  );
}

/** Demo control: judges can jump the business clock (e.g. to 05:55 to move a stop while the driver is offline). */
function ClockDialog({ onClose, planDate }: { onClose: () => void; planDate?: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const now = useNow();
  const [date, setDate] = useState(planDate ?? '2026-04-30');
  const [time, setTime] = useState(hhmm(now));
  const [confirmReset, setConfirmReset] = useState(false);
  const set = useAct((at: string) => put('/clock', { at }), { onDone: async () => { await syncClock(); qc.invalidateQueries(); onClose(); }, success: 'Clock changed' });
  const reset = useAct(() => post('/demo/reset'), { onDone: async () => { await syncClock(); qc.invalidateQueries(); toast('success', 'Demo day reset to Thu 30 Apr, 02:30'); onClose(); } });
  const presets: [string, string][] = [['02:30', 'Planning'], ['03:10', 'Loading'], ['04:55', 'On the road'], ['05:35', 'Delay reported'], ['05:55', 'Move a stop'], ['06:51', 'Back online'], ['08:30', 'Receipts']];
  return (
    <Modal title="Demo clock" onClose={onClose} width={460}>
      <p className="text-[13px] text-slate-600 -mt-1 mb-4">PathWise runs on a business clock so the demo day can be replayed. It keeps moving in real time from the time you set. Every screen and phone follows it.</p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Date"><input type="date" className={inputCls} value={date} onChange={e => setDate(e.target.value)} /></Field>
        <Field label="Time (Sri Lanka)"><input type="time" className={inputCls} value={time} onChange={e => setTime(e.target.value)} /></Field>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {presets.map(([t, l]) => <button key={t} onClick={() => setTime(t)} className={cx('h-7 px-2.5 rounded-full text-[12px] font-semibold ring-1', time === t ? 'bg-teal-50 text-teal-800 ring-teal-300' : 'bg-white text-slate-600 ring-[#E4E7EC] hover:bg-slate-50')}>{t} · {l}</button>)}
      </div>
      <div className="mt-6 flex items-center justify-between gap-2">
        {confirmReset
          ? <Button variant="danger" icon={<RotateCcw size={14} />} disabled={reset.isPending} onClick={() => reset.mutate()}>Confirm reset</Button>
          : <Button variant="ghost" icon={<RotateCcw size={14} />} onClick={() => setConfirmReset(true)}>Reset demo day</Button>}
        <div className="flex gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={set.isPending} onClick={() => set.mutate(`${date}T${time}:00+05:30`)}>Set clock</Button>
        </div>
      </div>
      {confirmReset && <p className="mt-3 text-[12px] text-red-700">Reset clears today's plan, loading, deliveries and receipts, and puts the clock back to 02:30.</p>}
    </Modal>
  );
}
