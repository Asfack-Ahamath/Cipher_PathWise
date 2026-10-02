import { useState, type ElementType } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { Activity, Database, KeyRound, LogOut, Menu, ScrollText, Settings2, SlidersHorizontal, Store, Truck, Users as UsersIcon, X, ArrowLeftRight, Route as RouteIcon } from 'lucide-react';
import { cx } from '../../components/ds';
import { LiveDot } from '../../components/common';
import { useAuth } from '../../lib/auth';
import { useLiveUpdates } from '../../lib/live';
import Users from './Users';
import Fleet from './Fleet';
import Outlets from './Outlets';
import Settings from './Settings';
import Data from './Data';
import Audit from './Audit';
import System from './System';

const NAV: { to: string; label: string; icon: ElementType; end?: boolean }[] = [
  { to: '/a', label: 'People', icon: UsersIcon, end: true },
  { to: '/a/fleet', label: 'Fleet', icon: Truck },
  { to: '/a/outlets', label: 'Outlets', icon: Store },
  { to: '/a/settings', label: 'Rules & settings', icon: SlidersHorizontal },
  { to: '/a/data', label: 'Data & imports', icon: Database },
  { to: '/a/audit', label: 'Audit log', icon: ScrollText },
  { to: '/a/system', label: 'System health', icon: Activity },
];

/** Administration: people and access, fleet and outlets, planning rules, data imports, audit and health. */
export default function AdminApp() {
  const { user, signOut } = useAuth();
  const live = useLiveUpdates();
  const [menu, setMenu] = useState(false);
  return (
    <div className="h-[100dvh] flex bg-[#F4F6FA] overflow-hidden">
      {menu && <div className="lg:hidden fixed inset-0 z-40 bg-slate-900/40" onClick={() => setMenu(false)} />}
      <aside className={cx('z-50 w-[240px] flex-shrink-0 flex-col text-slate-300', menu ? 'fixed inset-y-0 left-0 flex' : 'hidden lg:flex')} style={{ background: 'linear-gradient(180deg,#0B1324 0%,#111A3A 100%)' }}>
        <div className="h-16 flex items-center gap-3 px-5">
          <div className="w-9 h-9 rounded-[10px] flex items-center justify-center" style={{ background: 'linear-gradient(135deg,#A5B4FC,#4F46E5)' }}><Settings2 size={18} className="text-white" /></div>
          <div className="leading-tight flex-1"><div className="text-[16px] font-semibold text-white">Administration</div><div className="text-[11px] text-slate-400">PathWise · Waypoint Group</div></div>
          {menu && <button onClick={() => setMenu(false)} aria-label="Close menu" className="text-slate-400"><X size={17} /></button>}
        </div>
        <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-1" aria-label="Administration">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} onClick={() => setMenu(false)}
              className={({ isActive }) => cx('h-10 flex items-center gap-3 px-3 rounded-lg text-[13px] font-medium', isActive ? 'text-white bg-white/10 ring-1 ring-white/15' : 'text-slate-400 hover:text-white hover:bg-white/5')}>
              <Icon size={17} />{label}
            </NavLink>
          ))}
          <div className="pt-4 mt-4 border-t border-white/10">
            <NavLink to="/d" className="h-10 flex items-center gap-3 px-3 rounded-lg text-[13px] font-medium text-slate-400 hover:text-white hover:bg-white/5"><RouteIcon size={17} />Operations (dispatcher)</NavLink>
          </div>
        </nav>
        <div className="p-4 flex items-center gap-3">
          <div className="w-9 h-9 rounded-full flex items-center justify-center text-white text-[12px] font-semibold" style={{ background: 'linear-gradient(135deg,#818CF8,#4F46E5)' }}>{user?.name.split(' ').map(s => s[0]).join('').slice(0, 2)}</div>
          <div className="min-w-0 flex-1"><div className="text-[13px] font-semibold text-white truncate">{user?.name}</div><div className="text-[12px] text-slate-400 truncate">{user?.email}</div></div>
          <NavLink to="/account" className="text-slate-500 hover:text-white" title="Account and password" aria-label="Account and password"><KeyRound size={16} /></NavLink>
          <button onClick={() => void signOut()} className="text-slate-500 hover:text-white" title="Sign out" aria-label="Sign out"><LogOut size={16} /></button>
        </div>
      </aside>
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="h-14 flex-shrink-0 flex items-center justify-between gap-3 px-4 lg:px-6 bg-white/85 backdrop-blur border-b border-[#E6E9F0]">
          <div className="flex items-center gap-2">
            <button className="lg:hidden w-9 h-9 flex items-center justify-center rounded-md hover:bg-slate-100" onClick={() => setMenu(true)} aria-label="Open menu"><Menu size={18} /></button>
            <span className="text-[13px] text-slate-500">Changes here apply to everyone immediately and are written to the audit log.</span>
          </div>
          <div className="flex items-center gap-2"><LiveDot state={live} /><NavLink to="/d" className="hidden sm:inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-[12px] font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200"><ArrowLeftRight size={13} />Operations</NavLink></div>
        </header>
        <main className="flex-1 min-h-0 overflow-y-auto">
          <Routes>
            <Route index element={<Users />} />
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

/** Page frame shared by the admin screens. */
export function AdminPage({ title, subtitle, actions, children }: { title: string; subtitle?: string; actions?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="w-full px-4 sm:px-6 py-6">
      <div className="mx-auto max-w-[1200px]">
        <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
          <div><h1 className="text-[20px] font-semibold tracking-[-0.01em] text-slate-900">{title}</h1>{subtitle && <p className="text-[13px] text-slate-500 mt-0.5">{subtitle}</p>}</div>
          {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
        </div>
        {children}
      </div>
    </div>
  );
}
