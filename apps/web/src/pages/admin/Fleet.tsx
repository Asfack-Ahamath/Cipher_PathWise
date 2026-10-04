import { useMemo, useState } from 'react';
import { Download, Plus, Search, Truck, Wrench } from 'lucide-react';
import { Button, Card, Empty, Field, Modal, cx, inputCls, thCls } from '../../components/ds';
import { Select } from '../../components/Select';
import { ErrorState, Loading, fmt, useAct, useApi } from '../../components/common';
import { patch, post } from '../../lib/api';
import { downloadCsv, stamp } from '../../lib/csv';
import { AdminPage, FilterBar } from './AdminApp';

export default function Fleet() {
  const q = useApi<any[]>(['admin-vehicles'], '/admin/vehicles');
  const [depot, setDepot] = useState('all');
  const [text, setText] = useState('');
  const [status, setStatus] = useState('all');
  const [edit, setEdit] = useState<any | null>(null);
  const [adding, setAdding] = useState(false);
  const rows = useMemo(() => (q.data ?? []).filter(v => (depot === 'all' || v.depot === depot) && (status === 'all' || v.status === status) && (!text || `${v.id} ${v.driverName} ${v.type} ${v.temp}`.toLowerCase().includes(text.toLowerCase()))), [q.data, depot, status, text]);
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorState error={q.error} retry={q.refetch} />;
  const workshop = (q.data ?? []).filter(v => v.status === 'in_workshop').length;
  return (
    <AdminPage title="Fleet" subtitle={`${q.data?.length} vehicles · ${workshop} in the workshop. New vehicles join the next Auto-plan; the planner never uses a vehicle marked in the workshop.`}
      actions={<><Button variant="primary" icon={<Plus size={15} />} onClick={() => setAdding(true)}>Add vehicle</Button><Button icon={<Download size={15} />} disabled={!rows.length} onClick={() => downloadCsv(`pathwise-fleet-${stamp()}.csv`, ['Vehicle', 'Depot', 'Type', 'Temperature', 'Weight cap (kg)', 'Volume cap (m3)', 'Fuel used (L)', 'Fuel quota (L)', 'Driver', 'Status', 'Note'],
        rows.map(v => [v.id, v.depot, v.type, v.temp, v.weightCap, v.volumeCap, v.fuelUsedL, v.fuelQuotaL, v.driverName, v.status === 'available' ? 'Available' : 'In the workshop', v.statusNote]))}>Export CSV</Button></>}>
      <FilterBar>
        <span className="relative sm:w-64"><Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" /><input value={text} onChange={e => setText(e.target.value)} placeholder="Vehicle or driver" className={cx(inputCls, 'pl-8')} aria-label="Search vehicles" /></span>
        <div className="grid grid-cols-2 gap-2 sm:flex">
          <div className="sm:w-44"><Select value={depot} onChange={setDepot} aria-label="Depot" options={[{ value: 'all', label: 'Both depots' }, { value: 'Peliyagoda', label: 'Peliyagoda' }, { value: 'Kandy', label: 'Kandy' }]} /></div>
          <div className="sm:w-44"><Select value={status} onChange={setStatus} aria-label="Status" options={[{ value: 'all', label: 'Any status' }, { value: 'available', label: 'Available', icon: <span className="block w-2 h-2 rounded-full bg-emerald-600" /> }, { value: 'in_workshop', label: 'In the workshop', icon: <Wrench size={13} /> }]} /></div>
        </div>
        <span className="sm:ml-auto text-[12px] text-slate-500">{rows.length} of {q.data?.length ?? 0}</span>
      </FilterBar>
      <Card pad={false}>
        <ul className="md:hidden divide-y divide-[#EEF0F3]">
          {rows.length === 0 && <li><Empty icon={<Truck size={20} />} title="No vehicle matches">Change the search or the filters.</Empty></li>}
          {rows.map(v => {
            const pct = Math.min(100, (v.fuelUsedL / v.fuelQuotaL) * 100);
            return (
              <li key={v.id} className="px-4 py-3.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0"><div className="font-semibold text-[14px] text-slate-900">{v.id} <span className="font-normal text-[12px] text-slate-500">· {v.depot}</span></div><div className="text-[12px] text-slate-500 capitalize">{v.type} · {v.temp} · {fmt(v.weightCap)} kg · {fmt(v.volumeCap, 1)} m³</div></div>
                  {v.status === 'available' ? <span className="text-[12px] font-semibold text-emerald-700 flex-shrink-0">Available</span> : <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-amber-700 flex-shrink-0"><Wrench size={12} />{v.statusNote ?? 'Workshop'}</span>}
                </div>
                <div className="mt-2.5 h-1.5 rounded-full bg-slate-100 overflow-hidden"><div className={cx('h-full', pct > 90 ? 'bg-red-500' : pct > 75 ? 'bg-amber-500' : 'bg-teal-600')} style={{ width: `${pct}%` }} /></div>
                <div className="mt-1 flex justify-between text-[11px] text-slate-500 tabular"><span>Fuel {fmt(v.fuelUsedL)} of {fmt(v.fuelQuotaL)} L</span><span>{v.driverName}</span></div>
                <div className="mt-2.5"><Button size="sm" full icon={<Truck size={14} />} onClick={() => setEdit(v)}>Edit {v.id}</Button></div>
              </li>
            );
          })}
        </ul>
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full min-w-[940px] text-[13px]">
            <thead className="bg-[#F9FAFB] border-b border-[#E4E7EC]"><tr>{['Vehicle', 'Depot', 'Type', 'Capacity', 'Fuel this week', 'Driver', 'Status', ''].map(h => <th key={h} className={thCls}>{h}</th>)}</tr></thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={8}><Empty icon={<Truck size={20} />} title="No vehicle matches">Change the search or the filters.</Empty></td></tr>}
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
      {adding && <NewVehicleDialog onClose={() => setAdding(false)} />}
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
        <Field label="Status"><Select value={f.status} onChange={v => setF({ ...f, status: v })} aria-label="Status" options={[{ value: 'available', label: 'Available' }, { value: 'in_workshop', label: 'In the workshop', icon: <Wrench size={13} /> }]} /></Field>
        <Field label="Reason (workshop)"><input className={inputCls} value={f.statusNote} placeholder="e.g. Brake service" onChange={e => setF({ ...f, statusNote: e.target.value })} /></Field>
        <Field label="Driver name"><input className={inputCls} value={f.driverName} onChange={e => setF({ ...f, driverName: e.target.value })} /></Field>
        <div />
        <Field label="Fuel used this week (L)"><input className={inputCls} type="number" min={0} value={f.fuelUsedL} onChange={e => setF({ ...f, fuelUsedL: e.target.value })} /></Field>
        <Field label="Weekly fuel quota (L)"><input className={inputCls} type="number" min={1} value={f.fuelQuotaL} onChange={e => setF({ ...f, fuelQuotaL: e.target.value })} /></Field>
      </div>
      <p className="mt-4 text-[12px] text-slate-500">A vehicle on the road cannot be sent to the workshop from here — report a fault on its trip so the dispatcher can swap it.</p>
      <div className="mt-6 flex justify-end gap-2"><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={invalid || save.isPending} loading={save.isPending} onClick={() => save.mutate()}>Save</Button></div>
    </Modal>
  );
}

/* Typical capacities by vehicle type, so a new vehicle starts from sensible numbers. */
const DEFAULTS: Record<string, { weightCap: string; volumeCap: string; kmPerL: string; fuelQuotaL: string }> = {
  truck: { weightCap: '5510', volumeCap: '26.4', kmPerL: '4.7', fuelQuotaL: '450' },
  van: { weightCap: '1100', volumeCap: '8', kmPerL: '11.5', fuelQuotaL: '400' },
};

function NewVehicleDialog({ onClose }: { onClose: () => void }) {
  const ids = useApi<{ vehicle: string }>(['admin-next-ids'], '/admin/next-ids');
  const [f, setF] = useState({ id: '', type: 'truck', temp: 'ambient', depot: 'Peliyagoda', driverName: '', ...DEFAULTS.truck, fuelUsedL: '0' });
  const set = (k: keyof typeof f, v: string) => setF(p => ({ ...p, [k]: v }));
  const id = (f.id.trim() || ids.data?.vehicle || '').toUpperCase();
  const save = useAct(() => post(`/admin/vehicles`, {
    ...(f.id.trim() ? { id } : {}), type: f.type, temp: f.temp, depot: f.depot, driverName: f.driverName.trim(),
    weightCap: Number(f.weightCap), volumeCap: Number(f.volumeCap), kmPerL: Number(f.kmPerL), fuelQuotaL: Number(f.fuelQuotaL), fuelUsedL: Number(f.fuelUsedL),
  }), { invalidate: ['admin-vehicles', 'admin-next-ids', 'reference', 'plan', 'overview'], success: (r: any) => `${r?.id ?? 'Vehicle'} added. Add a driver account for it under Users.`, onDone: onClose });
  const num = (k: 'weightCap' | 'volumeCap' | 'kmPerL' | 'fuelQuotaL') => Number(f[k]) > 0;
  const bad = f.id.trim() && !/^VEH\d{3}$/i.test(f.id.trim()) ? 'Vehicle ids look like VEH061.'
    : !f.driverName.trim() || f.driverName.trim().length < 2 ? 'Add the driver name.'
    : !(num('weightCap') && num('volumeCap') && num('kmPerL') && num('fuelQuotaL')) || !(Number(f.fuelUsedL) >= 0) ? 'Capacities, fuel economy and quota must be above zero.' : null;
  return (
    <Modal title="Add a vehicle" onClose={onClose} width={540}>
      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="Vehicle id" hint={`Leave empty to use ${ids.data?.vehicle ?? 'the next free id'}`}><input className={inputCls} value={f.id} placeholder={ids.data?.vehicle} onChange={e => set('id', e.target.value)} /></Field>
        <Field label="Depot"><Select value={f.depot} onChange={v => set('depot', v)} aria-label="Depot" options={[{ value: 'Peliyagoda', label: 'Peliyagoda' }, { value: 'Kandy', label: 'Kandy' }]} /></Field>
        <Field label="Type"><Select value={f.type} onChange={v => setF(p => ({ ...p, type: v, ...DEFAULTS[v] }))} aria-label="Type" options={[{ value: 'truck', label: 'Truck' }, { value: 'van', label: 'Van', hint: 'Can serve van-only outlets' }]} /></Field>
        <Field label="Body"><Select value={f.temp} onChange={v => set('temp', v)} aria-label="Body" options={[{ value: 'ambient', label: 'Dry box (ambient)' }, { value: 'reefer', label: 'Reefer (chilled)', hint: 'Can carry chilled orders' }]} /></Field>
        <Field label="Weight capacity (kg)"><input className={inputCls} type="number" min={1} value={f.weightCap} onChange={e => set('weightCap', e.target.value)} /></Field>
        <Field label="Volume capacity (m³)"><input className={inputCls} type="number" min={0.1} step={0.1} value={f.volumeCap} onChange={e => set('volumeCap', e.target.value)} /></Field>
        <Field label="Fuel economy (km per litre)"><input className={inputCls} type="number" min={0.1} step={0.1} value={f.kmPerL} onChange={e => set('kmPerL', e.target.value)} /></Field>
        <Field label="Weekly fuel quota (L)"><input className={inputCls} type="number" min={1} value={f.fuelQuotaL} onChange={e => set('fuelQuotaL', e.target.value)} /></Field>
        <Field label="Driver name"><input className={inputCls} value={f.driverName} placeholder="e.g. Nimal Perera" onChange={e => set('driverName', e.target.value)} /></Field>
        <Field label="Fuel used this week (L)"><input className={inputCls} type="number" min={0} value={f.fuelUsedL} onChange={e => set('fuelUsedL', e.target.value)} /></Field>
      </div>
      <p className="mt-4 text-[12px] text-slate-500">The planner can use {id || 'the vehicle'} on the next Auto-plan. To let its driver sign in, add a person with the Driver role under Users and pick this vehicle.</p>
      {bad && <p className="mt-2 text-[12px] text-red-700">{bad}</p>}
      <div className="mt-6 flex justify-end gap-2"><Button onClick={onClose}>Cancel</Button><Button variant="primary" icon={<Plus size={15} />} disabled={!!bad || save.isPending} loading={save.isPending} onClick={() => save.mutate()}>Add vehicle</Button></div>
    </Modal>
  );
}
