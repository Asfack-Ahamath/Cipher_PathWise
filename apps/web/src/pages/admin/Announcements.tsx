import { useState } from 'react';
import { Megaphone, Send, Trash2, Users as UsersIcon, Eye } from 'lucide-react';
import { Button, Card, CardHeader, Empty, Field, IconChip, Modal, cx, inputCls } from '../../components/ds';
import { Select } from '../../components/Select';
import { ErrorState, Loading, useAct, useApi } from '../../components/common';
import { del, post, type ApiError } from '../../lib/api';
import { dayLabel, hhmm } from '../../lib/clock';
import { AdminPage } from './AdminApp';

const AUDIENCE: Record<string, string> = {
  all: 'Everyone', 'role:dispatcher': 'Dispatchers', 'role:loader': 'Loaders', 'role:driver': 'Drivers', 'role:store_manager': 'Store managers',
  'depot:Peliyagoda': 'Peliyagoda depot (loaders)', 'depot:Kandy': 'Kandy depot (loaders)', 'role:admin': 'Administrators',
};
const TONES = { blue: { label: 'Information', dot: '#4F46E5', chip: 'bg-indigo-50 text-indigo-800 ring-indigo-100' }, green: { label: 'Good news', dot: '#059669', chip: 'bg-emerald-50 text-emerald-800 ring-emerald-100' }, amber: { label: 'Heads-up', dot: '#D97706', chip: 'bg-amber-50 text-amber-800 ring-amber-100' }, red: { label: 'Urgent', dot: '#DC2626', chip: 'bg-red-50 text-red-800 ring-red-100' } } as const;
type ToneKey = keyof typeof TONES;
const audienceLabel = (a: string[]) => (a.length >= 5 ? 'Everyone' : a.map(x => AUDIENCE[x] ?? x).join(', '));

/** Announcements: a message to a role or a depot that lands in everyone's notification bell. */
export default function Announcements() {
  const q = useApi<any[]>(['admin-announcements'], '/admin/announcements');
  const [f, setF] = useState({ audience: 'all', tone: 'blue' as ToneKey, title: '', body: '' });
  const [err, setErr] = useState<Record<string, string>>({});
  const [removing, setRemoving] = useState<any | null>(null);
  const send = useAct(() => post('/admin/announcements', { ...f, title: f.title.trim(), body: f.body.trim() }), {
    invalidate: ['admin-announcements', 'notifications'], success: 'Announcement sent',
    onDone: () => setF({ ...f, title: '', body: '' }), onError: (e: ApiError) => setErr(e.fields),
  });
  const remove = useAct((id: number) => del(`/admin/announcements/${id}`), { invalidate: ['admin-announcements', 'notifications'], success: 'Announcement withdrawn', onDone: () => setRemoving(null) });
  const t = TONES[f.tone];
  const ok = f.title.trim().length >= 3;

  return (
    <AdminPage title="Announcements" subtitle="Send a short message to a role or depot. It appears in their notification bell on every device straight away.">
      <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] gap-5 sm:gap-6 items-start">
        <Card>
          <CardHeader icon={<IconChip hue="indigo" size={32}><Megaphone size={16} /></IconChip>} title="New announcement" />
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Send to"><Select value={f.audience} onChange={v => setF({ ...f, audience: v })} aria-label="Audience"
              options={Object.entries(AUDIENCE).filter(([k]) => k !== 'role:admin').map(([value, label]) => ({ value, label, icon: <UsersIcon size={14} /> }))} /></Field>
            <Field label="Type"><Select value={f.tone} onChange={v => setF({ ...f, tone: v })} aria-label="Type"
              options={(Object.keys(TONES) as ToneKey[]).map(k => ({ value: k, label: TONES[k].label, icon: <span className="block w-2.5 h-2.5 rounded-full" style={{ background: TONES[k].dot }} /> }))} /></Field>
            <div className="sm:col-span-2"><Field label="Title" hint={err.title || `${f.title.length}/80`}><input className={inputCls} maxLength={80} value={f.title} placeholder="e.g. Kandy depot closes at 18:00 on Friday" onChange={e => { setF({ ...f, title: e.target.value }); setErr({}); }} /></Field></div>
            <div className="sm:col-span-2"><Field label="Message (optional)" hint={`${f.body.length}/500`}><textarea className={cx(inputCls, 'h-28 py-2 resize-y')} maxLength={500} value={f.body} placeholder="Add the details people need." onChange={e => setF({ ...f, body: e.target.value })} /></Field></div>
          </div>
          <div className="mt-5 rounded-xl bg-slate-50 ring-1 ring-[#EEF0F3] p-3">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500 mb-2"><Eye size={12} />Preview</div>
            <div className="flex gap-3 bg-white rounded-lg ring-1 ring-[#E4E7EC] px-3 py-2.5">
              <span className="w-2 h-2 rounded-full mt-1.5 flex-shrink-0" style={{ background: t.dot }} />
              <div className="min-w-0"><div className="text-[13px] font-semibold text-slate-900 break-words">{f.title || 'Your title'}</div>{f.body && <div className="text-[12px] text-slate-500 mt-0.5 break-words whitespace-pre-line">{f.body}</div>}</div>
            </div>
          </div>
          <div className="mt-5 flex flex-col-reverse sm:flex-row sm:items-center justify-between gap-3">
            <span className="text-[12px] text-slate-500">To: <b className="text-slate-700">{AUDIENCE[f.audience]}</b></span>
            <Button variant="primary" icon={<Send size={14} />} disabled={!ok || send.isPending} loading={send.isPending} onClick={() => send.mutate()}>Send announcement</Button>
          </div>
        </Card>

        <Card pad={false}>
          <div className="px-5 pt-5"><CardHeader title="Sent" subtitle={q.data ? `${q.data.length} announcement${q.data.length === 1 ? '' : 's'}` : undefined} /></div>
          {q.isLoading ? <Loading /> : q.error ? <ErrorState error={q.error} retry={q.refetch} /> : q.data!.length === 0 ? (
            <Empty icon={<Megaphone size={20} />} title="Nothing sent yet">Announcements you send are listed here with how many people have read them.</Empty>
          ) : (
            <ul className="divide-y divide-[#EEF0F3] border-t border-[#EEF0F3]">
              {q.data!.map(a => {
                const tone = TONES[a.tone as ToneKey] ?? TONES.blue;
                return (
                  <li key={a.id} className="px-5 py-4 flex gap-3">
                    <span className="w-2 h-2 rounded-full mt-2 flex-shrink-0" style={{ background: tone.dot }} />
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1"><span className="text-[14px] font-semibold text-slate-900 break-words">{a.title}</span><span className={cx('inline-flex h-5 px-2 items-center rounded-full text-[11px] font-semibold ring-1', tone.chip)}>{tone.label}</span></div>
                      {a.body && <p className="text-[13px] text-slate-600 mt-1 whitespace-pre-line break-words">{a.body}</p>}
                      <div className="mt-1.5 text-[12px] text-slate-500 flex flex-wrap gap-x-3 gap-y-0.5"><span>{dayLabel(a.createdAt)} {hhmm(a.createdAt)}</span><span>To {audienceLabel(a.audiences)}</span><span className="inline-flex items-center gap-1"><Eye size={12} />Read by {a.reads}</span></div>
                    </div>
                    <button onClick={() => setRemoving(a)} className="w-8 h-8 flex-shrink-0 rounded-lg flex items-center justify-center text-slate-400 hover:text-red-600 hover:bg-red-50" title="Withdraw" aria-label={`Withdraw ${a.title}`}><Trash2 size={15} /></button>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
      {removing && (
        <Modal title="Withdraw this announcement?" onClose={() => setRemoving(null)} width={420}>
          <p className="text-[13px] text-slate-600">“{removing.title}” is removed from everyone's notification bell.</p>
          <div className="mt-6 flex justify-end gap-2"><Button onClick={() => setRemoving(null)}>Cancel</Button><Button variant="danger" disabled={remove.isPending} loading={remove.isPending} onClick={() => remove.mutate(removing.id)}>Withdraw</Button></div>
        </Modal>
      )}
    </AdminPage>
  );
}
