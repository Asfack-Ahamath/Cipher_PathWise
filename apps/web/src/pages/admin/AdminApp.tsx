import { useEffect, useRef, useState, type ElementType, type ReactNode } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { Activity, Bell, CalendarDays, ChevronDown, ChevronRight, Clock, Database, KeyRound, LogOut, Megaphone, Menu, ScrollText, Settings2, SlidersHorizontal, Store, Truck, Users as UsersIcon, X, ArrowLeftRight, Route as RouteIcon, PanelLeftClose, PanelLeftOpen, LayoutDashboard } from 'lucide-react';
import { cx } from '../../components/ds';
import { LiveDot, useAct, useApi } from '../../components/common';
import { useAuth } from '../../lib/auth';
import { post } from '../../lib/api';
import { SignOutDialog } from '../../components/FieldShell';
import { useLiveUpdates } from '../../lib/live';
import { businessNow, hhmm } from '../../lib/clock';
import Overview from './Overview';
import Users from './Users';
import Announcements from './Announcements';
import Fleet from './Fleet';
import Outlets from './Outlets';
import Settings from './Settings';
import Data from './Data';
import Audit from './Audit';
import System from './System';

type Item = { to: string; label: string; icon: ElementType; end?: boolean };
const GROUPS: { label: string; items: Item[] }[] = [
  { label: 'Home', items: [{ to: '/a', label: 'Overview', icon: LayoutDashboard, end: true }] },
  { label: 'People', items: [{ to: '/a/people', label: 'People & access', icon: UsersIcon }, { to: '/a/announcements', label: 'Announcements', icon: Megaphone }] },
  { label: 'Operations', items: [{ to: '/a/fleet', label: 'Fleet', icon: Truck }, { to: '/a/outlets', label: 'Outlets', icon: Store }, { to: '/a/settings', label: 'Rules & settings', icon: SlidersHorizontal }] },
  { label: 'Platform', items: [{ to: '/a/data', label: 'Data & imports', icon: Database }, { to: '/a/audit', label: 'Audit log', icon: ScrollText }, { to: '/a/system', label: 'System health', icon: Activity }] },
];
const ALL = GROUPS.flatMap(g => g.items.map(i => ({ ...i, group: g.label })));
const initials = (n?: string) => (n ?? '').split(' ').map(s => s[0]).join('').slice(0, 2).toUpperCase();

/** Administration: people and access, fleet and outlets, planning rules, data imports, audit and health. */
export default function AdminApp() {
  const [signOutOpen, setSignOutOpen] = useState(false);
  const live = useLiveUpdates();
  const [menu, setMenu] = useState(false);
  const [open, setOpen] = useState(() => typeof window === 'undefined' || window.innerWidth >= 1280);
  const loc = useLocation();
  useEffect(() => setMenu(false), [loc.pathname]);
  return (
    <div className="admin-shell app-shell pw-zoom flex bg-[#F4F6FA] overflow-hidden">
      <SignOutDialog open={signOutOpen} onClose={() => setSignOutOpen(false)} />
      {menu && <div className="lg:hidden fixed inset-0 z-40 bg-slate-900/50 backdrop-blur-[2px] anim-fade-in" onClick={() => setMenu(false)} />}
      <Sidebar open={open} setOpen={setOpen} mobile={menu} closeMobile={() => setMenu(false)} />
      <div className="relative flex-1 min-w-0 flex flex-col">
        <TopBar live={live} onMenu={() => setMenu(true)} onSignOut={() => setSignOutOpen(true)} />
        <main className="flex-1 min-h-0 overflow-y-auto pt-16">
          <Routes>
            <Route index element={<Overview />} />
            <Route path="people" element={<Users />} />
            <Route path="announcements" element={<Announcements />} />
            <Route path="fleet" element={<Fleet />} />
            <Route path="outlets" element={<Outlets />} />
            <Route path="settings" element={<Settings />} />
            <Route path="data" element={<Data />} />
            <Route path="audit" element={<Audit />} />
            <Route path="system" element={<System />} />
            <Route path="*" element={<Navigate to="/a" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}

function Sidebar({ open, setOpen, mobile, closeMobile }: { open: boolean; setOpen: (v: boolean) => void; mobile: boolean; closeMobile: () => void }) {
  const expanded = open || mobile;
  return (
    <aside className={cx('z-50 flex-shrink-0 flex-col text-slate-300 transition-[width] duration-200', mobile ? 'fixed inset-y-0 left-0 flex w-[272px] max-w-[85vw] anim-slide' : cx('hidden lg:flex relative', open ? 'w-[248px]' : 'w-[68px]'))}
      style={{ background: 'linear-gradient(180deg,#0B1324 0%,#0F1730 55%,#151B44 100%)' }}>
      <div className={cx('group/head h-16 flex items-center gap-3 border-b border-white/[.06]', expanded ? 'px-4' : 'px-4 justify-center')}>
        {expanded ? (
          <div className="w-9 h-9 rounded-[10px] flex items-center justify-center flex-shrink-0 shadow-[0_8px_20px_-8px_#6366F1]" style={{ background: 'linear-gradient(135deg,#A5B4FC,#4F46E5)' }}><Settings2 size={18} className="text-white" /></div>
        ) : (
          <button onClick={() => setOpen(true)} title="Expand sidebar" aria-label="Expand sidebar" className="relative w-9 h-9 rounded-[10px] flex items-center justify-center flex-shrink-0 text-white overflow-hidden group/exp shadow-[0_8px_20px_-8px_#6366F1]" style={{ background: 'linear-gradient(135deg,#A5B4FC,#4F46E5)' }}><span className="transition duration-150 group-hover/head:opacity-0 group-hover/head:scale-75 group-focus-visible/exp:opacity-0"><Settings2 size={18} className="text-white" /></span><span className="absolute inset-0 flex items-center justify-center bg-white/20 opacity-0 scale-75 transition duration-150 group-hover/head:opacity-100 group-hover/head:scale-100 group-focus-visible/exp:opacity-100"><PanelLeftOpen size={18} /></span></button>
        )}
        {expanded && <div className="leading-tight flex-1 min-w-0"><div className="text-[15px] font-semibold text-white tracking-[-0.01em]">Administration</div><div className="text-[11px] text-slate-400">PathWise · Waypoint Group</div></div>}
        {expanded && !mobile && <button onClick={() => setOpen(false)} title="Collapse sidebar" aria-label="Collapse sidebar" className="w-8 h-8 -mr-1 rounded-lg flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/10 opacity-0 group-hover/head:opacity-100 focus-visible:opacity-100 transition-opacity"><PanelLeftClose size={17} /></button>}
        {mobile && <button onClick={closeMobile} aria-label="Close menu" className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/10"><X size={17} /></button>}
      </div>
      <nav className={cx('flex-1 overflow-y-auto py-4 space-y-5', expanded ? 'px-3' : 'px-2.5')} aria-label="Administration">
        {GROUPS.map(g => (
          <div key={g.label}>
            {expanded ? <div className="px-3 mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-slate-500">{g.label}</div> : <div className="mx-3 mb-2 h-px bg-white/[.06]" />}
            <div className="space-y-0.5">
              {g.items.map(({ to, label, icon: Icon, end }) => (
                <NavLink key={to} to={to} end={end} title={label}
                  className={({ isActive }) => cx('relative h-10 flex items-center gap-3 px-3 rounded-lg text-[13px] transition-colors', expanded ? 'justify-start' : 'justify-center', isActive ? 'text-white font-semibold' : 'font-medium text-slate-400 hover:text-white hover:bg-white/5')}
                  style={({ isActive }) => isActive ? { background: 'linear-gradient(90deg,rgba(129,140,248,.32),rgba(129,140,248,.08))', boxShadow: 'inset 0 0 0 1px rgba(165,180,252,.35)' } : undefined}>
                  {({ isActive }) => <>
                    {isActive && <span aria-hidden className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r-full bg-indigo-300" />}
                    <Icon size={17} className={cx('flex-shrink-0', isActive && 'text-indigo-200')} />{expanded && <span className="truncate">{label}</span>}
                  </>}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
        <div className="pt-1">
          {expanded ? <div className="px-3 mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-slate-500">Switch</div> : <div className="mx-3 mb-2 h-px bg-white/[.06]" />}
          <NavLink to="/d" title="Operations (dispatcher)" className={cx('h-10 flex items-center gap-3 px-3 rounded-lg text-[13px] font-medium text-slate-400 hover:text-white hover:bg-white/5', expanded ? 'justify-start' : 'justify-center')}><RouteIcon size={17} className="flex-shrink-0" />{expanded && <span className="flex-1 truncate">Operations</span>}{expanded && <ArrowLeftRight size={13} className="text-slate-500" />}</NavLink>
        </div>
      </nav>
    </aside>
  );
}

/** Ticks every second; the business clock can differ from the device clock in demo mode. */
function useSecondClock() {
  const [now, setNow] = useState(businessNow);
  useEffect(() => { const id = setInterval(() => setNow(businessNow()), 1000); return () => clearInterval(id); }, []);
  return now;
}
const TZ = 'Asia/Colombo';
const longDate = (d: Date) => d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: TZ });
const shortDate = (d: Date) => d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: TZ });
const hms = (d: Date) => d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: TZ });

function TopBar({ live, onMenu, onSignOut }: { live: 'connecting' | 'live' | 'offline'; onMenu: () => void; onSignOut: () => void }) {
  const loc = useLocation();
  const nav = useNavigate();
  const { user } = useAuth();
  const now = useSecondClock();
  const clock = useApi<any>(['clock'], '/clock', { refetchInterval: 60_000 });
  const notes = useApi<any>(['notifications'], '/notifications', { refetchInterval: 20_000 });
  const markRead = useAct(() => post('/notifications/read', {}), { invalidate: ['notifications'] });
  const [panel, setPanel] = useState<'bell' | 'user' | null>(null);
  useEffect(() => setPanel(null), [loc.pathname]);
  // close on any click outside the open panel, or on Escape (the header's blur makes a full-screen overlay unreliable)
  const bellRef = useRef<HTMLDivElement>(null), userRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!panel) return;
    const box = panel === 'bell' ? bellRef : userRef;
    const down = (e: Event) => { if (!box.current?.contains(e.target as Node)) setPanel(null); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setPanel(null); };
    document.addEventListener('mousedown', down); document.addEventListener('touchstart', down); document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('touchstart', down); document.removeEventListener('keydown', key); };
  }, [panel]);
  const page = [...ALL].sort((a, b) => b.to.length - a.to.length).find(i => (i.end ? loc.pathname === i.to || loc.pathname === `${i.to}/` : loc.pathname.startsWith(i.to))) ?? ALL[0];
  const unread = notes.data?.unread ?? 0;
  const TONE: Record<string, string> = { grey: '#64748B', green: '#047857', amber: '#B45309', blue: '#4338CA', red: '#B91C1C', violet: '#6D28D9' };
  return (
    <header className="absolute inset-x-0 top-0 z-30 h-16 flex items-center justify-between gap-3 px-3 sm:px-5 lg:px-8 glass-bar">
      <div className="flex items-center gap-2.5 min-w-0">
        <button className="lg:hidden w-9 h-9 flex-shrink-0 flex items-center justify-center rounded-lg hover:bg-slate-900/5" onClick={onMenu} aria-label="Open menu"><Menu size={19} /></button>
        <div className="min-w-0">
          <div className="hidden sm:flex items-center gap-1 text-[11px] font-medium text-slate-400"><span>Administration</span><ChevronRight size={11} /><span>{page.group}</span></div>
          <div className="text-[15px] sm:text-[16px] font-semibold text-slate-900 tracking-[-0.01em] truncate leading-tight">{page.label}</div>
        </div>
      </div>
      <div className="flex items-center gap-1.5 sm:gap-2">
        <div className="hidden md:flex items-center h-9 rounded-full bg-white/80 ring-1 ring-slate-900/[.08] text-[12px] text-slate-600 overflow-hidden" title={clock.data?.demoMode === false ? 'Sri Lanka time' : 'Business time (demo clock)'}>
          <span className="hidden xl:flex items-center gap-1.5 px-3 h-full border-r border-slate-900/[.06]"><CalendarDays size={13} className="text-indigo-500" />{longDate(now)}</span>
          <span className="flex xl:hidden items-center gap-1.5 px-3 h-full border-r border-slate-900/[.06]"><CalendarDays size={13} className="text-indigo-500" />{shortDate(now)}</span>
          <span className="flex items-center gap-1.5 px-3 h-full font-semibold text-slate-800 tabular"><Clock size={13} className="text-indigo-500" />{hms(now)}</span>
          {clock.data?.planDateLabel && <span className="hidden 2xl:flex items-center px-3 h-full bg-indigo-50/70 text-indigo-800 font-medium border-l border-slate-900/[.06]">Delivery day {clock.data.planDateLabel}</span>}
        </div>
        <span className="md:hidden h-8 px-2.5 inline-flex items-center gap-1 rounded-full bg-white/80 ring-1 ring-slate-900/[.08] text-[12px] font-semibold text-slate-800 tabular"><Clock size={12} className="text-indigo-500" />{hhmm(now)}</span>
        <div className="hidden sm:block"><LiveDot state={live} /></div>
        <div className="relative" ref={bellRef}>
          <button onClick={() => setPanel(panel === 'bell' ? null : 'bell')} className={cx('relative w-9 h-9 flex items-center justify-center rounded-lg transition-colors', panel === 'bell' ? 'bg-slate-900/[.06]' : 'hover:bg-slate-900/5')} aria-label={`Notifications, ${unread} unread`} aria-expanded={panel === 'bell'}>
            <Bell size={17} className="text-slate-600" />
            {unread > 0 && <span className="absolute top-1 right-1 min-w-[16px] h-4 px-1 rounded-full text-[10px] font-bold text-white flex items-center justify-center tabular bg-red-600 ring-2 ring-white">{unread > 99 ? '99+' : unread}</span>}
          </button>
          {panel === 'bell' && <>
            <div className="absolute right-0 top-11 z-40 w-[380px] max-w-[calc(100vw-24px)] bg-white border border-[#E4E7EC] rounded-xl shadow-[0_16px_40px_-12px_rgba(15,23,42,.25)] overflow-hidden anim-menu">
              <div className="flex items-center justify-between px-4 h-12 border-b border-[#E4E7EC]">
                <span className="text-[14px] font-semibold text-slate-900">Notifications</span>
                {unread > 0 && <button className="text-[12px] font-semibold text-indigo-700 hover:text-indigo-900" onClick={() => markRead.mutate()}>Mark all read</button>}
              </div>
              <div className="max-h-[400px] overflow-y-auto py-1">
                {(notes.data?.items ?? []).length === 0 && <div className="px-4 py-8 text-center text-[13px] text-slate-500">You're all caught up.</div>}
                {(notes.data?.items ?? []).slice(0, 30).map((n: any) => (
                  <button key={n.id} onClick={() => { if (n.link) nav(n.link); }} className="w-full text-left px-4 py-2.5 flex gap-3 hover:bg-slate-50">
                    <span className="w-2 h-2 rounded-full mt-1.5 flex-shrink-0" style={{ background: n.read ? '#CBD5E1' : TONE[n.tone] ?? TONE.grey }} />
                    <span className="flex-1 min-w-0">
                      <span className="flex items-center justify-between gap-2"><span className={cx('text-[13px] truncate', n.read ? 'text-slate-600' : 'font-semibold text-slate-900')}>{n.title}</span><span className="text-[11px] tabular text-slate-400 flex-shrink-0">{shortDate(new Date(n.createdAt))} {hhmm(n.createdAt)}</span></span>
                      {n.body && <span className="block text-[12px] text-slate-500 mt-0.5 line-clamp-2">{n.body}</span>}
                    </span>
                  </button>
                ))}
              </div>
              <button onClick={() => nav('/a/announcements')} className="w-full h-11 border-t border-[#EEF0F3] text-[12px] font-semibold text-indigo-700 hover:bg-indigo-50/50 flex items-center justify-center gap-1.5"><Megaphone size={13} />Send an announcement</button>
            </div>
          </>}
        </div>
        <div className="relative" ref={userRef}>
          <button onClick={() => setPanel(panel === 'user' ? null : 'user')} className={cx('h-10 flex items-center gap-2 pl-1 pr-1 sm:pr-2.5 rounded-full transition-colors', panel === 'user' ? 'bg-slate-900/[.06]' : 'hover:bg-slate-900/5')} aria-label="Account menu" aria-expanded={panel === 'user'}>
            <span className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[11px] font-semibold" style={{ background: 'linear-gradient(135deg,#818CF8,#4F46E5)' }}>{initials(user?.name)}</span>
            <span className="hidden md:block text-left leading-tight max-w-[200px]"><span className="block text-[13px] font-semibold text-slate-900 truncate">{user?.name}</span><span className="block text-[11px] text-slate-500">Administrator</span></span>
            <ChevronDown size={14} className={cx('hidden sm:block text-slate-500 transition-transform', panel === 'user' && 'rotate-180')} />
          </button>
          {panel === 'user' && <>
            <div className="absolute right-0 top-11 z-40 w-[260px] bg-white border border-[#E4E7EC] rounded-xl shadow-[0_16px_40px_-12px_rgba(15,23,42,.25)] overflow-hidden anim-menu">
              <div className="px-4 py-3 border-b border-[#EEF0F3]"><div className="text-[13px] font-semibold text-slate-900 truncate">{user?.name}</div><div className="text-[12px] text-slate-500 truncate">{user?.email}</div><span className="mt-1.5 inline-flex h-5 px-2 items-center rounded-full bg-indigo-50 text-indigo-800 text-[11px] font-semibold">Administrator</span></div>
              <div className="p-1.5">
                <MenuItem icon={<KeyRound size={15} />} onClick={() => nav('/account')}>Account and password</MenuItem>
                <MenuItem icon={<ArrowLeftRight size={15} />} onClick={() => nav('/d')}>Switch to operations</MenuItem>
                <MenuItem icon={<Activity size={15} />} onClick={() => nav('/a/system')}>System health</MenuItem>
              </div>
              <div className="p-1.5 border-t border-[#EEF0F3]"><MenuItem icon={<LogOut size={15} />} danger onClick={() => { setPanel(null); onSignOut(); }}>Sign out</MenuItem></div>
            </div>
          </>}
        </div>
      </div>
    </header>
  );
}

function MenuItem({ icon, children, onClick, danger }: { icon: ReactNode; children: ReactNode; onClick: () => void; danger?: boolean }) {
  return <button onClick={onClick} className={cx('w-full h-9 px-2.5 flex items-center gap-2.5 rounded-md text-[13px] font-medium', danger ? 'text-red-700 hover:bg-red-50' : 'text-slate-700 hover:bg-slate-50')}><span className={danger ? 'text-red-600' : 'text-slate-400'}>{icon}</span>{children}</button>;
}

/** Page frame shared by the admin screens: title row that stacks on small screens, and consistent gutters. */
export function AdminPage({ title, subtitle, actions, children }: { title: string; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <div className="mx-auto max-w-[1320px] min-[1700px]:max-w-[1520px] min-[2300px]:max-w-[1760px] px-4 sm:px-6 lg:px-8 py-5 sm:py-7 anim-page">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 mb-5 sm:mb-6">
        <div className="min-w-0"><h1 className="text-[20px] sm:text-[22px] font-semibold tracking-[-0.02em] text-slate-900">{title}</h1>{subtitle && <p className="text-[13px] text-slate-500 mt-1 max-w-[720px] leading-5">{subtitle}</p>}</div>
        {actions && <div className="flex flex-wrap gap-2 sm:justify-end [&>*]:flex-1 sm:[&>*]:flex-none">{actions}</div>}
      </div>
      {children}
    </div>
  );
}

/** Filter row: full-width controls on phones, a wrapping row from tablet up. */
export function FilterBar({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 sm:flex sm:flex-wrap sm:items-center gap-2 mb-4">{children}</div>;
}
