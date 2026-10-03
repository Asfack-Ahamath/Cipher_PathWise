import { useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, Bell, BellOff, CheckCheck, CheckCircle2, ChevronRight, Clock, Info, KeyRound, LogOut, X } from 'lucide-react';
import { ROLE_GRAD, Spinner, cx } from './ds';
import { Loading, useAct, useApi } from './common';
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
          <div className="ios-title text-[18px] leading-tight truncate">{title}</div>
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

/* Centred glass confirmation shown before signing out. Shared by every role's sign-out button. */
export function SignOutDialog({ open, onClose, everywhere, hideAccount }: { open: boolean; onClose: () => void; everywhere?: boolean; hideAccount?: boolean }) {
  const { signOut } = useAuth();
  const nav = useNavigate();
  if (!open) return null;
  return createPortal(
        <div className="fixed inset-0 z-[60] bg-black/30 backdrop-blur-sm flex items-center justify-center p-6 anim-fade-in" onClick={() => onClose()} role="dialog" aria-modal="true" aria-label="Sign out confirmation">
          <div className="w-full max-w-[320px] rounded-[32px] glass !bg-white/75 text-slate-900 overflow-hidden text-center anim-pop-in" onClick={e => e.stopPropagation()}>
            <div className="px-5 pt-5 pb-4">
              <div className="mx-auto mb-3 w-11 h-11 rounded-full bg-red-50 text-red-600 flex items-center justify-center"><LogOut size={20} /></div>
              <div className="ios-title text-[19px]">{everywhere ? 'Sign out everywhere?' : 'Sign out?'}</div>
              <div className="text-[13px] text-slate-500 mt-1">{everywhere ? 'This ends your session on every phone, tablet and computer. You will need to sign in again on each one.' : 'You will need to sign in again to use the app.'}</div>
            </div>
            <div className="px-4 pb-4 grid grid-cols-2 gap-2.5">
              <button onClick={() => onClose()} className="h-12 rounded-full bg-black/5 text-[16px] font-medium text-slate-800 active:bg-black/10 transition-colors">Cancel</button>
              <button onClick={() => void signOut(everywhere ? { everywhere: true } : undefined)} className="h-12 rounded-full bg-[#FF3B30] text-[16px] font-semibold text-white active:opacity-80 transition-opacity">Sign out</button>
            </div>
            {!hideAccount && !everywhere && <button onClick={() => { onClose(); nav('/account'); }} className="w-full h-11 border-t border-black/10 text-[14px] text-slate-600 inline-flex items-center justify-center gap-1.5 active:bg-black/5"><KeyRound size={14} />Account and password</button>}
          </div>
        </div>,
    document.body,
  );
}

function SignOut() {
  const [confirm, setConfirm] = useState(false);
  return (
    <>
      <button onClick={() => setConfirm(true)} className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-white/10" aria-label="Sign out" title="Sign out"><LogOut size={17} /></button>
      <SignOutDialog open={confirm} onClose={() => setConfirm(false)} />
    </>
  );
}

function Notifications() {
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  /* Drag-to-dismiss (phones): the header follows the finger; past 120 px it closes, otherwise it springs back. */
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const startY = useRef<number | null>(null);
  const onDown = (e: React.PointerEvent) => { if (window.innerWidth >= 640) return; startY.current = e.clientY; setDragging(true); e.currentTarget.setPointerCapture(e.pointerId); };
  const onMove = (e: React.PointerEvent) => { if (startY.current !== null) setDragY(Math.max(0, e.clientY - startY.current)); };
  const onUp = () => { if (startY.current === null) return; startY.current = null; setDragging(false); if (dragY > 120) { setOpen(false); } setDragY(0); };
  const q = useApi<any>(['notifications'], '/notifications', { refetchInterval: 15_000 });
  const read = useAct(() => post('/notifications/read', {}), { invalidate: ['notifications'] });
  const unread = q.data?.unread ?? 0;
  return (
    <>
      <button onClick={() => { setOpen(true); }} className="relative w-9 h-9 rounded-full flex items-center justify-center bg-white/15 ring-1 ring-white/25 hover:bg-white/25" aria-label={`Notifications, ${unread} unread`}>
        <Bell size={17} />
        {unread > 0 && <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold flex items-center justify-center bg-red-600 ring-2 ring-white/80 tabular">{unread}</span>}
      </button>
      {open && (() => {
        const items: any[] = q.data?.items ?? [];
        const fresh = items.filter(n => !n.read);
        const earlier = items.filter(n => n.read);
        const TONE: Record<string, { icon: typeof Info; chip: string }> = {
          red: { icon: AlertTriangle, chip: 'bg-red-100 text-red-600' },
          amber: { icon: Clock, chip: 'bg-amber-100 text-amber-600' },
          green: { icon: CheckCircle2, chip: 'bg-emerald-100 text-emerald-600' },
        };
        const row = (n: any, i: number) => {
          const t = TONE[n.tone] ?? { icon: Info, chip: 'bg-indigo-100 text-indigo-600' };
          return (
            <button key={n.id} style={{ animationDelay: `${Math.min(i, 10) * 40 + 80}ms` }} onClick={() => { if (n.link) { setOpen(false); nav(n.link); } }} className="anim-rise w-full text-left px-4 py-3 flex gap-3 items-start active:bg-slate-100 hover:bg-slate-50 transition-colors">
              <span className={cx('w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0', n.read ? 'bg-slate-100 text-slate-400' : t.chip)}><t.icon size={19} /></span>
              <span className="flex-1 min-w-0 pt-0.5">
                <span className="flex items-start justify-between gap-2">
                  <span className={cx('text-[14.5px] leading-snug', n.read ? 'text-slate-600' : 'font-semibold text-slate-900')}>{n.title}</span>
                  <span className="flex items-center gap-1.5 flex-shrink-0 pt-0.5">
                    <span className="text-[12px] text-slate-400 tabular">{hhmm(n.createdAt)}</span>
                    {!n.read && <span className="w-2 h-2 rounded-full bg-[#007AFF]" />}
                  </span>
                </span>
                {n.body && <span className="block text-[13px] leading-snug text-slate-500 mt-0.5">{n.body}</span>}
              </span>
              {n.link && <ChevronRight size={16} className="text-slate-300 mt-3 flex-shrink-0" />}
            </button>
          );
        };
        const group = (label: string, list: any[]) => list.length > 0 && (
          <div key={label} className="mb-3">
            <div className="px-4 pt-2 pb-1.5 text-[12px] font-semibold uppercase tracking-[0.06em] text-slate-500">{label}</div>
            <div className="mx-3 rounded-[24px] bg-white/80 overflow-hidden shadow-[0_0_0_1px_#E8EBF0] divide-y divide-[#EEF0F3]">{list.map((n, i) => row(n, i))}</div>
          </div>
        );
        return (
          <div className="fixed inset-0 z-50 bg-slate-900/35 backdrop-blur-[3px] flex items-end sm:items-stretch justify-end sm:p-3 anim-fade-in" onClick={() => setOpen(false)}>
            <div className="w-full sm:max-w-[420px] h-[88dvh] sm:h-full bg-[#F2F3F7]/90 backdrop-blur-2xl text-slate-900 flex flex-col overflow-hidden rounded-t-[32px] sm:rounded-[32px] shadow-[0_-8px_40px_rgba(15,23,42,.25)] anim-sheet-in" style={dragY || dragging ? { transform: `translateY(${dragY}px)`, transition: dragging ? 'none' : undefined, animation: 'none' } : undefined} onClick={e => e.stopPropagation()} role="dialog" aria-label="Notifications">
              <div className="flex-shrink-0 bg-white/60 backdrop-blur-xl border-b-[0.5px] border-black/10 touch-none select-none" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
                <button onClick={() => setOpen(false)} aria-label="Close" className="sm:hidden mx-auto mt-2 block w-10 h-1.5 rounded-full bg-slate-300" />
                <div className="flex items-center justify-between px-4 h-14">
                  <div className="flex items-baseline gap-2">
                    <span className="ios-title text-[24px]">Notifications</span>
                    {unread > 0 && <span className="text-[12px] font-semibold text-white bg-[#FF3B30] rounded-full px-2 py-0.5 tabular">{unread} new</span>}
                  </div>
                  <button onClick={() => setOpen(false)} aria-label="Close" className="w-9 h-9 rounded-full bg-black/5 flex items-center justify-center active:bg-slate-300"><X size={16} className="text-slate-600" /></button>
                </div>
                {unread > 0 && (
                  <div className="px-4 pb-2.5 -mt-1">
                    <button className="text-[14px] font-medium text-[#007AFF] inline-flex items-center gap-1.5 disabled:opacity-50" disabled={read.isPending} onClick={() => read.mutate()}><CheckCheck size={15} />Mark all as read</button>
                  </div>
                )}
              </div>
              <div className="flex-1 overflow-y-auto pt-2 pb-6">
                {q.isLoading && <Loading className="py-20" />}
                {!q.isLoading && items.length === 0 && (
                  <div className="px-8 pt-20 text-center">
                    <div className="mx-auto w-16 h-16 rounded-full bg-white shadow-[0_0_0_1px_#E8EBF0] flex items-center justify-center text-slate-300"><BellOff size={28} /></div>
                    <div className="mt-4 text-[17px] font-semibold text-slate-800">You're all caught up</div>
                    <div className="mt-1 text-[14px] text-slate-500">New alerts about your deliveries will show up here.</div>
                  </div>
                )}
                {group('New', fresh)}
                {group('Earlier', earlier)}
              </div>
            </div>
          </div>
        );
      })()}
    </>
  );
}

/* Big touch button used across field apps (min 48 px, 56 px for the main action). */
export function BigButton({ children, onClick, disabled, loading, tone = 'primary', icon, className, type = 'button', ...rest }: { children: ReactNode; onClick?: () => void; disabled?: boolean; loading?: boolean; tone?: 'primary' | 'secondary' | 'danger' | 'warning' | 'driver' | 'loader' | 'store'; icon?: ReactNode; className?: string; type?: 'button' | 'submit'; [k: string]: any }) {
  const styles: Record<string, string> = {
    primary: 'bg-teal-700 text-white hover:bg-teal-800', driver: 'bg-[#1D4ED8] text-white hover:bg-[#1E40AF]', loader: 'bg-[#6D28D9] text-white hover:bg-[#5B21B6]', store: 'bg-[#C2410C] text-white hover:bg-[#9A3412]',
    secondary: 'bg-white text-slate-800 ring-1 ring-[#D0D5DD] hover:bg-slate-50', danger: 'bg-white text-red-700 ring-1 ring-red-200 hover:bg-red-50', warning: 'bg-amber-600 text-white hover:bg-amber-700',
  };
  return <button type={type} onClick={loading ? undefined : onClick} disabled={disabled && !loading} aria-busy={loading || undefined} {...rest} className={cx(loading && 'pointer-events-none', 'w-full min-h-[52px] px-4 rounded-xl text-[16px] font-bold flex items-center justify-center gap-2 transition-colors disabled:bg-slate-200 disabled:text-slate-400 disabled:ring-0 disabled:cursor-not-allowed', styles[tone], className)}>{loading ? <Spinner size={18} /> : icon}{children}</button>;
}
