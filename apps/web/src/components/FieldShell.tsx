import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Bell, KeyRound, LogOut, X } from 'lucide-react';
import { ROLE_GRAD, cx } from './ds';
import { useAct, useApi } from './common';
import { post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { hhmm } from '../lib/clock';

/* Header for the field apps (loader, driver, store): role gradient, title, back, bell, sign-out.
   On a desktop screen the app sits in a centred column the width of a tablet or phone. */
export function FieldHeader({ role, title, subtitle, back, right, children, offline }: { role: 'loader' | 'driver' | 'store'; title: ReactNode; subtitle?: ReactNode; back?: string | (() => void); right?: ReactNode; children?: ReactNode; offline?: boolean }) {
  const nav = useNavigate();
  return (
    <div className="flex-shrink-0 text-white" style={{ background: offline ? ROLE_GRAD.offline : ROLE_GRAD[role], paddingTop: 'env(safe-area-inset-top)' }}>
      <div className="px-4 sm:px-5 pt-3 pb-4 flex items-center gap-3">
        {back && <button onClick={() => typeof back === 'string' ? nav(back) : back()} className="-ml-1 w-9 h-9 rounded-full flex items-center justify-center hover:bg-white/10" aria-label="Back"><ArrowLeft size={20} /></button>}
        <div className="flex-1 min-w-0">
          <div className="font-bold text-[17px] leading-tight truncate">{title}</div>
          {subtitle && <div className="text-white/75 text-[12px] truncate mt-0.5">{subtitle}</div>}
        </div>
        {right}
        <Notifications />
        <SignOut />
      </div>
      {children}
    </div>
  );
}

function SignOut() {
  const { signOut } = useAuth();
  const nav = useNavigate();
  const [confirm, setConfirm] = useState(false);
  return confirm ? (
    <span className="flex items-center gap-1">
      <button onClick={() => nav('/account')} className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-white/10" aria-label="Account and password" title="Account and password"><KeyRound size={16} /></button>
      <button onClick={() => void signOut()} className="h-8 px-2.5 rounded-full bg-white text-slate-900 text-[12px] font-semibold">Sign out</button>
      <button onClick={() => setConfirm(false)} className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-white/10" aria-label="Cancel"><X size={16} /></button>
    </span>
  ) : <button onClick={() => setConfirm(true)} className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-white/10" aria-label="Sign out" title="Sign out"><LogOut size={17} /></button>;
}

function Notifications() {
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const q = useApi<any>(['notifications'], '/notifications', { refetchInterval: 15_000 });
  const read = useAct(() => post('/notifications/read', {}), { invalidate: ['notifications'] });
  const unread = q.data?.unread ?? 0;
  return (
    <>
      <button onClick={() => { setOpen(true); }} className="relative w-9 h-9 rounded-full flex items-center justify-center bg-white/15 ring-1 ring-white/25 hover:bg-white/25" aria-label={`Notifications, ${unread} unread`}>
        <Bell size={17} />
        {unread > 0 && <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold flex items-center justify-center bg-red-600 ring-2 ring-white/80 tabular">{unread}</span>}
      </button>
      {open && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 flex justify-end" onClick={() => setOpen(false)}>
          <div className="w-full max-w-[420px] h-full bg-white text-slate-900 flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 h-14 border-b border-[#E4E7EC]">
              <span className="text-[16px] font-semibold">Notifications</span>
              <div className="flex items-center gap-3">{unread > 0 && <button className="text-[13px] font-semibold text-teal-700" onClick={() => read.mutate()}>Mark all read</button>}<button onClick={() => setOpen(false)} aria-label="Close"><X size={18} className="text-slate-500" /></button></div>
            </div>
            <div className="flex-1 overflow-y-auto">
              {(q.data?.items ?? []).length === 0 && <div className="p-6 text-[14px] text-slate-500">Nothing yet.</div>}
              {(q.data?.items ?? []).map((n: any) => (
                <button key={n.id} onClick={() => { if (n.link) { setOpen(false); nav(n.link); } }} className="w-full text-left px-4 py-3.5 border-b border-[#EEF0F3] flex gap-3 hover:bg-slate-50">
                  <span className={cx('w-2 h-2 rounded-full mt-2 flex-shrink-0', n.read ? 'bg-slate-300' : n.tone === 'red' ? 'bg-red-500' : n.tone === 'amber' ? 'bg-amber-500' : n.tone === 'green' ? 'bg-emerald-500' : 'bg-indigo-500')} />
                  <span className="flex-1 min-w-0">
                    <span className="flex justify-between gap-2"><span className={cx('text-[14px]', n.read ? 'text-slate-700' : 'font-semibold')}>{n.title}</span><span className="text-[12px] text-slate-400 tabular flex-shrink-0">{hhmm(n.createdAt)}</span></span>
                    {n.body && <span className="block text-[13px] text-slate-500 mt-0.5">{n.body}</span>}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/* Big touch button used across field apps (min 48 px, 56 px for the main action). */
export function BigButton({ children, onClick, disabled, tone = 'primary', icon, className, type = 'button', ...rest }: { children: ReactNode; onClick?: () => void; disabled?: boolean; tone?: 'primary' | 'secondary' | 'danger' | 'warning' | 'driver' | 'loader' | 'store'; icon?: ReactNode; className?: string; type?: 'button' | 'submit'; [k: string]: any }) {
  const styles: Record<string, string> = {
    primary: 'bg-teal-700 text-white hover:bg-teal-800', driver: 'bg-[#1D4ED8] text-white hover:bg-[#1E40AF]', loader: 'bg-[#6D28D9] text-white hover:bg-[#5B21B6]', store: 'bg-[#C2410C] text-white hover:bg-[#9A3412]',
    secondary: 'bg-white text-slate-800 ring-1 ring-[#D0D5DD] hover:bg-slate-50', danger: 'bg-white text-red-700 ring-1 ring-red-200 hover:bg-red-50', warning: 'bg-amber-600 text-white hover:bg-amber-700',
  };
  return <button type={type} onClick={onClick} disabled={disabled} {...rest} className={cx('w-full min-h-[52px] px-4 rounded-xl text-[16px] font-bold flex items-center justify-center gap-2 transition-colors disabled:bg-slate-200 disabled:text-slate-400 disabled:ring-0 disabled:cursor-not-allowed', styles[tone], className)}>{icon}{children}</button>;
}
