import { useRef, useState } from 'react';
import { Database, FileUp, Trash2, RotateCcw, ShieldAlert } from 'lucide-react';
import { Button, Callout, Card, CardHeader, IconChip, Modal } from '../../components/ds';
import { ErrorState, Loading, fmt, useAct, useApi, useToast } from '../../components/common';
import { del, post } from '../../lib/api';
import { dayLabel, hhmm, syncClock } from '../../lib/clock';
import { useQueryClient } from '@tanstack/react-query';
import { AdminPage } from './AdminApp';

const LABEL: Record<string, string> = {
  outlets: 'Outlets', vehicles: 'Vehicles', district_travel: 'District travel', service_allowance: 'Service allowances', calendar: 'Calendar days', traffic_speed: 'Traffic speed rows', road_conditions: 'Road-condition rows',
  demand_weekly: 'Weekly demand rows', users: 'People', orders: 'Orders', plans: 'Plan versions', trips: 'Trips', stop_events: 'Driver records', pods: 'Proofs of delivery', receipts: 'Store receipts', exceptions: 'Exceptions',
  deferrals: 'Deferrals', notifications: 'Notifications', attachments: 'Photos and signatures', audit_log: 'Audit entries',
};
const wk = (n: number | null) => (n ? `${Math.floor(n / 100)} W${String(n % 100).padStart(2, '0')}` : '—');

export default function Data() {
  const q = useApi<any>(['admin-data'], '/admin/data');
  const qc = useQueryClient();
  const toast = useToast();
  const file = useRef<HTMLInputElement>(null);
  const [confirm, setConfirm] = useState<'clear' | 'reset' | null>(null);
  const imp = useAct((csv: string) => post('/admin/data/forecast', { csv }), { invalidate: ['admin-data', 'forecast'], success: (r: any) => `Imported ${r.imported} forecast rows. The forecast page now uses them.` });
  const clear = useAct(() => del('/admin/data/forecast'), { invalidate: ['admin-data', 'forecast'], success: (r: any) => `Removed ${r.removed} imported rows`, onDone: () => setConfirm(null) });
  const reset = useAct(() => post('/demo/reset'), { onDone: async () => { await syncClock(); qc.invalidateQueries(); setConfirm(null); toast('success', 'Demo day reset'); } });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorState error={q.error} retry={q.refetch} />;
  const d = q.data;
  const imported = d.demand.find((x: any) => x.source === 'forecast_import');
  const history = d.demand.find((x: any) => x.source === 'history');
  return (
    <AdminPage title="Data and imports" subtitle="What is loaded, where it came from, and the Datathon forecast import.">
      <Callout tone="warning" icon={<ShieldAlert size={15} className="text-amber-600" />} className="mb-6" title="Competition data stays private">The datasets must not be shared with any third party. They are loaded into this database only; keep the repository and any exports private.</Callout>
      <div className="grid lg:grid-cols-[1.2fr_1fr] gap-6">
        <Card>
          <CardHeader icon={<IconChip hue="sky" size={32}><Database size={16} /></IconChip>} title="What is in the database" />
          <div className="grid sm:grid-cols-2 gap-x-6">
            {Object.entries(d.counts).map(([k, n]) => (
              <div key={k} className="flex items-center justify-between py-2 border-b border-[#EEF0F3] text-[13px]"><span className="text-slate-600">{LABEL[k] ?? k}</span><span className="font-semibold tabular text-slate-900">{fmt(n as number)}</span></div>
            ))}
          </div>
          <div className="mt-4 grid gap-1 text-[12px] text-slate-500">
            <div>Calendar {d.calendar.from} → {d.calendar.to} · road conditions {d.roadConditions.from ?? '—'} → {d.roadConditions.to ?? '—'}</div>
            <div>Orders {d.orders.from ?? '—'} → {d.orders.to ?? '—'} · photos {fmt(d.attachments.count)} ({fmt(d.attachments.bytes / 1024 / 1024, 1)} MB{d.attachments.inSupabase ? `, ${d.attachments.inSupabase} in Supabase Storage` : ''})</div>
          </div>
        </Card>
        <div className="space-y-6">
          <Card>
            <CardHeader icon={<IconChip hue="violet" size={32}><FileUp size={16} /></IconChip>} title="Datathon forecast (Task 2A)" subtitle="Upload submission_task2a.csv to replace the baseline forecast" />
            <div className="text-[13px] text-slate-600 space-y-1">
              <div>History: {history ? `${history.rows} rows, ${wk(history.fromWeek)} → ${wk(history.toWeek)}` : 'none'}</div>
              <div>Imported forecast: {imported ? <>{imported.rows} rows, {wk(imported.fromWeek)} → {wk(imported.toWeek)} · {dayLabel(imported.importedAt)} {hhmm(imported.importedAt)}</> : 'none — the baseline is used'}</div>
            </div>
            <p className="mt-3 text-[12px] text-slate-500">Columns: row_id, pred_total_volume_m3, pred_chilled_volume_m3 (row ids from task2a_test_inputs.csv), or depot, brand, iso_year, iso_week, total_m3, chilled_m3. Every row is checked before anything is saved.</p>
            <input ref={file} type="file" accept=".csv,text/csv" className="sr-only" onChange={async e => {
              const f = e.target.files?.[0]; e.target.value = '';
              if (!f) return;
              if (f.size > 2_000_000) { toast('error', 'The file is larger than 2 MB.'); return; }
              imp.mutate(await f.text());
            }} />
            <div className="mt-4 flex flex-wrap gap-2">
              <Button variant="primary" icon={<FileUp size={14} />} disabled={imp.isPending} onClick={() => file.current?.click()}>{imp.isPending ? 'Checking…' : 'Upload CSV'}</Button>
              {imported && <Button variant="danger" icon={<Trash2 size={14} />} onClick={() => setConfirm('clear')}>Remove import</Button>}
            </div>
          </Card>
          {d.demoMode && (
            <Card>
              <CardHeader icon={<IconChip hue="amber" size={32}><RotateCcw size={16} /></IconChip>} title="Demo day" subtitle="DEMO_MODE is on" />
              <p className="text-[13px] text-slate-600">Reload the seeded Thursday 30 April: 143 confirmed orders, no plan, clock at 02:30. People, settings and the audit log are kept.</p>
              <div className="mt-4"><Button variant="danger" icon={<RotateCcw size={14} />} onClick={() => setConfirm('reset')}>Reset demo day</Button></div>
            </Card>
          )}
        </div>
      </div>
      {confirm && (
        <Modal title={confirm === 'clear' ? 'Remove the imported forecast?' : 'Reset the demo day?'} onClose={() => setConfirm(null)} width={420}>
          <p className="text-[13px] text-slate-600">{confirm === 'clear' ? 'The forecast page goes back to the baseline for those weeks.' : 'This clears today’s plan, loading, deliveries, receipts and notifications.'}</p>
          <div className="mt-6 flex justify-end gap-2"><Button onClick={() => setConfirm(null)}>Cancel</Button><Button variant="danger" disabled={clear.isPending || reset.isPending} onClick={() => (confirm === 'clear' ? clear.mutate() : reset.mutate())}>{confirm === 'clear' ? 'Remove' : 'Reset'}</Button></div>
        </Modal>
      )}
    </AdminPage>
  );
}
