import { useMemo, useState } from 'react';
import { Search, Store } from 'lucide-react';
import { Button, Card, Field, Modal, cx, inputCls } from '../../components/ds';
import { ErrorState, Loading, useAct, useApi } from '../../components/common';
import { BrandTag, DockBadge } from '../../components/tags';
import { patch } from '../../lib/api';
import { AdminPage } from './AdminApp';

export default function Outlets() {
  const q = useApi<any[]>(['admin-outlets'], '/admin/outlets');
  const [text, setText] = useState('');
  const [edit, setEdit] = useState<any | null>(null);
  const rows = useMemo(() => (q.data ?? []).filter(o => !text || `${o.id} ${o.name} ${o.district} ${o.brand} ${o.depot}`.toLowerCase().includes(text.toLowerCase())), [q.data, text]);
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorState error={q.error} retry={q.refetch} />;
  return (
    <AdminPage title="Outlets" subtitle="Delivery windows and access rules the planner respects. Inactive outlets cannot order and are left out of plans.">
      <div className="mb-4"><span className="relative inline-block"><Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" /><input value={text} onChange={e => setText(e.target.value)} placeholder="Outlet, district, brand" className={cx(inputCls, 'pl-8 w-64')} aria-label="Search outlets" /></span></div>
      <Card pad={false}>
        <div className="overflow-x-auto max-h-[70vh]">
          <table className="w-full min-w-[920px] text-[13px]">
            <thead className="sticky top-0 bg-[#F9FAFB] border-b border-[#E4E7EC]"><tr>{['Outlet', 'Brand', 'District', 'Depot', 'Window', 'Access', 'Manager', 'Status', ''].map(h => <th key={h} className="text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500 px-4 h-10">{h}</th>)}</tr></thead>
            <tbody>
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
        <Field label="Unloading"><select className={inputCls} value={f.dock} onChange={e => setF({ ...f, dock: e.target.value })}><option value="rear_dock">Rear dock</option><option value="street">Street</option><option value="mall_bay">Mall bay</option></select></Field>
        <Field label="Parking"><select className={inputCls} value={f.parking} onChange={e => setF({ ...f, parking: e.target.value })}><option value="normal">Normal</option><option value="van_only">Van only</option><option value="mall_dock">Mall dock</option></select></Field>
        <Field label="Status"><select className={inputCls} value={f.isActive ? '1' : '0'} onChange={e => setF({ ...f, isActive: e.target.value === '1' })}><option value="1">Active</option><option value="0">Inactive (no orders, not planned)</option></select></Field>
      </div>
      {bad && <p className="mt-3 text-[12px] text-red-700">{bad}</p>}
      <div className="mt-6 flex justify-end gap-2"><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!!bad || save.isPending || !f.name.trim()} loading={save.isPending} onClick={() => save.mutate()}>Save</Button></div>
    </Modal>
  );
}
