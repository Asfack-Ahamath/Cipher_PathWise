import { useMemo, useState } from 'react';
import { Search, Truck, Wrench } from 'lucide-react';
import { Button, Card, Field, Modal, Segmented, cx, inputCls } from '../../components/ds';
import { ErrorState, Loading, fmt, useAct, useApi } from '../../components/common';
import { patch } from '../../lib/api';
import { AdminPage } from './AdminApp';

export default function Fleet() {
  const q = useApi<any[]>(['admin-vehicles'], '/admin/vehicles');
  const [depot, setDepot] = useState('all');
  const [text, setText] = useState('');
  const [edit, setEdit] = useState<any | null>(null);
  const rows = useMemo(() => (q.data ?? []).filter(v => (depot === 'all' || v.depot === depot) && (!text || `${v.id} ${v.driverName} ${v.type} ${v.temp}`.toLowerCase().includes(text.toLowerCase()))), [q.data, depot, text]);
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorState error={q.error} retry={q.refetch} />;
  const workshop = (q.data ?? []).filter(v => v.status === 'in_workshop').length;
  return (
    <AdminPage title="Fleet" subtitle={`${q.data?.length} vehicles · ${workshop} in the workshop. Capacities come from vehicles.csv; the planner never uses a vehicle marked in the workshop.`}>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <span className="relative"><Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" /><input value={text} onChange={e => setText(e.target.value)} placeholder="Vehicle or driver" className={cx(inputCls, 'pl-8 w-56')} aria-label="Search vehicles" /></span>
        <Segmented size="sm" value={depot} onChange={setDepot} options={[{ id: 'all', label: 'Both depots' }, { id: 'Peliyagoda', label: 'Peliyagoda' }, { id: 'Kandy', label: 'Kandy' }]} />
      </div>
      <Card pad={false}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[940px] text-[13px]">
            <thead className="bg-[#F9FAFB] border-b border-[#E4E7EC]"><tr>{['Vehicle', 'Depot', 'Type', 'Capacity', 'Fuel this week', 'Driver', 'Status', ''].map(h => <th key={h} className="text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500 px-4 h-10">{h}</th>)}</tr></thead>
            <tbody>
              {rows.map(v => {
                const pct = Math.min(100, (v.fuelUsedL / v.fuelQuotaL) * 100);
                return (
                  <tr key={v.id} className="border-t border-[#EEF0F3]">
                    <td className="px-4 py-3 font-semibold text-slate-900">{v.id}</td>
                    <td className="px-4 py-3">{v.depot}</td>
                    <td className="px-4 py-3 capitalize">{v.type} · {v.temp}</td>
                    <td className="px-4 py-3 tabular text-slate-600">{fmt(v.weightCap)} kg · {fmt(v.volumeCap, 1)} m³</td>
                    <td className="px-4 py-3"><div className="w-28 h-1.5 rounded-full bg-slate-100 overflow-hidden"><div className={cx('h-full', pct > 90 ? 'bg-red-500' : pct > 75 ? 'bg-amber-500' : 'bg-teal-600')} style={{ width: `${pct}%` }} /></div><div className="text-[11px] text-slate-500 mt-1 tabular">{fmt(v.fuelUsedL)} of {fmt(v.fuelQuotaL)} L</div></td>
                    <td className="px-4 py-3">{v.driverName}{v.drivers?.length ? <div className="text-[11px] text-slate-500">{v.drivers.map((d: any) => d.email).join(', ')}</div> : null}</td>
                    <td className="px-4 py-3">{v.status === 'available' ? <span className="text-[12px] font-semibold text-emerald-700">Available</span> : <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-amber-700"><Wrench size={12} />{v.statusNote ?? 'Workshop'}</span>}</td>
                    <td className="px-4 py-3 text-right"><Button size="sm" icon={<Truck size={14} />} onClick={() => setEdit(v)}>Edit</Button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
      {edit && <VehicleDialog v={edit} onClose={() => setEdit(null)} />}
    </AdminPage>
  );
}

function VehicleDialog({ v, onClose }: { v: any; onClose: () => void }) {
  const [f, setF] = useState({ status: v.status, statusNote: v.statusNote ?? '', driverName: v.driverName ?? '', fuelUsedL: String(v.fuelUsedL), fuelQuotaL: String(v.fuelQuotaL) });
  const save = useAct(() => patch(`/admin/vehicles/${v.id}`, { status: f.status, statusNote: f.statusNote.trim() || null, driverName: f.driverName.trim(), fuelUsedL: Number(f.fuelUsedL), fuelQuotaL: Number(f.fuelQuotaL) }), { invalidate: ['admin-vehicles', 'reference', 'plan', 'overview'], success: `${v.id} saved`, onDone: onClose });
  const invalid = f.status === 'in_workshop' && !f.statusNote.trim() || !f.driverName.trim() || !(Number(f.fuelQuotaL) > 0) || !(Number(f.fuelUsedL) >= 0);
  return (
    <Modal title={`${v.id} · ${v.type} ${v.temp} · ${v.depot}`} onClose={onClose} width={480}>
      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="Status"><select className={inputCls} value={f.status} onChange={e => setF({ ...f, status: e.target.value })}><option value="available">Available</option><option value="in_workshop">In the workshop</option></select></Field>
        <Field label="Reason (workshop)"><input className={inputCls} value={f.statusNote} placeholder="e.g. Brake service" onChange={e => setF({ ...f, statusNote: e.target.value })} /></Field>
        <Field label="Driver name"><input className={inputCls} value={f.driverName} onChange={e => setF({ ...f, driverName: e.target.value })} /></Field>
        <div />
        <Field label="Fuel used this week (L)"><input className={inputCls} type="number" min={0} value={f.fuelUsedL} onChange={e => setF({ ...f, fuelUsedL: e.target.value })} /></Field>
        <Field label="Weekly fuel quota (L)"><input className={inputCls} type="number" min={1} value={f.fuelQuotaL} onChange={e => setF({ ...f, fuelQuotaL: e.target.value })} /></Field>
      </div>
      <p className="mt-4 text-[12px] text-slate-500">A vehicle on the road cannot be sent to the workshop from here — report a fault on its trip so the dispatcher can swap it.</p>
      <div className="mt-6 flex justify-end gap-2"><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={invalid || save.isPending} onClick={() => save.mutate()}>Save</Button></div>
    </Modal>
  );
}
