import { useMemo, useState } from 'react';
import { Download, Plus, Search, Store } from 'lucide-react';
import { Button, Card, Empty, Field, Modal, cx, inputCls, thCls } from '../../components/ds';
import { Select } from '../../components/Select';
import { ErrorState, Loading, useAct, useApi } from '../../components/common';
import { BrandTag, DockBadge } from '../../components/tags';
import { patch, post } from '../../lib/api';
import { downloadCsv, stamp } from '../../lib/csv';
import { AdminPage, FilterBar } from './AdminApp';

export default function Outlets() {
  const q = useApi<any[]>(['admin-outlets'], '/admin/outlets');
  const [text, setText] = useState('');
  const [depot, setDepot] = useState('all');
  const [brand, setBrand] = useState('all');
  const [status, setStatus] = useState('all');
  const [edit, setEdit] = useState<any | null>(null);
  const [adding, setAdding] = useState(false);
  const rows = useMemo(() => (q.data ?? []).filter(o => (depot === 'all' || o.depot === depot) && (brand === 'all' || o.brand === brand) && (status === 'all' || (status === 'active') === o.isActive) && (!text || `${o.id} ${o.name} ${o.district} ${o.brand} ${o.depot}`.toLowerCase().includes(text.toLowerCase()))), [q.data, text, depot, brand, status]);
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorState error={q.error} retry={q.refetch} />;
  return (
    <AdminPage title="Outlets" subtitle="Delivery windows and access rules the planner respects. Inactive outlets cannot order and are left out of plans."
      actions={<><Button variant="primary" icon={<Plus size={15} />} onClick={() => setAdding(true)}>Add outlet</Button><Button icon={<Download size={15} />} disabled={!rows.length} onClick={() => downloadCsv(`pathwise-outlets-${stamp()}.csv`, ['Outlet', 'Name', 'Brand', 'District', 'Depot', 'Opens', 'Closes', 'Mall window', 'Unloading', 'Parking', 'Van only', 'Managers', 'Status'],
        rows.map(o => [o.id, o.name, o.brand, o.district, o.depot, o.open, o.close, o.mallWindow, o.dock, o.parking, o.vanOnly ? 'Yes' : 'No', o.managers?.map((m: any) => m.name).join('; '), o.isActive ? 'Active' : 'Inactive']))}>Export CSV</Button></>}>
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
      {adding && <NewOutletDialog onClose={() => setAdding(false)} />}
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

const NEW_DISTRICT = '__new__';

function NewOutletDialog({ onClose }: { onClose: () => void }) {
  const ids = useApi<{ outlet: string }>(['admin-next-ids'], '/admin/next-ids');
  const travel = useApi<any[]>(['admin-travel'], '/admin/travel');
  const [f, setF] = useState({ id: '', name: '', brand: 'Fresh', depot: 'Peliyagoda', district: '', newDistrict: '', dock: 'rear_dock', parking: 'normal', open: '07:00', close: '20:00', mallWindow: '', lat: '', lng: '',
    outMin: '', interMin: '', outKm: '', interKm: '', roadClass: 'suburban' });
  const set = (k: keyof typeof f, v: string) => setF(p => ({ ...p, [k]: v }));
  const districts = useMemo(() => (travel.data ?? []).filter(t => t.depot === f.depot), [travel.data, f.depot]);
  const isNew = f.district === NEW_DISTRICT;
  const known = isNew ? (travel.data ?? []).find(t => t.depot === f.depot && t.district.toLowerCase() === f.newDistrict.trim().toLowerCase()) : null;
  const needTravel = isNew && !known;
  const district = isNew ? f.newDistrict.trim() : f.district;
  const id = (f.id.trim() || ids.data?.outlet || '').toUpperCase();
  const save = useAct(() => post('/admin/outlets', {
    ...(f.id.trim() ? { id } : {}), name: f.name.trim(), brand: f.brand, depot: f.depot, district, dock: f.dock, parking: f.parking, open: f.open, close: f.close,
    mallWindow: f.mallWindow.trim() || null,
    ...(f.lat.trim() && f.lng.trim() ? { lat: Number(f.lat), lng: Number(f.lng) } : {}),
    ...(needTravel ? { travel: { outMin: Number(f.outMin), interMin: Number(f.interMin), outKm: Number(f.outKm), interKm: Number(f.interKm), roadClass: f.roadClass } } : {}),
  }), { invalidate: ['admin-outlets', 'admin-next-ids', 'admin-travel', 'reference', 'plan', 'overview'], success: (r: any) => `${r?.id ?? 'Outlet'} added. Add a store manager for it under Users.`, onDone: onClose });
  const pos = (v: string) => Number(v) > 0;
  const bad = f.id.trim() && !/^OUT\d{3}$/i.test(f.id.trim()) ? 'Outlet ids look like OUT121.'
    : f.name.trim().length < 3 ? 'Add the outlet name.'
    : !district ? 'Pick the district.'
    : isNew && !/^[A-Za-z][A-Za-z .'-]*$/.test(district) ? 'District names use letters only, e.g. Ratnapura.'
    : f.open >= f.close ? 'The window must open before it closes.'
    : f.mallWindow.trim() && !/^\d{2}:\d{2}[–-]\d{2}:\d{2}$/.test(f.mallWindow.trim()) ? 'Mall window looks like 06:00–09:00.'
    : (f.lat.trim() || f.lng.trim()) && !(Number(f.lat) >= 5.8 && Number(f.lat) <= 9.9 && Number(f.lng) >= 79.5 && Number(f.lng) <= 81.95) ? 'The map position must be inside Sri Lanka (latitude 5.8–9.9, longitude 79.5–81.95), or leave both empty.'
    : needTravel && !(pos(f.outMin) && pos(f.interMin) && pos(f.outKm) && pos(f.interKm)) ? `Add the travel times from ${f.depot} to ${district}.` : null;
  return (
    <Modal title="Add an outlet" onClose={onClose} width={600}>
      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="Outlet id" hint={`Leave empty to use ${ids.data?.outlet ?? 'the next free id'}`}><input className={inputCls} value={f.id} placeholder={ids.data?.outlet} onChange={e => set('id', e.target.value)} /></Field>
        <Field label="Brand"><Select value={f.brand} onChange={v => set('brand', v)} aria-label="Brand" options={[{ value: 'Fresh', label: 'Fresh', hint: 'Groceries · chilled and ambient' }, { value: 'Style', label: 'Style' }, { value: 'Tech', label: 'Tech' }]} /></Field>
        <div className="sm:col-span-2"><Field label="Name"><input className={inputCls} value={f.name} placeholder="e.g. Fresh Ratnapura Town" onChange={e => set('name', e.target.value)} /></Field></div>
        <Field label="Served from depot"><Select value={f.depot} onChange={v => setF(p => ({ ...p, depot: v, district: '' }))} aria-label="Depot" options={[{ value: 'Peliyagoda', label: 'Peliyagoda' }, { value: 'Kandy', label: 'Kandy' }]} /></Field>
        <Field label="District"><Select value={f.district} onChange={v => set('district', v)} aria-label="District"
          options={[{ value: '', label: 'Pick a district' }, ...districts.map(t => ({ value: t.district as string, label: t.district as string, hint: `${t.outMin} min · ${t.outKm} km from ${f.depot}` })), { value: NEW_DISTRICT, label: 'Another district…', icon: <Plus size={13} /> }]} /></Field>
        {isNew && <div className="sm:col-span-2"><Field label="New district name"><input className={inputCls} value={f.newDistrict} placeholder="e.g. Ratnapura" onChange={e => set('newDistrict', e.target.value)} /></Field></div>}
        {needTravel && f.newDistrict.trim() && (
          <div className="sm:col-span-2 rounded-lg border border-amber-200 bg-amber-50/60 p-3">
            <p className="text-[12px] text-amber-900 mb-3">{f.depot} has no travel times to {f.newDistrict.trim()} yet. The planner needs them to route this outlet.</p>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              <Field label="Depot → district (min)"><input className={inputCls} type="number" min={5} value={f.outMin} onChange={e => set('outMin', e.target.value)} /></Field>
              <Field label="Depot → district (km)"><input className={inputCls} type="number" min={1} value={f.outKm} onChange={e => set('outKm', e.target.value)} /></Field>
              <Field label="Between stops (min)"><input className={inputCls} type="number" min={1} value={f.interMin} onChange={e => set('interMin', e.target.value)} /></Field>
              <Field label="Between stops (km)"><input className={inputCls} type="number" min={0.5} step={0.5} value={f.interKm} onChange={e => set('interKm', e.target.value)} /></Field>
              <Field label="Roads"><Select value={f.roadClass} onChange={v => set('roadClass', v)} aria-label="Roads" options={[{ value: 'urban', label: 'Urban' }, { value: 'suburban', label: 'Suburban' }, { value: 'highway', label: 'Highway' }, { value: 'hill', label: 'Hill' }]} /></Field>
            </div>
          </div>
        )}
        <Field label="Window opens"><input type="time" className={inputCls} value={f.open} onChange={e => set('open', e.target.value)} /></Field>
        <Field label="Window closes"><input type="time" className={inputCls} value={f.close} onChange={e => set('close', e.target.value)} /></Field>
        <Field label="Unloading"><Select value={f.dock} onChange={v => set('dock', v)} aria-label="Unloading" options={[{ value: 'rear_dock', label: 'Rear dock' }, { value: 'street', label: 'Street' }, { value: 'mall_bay', label: 'Mall bay' }]} /></Field>
        <Field label="Parking"><Select value={f.parking} onChange={v => set('parking', v)} aria-label="Parking" options={[{ value: 'normal', label: 'Normal' }, { value: 'van_only', label: 'Van only', hint: 'Trucks cannot stop here' }, { value: 'mall_dock', label: 'Mall dock' }]} /></Field>
        <Field label="Mall access window (optional)" hint="Only for mall outlets, e.g. 06:00–09:00"><input className={inputCls} value={f.mallWindow} onChange={e => set('mallWindow', e.target.value)} /></Field>
        <div />
        <Field label="Latitude (optional)" hint="Empty = placed in the district on the map"><input className={inputCls} type="number" step="any" value={f.lat} placeholder="6.6828" onChange={e => set('lat', e.target.value)} /></Field>
        <Field label="Longitude (optional)"><input className={inputCls} type="number" step="any" value={f.lng} placeholder="80.3992" onChange={e => set('lng', e.target.value)} /></Field>
      </div>
      <p className="mt-4 text-[12px] text-slate-500">{id || 'The outlet'} can order and be planned straight away. To let the store sign in, add a person with the Store manager role under Users and pick this outlet.</p>
      {bad && <p className="mt-2 text-[12px] text-red-700">{bad}</p>}
      <div className="mt-6 flex justify-end gap-2"><Button onClick={onClose}>Cancel</Button><Button variant="primary" icon={<Plus size={15} />} disabled={!!bad || save.isPending} loading={save.isPending} onClick={() => save.mutate()}>Add outlet</Button></div>
    </Modal>
  );
}
