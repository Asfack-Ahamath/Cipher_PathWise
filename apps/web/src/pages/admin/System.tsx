import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Activity, CheckCircle2, Cloud, Cpu, Database, HardDrive, Lock, RefreshCw, ServerCog, ShieldCheck, XCircle } from 'lucide-react';
import { Button, Card, CardHeader, IconChip, KeyValues, Skeleton, cx } from '../../components/ds';
import { ErrorState, fmt, useApi } from '../../components/common';
import { dayLabel, hhmm } from '../../lib/clock';
import { AdminPage } from './AdminApp';

const dur = (s: number) => (s < 3600 ? `${Math.max(1, Math.round(s / 60))} min` : s < 86400 ? `${(s / 3600).toFixed(1)} h` : `${(s / 86400).toFixed(1)} days`);
const bytes = (n: number) => (n < 1024 ** 2 ? `${(n / 1024).toFixed(0)} KB` : n < 1024 ** 3 ? `${(n / 1024 ** 2).toFixed(1)} MB` : `${(n / 1024 ** 3).toFixed(2)} GB`);
const C = { ok: '#059669', warn: '#D97706', bad: '#DC2626', line: '#6366F1', bar: '#818CF8', track: '#EEF0F3' };
type Tone = 'ok' | 'warn' | 'bad';
const TONE_TEXT: Record<Tone, string> = { ok: 'text-emerald-700', warn: 'text-amber-700', bad: 'text-red-700' };
const TONE_SOFT: Record<Tone, string> = { ok: 'bg-emerald-50 ring-emerald-100 text-emerald-800', warn: 'bg-amber-50 ring-amber-100 text-amber-800', bad: 'bg-red-50 ring-red-100 text-red-800' };
const latencyTone = (ms: number): Tone => (ms < 150 ? 'ok' : ms < 500 ? 'warn' : 'bad');

/** System health: an overall verdict, one row per service, live latency, capacity and storage. Refreshes every 15 seconds. */
export default function System() {
  const q = useApi<any>(['admin-system'], '/admin/system', { refetchInterval: 15_000 });
  // keep the last 40 database latency readings seen in this session for the trend line
  const samples = useRef<{ at: number; ms: number }[]>([]);
  const [, bump] = useState(0);
  useEffect(() => {
    if (!q.data) return;
    const last = samples.current[samples.current.length - 1];
    if (last && last.at === q.dataUpdatedAt) return;
    samples.current = [...samples.current, { at: q.dataUpdatedAt, ms: q.data.database.latencyMs }].slice(-40);
    bump(n => n + 1);
  }, [q.data, q.dataUpdatedAt]);

  if (q.error && !q.data) return <AdminPage title="System health"><ErrorState error={q.error} retry={q.refetch} /></AdminPage>;
  if (!q.data) return <AdminPage title="System health" subtitle="Checking services…"><div className="space-y-4"><Skeleton className="h-[120px] rounded-2xl" /><div className="grid lg:grid-cols-3 gap-4"><Skeleton className="h-[260px]" /><Skeleton className="h-[260px]" /><Skeleton className="h-[260px]" /></div></div></AdminPage>;

  const s = q.data;
  const sb = s.supabase;
  const checks: { name: string; icon: ReactNode; tone: Tone; detail: string }[] = [
    { name: 'API service', icon: <ServerCog size={15} />, tone: 'ok', detail: `Up ${dur(s.uptimeSec)} · Node ${s.node}` },
    { name: 'Database', icon: <Database size={15} />, tone: s.database.ok ? latencyTone(s.database.latencyMs) : 'bad', detail: `${s.database.latencyMs} ms · ${s.database.version}` },
    { name: 'Row-level security', icon: <ShieldCheck size={15} />, tone: s.rls.missing.length ? 'bad' : 'ok', detail: s.rls.missing.length ? `Missing on ${s.rls.missing.join(', ')}` : `${s.rls.enabled} of ${s.rls.total} tables protected` },
    { name: 'Sign-in provider', icon: <Lock size={15} />, tone: s.providers.auth === 'supabase' ? (sb?.auth ? 'ok' : 'bad') : 'ok', detail: s.providers.auth === 'supabase' ? (sb?.auth ? 'Supabase Auth reachable' : 'Supabase Auth not reachable') : 'PathWise passwords (bcrypt)' },
    { name: 'File storage', icon: <HardDrive size={15} />, tone: s.providers.storage === 'supabase' ? (sb?.storage ? 'ok' : 'bad') : 'ok', detail: s.providers.storage === 'supabase' ? (sb?.storage ? `Bucket ${s.providers.bucket}` : 'Bucket not reachable') : 'Photos kept in the database' },
  ];
  const bad = checks.filter(c => c.tone === 'bad').length, warn = checks.filter(c => c.tone === 'warn').length;
  const verdict: Tone = bad ? 'bad' : warn ? 'warn' : 'ok';
  const heap = s.process.heapUsedMb / Math.max(1, s.process.heapTotalMb);
  const pool = s.database.pool;
  const poolMax = Math.max(1, pool.total + pool.waiting);
  const tablesMax = Math.max(1, ...s.storage.tables.map((t: any) => t.bytes));

  return (
    <AdminPage title="System health" subtitle="Live status of the services PathWise depends on." actions={
      <Button icon={<RefreshCw size={14} className={q.isFetching ? 'animate-spin' : ''} />} onClick={() => void q.refetch()} disabled={q.isFetching}>Check now</Button>}>
      {/* Verdict */}
      <section className={cx('rounded-2xl ring-1 px-5 sm:px-6 py-5 flex flex-col sm:flex-row sm:items-center gap-4', TONE_SOFT[verdict])}>
        <span className="w-14 h-14 rounded-2xl bg-white/80 flex items-center justify-center flex-shrink-0">{verdict === 'ok' ? <CheckCircle2 size={28} className="text-emerald-600" /> : <XCircle size={28} className={verdict === 'bad' ? 'text-red-600' : 'text-amber-600'} />}</span>
        <div className="flex-1 min-w-0">
          <div className="text-[18px] sm:text-[20px] font-semibold tracking-[-0.01em]">{verdict === 'ok' ? 'All systems operational' : verdict === 'warn' ? 'Running, but slower than usual' : `${bad} service${bad > 1 ? 's' : ''} need attention`}</div>
          <div className="text-[13px] opacity-80 mt-0.5">{checks.length - bad - warn} of {checks.length} checks healthy · last checked {hhmm(s.checkedAt)} · {s.env}{s.demoMode ? ' · demo mode' : ''}</div>
        </div>
        <div className="grid grid-cols-3 gap-4 sm:gap-6 text-center sm:text-right">
          <Stat label="Uptime" value={dur(s.uptimeSec)} /><Stat label="DB latency" value={`${s.database.latencyMs} ms`} /><Stat label="Memory" value={`${s.process.rssMb} MB`} />
        </div>
      </section>

      <div className="grid lg:grid-cols-[1.1fr_1fr] gap-5 sm:gap-6 mt-5 sm:mt-6">
        {/* Services */}
        <Card pad={false}>
          <div className="px-5 pt-5"><CardHeader icon={<IconChip hue="emerald" size={32}><Activity size={16} /></IconChip>} title="Services" subtitle="Each dependency, checked on every refresh" /></div>
          <ul className="divide-y divide-[#EEF0F3] border-t border-[#EEF0F3]">
            {checks.map(c => (
              <li key={c.name} className="px-5 py-3.5 flex items-center gap-3">
                <span className={cx('w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ring-1', TONE_SOFT[c.tone])}>{c.icon}</span>
                <span className="flex-1 min-w-0"><span className="block text-[13px] font-semibold text-slate-900">{c.name}</span><span className="block text-[12px] text-slate-500 truncate">{c.detail}</span></span>
                <span className={cx('inline-flex items-center gap-1.5 text-[12px] font-semibold flex-shrink-0', TONE_TEXT[c.tone])}><span className="w-2 h-2 rounded-full" style={{ background: C[c.tone] }} />{c.tone === 'ok' ? 'Healthy' : c.tone === 'warn' ? 'Slow' : 'Down'}</span>
              </li>
            ))}
          </ul>
        </Card>

        {/* Latency trend */}
        <Card>
          <CardHeader icon={<IconChip hue="indigo" size={32}><Activity size={16} /></IconChip>} title="Database latency" subtitle={`${samples.current.length} reading${samples.current.length === 1 ? '' : 's'} this session · every 15 s`} />
          <LatencyChart samples={samples.current} />
          <div className="mt-3 grid grid-cols-3 gap-3 text-center">
            <Mini label="Now" value={`${s.database.latencyMs} ms`} tone={latencyTone(s.database.latencyMs)} />
            <Mini label="Average" value={`${Math.round(samples.current.reduce((a, x) => a + x.ms, 0) / Math.max(1, samples.current.length))} ms`} />
            <Mini label="Worst" value={`${Math.max(...samples.current.map(x => x.ms), 0)} ms`} />
          </div>
        </Card>
      </div>

      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-5 sm:gap-6 mt-5 sm:mt-6">
        {/* Capacity */}
        <Card>
          <CardHeader icon={<IconChip hue="sky" size={32}><Cpu size={16} /></IconChip>} title="Capacity" subtitle="Server and connection pool" />
          <div className="space-y-4">
            <Meter label="API memory (heap)" value={`${s.process.heapUsedMb} of ${s.process.heapTotalMb} MB`} pct={heap} tone={heap > 0.9 ? 'bad' : heap > 0.75 ? 'warn' : 'ok'} />
            <Meter label="Database connections" value={`${pool.total - pool.idle} busy · ${pool.idle} idle${pool.waiting ? ` · ${pool.waiting} waiting` : ''}`} pct={(pool.total - pool.idle) / poolMax} tone={pool.waiting ? 'bad' : 'ok'} />
            <Meter label="Row-level security" value={`${s.rls.enabled} of ${s.rls.total} tables`} pct={s.rls.total ? s.rls.enabled / s.rls.total : 1} tone={s.rls.missing.length ? 'bad' : 'ok'} invert />
          </div>
          <div className="mt-4 pt-4 border-t border-[#EEF0F3]"><KeyValues cols={2} items={[['Resident memory', `${s.process.rssMb} MB`], ['CPU cores', String(s.process.cpus)]]} /></div>
        </Card>

        {/* Storage */}
        <Card className="xl:col-span-2">
          <CardHeader icon={<IconChip hue="violet" size={32}><HardDrive size={16} /></IconChip>} title="Storage" subtitle={`Database ${bytes(s.storage.dbBytes)} · largest tables`} />
          <ul className="space-y-2.5">
            {s.storage.tables.map((t: any) => (
              <li key={t.name} className="grid grid-cols-[minmax(0,130px)_1fr_auto] sm:grid-cols-[minmax(0,160px)_1fr_auto] items-center gap-3 text-[13px]">
                <span className="font-mono text-[12px] text-slate-700 truncate">{t.name}</span>
                <span className="h-3.5 rounded-full bg-[#F1F3F7] overflow-hidden"><span className="block h-full rounded-r-[4px]" style={{ width: `${Math.max(1.5, (t.bytes / tablesMax) * 100)}%`, background: C.bar }} /></span>
                <span className="text-[12px] tabular text-slate-600 text-right whitespace-nowrap"><b className="text-slate-900">{bytes(t.bytes)}</b><span className="hidden sm:inline text-slate-400"> · ~{fmt(t.rows)} rows</span></span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <div className="grid lg:grid-cols-2 gap-5 sm:gap-6 mt-5 sm:mt-6">
        <Card>
          <CardHeader icon={<IconChip hue="indigo" size={32}><ShieldCheck size={16} /></IconChip>} title="Security" />
          <KeyValues cols={2} items={[
            ['Password checks', s.providers.auth === 'supabase' ? 'Supabase Auth' : 'PathWise (bcrypt)'], ['TLS to database', s.database.ssl ? 'Required' : 'Off'],
            ['Sessions', 'Signed, revoked on change'], ['Sign-in limits', '30/min · lock after 5'],
            ['Allowed origins', s.corsOrigins.length ? s.corsOrigins.join(', ') : 'Same origin only'], ['Tables without RLS', s.rls.missing.length ? s.rls.missing.join(', ') : 'None'],
          ]} />
        </Card>
        <Card>
          <CardHeader icon={<IconChip hue="violet" size={32}><Cloud size={16} /></IconChip>} title="Supabase" />
          {sb ? <KeyValues cols={2} items={[['Project', s.providers.supabaseUrl ?? '—'], ['Auth', <Dot ok={sb.auth}>{sb.auth ? 'Reachable' : 'Not reachable'}</Dot>], ['Storage', s.providers.storage === 'supabase' ? <Dot ok={sb.storage}>{sb.storage ? `Bucket ${s.providers.bucket}` : 'Not reachable'}</Dot> : 'Not used'], ['Database', s.database.name]]} />
            : <p className="text-[13px] text-slate-600 leading-6">Not in use. Passwords are checked by PathWise and photos are stored in the database. Set AUTH_PROVIDER / STORAGE_PROVIDER to “supabase” to use Supabase Auth and Storage.</p>}
        </Card>
      </div>

      <Card className="mt-5 sm:mt-6">
        <CardHeader icon={<IconChip hue="slate" size={32}><Database size={16} /></IconChip>} title="Migrations" subtitle={`${s.migrations.length} applied · newest last`} />
        <ol className="relative border-l border-[#E4E7EC] ml-2 space-y-3">
          {s.migrations.map((m: any, i: number) => (
            <li key={m.name} className="pl-5 relative">
              <span className={cx('absolute -left-[5px] top-1.5 w-2.5 h-2.5 rounded-full ring-2 ring-white', i === s.migrations.length - 1 ? 'bg-indigo-500' : 'bg-slate-300')} />
              <div className="flex flex-wrap items-baseline gap-x-3"><span className="font-mono text-[12px] text-slate-800">{m.name}</span><span className="text-[11px] text-slate-500 tabular">{dayLabel(m.appliedAt)} {hhmm(m.appliedAt)}</span></div>
            </li>
          ))}
        </ol>
      </Card>
    </AdminPage>
  );
}

const Stat = ({ label, value }: { label: string; value: string }) => <div><div className="text-[11px] uppercase tracking-[0.06em] opacity-70">{label}</div><div className="text-[16px] sm:text-[18px] font-semibold tabular">{value}</div></div>;
const Mini = ({ label, value, tone }: { label: string; value: string; tone?: Tone }) => <div className="rounded-lg bg-slate-50 ring-1 ring-[#EEF0F3] py-2"><div className="text-[11px] text-slate-500">{label}</div><div className={cx('text-[14px] font-semibold tabular', tone ? TONE_TEXT[tone] : 'text-slate-900')}>{value}</div></div>;
const Dot = ({ ok, children }: { ok: boolean; children: ReactNode }) => <span className={cx('inline-flex items-center gap-1.5 font-semibold', ok ? 'text-emerald-700' : 'text-red-700')}><span className="w-2 h-2 rounded-full" style={{ background: ok ? C.ok : C.bad }} />{children}</span>;

/** A bar that fills as the resource is used up (turns amber, then red). `invert` reads full as good (coverage). */
function Meter({ label, value, pct, tone }: { label: string; value: string; pct: number; tone: Tone; invert?: boolean }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-[12px]"><span className="font-medium text-slate-700">{label}</span><span className="text-slate-500 tabular text-right">{value}</span></div>
      <div className="mt-1.5 h-2 rounded-full overflow-hidden" style={{ background: C.track }} role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(Math.min(1, pct) * 100)}>
        <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${Math.max(2, Math.min(1, pct) * 100)}%`, background: C[tone] }} />
      </div>
    </div>
  );
}

/** One-series line on a single axis: 2px line, end dot with a surface ring, hairline grid, hover readout. */
function LatencyChart({ samples }: { samples: { at: number; ms: number }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 560, H = 150, P = { l: 34, r: 12, t: 10, b: 20 };
  if (samples.length < 2) return <div className="h-[150px] flex items-center justify-center text-[13px] text-slate-500 rounded-xl bg-slate-50 ring-1 ring-[#EEF0F3]">Collecting readings…</div>;
  const max = Math.max(50, ...samples.map(s => s.ms));
  const top = Math.ceil(max / 50) * 50;
  const x = (i: number) => P.l + (i / (samples.length - 1)) * (W - P.l - P.r);
  const y = (v: number) => P.t + (1 - v / top) * (H - P.t - P.b);
  const pts = samples.map((s, i) => `${x(i).toFixed(1)},${y(s.ms).toFixed(1)}`);
  const line = `M${pts.join('L')}`;
  const area = `${line}L${x(samples.length - 1)},${H - P.b}L${x(0)},${H - P.b}Z`;
  const h = hover ?? samples.length - 1;
  const t = (n: number) => new Date(n).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: 'Asia/Colombo' });
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label={`Database latency over the last ${samples.length} readings, now ${samples[samples.length - 1].ms} milliseconds`}
        onMouseLeave={() => setHover(null)} onMouseMove={e => { const r = e.currentTarget.getBoundingClientRect(); const px = ((e.clientX - r.left) / r.width) * W; setHover(Math.max(0, Math.min(samples.length - 1, Math.round(((px - P.l) / (W - P.l - P.r)) * (samples.length - 1))))); }}>
        {[0, top / 2, top].map(v => <g key={v}><line x1={P.l} x2={W - P.r} y1={y(v)} y2={y(v)} stroke="#EEF0F3" strokeWidth="1" /><text x={P.l - 6} y={y(v) + 4} textAnchor="end" fontSize="11" fill="#98A2B3">{v}</text></g>)}
        <path d={area} fill={C.line} opacity=".1" />
        <path d={line} fill="none" stroke={C.line} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {hover != null && <line x1={x(h)} x2={x(h)} y1={P.t} y2={H - P.b} stroke="#CBD5E1" strokeWidth="1" />}
        <circle cx={x(h)} cy={y(samples[h].ms)} r="4.5" fill={C.line} stroke="#fff" strokeWidth="2" />
        <text x={P.l} y={H - 4} fontSize="11" fill="#98A2B3">{t(samples[0].at)}</text>
        <text x={W - P.r} y={H - 4} textAnchor="end" fontSize="11" fill="#98A2B3">{t(samples[samples.length - 1].at)}</text>
      </svg>
      <div className="absolute top-0 right-2 px-2 py-1 rounded-md bg-slate-900 text-white text-[11px] tabular pointer-events-none">{t(samples[h].at)} · <b>{samples[h].ms} ms</b></div>
    </div>
  );
}
