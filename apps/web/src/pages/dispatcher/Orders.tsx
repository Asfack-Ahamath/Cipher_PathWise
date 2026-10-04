import { useMemo, useState } from 'react';
import { ClipboardList, Search, Phone, Smartphone, AlertTriangle, Plus, Clock, Lock, X, Pencil, Ban } from 'lucide-react';
import { Toolbar, Tabs, Segmented, Button, Callout, DetailPanel, Modal, Field, inputCls, KeyValues, Pill, PILL_TONE, Empty } from '../../components/ds';
import { Select } from '../../components/Select';
import { STATUS } from '../../components/StatusChip';
import { BrandTag, TempTag, OutletBadges } from '../../components/tags';
import { DownloadButton, ErrorState, Loading, Status, useAct, useApi, useReference, fmt } from '../../components/common';
import { patch, post } from '../../lib/api';
import { hhmm } from '../../lib/clock';
import { CATEGORIES } from '../../lib/categories';
import { useDepot } from './DispatcherApp';

/** Most units one order line can hold (the API enforces the same limit). */
const MAX_UNITS = 500;

export default function Orders() {
  const depot = useDepot();
  const [tab, setTab] = useState<'queue' | 'late' | 'cancelled'>('queue');
  const [editing, setEditing] = useState<any | null>(null);
  const [cancelling, setCancelling] = useState<any | null>(null);
  const [search, setSearch] = useState('');
  const [brand, setBrand] = useState<'all' | 'Fresh' | 'Style' | 'Tech'>('all');
  const [status, setStatus] = useState<'all' | 'placed' | 'unplaced' | 'deferred'>('all');
  const [sel, setSel] = useState<string | null>(null);
  const [phoneOpen, setPhoneOpen] = useState(false);
  const q = useApi<any>(['orders'], '/orders', { refetchInterval: 30_000 });
  const ref = useReference();
  const outlets = useMemo(() => new Map<string, any>((ref.data?.outlets ?? []).map((o: any) => [o.id, o])), [ref.data]);
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorState error={q.error} retry={q.refetch} />;
  const d = q.data;
  // remainders of a partly deferred order live on the Deferrals screen; the queue shows what stores ordered
  const all: any[] = d.orders.filter((o: any) => (depot === 'all' || o.depot === depot) && !o.parentOrderId);
  const s2 = search.trim().toLowerCase();
  const rows = all.filter(o => (brand === 'all' || o.brand === brand)
    && (status === 'all' || (status === 'placed' ? !!o.placement : status === 'deferred' ? !!o.deferral : !o.placement && !o.deferral))
    && (!s2 || o.id.toLowerCase().includes(s2) || o.outletId.toLowerCase().includes(s2) || o.district.toLowerCase().includes(s2)));
  const s = sel ? d.orders.find((o: any) => o.id === sel) : null;
  const sOut = s ? outlets.get(s.outletId) : null;
  const twin = s ? d.orders.filter((o: any) => o.outletId === s.outletId && o.id !== s.id) : [];
  const counts = { app: all.filter(o => o.source === 'app').length, phone: all.filter(o => o.source === 'phone').length };
  const th = 'text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500 px-4 h-10 whitespace-nowrap';
  const perOutlet = new Map<string, number>(); for (const o of d.orders) perOutlet.set(o.outletId, (perOutlet.get(o.outletId) ?? 0) + 1);
  return (
    <div className="flex flex-1 min-h-0">
      <div className="relative flex-1 min-w-0 flex flex-col">
        <Toolbar icon={<ClipboardList size={18} />} hue="indigo"
          title={<span className="inline-flex items-center gap-2.5">Order queue <span className="inline-flex items-center gap-1 h-6 px-2 rounded-md bg-slate-100 text-[12px] font-semibold text-slate-600"><Lock size={12} />Closed {ref.data?.operations?.cutoffTime ?? '16:00'}</span></span>}
          subtitle={<span className="flex flex-wrap items-center gap-x-4 gap-y-1">{all.length} confirmed orders for {d.dateLabel} — app and phone orders in one queue <span className="flex gap-3 text-[12px]"><span className="flex items-center gap-1"><Smartphone size={12} />{counts.app} app</span><span className="flex items-center gap-1"><Phone size={12} />{counts.phone} phone</span></span></span>}
          actions={<><DownloadButton path={`/orders.csv?date=${d.date}`} name={`pathwise-orders-${d.date}.csv`}>Export CSV</DownloadButton><Button variant="primary" icon={<Plus size={15} />} onClick={() => setPhoneOpen(true)}>Add phone order</Button></>}
          below={tab === 'queue' ? (
            <div className="flex flex-wrap items-center gap-3 px-4 sm:px-6 py-3 border-t border-[#EEF0F3]">
              <div className="relative w-full sm:w-72">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input value={search} onChange={e => setSearch(e.target.value)} className={`${inputCls} pl-9`} placeholder="Search order, outlet or district" aria-label="Search orders" />
              </div>
              <Segmented value={status} onChange={setStatus} options={[{ id: 'all', label: 'All' }, { id: 'placed', label: 'On a trip' }, { id: 'unplaced', label: 'Not placed' }, { id: 'deferred', label: 'Deferred' }]} />
              <Segmented value={brand} onChange={setBrand} options={[{ id: 'all', label: 'All brands' }, { id: 'Fresh', label: 'Fresh' }, { id: 'Style', label: 'Style' }, { id: 'Tech', label: 'Tech' }]} />
              <span className="ml-auto text-[12px] text-slate-500 tabular">Showing {rows.length} of {all.length}</span>
            </div>
          ) : undefined}>
          <Tabs className="mt-4 -mb-4" value={tab} onChange={setTab} items={[
            { id: 'queue', label: <>Confirmed for {d.dateLabel} <span className="ml-1 text-slate-400 tabular">{all.length}</span></> },
            { id: 'late', label: <>After cutoff <span className="ml-1 text-slate-400 tabular">{d.afterCutoff.length}</span></> },
            { id: 'cancelled', label: <>Cancelled <span className="ml-1 text-slate-400 tabular">{d.cancelled?.length ?? 0}</span></> },
          ]} />
        </Toolbar>
        {tab === 'queue' ? (
          <>
            <div className="flex-1 min-h-0 overflow-auto bg-white pt-[var(--top-h,4rem)]">
              {rows.length === 0 ? <Empty title="No orders match">Try another filter or clear the search.</Empty> : <>
                {/* phones: one card per order */}
                <ul className="md:hidden divide-y divide-[#EEF0F3] border-t border-[#EEF0F3]">
                  {rows.map(o => (
                    <li key={o.id}>
                      <button onClick={() => setSel(sel === o.id ? null : o.id)} className={`w-full text-left px-4 py-3.5 ${sel === o.id ? 'bg-teal-50/60' : 'active:bg-slate-50'}`}>
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2"><span className="text-[14px] font-semibold text-slate-900">{o.outletId}</span><BrandTag brand={o.brand} /><TempTag temp={o.temp} /></div>
                            <div className="text-[12px] text-slate-500 mt-0.5">{o.district} · {o.depot} · <span className="font-mono">{o.id}</span></div>
                          </div>
                          <div className="flex-shrink-0">{o.placement ? <Pill label={o.placement} color={STATUS.planned.color} bg={STATUS.planned.bg} /> : o.deferral ? <Pill label={`Deferred to ${o.deferral.toDate.slice(5)}`} color={STATUS.deferred.color} bg={STATUS.deferred.bg} /> : <Pill label="Not placed" {...PILL_TONE.neutral} />}</div>
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-slate-600 tabular"><span>{fmt(o.kg)} kg · {fmt(o.m3, 1)} m³</span><span>{o.open}–{o.close}</span><OutletBadges o={o} />{o.deferredYesterday && <span className="inline-flex items-center gap-1 font-semibold text-red-700"><AlertTriangle size={12} />Skipped last run</span>}</div>
                      </button>
                    </li>
                  ))}
                </ul>
                <table className="hidden md:table w-full min-w-[1080px] border-collapse">
                  <thead className="sticky top-[var(--top-h,0px)] z-[5] bg-[#F9FAFB] border-b border-[#E4E7EC]">
                    <tr>{['Order', 'Outlet', 'Temp', 'Weight', 'Volume', 'Window', 'Access', 'Last served', 'Source', 'Placement'].map(h => <th key={h} className={th}>{h}</th>)}</tr>
                  </thead>
                  <tbody>
                    {rows.map(o => {
                      const active = sel === o.id;
                      return (
                        <tr key={o.id} onClick={() => setSel(active ? null : o.id)} className={`border-b border-[#EEF0F3] cursor-pointer transition-colors ${active ? 'bg-teal-50/60' : 'hover:bg-slate-50'}`}>
                          <td className="px-4 py-3 font-mono text-[12px] text-slate-500 whitespace-nowrap">{o.id}</td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2"><span className="text-[13px] font-semibold text-slate-900">{o.outletId}</span><BrandTag brand={o.brand} /></div>
                            <div className="text-[12px] text-slate-500 mt-0.5">{o.district} · {o.depot}{(perOutlet.get(o.outletId) ?? 0) > 1 && ' · 2 orders today'}</div>
                          </td>
                          <td className="px-4 py-3"><TempTag temp={o.temp} /></td>
                          <td className="px-4 py-3 text-[13px] tabular text-slate-700 whitespace-nowrap">{fmt(o.kg)} kg</td>
                          <td className="px-4 py-3 text-[13px] tabular text-slate-700 whitespace-nowrap">{fmt(o.m3, 1)} m³</td>
                          <td className="px-4 py-3 text-[13px] tabular text-slate-700 whitespace-nowrap">{o.open}–{o.close}</td>
                          <td className="px-4 py-3"><OutletBadges o={o} /></td>
                          <td className="px-4 py-3 text-[13px] whitespace-nowrap">{o.deferredYesterday ? <span className="inline-flex items-center gap-1 font-semibold text-red-700"><AlertTriangle size={13} />Skipped last run</span> : <span className="text-slate-600">{o.daysSinceServed} day{o.daysSinceServed === 1 ? '' : 's'} ago</span>}</td>
                          <td className="px-4 py-3 text-[13px] text-slate-600 whitespace-nowrap"><span className="inline-flex items-center gap-1.5">{o.source === 'phone' ? <Phone size={13} className="text-slate-400" /> : <Smartphone size={13} className="text-slate-400" />}{o.source === 'phone' ? 'Phone' : 'App'} · {hhmm(o.submittedAt)}</span></td>
                          <td className="px-4 py-3">{o.placement ? <Pill label={o.placement} color={STATUS.planned.color} bg={STATUS.planned.bg} /> : o.deferral ? <Pill label={`Deferred to ${o.deferral.toDate.slice(5)}`} color={STATUS.deferred.color} bg={STATUS.deferred.bg} /> : <Pill label="Not placed" {...PILL_TONE.neutral} />}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </>}
            </div>
          </>
        ) : tab === 'cancelled' ? (
          <div className="flex-1 overflow-y-auto pt-[var(--top-h,4rem)]">
            <div className="mx-auto max-w-[960px] px-4 sm:px-6 py-6">
              <div className="bg-white rounded-xl border border-[#E6E9F0] divide-y divide-[#EEF0F3]">
                {(d.cancelled ?? []).length === 0 && <Empty title="No cancelled orders for this day" />}
                {(d.cancelled ?? []).map((c: any) => (
                  <div key={c.id} className="px-5 py-4 flex flex-wrap items-center gap-x-4 gap-y-1">
                    <span className="font-mono text-[12px] text-slate-500 w-28">{c.id}</span>
                    <div className="flex-1 min-w-[200px]"><div className="text-[13px] font-semibold text-slate-900">{outlets.get(c.outletId)?.name ?? c.outletId}</div><div className="text-[12px] text-slate-500">Cancelled {hhmm(c.cancelledAt)} · {c.cancelReason}</div></div>
                    <TempTag temp={c.temp} /><span className="text-[12px] text-slate-500 tabular">{c.units} units</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto pt-[var(--top-h,4rem)]">
            <div className="mx-auto max-w-[960px] px-4 sm:px-6 py-6 space-y-4">
              <Callout icon={<Clock size={15} className="text-slate-500" />}>Orders received after the {ref.data?.operations?.cutoffTime ?? '16:00'} cutoff join the following run. The store is told the new date straight away — these are not deferrals, and nothing is lost.</Callout>
              <div className="bg-white rounded-xl border border-[#E6E9F0] divide-y divide-[#EEF0F3]">
                {d.afterCutoff.length === 0 && <Empty title="No late orders" />}
                {d.afterCutoff.map((l: any) => {
                  const ot = outlets.get(l.outletId);
                  return (
                    <div key={l.id} className="px-5 py-4 flex flex-wrap items-center gap-x-4 gap-y-2">
                      <span className="font-mono text-[12px] text-slate-500 w-28">{l.id}</span>
                      <div className="flex-1 min-w-[180px]"><div className="text-[13px] font-semibold text-slate-900">{ot?.name ?? l.outletId}</div><div className="text-[12px] text-slate-500">Received {hhmm(l.submittedAt)} by {l.source}</div></div>
                      <TempTag temp={l.temp} />
                      <Pill label={`Confirmed for ${l.date}`} color={STATUS.confirmed.color} bg={STATUS.confirmed.bg} />
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>

      <DetailPanel open={!!s} onClose={() => setSel(null)}>
        {s && <>
          <div className="px-5 py-4 border-b border-[#E4E7EC] flex items-start justify-between gap-3">
            <div className="min-w-0"><div className="font-mono text-[12px] text-slate-500">{s.id}</div><div className="text-[16px] font-semibold text-slate-900 mt-0.5">{sOut?.name ?? s.outletId}</div></div>
            <button onClick={() => setSel(null)} aria-label="Close" className="w-8 h-8 flex items-center justify-center rounded-md text-slate-400 hover:bg-slate-100"><X size={16} /></button>
          </div>
          <div className="flex-1 overflow-y-auto p-5 space-y-5">
            <div className="flex flex-wrap gap-1.5"><BrandTag brand={s.brand} /><TempTag temp={s.temp} /><OutletBadges o={s} /><Status s={s.status} size="sm" /></div>
            <KeyValues items={[['Weight', `${fmt(s.kg)} kg`], ['Volume', `${fmt(s.m3, 1)} m³`], ['Units', s.units], ['Window', `${s.open}–${s.close}`], ['District', s.district], ['Depot', s.depot], ['Source', s.source], ['Submitted', hhmm(s.submittedAt)]]} />
            {s.description && <div className="text-[13px] text-slate-700"><span className="font-semibold">Contents: </span>{s.description}</div>}
            {s.deferredYesterday && <Callout tone="warning" title="Skipped on the last run">The planner puts this outlet first so it is not skipped twice in a row.</Callout>}
            {s.placement && <Callout tone="info" title={`Placed on ${s.placement}`}>See the plan board for stop order and arrival time.</Callout>}
            {s.deferral && <Callout tone="warning" title={`Deferred to ${s.deferral.toDate} · ${s.deferral.kind}`}>{ref.data?.reasons?.[s.deferral.reason]?.label ?? s.deferral.reason}</Callout>}
            {s.status === 'confirmed' && !s.placement && !s.parentOrderId && (
              <div className="flex gap-2">
                <Button size="sm" icon={<Pencil size={13} />} onClick={() => setEditing(s)}>Change quantities</Button>
                <Button size="sm" variant="danger" icon={<Ban size={13} />} onClick={() => setCancelling(s)}>Cancel order</Button>
              </div>
            )}
            {s.placement && <p className="text-[12px] text-slate-500">This order is on a published trip; change it on the plan board.</p>}
            {twin.length > 0 && <div><div className="text-[12px] font-semibold text-slate-700 mb-1.5">Also from this outlet today</div>{twin.map((t: any) => <button key={t.id} onClick={() => setSel(t.id)} className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-slate-50 hover:bg-slate-100 text-[13px]"><span className="font-mono text-[12px]">{t.id}</span><TempTag temp={t.temp} /></button>)}</div>}
          </div>
        </>}
      </DetailPanel>
      {phoneOpen && <PhoneOrder onClose={() => setPhoneOpen(false)} outlets={[...outlets.values()]} />}
      {editing && <EditOrder order={editing} onClose={() => setEditing(null)} />}
      {cancelling && <CancelOrder order={cancelling} onClose={() => { setCancelling(null); setSel(null); }} />}
    </div>
  );
}

function PhoneOrder({ onClose, outlets }: { onClose: () => void; outlets: any[] }) {
  const [outletId, setOutletId] = useState('');
  const [temp, setTemp] = useState<'ambient' | 'chilled'>('ambient');
  const [units, setUnits] = useState<Record<string, number>>({});
  const [done, setDone] = useState<any>(null);
  const ot = outlets.find(o => o.id === outletId);
  const cats = ot ? CATEGORIES[ot.brand]?.[temp] ?? [] : [];
  const total = cats.reduce((a, c) => a + (units[c.k] ?? 0), 0);
  const kg = cats.reduce((a, c) => a + (units[c.k] ?? 0) * c.kg, 0);
  const place = useAct(() => post('/orders/phone', { outletId, temp, lines: cats.map(c => ({ category: c.k, units: units[c.k] ?? 0 })).filter(l => l.units > 0) }), { invalidate: ['orders', 'overview'], onDone: r => setDone(r) });
  return (
    <Modal title="Add phone order" onClose={onClose} width={520}>
      {done ? (
        <div className="space-y-4">
          <Callout tone="success" title={`${done.id} confirmed for ${done.deliveryLabel ?? done.deliveryDate}`}>{done.afterCutoff ? 'Received after the 16:00 cutoff, so it joins the following run. The store has been told.' : 'It will be in the next plan.'}</Callout>
          <div className="flex justify-end"><Button variant="primary" onClick={onClose}>Done</Button></div>
        </div>
      ) : (
        <div className="space-y-4">
          <Field label="Outlet">
            <Select value={outletId} onChange={v => { setOutletId(v); setUnits({}); setTemp('ambient'); }} aria-label="Outlet" placeholder="Choose an outlet…" searchable
              options={outlets.map(o => ({ value: o.id as string, label: `${o.id} · ${o.name.replace(/ · OUT\d+$/, '')}`, hint: `${o.brand} · ${o.district} · ${o.depot}` }))} />
          </Field>
          {ot && <>
            {ot.brand === 'Fresh' && <Segmented value={temp} onChange={v => { setTemp(v); setUnits({}); }} options={[{ id: 'ambient', label: 'Ambient' }, { id: 'chilled', label: 'Chilled' }]} />}
            <div className="space-y-2">
              {cats.map(c => (
                <div key={c.k} className="flex items-center justify-between gap-3">
                  <span className="text-[13px] text-slate-700">{c.k}</span>
                  <input type="number" min={0} max={MAX_UNITS} className={`${inputCls} w-24 text-right`} value={units[c.k] ?? ''} placeholder="0" onChange={e => setUnits({ ...units, [c.k]: Math.max(0, Math.min(MAX_UNITS, Number(e.target.value) || 0)) })} aria-label={`${c.k} units`} />
                </div>
              ))}
            </div>
            <div className="text-[12px] text-slate-500 tabular">{total} units · about {fmt(kg)} kg</div>
          </>}
          <div className="flex justify-end gap-2"><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!ot || total === 0 || place.isPending} loading={place.isPending} onClick={() => place.mutate()}>Confirm order</Button></div>
        </div>
      )}
    </Modal>
  );
}

function EditOrder({ order, onClose }: { order: any; onClose: () => void }) {
  const cats = CATEGORIES[order.brand]?.[order.temp as 'ambient' | 'chilled'] ?? [];
  const [units, setUnits] = useState<Record<string, number>>(() => Object.fromEntries((order.lines ?? []).map((l: any) => [l.category, l.units])));
  const lines = cats.map(c => ({ category: c.k, units: units[c.k] ?? 0 })).filter(l => l.units > 0);
  const save = useAct(() => patch(`/orders/${order.id}`, { lines }), { invalidate: ['orders', 'overview', 'plan'], success: `${order.id} updated · the store was told`, onDone: onClose });
  return (
    <Modal title={`Change ${order.id}`} onClose={onClose} width={480}>
      {!order.lines?.length && <Callout tone="info" className="mb-3">This order came without category lines; enter the quantities to replace it.</Callout>}
      <div className="space-y-2">
        {cats.map(c => (
          <div key={c.k} className="flex items-center justify-between gap-3">
            <span className="text-[13px] text-slate-700">{c.k}</span>
            <input type="number" min={0} max={MAX_UNITS} className={`${inputCls} w-24 text-right`} value={units[c.k] ?? ''} placeholder="0" onChange={e => setUnits({ ...units, [c.k]: Math.max(0, Math.min(MAX_UNITS, Number(e.target.value) || 0)) })} aria-label={`${c.k} units`} />
          </div>
        ))}
      </div>
      <div className="mt-6 flex justify-end gap-2"><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!lines.length || save.isPending} loading={save.isPending} onClick={() => save.mutate()}>Save</Button></div>
    </Modal>
  );
}

function CancelOrder({ order, onClose }: { order: any; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const cancel = useAct(() => post(`/orders/${order.id}/cancel`, { reason: reason.trim() }), { invalidate: ['orders', 'overview', 'plan'], success: `${order.id} cancelled · the store was told`, onDone: onClose });
  return (
    <Modal title={`Cancel ${order.id}?`} onClose={onClose} width={440}>
      <p className="text-[13px] text-slate-600 mb-3">{order.outletId} · {order.temp} · {order.units} units. The order is removed from the draft plan and the store is notified.</p>
      <Field label="Reason"><input className={inputCls} value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Store called: ordered twice" /></Field>
      <div className="mt-6 flex justify-end gap-2"><Button onClick={onClose}>Keep order</Button><Button variant="danger" disabled={reason.trim().length < 3 || cancel.isPending} loading={cancel.isPending} onClick={() => cancel.mutate()}>Cancel order</Button></div>
    </Modal>
  );
}
