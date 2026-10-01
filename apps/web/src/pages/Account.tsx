import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, KeyRound, Loader2, LogOut, ShieldCheck } from 'lucide-react';
import { post, type User } from '../lib/api';
import { HOME, useAuth } from '../lib/auth';
import { useToast } from '../components/common';

const ROLE_LABEL: Record<User['role'], string> = { admin: 'Administrator', dispatcher: 'Dispatcher', loader: 'Loader', driver: 'Driver', store_manager: 'Store manager' };
const rules = (p: string) => [
  { ok: p.length >= 10, label: 'At least 10 characters' },
  { ok: /[A-Za-z]/.test(p), label: 'A letter' },
  { ok: /\d/.test(p), label: 'A number' },
];

/** Account page: change your password (required after an admin reset) and sign out of every device. */
export default function Account() {
  const { user, adopt, signOut } = useAuth();
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
  const valid = checks.every(c => c.ok) && next === again && current.length > 0 && next !== current;

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
    <div className="min-h-[100dvh] bg-[#F4F6FA] flex items-start sm:items-center justify-center px-4 py-8">
      <div className="w-full max-w-[440px]">
        {!required && <Link to={HOME[user.role]} className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-slate-600 hover:text-slate-900 mb-4"><ArrowLeft size={15} />Back</Link>}
        <div className="bg-white rounded-2xl ring-1 ring-[#E6E9F0] shadow-[0_16px_40px_-24px_rgba(15,23,42,.35)] p-6">
          <div className="flex items-center gap-3">
            <span className="w-10 h-10 rounded-xl bg-teal-50 text-teal-700 flex items-center justify-center"><KeyRound size={19} /></span>
            <div className="min-w-0">
              <h1 className="text-[18px] font-semibold text-slate-900">{required ? 'Set your own password' : 'Your account'}</h1>
              <div className="text-[13px] text-slate-500 truncate">{user.name} · {ROLE_LABEL[user.role]} · {user.email}</div>
            </div>
          </div>
          {required && <p className="mt-4 rounded-xl bg-amber-50 ring-1 ring-amber-200 px-3.5 py-3 text-[13px] text-amber-900">You signed in with a temporary password. Choose a new one to continue.</p>}
          <form onSubmit={submit} className="mt-5 grid gap-4">
            <label className="block"><span className="block text-[12px] font-semibold text-slate-700 mb-1.5">{required ? 'Temporary password' : 'Current password'}</span>
              <input type="password" autoComplete="current-password" value={current} onChange={e => setCurrent(e.target.value)} className="w-full h-11 px-3 text-[14px] rounded-xl ring-1 ring-[#D0D5DD] outline-none focus:ring-2 focus:ring-teal-600" /></label>
            <label className="block"><span className="block text-[12px] font-semibold text-slate-700 mb-1.5">New password</span>
              <input type="password" autoComplete="new-password" value={next} onChange={e => setNext(e.target.value)} className="w-full h-11 px-3 text-[14px] rounded-xl ring-1 ring-[#D0D5DD] outline-none focus:ring-2 focus:ring-teal-600" /></label>
            <ul className="grid grid-cols-3 gap-2 text-[12px]">
              {checks.map(c => <li key={c.label} className={c.ok ? 'text-emerald-700 font-semibold' : 'text-slate-500'}>{c.ok ? '✓ ' : '• '}{c.label}</li>)}
            </ul>
            <label className="block"><span className="block text-[12px] font-semibold text-slate-700 mb-1.5">Type it again</span>
              <input type="password" autoComplete="new-password" value={again} onChange={e => setAgain(e.target.value)} className="w-full h-11 px-3 text-[14px] rounded-xl ring-1 ring-[#D0D5DD] outline-none focus:ring-2 focus:ring-teal-600" />
              {again && next !== again && <span className="block mt-1 text-[12px] text-red-700">The two passwords do not match.</span>}
              {next && current && next === current && <span className="block mt-1 text-[12px] text-red-700">Choose a password different from the current one.</span>}</label>
            {error && <div role="alert" className="rounded-xl bg-red-50 ring-1 ring-red-200 px-3.5 py-3 text-[13px] text-red-800">{error}</div>}
            <button type="submit" disabled={!valid || busy} className="h-11 rounded-xl bg-teal-700 text-white text-[14px] font-semibold flex items-center justify-center gap-2 disabled:opacity-50 hover:bg-teal-800">
              {busy ? <Loader2 size={16} className="animate-spin" /> : <ShieldCheck size={16} />}Save new password
            </button>
          </form>
          <div className="mt-6 pt-5 border-t border-[#EEF0F3] flex flex-wrap gap-2 justify-between">
            <button onClick={() => void signOut()} className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-slate-600 hover:text-slate-900"><LogOut size={14} />Sign out</button>
            <button onClick={() => void signOut({ everywhere: true })} className="text-[13px] font-semibold text-red-700 hover:text-red-800">Sign out on every device</button>
          </div>
        </div>
      </div>
    </div>
  );
}
