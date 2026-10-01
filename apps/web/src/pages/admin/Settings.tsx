import { useEffect, useState } from 'react';
import { Clock3, Save, SlidersHorizontal } from 'lucide-react';
import { Button, Callout, Card, CardHeader, Field, IconChip, inputCls } from '../../components/ds';
import { ErrorState, Loading, useAct, useApi } from '../../components/common';
import { put } from '../../lib/api';
import { AdminPage } from './AdminApp';

type Def = { key: string; label: string; hint: string; kind: 'int' | 'num' | 'time' | 'bool'; min?: number; max?: number };
const RULES: Def[] = [
  { key: 'freshBudgetMin', label: 'Fresh trip budget (min)', hint: 'Booklet: 270. Chilled goods must be delivered within this.', kind: 'int', min: 60, max: 600 },
  { key: 'styleTechBudgetMin', label: 'Style / Tech trip budget (min)', hint: 'Booklet: 480.', kind: 'int', min: 60, max: 900 },
  { key: 'maxTripsPerVehicle', label: 'Trips per vehicle per day', hint: 'Booklet: 2.', kind: 'int', min: 1, max: 3 },
  { key: 'freshDepart', label: 'Earliest Fresh departure', hint: 'Trucks leave the depot from this time.', kind: 'time' },
  { key: 'reloadMin', label: 'Reload time between trips (min)', hint: 'Back at the depot to leaving again.', kind: 'int', min: 0, max: 180 },
  { key: 'lateRiskSlackMin', label: 'Late-risk warning (min before close)', hint: 'Stops expected closer than this to the window close are flagged.', kind: 'int', min: 0, max: 120 },
];
const OPS: Def[] = [
  { key: 'cutoffTime', label: 'Order cutoff', hint: 'Orders after this go to the following run.', kind: 'time' },
  { key: 'offlineAfterMin', label: 'Show a vehicle offline after (min)', hint: 'Minutes without contact from the driver’s phone.', kind: 'int', min: 2, max: 120 },
  { key: 'receiptConfirmHours', label: 'Receipt confirmation due (hours)', hint: 'After delivery; later receipts are flagged overdue.', kind: 'num', min: 0.5, max: 72 },
  { key: 'sessionHours', label: 'Office session length (hours)', hint: 'Dispatchers, loaders, stores, admins.', kind: 'num', min: 1, max: 72 },
  { key: 'driverSessionHours', label: 'Driver session length (hours)', hint: 'Longer, so a phone without signal stays signed in.', kind: 'num', min: 1, max: 96 },
  { key: 'loaderClaimMinutes', label: 'Loader tablet lock (min)', hint: 'Another tablet can take over a trip after this much inactivity.', kind: 'int', min: 1, max: 30 },
  { key: 'useTrafficForEta', label: 'Use traffic and road conditions in ETAs', hint: 'traffic_speed.csv and road_conditions.csv.', kind: 'bool' },
];

export default function Settings() {
  const q = useApi<any>(['admin-settings'], '/admin/settings');
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorState error={q.error} retry={q.refetch} />;
  return (
    <AdminPage title="Rules and settings" subtitle="The planning rules and day-to-day operating settings. Every change is validated and recorded in the audit log.">
      <div className="grid lg:grid-cols-2 gap-6">
        <Group k="rules" title="Planning rules" icon={<SlidersHorizontal size={16} />} defs={RULES} value={q.data.rules} note="Rules from the challenge booklet. Change them only if the business rules change — every plan is re-validated against them." />
        <Group k="operations" title="Operations" icon={<Clock3 size={16} />} defs={OPS} value={q.data.operations} />
      </div>
    </AdminPage>
  );
}

function Group({ k, title, icon, defs, value, note }: { k: 'rules' | 'operations'; title: string; icon: React.ReactNode; defs: Def[]; value: any; note?: string }) {
  const [f, setF] = useState<any>(value);
  useEffect(() => setF(value), [value]);
  const errors = Object.fromEntries(defs.map(d => {
    const v = f[d.key];
    if (d.kind === 'time') return [d.key, /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? '' : 'Use HH:MM'];
    if (d.kind === 'bool') return [d.key, ''];
    const n = Number(v);
    return [d.key, Number.isFinite(n) && n >= (d.min ?? -Infinity) && n <= (d.max ?? Infinity) && (d.kind !== 'int' || Number.isInteger(n)) ? '' : `${d.min}–${d.max}${d.kind === 'int' ? ', whole number' : ''}`];
  }));
  const dirty = defs.some(d => String(f[d.key]) !== String(value[d.key]));
  const save = useAct(() => put(`/admin/settings/${k}`, Object.fromEntries(defs.map(d => [d.key, d.kind === 'int' || d.kind === 'num' ? Number(f[d.key]) : f[d.key]]))), { invalidate: ['admin-settings', 'reference', 'plan', 'tracking', 'overview'], success: `${title} saved` });
  return (
    <Card>
      <CardHeader icon={<IconChip hue="indigo" size={32}>{icon}</IconChip>} title={title} />
      {note && <Callout tone="info" className="mb-4">{note}</Callout>}
      <div className="grid gap-4">
        {defs.map(d => (
          <Field key={d.key} label={d.label} hint={errors[d.key] || d.hint}>
            {d.kind === 'bool'
              ? <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={!!f[d.key]} onChange={e => setF({ ...f, [d.key]: e.target.checked })} />On</label>
              : <input className={`${inputCls} ${errors[d.key] ? 'border-red-400' : ''}`} type={d.kind === 'time' ? 'time' : 'number'} step={d.kind === 'num' ? 0.5 : 1} value={f[d.key]} onChange={e => setF({ ...f, [d.key]: e.target.value })} />}
          </Field>
        ))}
      </div>
      <div className="mt-5 flex justify-end gap-2">
        {dirty && <Button onClick={() => setF(value)}>Undo changes</Button>}
        <Button variant="primary" icon={<Save size={14} />} disabled={!dirty || Object.values(errors).some(Boolean) || save.isPending} onClick={() => save.mutate()}>Save</Button>
      </div>
    </Card>
  );
}
