import { useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Activity, AlertTriangle, ArrowRight, ArrowUpRight, CheckCircle2, ClipboardList, Lock, Megaphone, ScrollText, ShieldCheck, Store, Truck, UserPlus, Users as UsersIcon, Wrench, Route as RouteIcon, LogIn } from 'lucide-react';
import { Card, CardHeader, IconChip, Skeleton, cx, type Hue } from '../../components/ds';
import { ErrorState, fmt, useApi } from '../../components/common';
import { useAuth } from '../../lib/auth';
import { businessNow, dayLabel, hhmm } from '../../lib/clock';
import { ROLE_LABEL } from './Users';

/* Chart colours (validated: lightness band, CVD separation and contrast against white all pass). */
const C_OK = '#6366F1', C_FAIL = '#E5484D', C_BAR = '#818CF8';

/** Admin landing page: greeting, headline numbers, sign-in activity, what needs a look, today's operations and recent activity. */
export default function Overview() {
  const { user } = useAuth();
  const nav = useNavigate();
  const stats = useApi<any>(['admin-overview'], '/admin/overview', { refetchInterval: 60_000 });
  const users = useApi<any[]>(['admin-users'], '/admin/users');
  const vehicles = useApi<any[]>(['admin-vehicles'], '/admin/vehicles');
  const outlets = useApi<any[]>(['admin-outlets'], '/admin/outlets');
  const system = useApi<any>(['admin-system'], '/admin/system', { refetchInterval: 30_000 });
  const audit = useApi<any>(['admin-audit-recent'], '/admin/audit?limit=8', { refetchInterval: 30_000 });
  const ops = useApi<any>(['overview'], '/overview', { refetchInterval: 30_000 });
  const all = [stats, users, vehicles, outlets, system, audit];
  const failed = all.find(q => q.error);
  if (failed) return <div className="p-6"><ErrorState error={failed.error} retry={() => all.forEach(q => void q.refetch())} /></div>;
  if (all.some(q => q.isLoading)) return <OverviewSkeleton />;

  const u = users.data!, v = vehicles.data!, o = outlets.data!, s = system.data, st = stats.data, recent: any[] = audit.data.items;
  const now = Date.now();
  const activeUsers = u.filter(x => x.isActive);
  const locked = activeUsers.filter(x => x.lockedUntil && new Date(x.lockedUntil).getTime() > now);
  const mustSet = activeUsers.filter(x => x.mustChangePassword);
  const workshop = v.filter(x => x.status === 'in_workshop');
  const fuelHigh = v.filter(x => x.fuelQuotaL > 0 && x.fuelUsedL / x.fuelQuotaL > 0.9);
  const activeOutlets = o.filter(x => x.isActive);
  const noManager = activeOutlets.filter(x => !x.managers?.length);
  const dbOk = s.database.ok, rlsOk = s.rls.missing.length === 0, sbOk = !s.supabase || (s.supabase.auth && s.supabase.storage !== false);
  const healthy = dbOk && rlsOk && sbOk;
  const days: { day: string; ok: number; failed: number; changes: number }[] = st.days;
  const signins7 = days.reduce((a, d) => a + d.ok, 0), failed7 = days.reduce((a, d) => a + d.failed, 0);
  const today = days[days.length - 1];

  const attention: { tone: 'bad' | 'warn'; icon: ReactNode; title: string; detail?: string; to: string }[] = [
    ...(!dbOk ? [{ tone: 'bad' as const, icon: <Activity size={15} />, title: 'Database not responding', to: '/a/system' }] : []),
    ...(!rlsOk ? [{ tone: 'bad' as const, icon: <ShieldCheck size={15} />, title: `${s.rls.missing.length} table${s.rls.missing.length > 1 ? 's' : ''} without row-level security`, detail: s.rls.missing.join(', '), to: '/a/system' }] : []),
    ...(!sbOk ? [{ tone: 'bad' as const, icon: <AlertTriangle size={15} />, title: 'Supabase Auth or Storage unreachable', to: '/a/system' }] : []),
    ...(locked.length ? [{ tone: 'bad' as const, icon: <Lock size={15} />, title: `${locked.length} locked account${locked.length > 1 ? 's' : ''}`, detail: locked.map(x => x.name).join(', '), to: '/a/people' }] : []),
    ...(workshop.length ? [{ tone: 'warn' as const, icon: <Wrench size={15} />, title: `${workshop.length} vehicle${workshop.length > 1 ? 's' : ''} in the workshop`, detail: workshop.map(x => x.id).join(', '), to: '/a/fleet' }] : []),
    ...(fuelHigh.length ? [{ tone: 'warn' as const, icon: <Truck size={15} />, title: `${fuelHigh.length} vehicle${fuelHigh.length > 1 ? 's' : ''} over 90% of fuel quota`, detail: fuelHigh.map(x => x.id).join(', '), to: '/a/fleet' }] : []),
    ...(mustSet.length ? [{ tone: 'warn' as const, icon: <UsersIcon size={15} />, title: `${mustSet.length} ${mustSet.length > 1 ? 'people' : 'person'} still on a temporary password`, detail: mustSet.map(x => x.name).join(', '), to: '/a/people' }] : []),
    ...(noManager.length ? [{ tone: 'warn' as const, icon: <Store size={15} />, title: `${noManager.length} active outlet${noManager.length > 1 ? 's' : ''} without a store manager`, detail: noManager.slice(0, 6).map(x => x.id).join(', ') + (noManager.length > 6 ? '…' : ''), to: '/a/outlets' }] : []),
  ];

  const hour = Number(businessNow().toLocaleString('en-GB', { hour: '2-digit', hour12: false, timeZone: 'Asia/Colombo' }));
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const roleRows = Object.keys(ROLE_LABEL).map(r => ({ label: ROLE_LABEL[r], n: st.roles.find((x: any) => x.role === r)?.active ?? 0 }));
  const areaRows = (st.byArea as { area: string; n: number }[]).map(a => ({ label: a.area, n: a.n }));
  const op = ops.data;

  return (
    <div className="mx-auto max-w-[1320px] min-[1700px]:max-w-[1520px] min-[2300px]:max-w-[1760px] px-4 sm:px-6 lg:px-8 py-5 sm:py-7 anim-page space-y-5 sm:space-y-6">
      {/* Hero */}
      <section className="relative overflow-hidden rounded-2xl text-white px-5 sm:px-7 py-6 sm:py-7"
        style={{ background: 'radial-gradient(600px 300px at 100% 0%,rgba(129,140,248,.45),transparent 60%),radial-gradient(500px 300px at 0% 100%,rgba(45,212,191,.22),transparent 60%),linear-gradient(135deg,#0B1324,#151B44)' }}>
        <div aria-hidden className="absolute inset-0 opacity-[.06]" style={{ backgroundImage: 'linear-gradient(#fff 1px,transparent 1px),linear-gradient(90deg,#fff 1px,transparent 1px)', backgroundSize: '36px 36px' }} />
        <div className="relative flex flex-col lg:flex-row lg:items-end justify-between gap-5">
          <div className="min-w-0">
            <div className="text-[12px] font-medium text-indigo-200/80">{dayLabel(businessNow())} · {op?.dateLabel ? `Delivery day ${op.dateLabel}` : 'Administration'}</div>
            <h1 className="mt-1 text-[22px] sm:text-[26px] font-semibold tracking-[-0.02em]">{greet}, {user?.name.split(' ')[0]}</h1>
            <p className="mt-1.5 text-[13px] sm:text-[14px] text-white/70 max-w-[620px] leading-6">
              {healthy ? 'All systems are healthy.' : 'Some systems need attention.'} {attention.length ? `${attention.length} item${attention.length > 1 ? 's' : ''} to look at` : 'Nothing needs a look'} · {fmt(today?.ok ?? 0)} sign-in{today?.ok === 1 ? '' : 's'} today.
            </p>
          </div>
          <div className="grid grid-cols-2 sm:flex gap-2 [&>:last-child]:col-span-2 sm:[&>:last-child]:col-span-1">
            <HeroAction icon={<UserPlus size={15} />} onClick={() => nav('/a/people?new=1')}>Add person</HeroAction>
            <HeroAction icon={<Megaphone size={15} />} onClick={() => nav('/a/announcements')}>Announce</HeroAction>
            <HeroAction icon={<RouteIcon size={15} />} onClick={() => nav('/d')}>Operations</HeroAction>
          </div>
        </div>
      </section>

      {/* KPIs */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4">
        <Kpi to="/a/people" hue="indigo" icon={<UsersIcon size={16} />} label="Active people" value={fmt(activeUsers.length)} sub={`${st.activeUsers.week} signed in this week`} />
        <Kpi to="/a/audit" hue="violet" icon={<LogIn size={16} />} label="Sign-ins · 7 days" value={fmt(signins7)} sub={failed7 ? `${fmt(failed7)} failed attempts` : 'No failed attempts'} tone={failed7 > 10 ? 'warn' : undefined} />
        <Kpi to="/a/fleet" hue="teal" icon={<Truck size={16} />} label="Vehicles available" value={<>{v.length - workshop.length}<span className="text-[14px] font-medium text-slate-400"> / {v.length}</span></>} sub={workshop.length ? `${workshop.length} in the workshop` : 'Whole fleet available'} tone={workshop.length ? 'warn' : undefined} />
        <Kpi to="/a/system" hue={healthy ? 'emerald' : 'rose'} icon={<Activity size={16} />} label="System" value={healthy ? 'Healthy' : 'Check'} sub={`Database ${s.database.latencyMs} ms · RLS ${s.rls.enabled}/${s.rls.total}`} tone={healthy ? 'good' : 'bad'} />
      </div>

      {/* Activity chart + attention */}
      <div className="grid grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] gap-5 sm:gap-6">
        <Card>
          <CardHeader icon={<IconChip hue="indigo" size={32}><LogIn size={16} /></IconChip>} title="Sign-in activity" subtitle="Last 7 days, business clock" />
          <div className="flex items-center gap-4 text-[12px] text-slate-600 mb-3"><Key color={C_OK}>Successful</Key><Key color={C_FAIL}>Failed</Key></div>
          <SignInChart days={days} />
        </Card>
        <Card>
          <CardHeader icon={<IconChip hue="amber" size={32}><AlertTriangle size={16} /></IconChip>} title="Needs a look" subtitle={attention.length ? `${attention.length} item${attention.length > 1 ? 's' : ''}` : 'All clear'} />
          {attention.length === 0 ? (
            <div className="flex flex-col items-center justify-center text-center py-8">
              <span className="w-12 h-12 rounded-full bg-emerald-50 flex items-center justify-center"><CheckCircle2 size={22} className="text-emerald-600" /></span>
              <div className="mt-3 text-[14px] font-semibold text-slate-900">Nothing needs attention</div>
              <div className="text-[12px] text-slate-500">Accounts, fleet, outlets and systems look fine.</div>
            </div>
          ) : (
            <ul className="space-y-2 max-h-[300px] overflow-y-auto -mr-2 pr-2">
              {attention.map((a, i) => (
                <li key={i}><Link to={a.to} className={cx('group flex items-start gap-3 rounded-xl px-3 py-2.5 ring-1 transition-colors', a.tone === 'bad' ? 'bg-red-50/70 ring-red-100 hover:bg-red-50' : 'bg-amber-50/70 ring-amber-100 hover:bg-amber-50')}>
                  <span className={cx('mt-0.5 w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0', a.tone === 'bad' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700')}>{a.icon}</span>
                  <span className="flex-1 min-w-0"><span className="block text-[13px] font-semibold text-slate-900">{a.title}</span>{a.detail && <span className="block text-[12px] text-slate-500 truncate">{a.detail}</span>}</span>
                  <ArrowRight size={14} className="mt-1.5 flex-shrink-0 text-slate-400 group-hover:translate-x-0.5 transition-transform" />
                </Link></li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* Operations + breakdowns */}
      <div className="grid grid-cols-[minmax(0,1fr)] md:grid-cols-2 xl:grid-cols-3 gap-5 sm:gap-6">
        <Card>
          <CardHeader icon={<IconChip hue="teal" size={32}><ClipboardList size={16} /></IconChip>} title="Today's operations" subtitle={op ? `Delivery day ${op.dateLabel}` : 'Loading…'}
            action={<Link to="/d" className="inline-flex items-center gap-1 py-2 -my-2 text-[12px] font-semibold text-indigo-700 hover:text-indigo-900">Open<ArrowUpRight size={13} /></Link>} />
          {!op ? <div className="space-y-2">{[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-9" />)}</div> : (
            <div className="grid grid-cols-2 gap-2.5">
              <OpStat label="Orders" value={fmt(op.orders.confirmed)} sub={`${fmt(op.orders.delivered)} delivered`} />
              <OpStat label="Trips" value={fmt(op.trips.total)} sub={op.plan.published ? `Plan v${op.plan.published.version} published` : op.plan.draft ? `Draft v${op.plan.draft.version}` : 'No plan yet'} />
              <OpStat label="Deferred" value={fmt(op.orders.deferred)} sub={`${fmt(op.orders.partial)} part-deferred`} tone={op.orders.deferred ? 'warn' : undefined} />
              <OpStat label="Open exceptions" value={fmt(op.attention.length)} sub={op.orders.unconfirmedReceipts ? `${op.orders.unconfirmedReceipts} receipts overdue` : 'Receipts on time'} tone={op.attention.length ? 'bad' : undefined} />
            </div>
          )}
        </Card>
        <Card>
          <CardHeader icon={<IconChip hue="violet" size={32}><UsersIcon size={16} /></IconChip>} title="People by role" subtitle={`${activeUsers.length} active accounts`} />
          <HBars rows={roleRows} />
        </Card>
        <Card className="md:col-span-2 xl:col-span-1">
          <CardHeader icon={<IconChip hue="sky" size={32}><ScrollText size={16} /></IconChip>} title="Activity by area" subtitle="Audit entries, last 7 days" />
          {areaRows.length ? <HBars rows={areaRows} mono /> : <p className="text-[13px] text-slate-500">Nothing recorded this week.</p>}
        </Card>
      </div>

      {/* Recent activity */}
      <Card pad={false}>
        <div className="px-5 pt-5"><CardHeader icon={<IconChip hue="slate" size={32}><ScrollText size={16} /></IconChip>} title="Recent activity" subtitle="Updates every 30 seconds"
          action={<Link to="/a/audit" className="inline-flex items-center gap-1 py-2 -my-2 text-[12px] font-semibold text-indigo-700 hover:text-indigo-900">Full audit log<ArrowUpRight size={13} /></Link>} /></div>
        {recent.length === 0 ? <p className="px-5 pb-5 text-[13px] text-slate-500">Nothing recorded yet.</p> : (
          <ul className="divide-y divide-[#EEF0F3] border-t border-[#EEF0F3]">
            {recent.map(a => (
              <li key={a.id} className="px-5 py-3 flex items-center gap-3 text-[13px] hover:bg-slate-50/60">
                <span className="w-8 h-8 rounded-full bg-slate-100 text-slate-600 text-[11px] font-semibold flex items-center justify-center flex-shrink-0">{a.userName ? a.userName.split(' ').map((p: string) => p[0]).join('').slice(0, 2) : 'SY'}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate"><span className="font-semibold text-slate-900">{a.userName ?? 'System'}</span> <span className="font-mono text-[12px] text-slate-600">{a.action}</span>{a.entity && <span className="font-mono text-[12px] text-slate-400"> · {a.entity}</span>}</span>
                  <span className="block text-[12px] text-slate-500 truncate">{a.userRole ? ROLE_LABEL[a.userRole] : 'Automatic or signed-out'}</span>
                </span>
                <span className="text-[12px] tabular text-slate-500 flex-shrink-0 text-right">{dayLabel(a.at)}<span className="block sm:inline sm:ml-1">{hhmm(a.at)}</span></span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function HeroAction({ icon, children, onClick }: { icon: ReactNode; children: ReactNode; onClick: () => void }) {
  return <button onClick={onClick} className="h-10 px-3.5 rounded-xl bg-white/10 ring-1 ring-white/15 hover:bg-white/15 text-[13px] font-semibold flex items-center justify-center gap-2 backdrop-blur transition-colors">{icon}<span className="truncate">{children}</span></button>;
}

function Kpi({ to, hue, icon, label, value, sub, tone }: { to: string; hue: Hue; icon: ReactNode; label: string; value: ReactNode; sub: string; tone?: 'good' | 'warn' | 'bad' }) {
  return (
    <Link to={to} className="group block rounded-2xl bg-white ring-1 ring-[#E4E7EC] p-4 sm:p-5 hover:ring-indigo-200 hover:shadow-[0_8px_24px_-12px_rgba(79,70,229,.25)] transition">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] font-semibold text-slate-500 leading-4">{label}</span>
        <span className="hidden sm:block flex-shrink-0"><IconChip hue={hue} size={30} soft>{icon}</IconChip></span>
      </div>
      <div className={cx('mt-2 text-[24px] sm:text-[28px] font-semibold leading-none tabular tracking-[-0.02em]', tone === 'good' ? 'text-emerald-700' : tone === 'bad' ? 'text-red-600' : 'text-slate-900')}>{value}</div>
      <div className={cx('mt-2 text-[12px] leading-4 sm:truncate', tone === 'warn' ? 'text-amber-700 font-medium' : 'text-slate-500')}>{sub}</div>
    </Link>
  );
}

function OpStat({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: 'warn' | 'bad' }) {
  return (
    <div className="rounded-xl bg-slate-50 ring-1 ring-[#EEF0F3] px-3 py-2.5 min-w-0">
      <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500 truncate">{label}</div>
      <div className={cx('mt-0.5 text-[20px] font-semibold tabular', tone === 'bad' ? 'text-red-600' : tone === 'warn' ? 'text-amber-700' : 'text-slate-900')}>{value}</div>
      <div className="text-[11px] text-slate-500 truncate">{sub}</div>
    </div>
  );
}

const Key = ({ color, children }: { color: string; children: ReactNode }) => <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-[3px]" style={{ background: color }} />{children}</span>;

/** Grouped columns per day (successful vs failed sign-ins) on one shared axis, with a hover tooltip and a screen-reader table. */
function SignInChart({ days }: { days: { day: string; ok: number; failed: number }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(4, ...days.map(d => Math.max(d.ok, d.failed)));
  const step = Math.pow(10, Math.floor(Math.log10(max)));
  const top = Math.ceil(max / step) * step;
  const ticks = [0, top / 2, top];
  const H = 210;
  return (
    <div>
      <div className="relative flex gap-2" style={{ height: H + 24 }}>
        <div className="relative w-7 flex-shrink-0 text-[11px] text-slate-400 tabular" style={{ height: H }}>
          {ticks.map(t => <span key={t} className="absolute right-0 -translate-y-1/2" style={{ top: H - (t / top) * H }}>{fmt(t)}</span>)}
        </div>
        <div className="relative flex-1 min-w-0">
          {ticks.map(t => <div key={t} className="absolute inset-x-0 h-px bg-slate-100" style={{ top: H - (t / top) * H }} />)}
          <div className="absolute inset-x-0 top-0 flex" style={{ height: H }}>
            {days.map((d, i) => (
              <div key={d.day} className="relative flex-1 flex items-end justify-center gap-[2px] cursor-default" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                {hover === i && <div className="absolute inset-y-0 inset-x-1 rounded-lg bg-indigo-50/60" />}
                <div className="relative w-[min(24px,30%)] rounded-t-[4px]" style={{ height: Math.max(d.ok ? 2 : 0, (d.ok / top) * H), background: C_OK }} />
                <div className="relative w-[min(24px,30%)] rounded-t-[4px]" style={{ height: Math.max(d.failed ? 2 : 0, (d.failed / top) * H), background: C_FAIL }} />
                {hover === i && (
                  <div className={cx('absolute z-10 bottom-full mb-1 px-3 py-2 rounded-lg bg-slate-900 text-white text-[12px] shadow-lg whitespace-nowrap pointer-events-none', i > days.length - 3 ? 'right-0' : i < 2 ? 'left-0' : 'left-1/2 -translate-x-1/2')}>
                    <div className="font-semibold mb-1">{dayLabel(d.day)}</div>
                    <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-sm" style={{ background: C_OK }} />Successful <b className="ml-auto pl-3 tabular">{d.ok}</b></div>
                    <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-sm" style={{ background: C_FAIL }} />Failed <b className="ml-auto pl-3 tabular">{d.failed}</b></div>
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="absolute inset-x-0 h-px bg-slate-300" style={{ top: H }} />
          <div className="absolute inset-x-0 flex text-[11px] text-slate-500" style={{ top: H + 6 }}>
            {days.map((d, i) => <span key={d.day} className={cx('flex-1 text-center truncate', i === days.length - 1 && 'font-semibold text-slate-800')}>{i === days.length - 1 ? 'Today' : dayLabel(d.day).split(' ')[0]}</span>)}
          </div>
        </div>
      </div>
      <table className="sr-only"><caption>Sign-ins per day</caption><thead><tr><th>Day</th><th>Successful</th><th>Failed</th></tr></thead><tbody>{days.map(d => <tr key={d.day}><td>{d.day}</td><td>{d.ok}</td><td>{d.failed}</td></tr>)}</tbody></table>
    </div>
  );
}

/** Single-series horizontal bars with the value at the tip. */
function HBars({ rows, mono }: { rows: { label: string; n: number }[]; mono?: boolean }) {
  const max = Math.max(1, ...rows.map(r => r.n));
  return (
    <ul className="space-y-2.5">
      {rows.map(r => (
        <li key={r.label} className="grid grid-cols-[minmax(0,110px)_1fr] items-center gap-3 text-[13px]">
          <span className={cx('truncate text-slate-600', mono && 'font-mono text-[12px]')}>{r.label}</span>
          <span className="flex items-center gap-2 min-w-0">
            <span className="h-3.5 rounded-r-[4px] min-w-[2px]" style={{ width: `${(r.n / max) * 85}%`, background: C_BAR }} />
            <span className="text-[12px] font-semibold tabular text-slate-800">{fmt(r.n)}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function OverviewSkeleton() {
  return (
    <div className="mx-auto max-w-[1320px] min-[1700px]:max-w-[1520px] min-[2300px]:max-w-[1760px] px-4 sm:px-6 lg:px-8 py-5 sm:py-7 space-y-5">
      <Skeleton className="h-[150px] rounded-2xl" />
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">{[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-[118px] rounded-2xl" />)}</div>
      <div className="grid lg:grid-cols-[1.6fr_1fr] gap-6"><Skeleton className="h-[290px] rounded-xl" /><Skeleton className="h-[290px] rounded-xl" /></div>
    </div>
  );
}
