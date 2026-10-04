import { useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Download, ScrollText, X } from 'lucide-react';
import { Button, Card, Empty, cx, inputCls, thCls } from '../../components/ds';
import { Select } from '../../components/Select';
import { ErrorState, Loading, useApi } from '../../components/common';
import { api } from '../../lib/api';
import { dayLabel } from '../../lib/clock';
import { downloadCsv, stamp } from '../../lib/csv';
import { AdminPage, FilterBar } from './AdminApp';
import { ROLE_LABEL } from './Users';

const time = (d: string) => new Date(d).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: 'Asia/Colombo' });

export default function Audit() {
  const [action, setAction] = useState('');
  const [entity, setEntity] = useState('');
  const [userId, setUserId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const people = useApi<any[]>(['admin-users'], '/admin/users');
  // dates are Colombo days: from 00:00 to 23:59:59 local
  const iso = (d: string, end: boolean) => (d ? `${d}T${end ? '23:59:59' : '00:00:00'}+05:30` : '');
  const [open, setOpen] = useState<number | null>(null);
  const qs = (before?: number) => new URLSearchParams(Object.entries({ limit: '50', action, entity, userId, from: iso(from, false), to: iso(to, true), before: before ? String(before) : '' }).filter(([, v]) => v)).toString();
  const q = useInfiniteQuery({
    queryKey: ['admin-audit', action, entity, userId, from, to],
    queryFn: ({ pageParam }) => api<any>(`/admin/audit?${qs(pageParam as number | undefined)}`),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: last => last.nextBefore ?? undefined,
  });
  const items = q.data?.pages.flatMap(p => p.items) ?? [];
  const prefixes: string[] = q.data?.pages[0]?.actionPrefixes ?? [];
  return (
    <AdminPage title="Audit log" subtitle="Every sign-in, change and decision, newest first. Passwords, PINs and photos are never written here."
      actions={<Button icon={<Download size={15} />} disabled={!items.length} onClick={() => downloadCsv(`pathwise-audit-${stamp()}.csv`, ['When', 'Who', 'Role', 'Action', 'Entity', 'Details'],
        items.map((a: any) => [a.at, a.userName ?? 'System / anonymous', a.userRole ? ROLE_LABEL[a.userRole] : '', a.action, a.entity, a.data && Object.keys(a.data).length ? a.data : '']))}>Export {items.length} loaded</Button>}>
      <FilterBar>
        <div className="grid grid-cols-2 gap-2 sm:flex">
          <div className="sm:w-44"><Select value={action} onChange={setAction} aria-label="Action" options={[{ value: '', label: 'All actions' }, ...prefixes.map(p => ({ value: `${p}.`, label: <span className="font-mono text-[12px]">{p}</span>, text: p }))]} /></div>
          <div className="sm:w-56"><Select value={userId} onChange={setUserId} aria-label="Person" searchable options={[{ value: '', label: 'Anyone' }, ...(people.data ?? []).map(u => ({ value: String(u.id), label: u.name as string, hint: ROLE_LABEL[u.role] }))]} /></div>
        </div>
        <input className={cx(inputCls, 'sm:w-56')} value={entity} onChange={e => setEntity(e.target.value)} placeholder="Entity, e.g. trip:12 or user:3" aria-label="Entity" />
        <div className="grid grid-cols-2 gap-2 sm:flex">
          <label className="flex items-center gap-1.5 text-[12px] text-slate-500"><span className="w-9 sm:w-auto">From</span><input type="date" className={cx(inputCls, 'sm:w-40')} value={from} max={to || undefined} onChange={e => setFrom(e.target.value)} /></label>
          <label className="flex items-center gap-1.5 text-[12px] text-slate-500"><span className="w-9 sm:w-auto">To</span><input type="date" className={cx(inputCls, 'sm:w-40')} value={to} min={from || undefined} onChange={e => setTo(e.target.value)} /></label>
        </div>
        {(action || entity || userId || from || to) && <div><Button size="sm" icon={<X size={13} />} onClick={() => { setAction(''); setEntity(''); setUserId(''); setFrom(''); setTo(''); }}>Clear filters</Button></div>}
      </FilterBar>
      {q.isLoading ? <Loading /> : q.error ? <ErrorState error={q.error} retry={q.refetch} /> : (
        <Card pad={false}>
          {items.length === 0 ? <Empty icon={<ScrollText size={20} />} title="Nothing recorded for this filter" /> : (
            <>
            <ul className="md:hidden divide-y divide-[#EEF0F3]">
              {items.map((a: any) => (
                <li key={a.id} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-3"><span className="font-mono text-[12px] text-slate-900 break-all">{a.action}</span><span className="text-[11px] tabular text-slate-500 flex-shrink-0">{dayLabel(a.at)} {time(a.at).slice(0, 5)}</span></div>
                  <div className="mt-1 text-[12px] text-slate-600">{a.userName ?? 'System / anonymous'}{a.userRole ? ` · ${ROLE_LABEL[a.userRole]}` : ''}{a.entity ? <span className="font-mono text-slate-400"> · {a.entity}</span> : null}</div>
                  {a.data && Object.keys(a.data).length > 0 && (open === a.id
                    ? <pre className="mt-2 text-[11px] bg-slate-50 rounded-md p-2 overflow-x-auto whitespace-pre-wrap break-all">{JSON.stringify(a.data, null, 2)}</pre>
                    : <button className="mt-1 text-[12px] font-semibold text-teal-700" onClick={() => setOpen(a.id)}>Show {Object.keys(a.data).length} field{Object.keys(a.data).length > 1 ? 's' : ''}</button>)}
                </li>
              ))}
            </ul>
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full min-w-[820px] text-[13px]">
                <thead className="bg-[#F9FAFB] border-b border-[#E4E7EC]"><tr>{['When', 'Who', 'Action', 'Entity', 'Details'].map(h => <th key={h} className={thCls}>{h}</th>)}</tr></thead>
                <tbody>
                  {items.map((a: any) => (
                    <tr key={a.id} className="border-t border-[#EEF0F3] align-top">
                      <td className="px-4 py-2.5 whitespace-nowrap tabular text-slate-600">{dayLabel(a.at)} {time(a.at)}</td>
                      <td className="px-4 py-2.5">{a.userName ?? <span className="text-slate-400">System / anonymous</span>}{a.userRole && <div className="text-[11px] text-slate-500">{ROLE_LABEL[a.userRole]}</div>}</td>
                      <td className="px-4 py-2.5 font-mono text-[12px] text-slate-800">{a.action}</td>
                      <td className="px-4 py-2.5 font-mono text-[12px] text-slate-600">{a.entity ?? '—'}</td>
                      <td className="px-4 py-2.5 max-w-[360px]">
                        {a.data && Object.keys(a.data).length > 0 && (open === a.id
                          ? <pre className="text-[11px] bg-slate-50 rounded-md p-2 overflow-x-auto whitespace-pre-wrap break-all">{JSON.stringify(a.data, null, 2)}</pre>
                          : <button className="text-[12px] font-semibold text-teal-700" onClick={() => setOpen(a.id)}>Show {Object.keys(a.data).length} field{Object.keys(a.data).length > 1 ? 's' : ''}</button>)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            </>
          )}
          {q.hasNextPage && <div className="p-3 border-t border-[#EEF0F3] text-center"><Button disabled={q.isFetchingNextPage} onClick={() => q.fetchNextPage()}>{q.isFetchingNextPage ? 'Loading…' : 'Load older entries'}</Button></div>}
        </Card>
      )}
    </AdminPage>
  );
}
