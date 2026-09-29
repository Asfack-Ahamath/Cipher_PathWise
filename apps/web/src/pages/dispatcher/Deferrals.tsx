import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarClock, CheckCircle2, ShieldCheck, Store, History, ChevronRight, Clock, AlertTriangle, KanbanSquare } from 'lucide-react';
import { BrandTag, TempTag, OutletBadges } from '../../components/tags';
import { Toolbar, Tabs, Button, Callout, KeyValues, Pill, Overline, Field, inputCls, Empty, cx } from '../../components/ds';
import { ErrorState, Loading, useAct, useApi, useReference, fmt } from '../../components/common';
import { post } from '../../lib/api';
import { dayLabel, hhmm } from '../../lib/clock';
import { useDepot } from './DispatcherApp';

type Row = { key: string; orderId: string; outletId: string; temp: string; kg: number; m3: number; units: number | null; orderUnits?: number; reason: string; kind: string; why: string; toDate: string | null; notifiedAt?: string | null; acknowledgedAt?: string | null; escalated?: boolean; proposed: boolean; daysSinceServed?: number; description?: string };

export default function Deferrals() {
  const nav = useNavigate();
  const depot = useDepot();
  const [tab, setTab] = useState<'today' | 'history'>('today');
  const [selKey, setSelKey] = useState<string | null>(null);
  const q = useApi<any>(['deferrals'], '/deferrals', { refetchInterval: 20_000 });
  const clock = useApi<any>(['clock'], '/clock');
  const plan = useApi<any>(['plan', clock.data?.planDate], clock.data?.planDate ? `/plans/${clock.data.planDate}` : null);
  const ref = useReference();
  const outlets = useMemo(() => new Map<string, any>((ref.data?.outlets ?? []).map((o: any) => [o.id, o])), [ref.data]);
  const [reasonEdit, setReasonEdit] = useState<Record<string, string>>({});
  const [noteEdit, setNoteEdit] = useState<Record<string, string>>({});
  const date = clock.data?.planDate;
  const change = useAct((b: { orderId: string; reason: string; why: string }) => post(`/plans/${date}/move`, { orderId: b.orderId, target: null, reason: { reason: b.reason, why: b.why } }), { invalidate: ['plan', 'deferrals'], success: 'Deferral reason updated in the draft' });

  if (q.isLoading || ref.isLoading) return <Loading />;
  if (q.error) return <ErrorState error={q.error} retry={q.refetch} />;
  const d = q.data;
  const reasons = ref.data?.reasons ?? {};
  const published: Row[] = d.deferrals.map((x: any) => ({ key: `d${x.id}`, orderId: x.order_id, outletId: x.outletId, temp: x.temp, kg: x.kg, m3: x.m3, units: x.units, orderUnits: x.orderUnits, reason: x.reason, kind: x.kind, why: x.why, toDate: x.toDate, notifiedAt: x.notified_at, acknowledgedAt: x.acknowledged_at, escalated: x.escalated, proposed: false, description: x.description }));
  const proposals: Row[] = plan.data?.mode === 'draft' ? plan.data.unassigned.filter((u: any) => u.proposal).map((u: any) => ({ key: `p${u.id}`, orderId: u.id, outletId: u.outletId, temp: u.temp, kg: u.kg, m3: u.m3, units: null, reason: u.proposal.reason, kind: u.proposal.kind, why: u.proposal.why, toDate: null, proposed: true, daysSinceServed: u.daysSinceServed, description: u.description })) : [];
  const all = [...published, ...proposals.filter(p => !published.some(x => x.orderId === p.orderId))].filter(r => depot === 'all' || outlets.get(r.outletId)?.depot === depot);
  const forced = all.filter(r => r.kind === 'forced');
  const chosen = all.filter(r => r.kind === 'chosen');
  const sel = all.find(r => r.key === selKey) ?? all[0];
  const selOut = sel ? outlets.get(sel.outletId) : null;
  const acked = published.filter(r => r.acknowledgedAt).length;
  const th = 'text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500 px-4 h-10 whitespace-nowrap';
  const nextLabel = sel?.toDate ? dayLabel(sel.toDate) : 'the next operating day';
  const curReason = sel ? reasonEdit[sel.key] ?? sel.reason : 'other';

  return (
    <div className="flex flex-1 min-h-0">
      <div className="flex-1 min-w-0 flex flex-col">
        <Toolbar icon={<CalendarClock size={18} />} hue="amber" title="Deferrals"
          subtitle={all.length ? `${all.length} orders move from ${d.dateLabel} · ${forced.length} forced, ${chosen.length} chosen · every one has a reason code` : `No deferrals for ${d.dateLabel} yet`}
          actions={published.length > 0 ? <span className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-emerald-50 text-emerald-800 text-[13px] font-semibold ring-1 ring-emerald-200"><CheckCircle2 size={15} />{published.length} stores told · {acked} acknowledged</span> : proposals.length ? <Button variant="primary" icon={<KanbanSquare size={15} />} onClick={() => nav('/d/plan')}>Publish from the plan board</Button> : undefined}>
          <Tabs className="mt-4 -mb-4" value={tab} onChange={setTab} items={[{ id: 'today', label: <>Today's decisions <span className="ml-1 text-slate-400 tabular">{all.length}</span></> }, { id: 'history', label: 'History and audit' }]} />
        </Toolbar>
        {tab === 'today' ? (
          <div className="flex-1 overflow-y-auto">
            <div className="mx-auto max-w-[1100px] px-4 sm:px-6 py-6 space-y-6">
              {d.protectedOutlets.length > 0 && <Callout tone="success" icon={<ShieldCheck size={15} className="text-emerald-600" />} title="Repeat-skip protection">
                {d.protectedOutlets.length} outlets deferred on the last run are served first today — {d.protectedOutlets.join(', ')}. The planner puts them at the top so no outlet is skipped two runs in a row.
              </Callout>}
              {proposals.length > 0 && !published.length && <Callout tone="info" title="These are proposals from the current draft">They become real deferrals, and stores are told, when you publish the plan.</Callout>}
              {all.length === 0 && <Empty icon={<CalendarClock size={28} />} title="Nothing deferred">Run auto-plan on the plan board. If demand is higher than capacity, the orders it cannot fit appear here with a reason.</Empty>}
              {forced.length > 0 && <Section title="Forced" hint="No feasible vehicle existed" list={forced} sel={sel?.key} onSel={setSelKey} reasons={reasons} outlets={outlets} />}
              {chosen.length > 0 && <Section title="Chosen" hint="Capacity went to higher-priority orders" list={chosen} sel={sel?.key} onSel={setSelKey} reasons={reasons} outlets={outlets} />}
              <p className="text-[12px] text-slate-500">Planner priority: skipped last run → days since last served → chilled Fresh → ambient Fresh → Tech → Style. The dispatcher can override any line on the plan board.</p>
            </div>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto">
            <div className="mx-auto max-w-[1200px] px-4 sm:px-6 py-6 space-y-3">
              <div className="bg-white rounded-xl border border-[#E6E9F0] overflow-x-auto">
                <table className="w-full min-w-[860px]">
                  <thead className="bg-[#F9FAFB] border-b border-[#E4E7EC]"><tr>{['From', 'To', 'Order', 'Outlet', 'Reason', 'Type', 'What happened next'].map(h => <th key={h} className={th}>{h}</th>)}</tr></thead>
                  <tbody>
                    {[...published.map(r => ({ fromDate: d.date, toDate: r.toDate, orderId: r.orderId, outletId: r.outletId, reason: r.reason, kind: r.kind, nextStatus: 'scheduled first on next run' })), ...d.history].map((h: any, i: number) => (
                      <tr key={i} className="border-t border-[#EEF0F3] text-[13px]">
                        <td className="px-4 py-3 text-slate-600 tabular whitespace-nowrap">{dayLabel(h.fromDate)}</td>
                        <td className="px-4 py-3 text-slate-600 tabular whitespace-nowrap">{h.toDate ? dayLabel(h.toDate) : '—'}</td>
                        <td className="px-4 py-3 font-mono text-[12px] text-slate-500">{h.orderId}</td>
                        <td className="px-4 py-3"><span className="font-semibold text-slate-900">{h.outletId}</span> <span className="text-slate-500">{outlets.get(h.outletId)?.brand} {outlets.get(h.outletId)?.district}</span></td>
                        <td className="px-4 py-3 text-slate-700">{reasons[h.reason]?.label ?? h.reason}</td>
                        <td className="px-4 py-3 capitalize text-slate-600">{h.kind}</td>
                        <td className="px-4 py-3 text-slate-700">{h.nextStatus ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-[12px] text-slate-500 flex items-center gap-1.5"><History size={13} />Every deferral keeps its reason, time and decision-maker in the audit log, so an outlet can't be skipped silently.</p>
            </div>
          </div>
        )}
      </div>

      {sel && selOut && tab === 'today' && (
        <aside className="w-[360px] 2xl:w-[400px] flex-shrink-0 hidden lg:flex flex-col min-h-0 bg-white border-l border-[#E4E7EC]">
          <div className="flex-shrink-0 px-5 py-4 border-b border-[#E4E7EC]">
            <div className="font-mono text-[12px] text-slate-500">{sel.orderId}</div>
            <div className="text-[16px] font-semibold text-slate-900 mt-0.5">{selOut.name}</div>
            <div className="flex flex-wrap items-center gap-1.5 mt-2.5"><BrandTag brand={selOut.brand} /><TempTag temp={sel.temp} /><OutletBadges o={selOut} /></div>
          </div>
          <div className="flex-1 overflow-y-auto p-5 space-y-5">
            <KeyValues items={[
              ['Type', <Pill key="t" label={sel.kind === 'forced' ? 'Forced' : 'Chosen'} color={sel.kind === 'forced' ? '#B91C1C' : '#92400E'} bg={sel.kind === 'forced' ? '#FEE2E2' : '#FEF3C7'} />],
              ['Status', sel.proposed ? 'Proposed in draft' : sel.acknowledgedAt ? `Store read it ${hhmm(sel.acknowledgedAt)}` : `Store told ${hhmm(sel.notifiedAt)}`],
              ['Size', sel.units ? `${sel.units} of ${sel.orderUnits} units` : `${fmt(sel.kg)} kg · ${fmt(sel.m3, 1)} m³`],
              ['New date', sel.toDate ? dayLabel(sel.toDate) : 'Next operating day'],
            ]} />
            {sel.escalated && <Callout tone="danger" icon={<AlertTriangle size={15} className="text-red-600" />} title="Deferred two runs in a row">This outlet was also deferred last run. It is escalated and goes first next time.</Callout>}
            {sel.proposed ? (
              <Field label="Reason (required)">
                <select value={curReason} onChange={e => setReasonEdit(r => ({ ...r, [sel.key]: e.target.value }))} className={inputCls}>
                  {Object.entries(reasons).map(([k, v]: any) => <option key={k} value={k}>{v.label}</option>)}
                </select>
              </Field>
            ) : <div><Overline>Reason</Overline><p className="mt-1 text-[13px] font-semibold text-slate-900">{reasons[sel.reason]?.label ?? sel.reason}</p></div>}
            <div><Overline>Why · from the planner</Overline><p className="mt-1 text-[13px] text-slate-700 leading-5">{sel.why}</p></div>
            {sel.proposed && <Field label={curReason === 'other' ? 'Note (required for Other)' : 'Note'}>
              <textarea value={noteEdit[sel.key] ?? ''} onChange={e => setNoteEdit(n => ({ ...n, [sel.key]: e.target.value }))} rows={2} className={`${inputCls} h-auto py-2 resize-none`} placeholder="Context for the store and the audit log" />
            </Field>}
            <div className="rounded-lg border border-[#E4E7EC] overflow-hidden">
              <div className="px-4 py-2 bg-[#F9FAFB] border-b border-[#EEF0F3] flex items-center gap-1.5"><Store size={13} className="text-slate-500" /><Overline>Store manager sees</Overline></div>
              <div className="px-4 py-3 text-[13px] leading-5 space-y-1">
                <div className="font-semibold text-slate-900">{sel.units ? `${sel.units} units of your ${sel.temp} order` : `Your ${sel.temp} order ${sel.orderId}`} moves to {nextLabel}</div>
                <div className="text-slate-700">{reasons[curReason]?.store}</div>
                <div className="text-slate-500">It stays confirmed — no need to re-order. It goes first on the next run.</div>
              </div>
            </div>
          </div>
          <div className="flex-shrink-0 p-4 border-t border-[#E4E7EC] flex gap-2">
            {sel.proposed && <Button className="flex-1" variant="primary" disabled={change.isPending || (curReason === 'other' && !(noteEdit[sel.key] ?? '').trim())} onClick={() => change.mutate({ orderId: sel.orderId, reason: curReason, why: (noteEdit[sel.key] ?? '').trim() || sel.why })}>Save reason</Button>}
            <Button className={sel.proposed ? '' : 'flex-1'} icon={<KanbanSquare size={15} />} onClick={() => nav('/d/plan')}>Try to serve</Button>
          </div>
        </aside>
      )}
    </div>
  );
}

function Section({ title, hint, list, sel, onSel, reasons, outlets }: { title: string; hint: string; list: Row[]; sel?: string; onSel: (k: string) => void; reasons: any; outlets: Map<string, any> }) {
  return (
    <section>
      <div className="flex items-baseline gap-2 mb-2.5"><h2 className="text-[14px] font-semibold text-slate-900">{title}</h2><span className="text-[13px] text-slate-500">{hint} · {list.length}</span></div>
      <div className="bg-white rounded-xl border border-[#E6E9F0] divide-y divide-[#EEF0F3] overflow-hidden">
        {list.map(r => {
          const ot = outlets.get(r.outletId); const active = sel === r.key;
          return (
            <button key={r.key} onClick={() => onSel(r.key)} className={cx('relative w-full text-left flex items-center gap-4 px-5 py-3.5 transition-colors', active ? 'bg-teal-50/60' : 'hover:bg-slate-50')}>
              {active && <span className="absolute left-0 top-0 bottom-0 w-[3px] bg-teal-700" />}
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2"><span className="text-[14px] font-semibold text-slate-900">{r.outletId}</span><span className="text-[13px] text-slate-500">{ot?.brand} {ot?.district}</span><TempTag temp={r.temp} />
                  {r.units ? <Pill label={`${r.units} units · partial`} color="#9A3412" bg="#FFEDD5" /> : null}
                  {r.proposed ? <Pill label="Proposed" color="#475569" bg="#F1F5F9" /> : r.acknowledgedAt ? <Pill label="Store read" color="#047857" bg="#D1FAE5" icon={<CheckCircle2 size={11} />} /> : <Pill label="Store told" color="#4338CA" bg="#E0E7FF" icon={<Clock size={11} />} />}
                  {r.escalated && <Pill label="Escalated" color="#B91C1C" bg="#FEE2E2" />}</div>
                <p className="text-[12px] text-slate-500 mt-1 line-clamp-1">{r.why}</p>
              </div>
              <span className="hidden md:inline text-[12px] font-semibold text-slate-700 bg-slate-100 rounded-md px-2 h-6 leading-6 whitespace-nowrap">{reasons[r.reason]?.label ?? r.reason}</span>
              <ChevronRight size={16} className="text-slate-300" />
            </button>
          );
        })}
      </div>
    </section>
  );
}
