import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Check, ChevronRight, Eye, EyeOff, Lock, LogOut, Mail, ShieldCheck, Smartphone } from 'lucide-react';
import { post, type User } from '../lib/api';
import { HOME, useAuth } from '../lib/auth';
import { ROLE_GRAD, Spinner, cx } from '../components/ds';
import { useToast } from '../components/common';
import { SignOutDialog } from '../components/FieldShell';

const ROLE_LABEL: Record<User['role'], string> = { admin: 'Administrator', dispatcher: 'Dispatcher', loader: 'Loader', driver: 'Driver', store_manager: 'Store manager' };
const ROLE_BG: Record<User['role'], string> = { admin: ROLE_GRAD.offline, dispatcher: ROLE_GRAD.dispatcher, loader: ROLE_GRAD.loader, driver: ROLE_GRAD.driver, store_manager: ROLE_GRAD.store };
const rules = (p: string) => [
  { ok: p.length >= 10, label: '10+ characters' },
  { ok: /[A-Za-z]/.test(p), label: 'A letter' },
  { ok: /\d/.test(p), label: 'A number' },
];
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join('') || '?';

/* Grouped, rounded section in the iOS Settings style. */
function Group({ title, children, footer }: { title?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <section className="anim-rise">
      {title && <h2 className="px-4 pb-1.5 text-[12px] font-semibold uppercase tracking-[0.06em] text-slate-500">{title}</h2>}
      <div className="rounded-[24px] bg-white/85 shadow-[0_0_0_1px_#E8EBF0,0_8px_24px_-16px_rgba(15,23,42,.25)] overflow-hidden divide-y divide-[#EEF0F3]">{children}</div>
      {footer && <div className="px-4 pt-2 text-[12px] text-slate-500">{footer}</div>}
    </section>
  );
}

function PasswordField({ label, value, onChange, auto }: { label: string; value: string; onChange: (v: string) => void; auto: 'current-password' | 'new-password' }) {
  const [show, setShow] = useState(false);
  return (
    <label className="flex items-center gap-3 px-4 min-h-[56px]">
      <span className="w-[112px] sm:w-[140px] flex-shrink-0 text-[14px] font-medium text-slate-800">{label}</span>
      <input type={show ? 'text' : 'password'} autoComplete={auto} value={value} onChange={e => onChange(e.target.value)} placeholder="Required" className="flex-1 min-w-0 h-12 bg-transparent text-[15px] text-slate-900 placeholder:text-slate-300 outline-none" />
      <button type="button" onClick={() => setShow(s => !s)} className="w-8 h-8 -mr-1 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-600 active:bg-slate-100" aria-label={show ? 'Hide password' : 'Show password'}>{show ? <EyeOff size={17} /> : <Eye size={17} />}</button>
    </label>
  );
}

/** Account page: change your password (required after an admin reset) and sign out of every device. */
export default function Account() {
  const { user, adopt } = useAuth();
  const [confirmOut, setConfirmOut] = useState<null | 'one' | 'all'>(null);
  const [params] = useSearchParams();
  const nav = useNavigate();
  const toast = useToast();
  const required = !!user?.mustChangePassword || params.get('required') === '1';
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!user) return null;
  const checks = rules(next);
  const score = checks.filter(c => c.ok).length;
  const mismatch = !!again && next !== again;
  const same = !!next && !!current && next === current;
  const valid = checks.every(c => c.ok) && next === again && current.length > 0 && next !== current;
  const meter = ['bg-slate-200', 'bg-red-500', 'bg-amber-500', 'bg-emerald-500'][next ? score : 0];

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    setBusy(true); setError(null);
    try {
      const r = await post<{ token: string; user: User }>('/me/password', { current, next });
      adopt(r.token, r.user);
      toast('success', 'Password changed. Other devices were signed out.');
      nav(HOME[r.user.role], { replace: true });
    } catch (err: any) { setError(err.message); } finally { setBusy(false); }
  };

  return (
    <div className="min-h-[100dvh] bg-[#F2F3F7] flex justify-center">
      <SignOutDialog open={confirmOut !== null} everywhere={confirmOut === 'all'} hideAccount onClose={() => setConfirmOut(null)} />
      <div className="w-full max-w-[520px] pb-10">
        {/* Hero: role gradient, large avatar, name and role */}
        <div className="relative text-white px-5 pt-[max(20px,env(safe-area-inset-top))] pb-8 sm:rounded-b-[36px] overflow-hidden" style={{ background: ROLE_BG[user.role] }}>
          <div className="absolute -right-10 -top-12 w-48 h-48 rounded-full bg-white/10 blur-2xl" aria-hidden="true" />
          <div className="relative h-10 flex items-center">
            {!required
              ? <Link to={HOME[user.role]} className="-ml-1 h-9 pl-2 pr-3.5 rounded-full bg-white/15 ring-1 ring-white/25 backdrop-blur text-[14px] font-semibold inline-flex items-center gap-1 active:bg-white/25"><ArrowLeft size={17} />Back</Link>
              : <span className="text-[13px] font-semibold text-white/80">Action needed</span>}
          </div>
          <div className="relative mt-10 flex flex-col items-center text-center">
            <div className="w-20 h-20 rounded-full bg-white/20 ring-1 ring-white/40 backdrop-blur flex items-center justify-center ios-title text-[30px] shadow-[0_8px_24px_rgba(0,0,0,.18)]">{initials(user.name)}</div>
            <h1 className="ios-title text-[26px] mt-3 leading-tight">{required ? 'Set your own password' : user.name}</h1>
            <span className="mt-1.5 inline-flex items-center h-6 px-2.5 rounded-full bg-white/20 text-[12px] font-semibold">{ROLE_LABEL[user.role]}</span>
          </div>
        </div>

        <div className="relative mt-5 px-4 space-y-5">
          {required && (
            <div className="anim-rise rounded-[24px] glass !bg-amber-50/90 px-4 py-3.5 text-[13px] text-amber-900 flex gap-2.5"><Lock size={16} className="mt-0.5 flex-shrink-0 text-amber-600" />You signed in with a temporary password. Choose a new one to continue.</div>
          )}

          <Group title="Account">
            <div className="flex items-center gap-3 px-4 min-h-[56px]"><Mail size={17} className="text-slate-400" /><span className="text-[14px] text-slate-500 w-14">Email</span><span className="flex-1 min-w-0 text-[15px] text-slate-900 truncate text-right">{user.email}</span></div>
            <div className="flex items-center gap-3 px-4 min-h-[56px]"><ShieldCheck size={17} className="text-slate-400" /><span className="text-[14px] text-slate-500 w-14">Role</span><span className="flex-1 min-w-0 text-[15px] text-slate-900 truncate text-right">{ROLE_LABEL[user.role]}</span></div>
          </Group>

          <form onSubmit={submit} className="space-y-5">
            <Group title="Change password" footer={mismatch ? <span className="text-red-600">The two passwords do not match.</span> : same ? <span className="text-red-600">Choose a password different from the current one.</span> : undefined}>
              <PasswordField label={required ? 'Temporary' : 'Current'} value={current} onChange={setCurrent} auto="current-password" />
              <PasswordField label="New" value={next} onChange={setNext} auto="new-password" />
              <PasswordField label="Verify" value={again} onChange={setAgain} auto="new-password" />
              <div className="px-4 py-3.5">
                <div className="flex gap-1.5" aria-hidden="true">{[0, 1, 2].map(i => <span key={i} className={cx('h-1.5 flex-1 rounded-full transition-colors duration-300', i < (next ? score : 0) ? meter : 'bg-slate-200')} />)}</div>
                <ul className="mt-3 flex flex-wrap gap-2 text-[12px]">
                  {checks.map(c => (
                    <li key={c.label} className={cx('inline-flex items-center gap-1 h-7 pl-2 pr-2.5 rounded-full font-medium transition-colors', c.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500')}>
                      <Check size={13} className={c.ok ? 'opacity-100' : 'opacity-30'} />{c.label}
                    </li>
                  ))}
                </ul>
              </div>
            </Group>

            {error && <div role="alert" className="rounded-[20px] bg-red-50 ring-1 ring-red-200 px-4 py-3 text-[13px] text-red-800">{error}</div>}

            <button type="submit" disabled={!valid || busy} className="w-full h-14 rounded-full bg-teal-700 text-white text-[16px] font-semibold flex items-center justify-center gap-2 shadow-[0_8px_20px_-8px_rgba(15,118,110,.7)] transition-all active:scale-[.98] disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none disabled:cursor-not-allowed">
              {busy ? <Spinner size={18} /> : <ShieldCheck size={18} />}Save new password
            </button>
          </form>

          <Group title="Sign out">
            <button type="button" onClick={() => setConfirmOut('one')} className="w-full flex items-center gap-3 px-4 min-h-[56px] text-left active:bg-slate-100"><LogOut size={18} className="text-slate-500" /><span className="flex-1 text-[15px] text-slate-900">Sign out</span><ChevronRight size={16} className="text-slate-300" /></button>
            <button type="button" onClick={() => setConfirmOut('all')} className="w-full flex items-center gap-3 px-4 min-h-[56px] text-left active:bg-red-50"><Smartphone size={18} className="text-red-500" /><span className="flex-1 text-[15px] font-medium text-red-600">Sign out on every device</span><ChevronRight size={16} className="text-red-200" /></button>
          </Group>
        </div>
      </div>
    </div>
  );
}
