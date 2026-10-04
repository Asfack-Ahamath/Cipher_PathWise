import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Route, Lock, ArrowRight, ArrowLeft, ShieldCheck, User } from 'lucide-react';
import { Spinner } from '../components/ds';
import { HOME, useAuth } from '../lib/auth';
import { api } from '../lib/api';
import { DEMO_PASSWORD, PwInput } from './SignIn';

const ADMIN_EMAIL = 'admin@pathwise.lk';

/** Administrator sign-in: its own screen, kept apart from the staff roles. Only admin accounts get through. */
export default function AdminSignIn() {
  const { signIn, signOut, endedReason } = useAuth();
  const nav = useNavigate();
  const [demo, setDemo] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<{ demoMode: boolean }>('/auth/config').then(c => { setDemo(c.demoMode); if (c.demoMode) { setEmail(ADMIN_EMAIL); setPassword(DEMO_PASSWORD); } }).catch(() => {});
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      const u = await signIn({ email: email.trim(), password });
      if (u.role !== 'admin') { await signOut(); setError('This account is not an administrator. Use the staff sign in.'); return; }
      nav(u.mustChangePassword ? '/account?required=1' : HOME.admin, { replace: true });
    } catch (err: any) { setError(err.message); } finally { setBusy(false); }
  };

  return (
    <div className="pw-zoom-min flex items-center justify-center px-4 py-8 text-white"
      style={{ background: 'radial-gradient(700px 500px at 0% 0%,rgba(20,184,166,.30),transparent 60%),radial-gradient(700px 600px at 100% 100%,rgba(99,102,241,.35),transparent 60%),linear-gradient(160deg,#0B1324,#0E1B2E 55%,#111A3A)' }}>
      <form onSubmit={submit} className="w-full max-w-[420px] rounded-2xl bg-white text-slate-900 p-6 sm:p-8 shadow-2xl">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center text-white" style={{ background: 'linear-gradient(135deg,#2DD4BF,#0F766E)' }}><Route size={20} /></div>
          <div><div className="text-[17px] font-semibold leading-tight">PathWise</div><div className="text-[12px] text-slate-500">Administrator console</div></div>
        </div>
        <h1 className="mt-6 text-[22px] font-semibold tracking-[-0.02em]">Administrator sign in</h1>
        <p className="text-[13px] text-slate-500 mt-0.5">Manage users, outlets, fleet and system settings.</p>
        {endedReason && <div role="status" className="mt-4 px-3.5 py-3 rounded-xl bg-amber-50 ring-1 ring-amber-200 text-[13px] text-amber-900">{endedReason}</div>}
        <div className="mt-5 grid gap-3">
          <label className="block"><span className="block text-[12px] font-semibold text-slate-700 mb-1">Admin email</span>
            <span className="relative block"><User size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input value={email} onChange={e => setEmail(e.target.value)} autoComplete="username" name="email" className="w-full h-11 pl-10 pr-3 text-[14px] rounded-xl bg-white ring-1 ring-[#D0D5DD] outline-none focus:ring-2 focus:ring-teal-600" /></span></label>
          <label className="block"><span className="block text-[12px] font-semibold text-slate-700 mb-1">Password</span>
            <span className="relative block"><Lock size={15} className="absolute z-10 left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              <PwInput value={password} onChange={setPassword} autoComplete="current-password" name="password" className="w-full h-11 pl-10 pr-10 text-[14px] rounded-xl bg-white ring-1 ring-[#D0D5DD] outline-none focus:ring-2 focus:ring-teal-600" /></span></label>
        </div>
        {error && <div role="alert" className="mt-3 px-3 py-2 rounded-xl bg-red-50 ring-1 ring-red-200 text-[12px] text-red-800">{error}</div>}
        <button type="submit" disabled={busy || !email || !password} className="mt-5 w-full h-11 rounded-xl text-[15px] font-semibold text-white bg-slate-900 hover:bg-slate-800 flex items-center justify-center gap-2 disabled:opacity-70">
          {busy ? <Spinner size={17} /> : <>Sign in as administrator <ArrowRight size={17} /></>}
        </button>
        <div className="mt-4 flex items-center justify-between text-[12px] text-slate-500">
          <Link to="/login" className="inline-flex items-center gap-1.5 font-semibold hover:text-slate-800"><ArrowLeft size={13} />Staff sign in</Link>
          <span className="inline-flex items-center gap-1.5"><ShieldCheck size={13} />Admins only{demo ? ' · demo' : ''}</span>
        </div>
      </form>
    </div>
  );
}
