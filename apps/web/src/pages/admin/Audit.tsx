import { useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { ScrollText } from 'lucide-react';
import { Button, Card, Empty, cx, inputCls } from '../../components/ds';
import { ErrorState, Loading } from '../../components/common';
import { api } from '../../lib/api';
import { dayLabel } from '../../lib/clock';
import { AdminPage } from './AdminApp';
import { ROLE_LABEL } from './Users';

const time = (d: string) => new Date(d).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: 'Asia/Colombo' });

export default function Audit() {
  const [action, setAction] = useState('');
  const [entity, setEntity] = useState('');
  const [open, setOpen] = useState<number | null>(null);
  const qs = (before?: number) => new URLSearchParams(Object.entries({ limit: '50', action, entity, before: before ? String(before) : '' }).filter(([, v]) => v)).toString();
  const q = useInfiniteQuery({
    queryKey: ['admin-audit', action, entity],
    queryFn: ({ pageParam }) => api<any>(`/admin/audit?${qs(pageParam as number | undefined)}`),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: last => last.nextBefore ?? undefined,
  });
  const items = q.data?.pages.flatMap(p => p.items) ?? [];
  const prefixes: string[] = q.data?.pages[0]?.actionPrefixes ?? [];
  return (
    <AdminPage title="Audit log" subtitle="Every sign-in, change and decision, newest first. Passwords, PINs and photos are never written here.">
      <div className="flex flex-wrap gap-2 mb-4">
        <select className={cx(inputCls, 'w-48')} value={action} onChange={e => setAction(e.target.value)} aria-label="Action"><option value="">All actions</option>{prefixes.map(p => <option key={p} value={`${p}.`}>{p}</option>)}</select>
        <input className={cx(inputCls, 'w-56')} value={entity} onChange={e => setEntity(e.target.value)} placeholder="Entity, e.g. trip:12 or user:3" aria-label="Entity" />
      </div>
      {q.isLoading ? <Loading /> : q.error ? <ErrorState error={q.error} retry={q.refetch} /> : (
        <Card pad={false}>
          {items.length === 0 ? <Empty icon={<ScrollText size={20} />} title="Nothing recorded for this filter" /> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-[13px]">
                <thead className="bg-[#F9FAFB] border-b border-[#E4E7EC]"><tr>{['When', 'Who', 'Action', 'Entity', 'Details'].map(h => <th key={h} className="text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500 px-4 h-10">{h}</th>)}</tr></thead>
                <tbody>
                  {items.map((a: any) => (
                    <tr key={a.id} className="border-t border-[#EEF0F3] align-top">
                      <td className="px-4 py-2.5 whitespace-nowrap tabular text-slate-600">{dayLabel(a.at)} {time(a.at)}</td>
                      <td className="px-4 py-2.5">{a.userName ?? <span className="text-slate-400">System / anonymous</span>}{a.userRole && <div className="text-[11px] text-slate-500">{ROLE_LABEL[a.userRole]}</div>}</td>
                      <td className="px-4 py-2.5 font-mono text-[12px] text-slate-800">{a.action}</td>
                      <td className="px-4 py-2.5 font-mono text-[12px] text-slate-600">{a.entity ?? '—'}</td>
                      <td className="px-4 py-2.5 max-w-[360px]">
                        {a.data && Object.keys(a.data).length > 0 && (open === a.id
                          ? <><pre className="text-[11px] bg-slate-50 rounded-md p-2 overflow-x-auto whitespace-pre-wrap break-all">{JSON.stringify(a.data, null, 2)}</pre><button className="mt-2 text-[12px] font-semibold text-slate-600 hover:text-slate-900" onClick={() => setOpen(null)}>Hide</button></>
                          : <button className="text-[12px] font-semibold text-teal-700 hover:text-teal-800" onClick={(e) => { e.preventDefault(); setOpen(a.id); }}>Show {Object.keys(a.data).length} field{Object.keys(a.data).length > 1 ? 's' : ''}</button>)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {q.hasNextPage && <div className="p-3 border-t border-[#EEF0F3] text-center"><Button disabled={q.isFetchingNextPage} onClick={() => q.fetchNextPage()}>{q.isFetchingNextPage ? 'Loading…' : 'Load older entries'}</Button></div>}
        </Card>
      )}
    </AdminPage>
  );
}
