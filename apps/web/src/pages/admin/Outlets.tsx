import { useMemo, useState } from 'react';
import { Download, Search, Store } from 'lucide-react';
import { Button, Card, Empty, Field, Modal, cx, inputCls, thCls } from '../../components/ds';
import { Select } from '../../components/Select';
import { ErrorState, Loading, useAct, useApi } from '../../components/common';
import { BrandTag, DockBadge } from '../../components/tags';
import { patch } from '../../lib/api';
import { downloadCsv, stamp } from '../../lib/csv';
import { AdminPage, FilterBar } from './AdminApp';

export default function Outlets() {
  const q = useApi<any[]>(['admin-outlets'], '/admin/outlets');
  const [text, setText] = useState('');
  const [depot, setDepot] = useState('all');
  const [brand, setBrand] = useState('all');
  const [status, setStatus] = useState('all');
  const [edit, setEdit] = useState<any | null>(null);
  const rows = useMemo(() => (q.data ?? []).filter(o => (depot === 'all' || o.depot === depot) && (brand === 'all' || o.brand === brand) && (status === 'all' || (status === 'active') === o.isActive) && (!text || `${o.id} ${o.name} ${o.district} ${o.brand} ${o.depot}`.toLowerCase().includes(text.toLowerCase()))), [q.data, text, depot, brand, status]);
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorState error={q.error} retry={q.refetch} />;
  return (
    <AdminPage title="Outlets" subtitle="Delivery windows and access rules the planner respects. Inactive outlets cannot order and are left out of plans."
      actions={<Button icon={<Download size={15} />} disabled={!rows.length} onClick={() => downloadCsv(`pathwise-outlets-${stamp()}.csv`, ['Outlet', 'Name', 'Brand', 'District', 'Depot', 'Opens', 'Closes', 'Mall window', 'Unloading', 'Parking', 'Van only', 'Managers', 'Status'],
        rows.map(o => [o.id, o.name, o.brand, o.district, o.depot, o.open, o.close, o.mallWindow, o.dock, o.parking, o.vanOnly ? 'Yes' : 'No', o.managers?.map((m: any) => m.name).join('; '), o.isActive ? 'Active' : 'Inactive']))}>Export CSV</Button>}>
      <FilterBar>
        <span className="relative sm:w-64"><Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" /><input value={text} onChange={e => setText(e.target.value)} placeholder="Outlet, district, brand" className={cx(inputCls, 'pl-8')} aria-label="Search outlets" /></span>
        <div className="grid grid-cols-3 gap-2 sm:flex">
          <div className="sm:w-40"><Select value={depot} onChange={setDepot} aria-label="Depot" options={[{ value: 'all', label: 'Both depots' }, { value: 'Peliyagoda', label: 'Peliyagoda' }, { value: 'Kandy', label: 'Kandy' }]} /></div>
          <div className="sm:w-36"><Select value={brand} onChange={setBrand} aria-label="Brand" options={[{ value: 'all', label: 'All brands' }, ...[...new Set((q.data ?? []).map(o => o.brand as string))].sort().map(b => ({ value: b, label: b }))]} /></div>
          <div className="sm:w-36"><Select value={status} onChange={setStatus} aria-label="Status" options={[{ value: 'all', label: 'Any status' }, { value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }]} /></div>
        </div>
        <span className="sm:ml-auto text-[12px] text-slate-500">{rows.length} of {q.data?.length ?? 0}</span>
      </FilterBar>
      <Card pad={false}>
        <ul className="md:hidden divide-y divide-[#EEF0F3]">
          {rows.length === 0 && <li><Empty icon={<Store size={20} />} title="No outlet matches">Change the search or the filters.</Empty></li>}
          {rows.map(o => (
            <li key={o.id} className={cx('px-4 py-3.5', !o.isActive && 'opacity-60')}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="font-semibold text-[14px] text-slate-900">{o.id}</span><BrandTag brand={o.brand} /></div><div className="text-[12px] text-slate-500 mt-0.5">{o.district} · {o.depot} depot</div></div>
                <span className={cx('text-[12px] font-semibold flex-shrink-0', o.isActive ? 'text-emerald-700' : 'text-slate-500')}>{o.isActive ? 'Active' : 'Inactive'}</span>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-slate-600"><span className="tabular">{o.open}–{o.close}</span>{o.mallWindow && <span className="text-violet-700">Mall {o.mallWindow}</span>}<DockBadge dock={o.dock} />{o.vanOnly && <span className="font-semibold text-amber-700">Van only</span>}</div>
              <div className="mt-1 text-[12px] text-slate-500 truncate">{o.managers?.map((m: any) => m.name).join(', ') ?? 'No manager'}</div>
              <div className="mt-2.5"><Button size="sm" full icon={<Store size={14} />} onClick={() => setEdit(o)}>Edit {o.id}</Button></div>
            </li>
          ))}
        </ul>
        <div className="hidden md:block overflow-x-auto max-h-[70vh]">
          <table className="w-full min-w-[920px] text-[13px]">
            <thead className="sticky top-0 bg-[#F9FAFB] border-b border-[#E4E7EC]"><tr>{['Outlet', 'Brand', 'District', 'Depot', 'Window', 'Access', 'Manager', 'Status', ''].map(h => <th key={h} className={thCls}>{h}</th>)}</tr></thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={9}><Empty icon={<Store size={20} />} title="No outlet matches">Change the search or the filters.</Empty></td></tr>}
              {rows.map(o => (
                <tr key={o.id} className={cx('border-t border-[#EEF0F3]', !o.isActive && 'opacity-60')}>
                  <td className="px-4 py-2.5 font-semibold text-slate-900">{o.id}</td>
                  <td className="px-4 py-2.5"><BrandTag brand={o.brand} /></td>
                  <td className="px-4 py-2.5">{o.district}</td><td className="px-4 py-2.5">{o.depot}</td>
                  <td className="px-4 py-2.5 tabular">{o.open}–{o.close}{o.mallWindow && <div className="text-[11px] text-violet-700">Mall {o.mallWindow}</div>}</td>
                  <td className="px-4 py-2.5"><span className="flex flex-wrap gap-1"><DockBadge dock={o.dock} />{o.vanOnly && <span className="text-[11px] font-semibold text-amber-700">Van only</span>}</span></td>
                  <td className="px-4 py-2.5 text-[12px] text-slate-600">{o.managers?.map((m: any) => m.name).join(', ') ?? '—'}</td>
                  <td className="px-4 py-2.5 text-[12px] font-semibold">{o.isActive ? <span className="text-emerald-700">Active</span> : <span className="text-slate-500">Inactive</span>}</td>
                  <td className="px-4 py-2.5 text-right"><Button size="sm" icon={<Store size={14} />} onClick={() => setEdit(o)}>Edit</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      {edit && <OutletDialog o={edit} onClose={() => setEdit(null)} />}
    </AdminPage>
  );
}

function OutletDialog({ o, onClose }: { o: any; onClose: () => void }) {
  const [f, setF] = useState({ name: o.name, open: o.open, close: o.close, mallWindow: o.mallWindow ?? '', dock: o.dock, parking: o.parking, isActive: o.isActive });
  const save = useAct(() => patch(`/admin/outlets/${o.id}`, { ...f, name: f.name.trim(), mallWindow: f.mallWindow.trim() || null }), { invalidate: ['admin-outlets', 'reference', 'plan'], success: `${o.id} saved`, onDone: onClose });
  const bad = f.open >= f.close ? 'The window must open before it closes.' : f.mallWindow && !/^\d{2}:\d{2}[–-]\d{2}:\d{2}$/.test(f.mallWindow.trim()) ? 'Mall window looks like 06:00–09:00.' : null;
  return (
    <Modal title={`${o.id} · ${o.brand} ${o.district}`} onClose={onClose} width={520}>
      <div className="grid sm:grid-cols-2 gap-4">
        <div className="sm:col-span-2"><Field label="Name"><input className={inputCls} value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></Field></div>
        <Field label="Window opens"><input type="time" className={inputCls} value={f.open} onChange={e => setF({ ...f, open: e.target.value })} /></Field>
        <Field label="Window closes"><input type="time" className={inputCls} value={f.close} onChange={e => setF({ ...f, close: e.target.value })} /></Field>
        <Field label="Mall access window (optional)" hint="Only for mall outlets, e.g. 06:00–09:00"><input className={inputCls} value={f.mallWindow} onChange={e => setF({ ...f, mallWindow: e.target.value })} /></Field>
        <Field label="Unloading"><Select value={f.dock} onChange={v => setF({ ...f, dock: v })} aria-label="Unloading" options={[{ value: 'rear_dock', label: 'Rear dock' }, { value: 'street', label: 'Street' }, { value: 'mall_bay', label: 'Mall bay' }]} /></Field>
        <Field label="Parking"><Select value={f.parking} onChange={v => setF({ ...f, parking: v })} aria-label="Parking" options={[{ value: 'normal', label: 'Normal' }, { value: 'van_only', label: 'Van only', hint: 'Trucks cannot stop here' }, { value: 'mall_dock', label: 'Mall dock' }]} /></Field>
        <Field label="Status"><Select value={f.isActive ? '1' : '0'} onChange={v => setF({ ...f, isActive: v === '1' })} aria-label="Status" options={[{ value: '1', label: 'Active' }, { value: '0', label: 'Inactive', hint: 'No orders, not planned' }]} /></Field>
      </div>
      {bad && <p className="mt-3 text-[12px] text-red-700">{bad}</p>}
      <div className="mt-6 flex justify-end gap-2"><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!!bad || save.isPending || !f.name.trim()} loading={save.isPending} onClick={() => save.mutate()}>Save</Button></div>
    </Modal>
  );
}
