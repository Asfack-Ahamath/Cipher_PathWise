import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Route, Truck, Tablet, Smartphone, ShoppingBag, Lock, ArrowRight, WifiOff, Check, CheckCircle2, ShieldCheck, User, Delete, Loader2, Settings2, ArrowLeft, Mail } from 'lucide-react';
import { ROLE_GRAD, ROLE_SOLID } from '../components/ds';
import { HOME, useAuth } from '../lib/auth';
import { api, post, type User as AppUser } from '../lib/api';
import { syncClock } from '../lib/clock';

type Key = 'dispatcher' | 'loader' | 'driver' | 'store';
type Acc = { key: Key; label: string; email: string; name: string; where: string; device: string; icon: React.ElementType; blurb: string };
/* Seeded demo accounts (see README). All use the same password; the loader dock tablet also takes a PIN. */
const ACCOUNTS: Acc[] = [
  { key: 'dispatcher', label: 'Dispatcher', email: 'dispatcher@pathwise.lk', name: 'Nimal Perera', where: 'Peliyagoda planning office', device: 'Desktop', icon: Truck, blurb: 'Plan, publish and handle exceptions' },
  { key: 'loader', label: 'Loader', email: 'loader@pathwise.lk', name: 'Kasun Jayasinghe', where: 'Kandy DC · dock tablet', device: 'Shared tablet · PIN', icon: Tablet, blurb: 'Load in stop order, flag shortages' },
  { key: 'driver', label: 'Driver', email: 'driver@pathwise.lk', name: 'Ruwan Bandara', where: 'VEH041 · Kandy depot', device: 'Phone · offline-ready', icon: Smartphone, blurb: 'Run the route, capture proof' },
  { key: 'store', label: 'Store manager', email: 'store@pathwise.lk', name: 'Sanduni Fernando', where: 'Waypoint Fresh Kegalle · OUT116', device: 'Counter PC or phone', icon: ShoppingBag, blurb: 'Order, track and confirm receipt' },
];
const DEMO_PASSWORD = 'PathWise@2026';

type View = 'signin' | 'forgot' | 'recover';

export default function SignIn() {
  const { signIn, endedReason, adopt } = useAuth();
  const [cfg, setCfg] = useState<{ demoMode: boolean; passwordRecovery: 'email' | 'admin' } | null>(null);
  const [view, setView] = useState<View>(() => (/type=recovery/.test(window.location.hash) ? 'recover' : 'signin'));
  useEffect(() => { api<any>('/auth/config').then(setCfg).catch(() => setCfg({ demoMode: true, passwordRecovery: 'admin' })); }, []);
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [sel, setSel] = useState<Key>('dispatcher');
  const acc = ACCOUNTS.find(a => a.key === sel)!;
  const [email, setEmail] = useState(acc.email);
  const [password, setPassword] = useState(DEMO_PASSWORD);
  const [usePin, setUsePin] = useState(true);
  const [pin, setPin] = useState('');
  const [depot, setDepot] = useState<'Kandy' | 'Peliyagoda'>('Kandy');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pinMode = sel === 'loader' && usePin;

  const choose = (k: Key) => { setSel(k); const a = ACCOUNTS.find(x => x.key === k)!; setEmail(a.email); setPassword(DEMO_PASSWORD); setPin(''); setError(null); };
  const go = async (body: any) => {
    setBusy(true); setError(null);
    try {
      const u = await signIn(body);
      const next = params.get('next');
      if (u.mustChangePassword) { nav('/account?required=1', { replace: true }); return; }
      nav(next && next.startsWith(HOME[u.role]) ? next : HOME[u.role], { replace: true });
    } catch (e: any) { setError(e.message); setPin(''); } finally { setBusy(false); }
  };
  const submit = (e?: FormEvent) => { e?.preventDefault(); if (pinMode) { if (pin.length === 4) void go({ pin, depot }); } else void go({ email: email.trim(), password }); };
  const press = (d: string) => { if (busy) return; const p = (pin + d).slice(0, 4); setPin(p); if (p.length === 4) void go({ pin: p, depot }); };

  return (
    <div className="min-h-screen grid lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] bg-white">
      {/* ── Brand panel ── */}
      <section className="relative overflow-hidden text-white px-6 sm:px-10 xl:px-16 py-8 lg:py-12 flex flex-col"
        style={{ background: 'radial-gradient(700px 500px at 0% 0%,rgba(20,184,166,.35),transparent 60%),radial-gradient(700px 600px at 100% 100%,rgba(99,102,241,.40),transparent 60%),linear-gradient(160deg,#0B1324,#0E1B2E 55%,#111A3A)' }}>
        <div aria-hidden className="absolute inset-0 opacity-[.07]" style={{ backgroundImage: 'linear-gradient(#fff 1px,transparent 1px),linear-gradient(90deg,#fff 1px,transparent 1px)', backgroundSize: '44px 44px', maskImage: 'radial-gradient(ellipse at 30% 30%,#000 30%,transparent 75%)' }} />
        <div className="relative flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center shadow-[0_8px_24px_-8px_rgba(20,184,166,.8)]" style={{ background: 'linear-gradient(135deg,#2DD4BF,#0F766E)' }}><Route size={20} /></div>
          <div><div className="text-[17px] font-semibold leading-tight tracking-[-0.01em]">PathWise</div><div className="text-[12px] text-white/60">for Waypoint Group</div></div>
        </div>
        <div className="relative lg:my-auto py-2">
          <div className="relative mt-8 lg:mt-0 max-w-[600px]">
            <span className="inline-flex items-center gap-2 h-7 px-3 rounded-full text-[12px] font-semibold bg-white/10 ring-1 ring-white/15 backdrop-blur"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_0_3px_rgba(52,211,153,.25)]" />Delivery planning · Peliyagoda &amp; Kandy</span>
            <h1 className="mt-5 text-[32px] sm:text-[42px] xl:text-[48px] font-semibold leading-[1.08] tracking-[-0.03em]">
              Every delivery,<br /><span className="bg-clip-text text-transparent" style={{ backgroundImage: 'linear-gradient(90deg,#5EEAD4,#A5B4FC)' }}>planned and proven.</span>
            </h1>
            <p className="mt-4 text-[15px] leading-7 text-white/70 max-w-[460px]">One plan from the 16:00 order cutoff to the store's receipt — for Fresh, Style and Tech, even when the driver loses signal.</p>
          </div>
          <div className="relative mt-8 hidden sm:grid grid-cols-3 gap-3 max-w-[600px]">
            {[['120', 'outlets served'], ['60', 'vehicles planned'], ['11', 'rules checked on every plan']].map(([n, l]) => (
              <div key={l} className="rounded-xl bg-white/[.04] ring-1 ring-white/10 px-4 py-3">
                <div className="text-[22px] font-semibold tabular tracking-[-0.02em]">{n}</div>
                <div className="text-[11px] text-white/55 leading-4">{l}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="relative mt-8 hidden sm:flex flex-wrap items-center justify-between gap-2 text-[12px] text-white/45">
          <span>Team Cipher · Tech-Triathlon 2026</span>
          {cfg?.demoMode !== false && <span>Demo accounts · password {DEMO_PASSWORD}</span>}
        </div>
      </section>

      {/* ── Sign-in form ── */}
      <section className="relative flex items-center justify-center px-4 sm:px-10 py-8 lg:py-12" style={{ background: 'radial-gradient(600px 400px at 100% 0%,#F0FDFA,transparent 60%),radial-gradient(500px 400px at 0% 100%,#EEF2FF,transparent 60%),#fff' }}>
        {view === 'forgot' ? <Forgot mode={cfg?.passwordRecovery ?? 'admin'} initial={email} onBack={() => setView('signin')} />
        : view === 'recover' ? <Recover onBack={() => { history.replaceState(null, '', '/login'); setView('signin'); }} onDone={(t, u) => { history.replaceState(null, '', '/'); adopt(t, u); void syncClock(); nav(HOME[u.role], { replace: true }); }} />
        : <form onSubmit={submit} className="w-full max-w-[460px]">
          <h2 className="text-[26px] font-semibold tracking-[-0.02em] text-slate-900">Welcome back</h2>
          <p className="text-[14px] text-slate-500 mt-1">{cfg?.demoMode === false ? 'Sign in with your work account.' : 'Choose a demo role, or type any account.'}</p>
          {endedReason && <div role="status" className="mt-4 px-3.5 py-3 rounded-xl bg-amber-50 ring-1 ring-amber-200 text-[13px] text-amber-900">{endedReason}</div>}

          {cfg?.demoMode !== false && <>
          <div className="mt-6 grid grid-cols-2 gap-3" role="radiogroup" aria-label="Role">
            {ACCOUNTS.map(a => {
              const Icon = a.icon; const on = a.key === sel;
              return (
                <button type="button" key={a.key} role="radio" aria-checked={on} onClick={() => choose(a.key)} data-testid={`role-${a.key}`}
                  className={`relative text-left rounded-2xl p-3.5 sm:p-4 border transition-colors ${on ? 'border-transparent bg-white' : 'border-[#E6E9F0] bg-white/70 hover:bg-white hover:border-slate-300'}`}
                  style={on ? { boxShadow: `0 0 0 2px ${ROLE_SOLID[a.key]}, 0 12px 28px -14px rgba(15,23,42,.35)` } : undefined}>
                  <span className={`absolute top-3 right-3 w-5 h-5 rounded-full flex items-center justify-center transition-opacity ${on ? 'opacity-100' : 'opacity-0'}`} style={{ background: ROLE_SOLID[a.key] }}><Check size={12} strokeWidth={3} className="text-white" /></span>
                  <span className="w-10 h-10 rounded-xl flex items-center justify-center text-white shadow-sm" style={{ background: ROLE_GRAD[a.key] }}><Icon size={19} /></span>
                  <span className="block mt-3 text-[14px] font-semibold text-slate-900">{a.label}</span>
                  <span className="block text-[12px] text-slate-500 leading-4 mt-0.5">{a.blurb}</span>
                </button>
              );
            })}
          </div>

          <div className="mt-5 flex items-center gap-3 rounded-xl bg-slate-50 ring-1 ring-[#E6E9F0] px-3.5 py-3">
            <span className="w-9 h-9 rounded-full flex items-center justify-center text-white text-[12px] font-semibold flex-shrink-0" style={{ background: ROLE_GRAD[acc.key] }}>{acc.name.split(' ').map(s => s[0]).join('')}</span>
            <div className="min-w-0 flex-1"><div className="text-[13px] font-semibold text-slate-900 truncate">{acc.name}</div><div className="text-[12px] text-slate-500 truncate">{acc.where}</div></div>
            <span className="hidden sm:inline-flex text-[11px] font-semibold text-slate-500 bg-white ring-1 ring-[#E6E9F0] rounded-full px-2 h-6 items-center whitespace-nowrap">{acc.device}</span>
          </div>
          <button type="button" onClick={() => { setSel('dispatcher'); setEmail('admin@pathwise.lk'); setPassword(DEMO_PASSWORD); setError(null); }} className="mt-2 inline-flex items-center gap-1.5 text-[12px] font-semibold text-slate-500 hover:text-slate-800"><Settings2 size={13} />Administrator (users, settings, audit log): admin@pathwise.lk</button>
          </>}
          {cfg?.demoMode === false && <div className="mt-6 inline-flex rounded-lg bg-slate-100 p-0.5">{([['office', 'Email'], ['dock', 'Dock tablet PIN']] as const).map(([k, l]) => <button type="button" key={k} onClick={() => { setSel(k === 'dock' ? 'loader' : 'dispatcher'); setUsePin(k === 'dock'); setEmail(''); setPassword(''); setError(null); }} className={`h-8 px-3 rounded-md text-[12px] font-semibold ${(k === 'dock') === pinMode ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'}`}>{l}</button>)}</div>}

          {pinMode ? (
            <div className="mt-5">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[12px] font-semibold text-slate-700">Dock PIN · {depot} DC</span>
                <div className="inline-flex rounded-lg bg-slate-100 p-0.5">{(['Kandy', 'Peliyagoda'] as const).map(d => <button type="button" key={d} onClick={() => { setDepot(d); setPin(''); }} className={`h-7 px-2.5 rounded-md text-[12px] font-semibold ${depot === d ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'}`}>{d}</button>)}</div>
              </div>
              <div className="grid grid-cols-4 gap-3" aria-label={`${pin.length} of 4 digits entered`}>{[0, 1, 2, 3].map(i => <span key={i} className={`h-12 rounded-xl bg-white ring-1 flex items-center justify-center ${i < pin.length ? 'ring-violet-500' : 'ring-[#D0D5DD]'}`}>{i < pin.length && <span className="w-2.5 h-2.5 rounded-full bg-slate-800" />}</span>)}</div>
              <div className="mt-3 grid grid-cols-3 gap-2">
                {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'].map(k => k === '' ? <span key="x" /> : (
                  <button type="button" key={k} onClick={() => k === 'del' ? setPin(pin.slice(0, -1)) : press(k)} className="h-12 rounded-xl bg-white ring-1 ring-[#E4E7EC] text-[18px] font-semibold text-slate-800 hover:bg-slate-50 active:bg-slate-100 flex items-center justify-center" aria-label={k === 'del' ? 'Delete' : k}>
                    {k === 'del' ? <Delete size={18} /> : k}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-[12px] text-slate-500">{cfg?.demoMode !== false && <>Demo PINs: Kandy <b className="tabular">2468</b> · Peliyagoda <b className="tabular">1357</b>. </>}<button type="button" className="underline" onClick={() => setUsePin(false)}>Use email instead</button></p>
            </div>
          ) : (
            <div className="mt-5 grid gap-4">
              <label className="block"><span className="block text-[12px] font-semibold text-slate-700 mb-1.5">Work email</span>
                <span className="relative block"><User size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input value={email} onChange={e => setEmail(e.target.value)} autoComplete="username" name="email" className="w-full h-11 pl-10 pr-3 text-[14px] rounded-xl bg-white ring-1 ring-[#D0D5DD] text-slate-800 outline-none focus:ring-2 focus:ring-teal-600" /></span></label>
              <label className="block"><span className="block text-[12px] font-semibold text-slate-700 mb-1.5">Password</span>
                <span className="relative block"><Lock size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" name="password" className="w-full h-11 pl-10 pr-3 text-[14px] rounded-xl bg-white ring-1 ring-[#D0D5DD] outline-none focus:ring-2 focus:ring-teal-600" /></span></label>
              <div className="flex items-center justify-between gap-2">
                {sel === 'loader' ? <button type="button" className="text-left text-[12px] text-slate-500 underline" onClick={() => setUsePin(true)}>Use the dock PIN instead</button> : <span />}
                <button type="button" className="text-[12px] font-semibold text-teal-700 hover:text-teal-800" onClick={() => setView('forgot')}>Forgot password?</button>
              </div>
            </div>
          )}

          {sel === 'driver' && <div className="mt-4 flex items-start gap-2.5 px-3.5 py-3 rounded-xl bg-sky-50 ring-1 ring-sky-100 text-[13px] text-sky-900"><WifiOff size={15} className="text-sky-600 mt-0.5 flex-shrink-0" />No signal on the road? Your saved run opens without signing in again.</div>}
          {error && <div role="alert" className="mt-4 px-3.5 py-3 rounded-xl bg-red-50 ring-1 ring-red-200 text-[13px] text-red-800">{error}</div>}

          {!pinMode && (
            <button type="submit" disabled={busy} className="mt-6 w-full h-12 rounded-xl text-[15px] font-semibold text-white flex items-center justify-center gap-2 transition hover:brightness-110 active:scale-[.99] disabled:opacity-70"
              style={{ background: ROLE_GRAD[acc.key], boxShadow: `0 14px 28px -14px ${ROLE_SOLID[acc.key]}` }}>
              {busy ? <Loader2 size={17} className="animate-spin" /> : <>Sign in{cfg?.demoMode !== false && email === acc.email ? ` as ${acc.name.split(' ')[0]}` : ''} <ArrowRight size={17} /></>}
            </button>
          )}

          <div className="mt-6 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[12px] text-slate-400">
            <span className="inline-flex items-center gap-1.5"><ShieldCheck size={13} />Role-based access</span>
            <span className="w-1 h-1 rounded-full bg-slate-300" />
            <span className="inline-flex items-center gap-1.5"><CheckCircle2 size={13} />Works offline in the field</span>
          </div>
        </form>}
      </section>
    </div>
  );
}

function Forgot({ mode, initial, onBack }: { mode: 'email' | 'admin'; initial: string; onBack: () => void }) {
  const [email, setEmail] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const send = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setError(null);
    try { setMsg((await post<{ message: string }>('/auth/forgot', { email: email.trim() })).message); } catch (err: any) { setError(err.message); } finally { setBusy(false); }
  };
  return (
    <form onSubmit={send} className="w-full max-w-[460px]">
      <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-slate-600 hover:text-slate-900"><ArrowLeft size={15} />Back to sign in</button>
      <h2 className="mt-4 text-[24px] font-semibold tracking-[-0.02em] text-slate-900">Reset your password</h2>
      <p className="text-[14px] text-slate-500 mt-1">{mode === 'email' ? 'We will email you a link to choose a new password.' : 'Passwords are reset by your PathWise administrator.'}</p>
      <label className="block mt-6"><span className="block text-[12px] font-semibold text-slate-700 mb-1.5">Work email</span>
        <span className="relative block"><Mail size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input type="email" required value={email} onChange={e => setEmail(e.target.value)} autoComplete="username" className="w-full h-11 pl-10 pr-3 text-[14px] rounded-xl bg-white ring-1 ring-[#D0D5DD] outline-none focus:ring-2 focus:ring-teal-600" /></span></label>
      {msg && <div role="status" className="mt-4 px-3.5 py-3 rounded-xl bg-emerald-50 ring-1 ring-emerald-200 text-[13px] text-emerald-900">{msg}</div>}
      {error && <div role="alert" className="mt-4 px-3.5 py-3 rounded-xl bg-red-50 ring-1 ring-red-200 text-[13px] text-red-800">{error}</div>}
      <button type="submit" disabled={busy || !email} className="mt-6 w-full h-12 rounded-xl text-[15px] font-semibold text-white bg-teal-700 hover:bg-teal-800 disabled:opacity-60 flex items-center justify-center gap-2">{busy && <Loader2 size={16} className="animate-spin" />}{mode === 'email' ? 'Send reset link' : 'Check what to do'}</button>
    </form>
  );
}

function Recover({ onBack, onDone }: { onBack: () => void; onDone: (token: string, user: AppUser) => void }) {
  const token = new URLSearchParams(window.location.hash.slice(1)).get('access_token') ?? '';
  const [pw, setPw] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ok = pw.length >= 10 && /[A-Za-z]/.test(pw) && /\d/.test(pw) && pw === again;
  const save = async (e: FormEvent) => {
    e.preventDefault(); if (!ok) return; setBusy(true); setError(null);
    try { const r = await post<{ token: string; user: AppUser }>('/auth/recover', { accessToken: token, password: pw }); onDone(r.token, r.user); }
    catch (err: any) { setError(err.message); } finally { setBusy(false); }
  };
  return (
    <form onSubmit={save} className="w-full max-w-[460px]">
      <h2 className="text-[24px] font-semibold tracking-[-0.02em] text-slate-900">Choose a new password</h2>
      <p className="text-[14px] text-slate-500 mt-1">At least 10 characters, with a letter and a number.</p>
      {!token && <div role="alert" className="mt-4 px-3.5 py-3 rounded-xl bg-red-50 ring-1 ring-red-200 text-[13px] text-red-800">This reset link is incomplete. Ask for a new one.</div>}
      <label className="block mt-6"><span className="block text-[12px] font-semibold text-slate-700 mb-1.5">New password</span>
        <input type="password" autoComplete="new-password" value={pw} onChange={e => setPw(e.target.value)} className="w-full h-11 px-3 text-[14px] rounded-xl bg-white ring-1 ring-[#D0D5DD] outline-none focus:ring-2 focus:ring-teal-600" /></label>
      <label className="block mt-4"><span className="block text-[12px] font-semibold text-slate-700 mb-1.5">Type it again</span>
        <input type="password" autoComplete="new-password" value={again} onChange={e => setAgain(e.target.value)} className="w-full h-11 px-3 text-[14px] rounded-xl bg-white ring-1 ring-[#D0D5DD] outline-none focus:ring-2 focus:ring-teal-600" /></label>
      {error && <div role="alert" className="mt-4 px-3.5 py-3 rounded-xl bg-red-50 ring-1 ring-red-200 text-[13px] text-red-800">{error}</div>}
      <button type="submit" disabled={!ok || busy || !token} className="mt-6 w-full h-12 rounded-xl text-[15px] font-semibold text-white bg-teal-700 hover:bg-teal-800 disabled:opacity-60 flex items-center justify-center gap-2">{busy && <Loader2 size={16} className="animate-spin" />}Save and sign in</button>
      <button type="button" onClick={onBack} className="mt-3 w-full text-[13px] font-semibold text-slate-600">Back to sign in</button>
    </form>
  );
}
