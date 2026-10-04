import type { ReactNode } from 'react';
import { Activity, CheckCircle2, Cloud, Database, ShieldCheck, XCircle } from 'lucide-react';
import { Card, CardHeader, IconChip, KeyValues } from '../../components/ds';
import { ErrorState, Loading, useApi } from '../../components/common';
import { dayLabel, hhmm } from '../../lib/clock';
import { AdminPage } from './AdminApp';

const Ok = ({ ok, children }: { ok: boolean; children: ReactNode }) => <span className={`inline-flex items-center gap-1 font-semibold ${ok ? 'text-emerald-700' : 'text-red-700'}`}>{ok ? <CheckCircle2 size={13} /> : <XCircle size={13} />}{children}</span>;
const dur = (s: number) => (s < 3600 ? `${Math.round(s / 60)} min` : s < 86400 ? `${(s / 3600).toFixed(1)} h` : `${(s / 86400).toFixed(1)} days`);

export default function System() {
  const q = useApi<any>(['admin-system'], '/admin/system', { refetchInterval: 30_000 });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorState error={q.error} retry={q.refetch} />;
  const s = q.data;
  return (
    <AdminPage title="System health" subtitle="Refreshes every 30 seconds.">
      <div className="grid lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader icon={<IconChip hue="emerald" size={32}><Activity size={16} /></IconChip>} title="Service" />
          <KeyValues items={[['Status', <Ok ok>{s.status}</Ok>], ['Up for', dur(s.uptimeSec)], ['Environment', s.env], ['Node.js', s.node], ['Demo mode', s.demoMode ? 'On (demo clock and reset enabled)' : 'Off'], ['Allowed origins', s.corsOrigins.length ? s.corsOrigins.join(', ') : 'Same origin only']]} />
        </Card>
        <Card>
          <CardHeader icon={<IconChip hue="sky" size={32}><Database size={16} /></IconChip>} title="Database" />
          <KeyValues items={[['Connection', <Ok ok={s.database.ok}>{s.database.latencyMs} ms</Ok>], ['Server', s.database.version], ['Database', s.database.name], ['TLS', s.database.ssl ? 'Required' : 'Off'], ['Pool', `${s.database.pool.total} open · ${s.database.pool.idle} idle · ${s.database.pool.waiting} waiting`], ['Migrations', `${s.migrations.length} applied · last ${s.migrations.at(-1)?.name ?? '—'}`]]} />
        </Card>
        <Card>
          <CardHeader icon={<IconChip hue="indigo" size={32}><ShieldCheck size={16} /></IconChip>} title="Security" />
          <KeyValues items={[['Row-level security', <Ok ok={s.rls.missing.length === 0}>{s.rls.enabled} of {s.rls.total} tables</Ok>], ['Tables without RLS', s.rls.missing.length ? s.rls.missing.join(', ') : 'None (schema_migrations is internal)'], ['Password checks', s.providers.auth === 'supabase' ? 'Supabase Auth' : 'PathWise (bcrypt)'], ['Sessions', 'Signed tokens, revoked on password change or disable'], ['Sign-in limits', '30 a minute per address · lock after 5 wrong passwords']]} />
        </Card>
        <Card>
          <CardHeader icon={<IconChip hue="violet" size={32}><Cloud size={16} /></IconChip>} title="Supabase" />
          {s.supabase ? <KeyValues items={[['Project', s.providers.supabaseUrl], ['Auth', <Ok ok={s.supabase.auth}>{s.supabase.auth ? 'Reachable' : 'Not reachable'}</Ok>], ['Storage', s.providers.storage === 'supabase' ? <Ok ok={s.supabase.storage}>{s.supabase.storage ? `Bucket ${s.providers.bucket}` : 'Bucket not reachable'}</Ok> : 'Not used (photos in the database)']]} />
            : <p className="text-[13px] text-slate-600">Not in use. Passwords are checked by PathWise and photos are stored in the database. Set AUTH_PROVIDER / STORAGE_PROVIDER to “supabase” to use Supabase Auth and Storage.</p>}
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title="Migrations" />
          <div className="grid sm:grid-cols-3 gap-2 text-[13px]">{s.migrations.map((m: any) => <div key={m.name} className="rounded-md bg-slate-50 px-3 py-2"><div className="font-mono text-[12px] text-slate-800">{m.name}</div><div className="text-[11px] text-slate-500">{dayLabel(m.appliedAt)} {hhmm(m.appliedAt)}</div></div>)}</div>
        </Card>
      </div>
    </AdminPage>
  );
}
