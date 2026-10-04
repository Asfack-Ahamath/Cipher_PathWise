import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Ban, Download, KeyRound, Lock, LogOut, Mail, Plus, Search, ShieldCheck, Unlock, UserCog, Users as UsersIcon } from 'lucide-react';
import { Button, Card, Empty, Field, Modal, cx, inputCls, thCls } from '../../components/ds';
import { Select } from '../../components/Select';
import { ErrorState, Loading, useAct, useApi, useReference, useToast } from '../../components/common';
import { patch, post, type ApiError } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { hhmm, dayLabel } from '../../lib/clock';
import { downloadCsv, stamp } from '../../lib/csv';
import { AdminPage, FilterBar } from './AdminApp';

export const ROLE_LABEL: Record<string, string> = { admin: 'Administrator', dispatcher: 'Dispatcher', loader: 'Loader', driver: 'Driver', store_manager: 'Store manager' };
const ROLE_TONE: Record<string, string> = { admin: 'bg-indigo-50 text-indigo-800', dispatcher: 'bg-teal-50 text-teal-800', loader: 'bg-violet-50 text-violet-800', driver: 'bg-sky-50 text-sky-800', store_manager: 'bg-amber-50 text-amber-800' };
const when = (d?: string | null) => (d ? `${dayLabel(d)} ${hhmm(d)}` : 'Never');
type Status = 'active' | 'locked' | 'must_set' | 'disabled';
const STATUS_LABEL: Record<Status, string> = { active: 'Active', locked: 'Locked', must_set: 'Must set password', disabled: 'Disabled' };
const statusOf = (u: any): Status => !u.isActive ? 'disabled' : u.lockedUntil && new Date(u.lockedUntil).getTime() > Date.now() ? 'locked' : u.mustChangePassword ? 'must_set' : 'active';

export default function Users() {
  const [params, setParams] = useSearchParams();
  const [text, setText] = useState('');
  const [role, setRole] = useState<string>('all');
  const [status, setStatus] = useState<string>('all');
  const [editing, setEditing] = useState<any | 'new' | null>(() => (params.get('new') ? 'new' : null));
  const [secret, setSecret] = useState<{ title: string; value: string; note: string } | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [confirm, setConfirm] = useState<BulkAction | null>(null);
  const q = useApi<any[]>(['admin-users'], '/admin/users');
  const toast = useToast();
  const { user: me } = useAuth();
  useEffect(() => { if (params.get('new')) setParams({}, { replace: true }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const rows = useMemo(() => (q.data ?? []).filter(u => (role === 'all' || u.role === role) && (status === 'all' || statusOf(u) === status) && (!text || `${u.name} ${u.email} ${u.outletId ?? ''} ${u.vehicleId ?? ''} ${u.depot ?? ''}`.toLowerCase().includes(text.toLowerCase()))), [q.data, role, status, text]);
  // the selection only counts people still on screen
  const sel = rows.filter(u => picked.has(u.id));
  const selectable = rows.filter(u => u.id !== me?.id);
  const allOn = selectable.length > 0 && selectable.every(u => picked.has(u.id));
  const toggle = (id: number) => setPicked(p => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const bulk = useAct((action: BulkAction) => post<{ done: number; failed: { id: number; error: string }[] }>('/admin/users/bulk', { ids: sel.map(u => u.id), action }), {
    invalidate: ['admin-users', 'admin-overview'],
    onDone: (r, action) => {
      setConfirm(null); setPicked(new Set());
      toast(r.failed.length ? 'error' : 'success', `${BULK[action].done} ${r.done} ${r.done === 1 ? 'person' : 'people'}${r.failed.length ? ` · ${r.failed.length} skipped: ${r.failed[0].error}` : ''}`);
    },
  });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorState error={q.error} retry={q.refetch} />;
  const counts = (r: string) => (q.data ?? []).filter(u => u.role === r).length;
  const scs = (s: Status) => (q.data ?? []).filter(u => statusOf(u) === s).length;
  return (
    <AdminPage title="People and access" subtitle="Who can sign in, what they can reach, and how." actions={<>
      <Button icon={<Download size={15} />} disabled={!rows.length} onClick={() => downloadCsv(`pathwise-people-${stamp()}.csv`, ['Name', 'Email', 'Phone', 'Role', 'Depot', 'Outlet', 'Vehicle', 'Sign-in', 'Dock PIN', 'Status', 'Last sign-in'],
        rows.map(u => [u.name, u.email, u.phone, ROLE_LABEL[u.role], u.depot, u.outletId, u.vehicleId, u.supabaseLinked ? 'Supabase Auth' : 'Password', u.hasPin ? 'Yes' : 'No', STATUS_LABEL[statusOf(u)], u.lastLoginAt]))}>Export CSV</Button>
      <Button variant="primary" icon={<Plus size={15} />} onClick={() => setEditing('new')}>Add person</Button></>}>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mb-4">
        {(Object.keys(STATUS_LABEL) as Status[]).map(k => (
          <button key={k} onClick={() => setStatus(status === k ? 'all' : k)} aria-pressed={status === k} className={cx('text-left rounded-xl bg-white ring-1 px-3.5 py-2.5 transition', status === k ? 'ring-2 ring-indigo-500' : 'ring-[#E4E7EC] hover:ring-slate-300')}>
            <div className="flex items-center gap-1.5 text-[12px] font-medium text-slate-500"><span className="w-2 h-2 rounded-full" style={{ background: STATUS_DOT[k] }} />{STATUS_LABEL[k]}</div>
            <div className="text-[20px] font-semibold tabular text-slate-900 leading-7">{scs(k)}</div>
          </button>
        ))}
      </div>
      <FilterBar>
        <span className="relative sm:w-72"><Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" /><input value={text} onChange={e => setText(e.target.value)} placeholder="Name, email, outlet, vehicle" className={cx(inputCls, 'pl-8')} aria-label="Search people" /></span>
        <div className="grid grid-cols-2 gap-2 sm:flex">
          <div className="sm:w-52"><Select value={role} onChange={setRole} aria-label="Role" options={[{ value: 'all', label: 'All roles', hint: `${q.data?.length ?? 0} people` }, ...Object.keys(ROLE_LABEL).map(r => ({ value: r, label: ROLE_LABEL[r], hint: `${counts(r)} people` }))]} /></div>
          <div className="sm:w-52"><Select value={status} onChange={setStatus} aria-label="Status" options={[{ value: 'all', label: 'Any status' }, ...(Object.keys(STATUS_LABEL) as Status[]).map(k => ({ value: k, label: STATUS_LABEL[k], icon: <span className="block w-2 h-2 rounded-full" style={{ background: STATUS_DOT[k] }} /> }))]} /></div>
        </div>
        {(text || role !== 'all' || status !== 'all') && <button className="text-[12px] font-semibold text-indigo-700 hover:text-indigo-900 justify-self-start" onClick={() => { setText(''); setRole('all'); setStatus('all'); }}>Clear filters</button>}
        <span className="sm:ml-auto text-[12px] text-slate-500">{rows.length} of {q.data?.length ?? 0}</span>
      </FilterBar>
      {sel.length > 0 && (
        <div className="sticky top-2 z-20 mb-3 flex flex-col sm:flex-row sm:items-center gap-2 rounded-xl bg-slate-900 text-white px-4 py-2.5 shadow-lg anim-menu">
          <span className="text-[13px] font-semibold flex-1">{sel.length} selected</span>
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(BULK) as BulkAction[]).map(k => <button key={k} onClick={() => setConfirm(k)} className={cx('h-8 px-3 rounded-lg text-[12px] font-semibold inline-flex items-center gap-1.5', k === 'disable' ? 'bg-red-500/90 hover:bg-red-500' : 'bg-white/10 hover:bg-white/20')}>{BULK[k].icon}{BULK[k].label}</button>)}
            <button onClick={() => setPicked(new Set())} className="h-8 px-3 rounded-lg text-[12px] font-semibold text-white/70 hover:text-white">Clear</button>
          </div>
        </div>
      )}
      <Card pad={false}>
        {rows.length === 0 ? <Empty icon={<UsersIcon size={20} />} title="No one matches">Change the search or the filters.</Empty> : <>
          {/* phones: cards */}
          <ul className="md:hidden divide-y divide-[#EEF0F3]">
            {rows.map(u => (
              <li key={u.id} className={cx('px-4 py-3.5 flex items-start gap-3', !u.isActive && 'opacity-60')}>
                <Check on={picked.has(u.id)} disabled={u.id === me?.id} onChange={() => toggle(u.id)} label={u.name} />
                <button className="flex-1 min-w-0 text-left" onClick={() => setEditing(u)}>
                  <div className="flex items-center gap-2"><span className="font-semibold text-[14px] text-slate-900 truncate">{u.name}</span>{u.id === me?.id && <span className="text-[11px] text-slate-400">(you)</span>}</div>
                  <div className="text-[12px] text-slate-500 truncate">{u.email}</div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5"><RolePill role={u.role} /><StatusTag u={u} /><span className="text-[11px] text-slate-500">{scopeOf(u)}</span></div>
                </button>
                <UserCog size={16} className="text-slate-400 mt-1" />
              </li>
            ))}
          </ul>
          {/* tablet and up: table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full min-w-[860px] text-[13px]">
              <thead className="bg-[#F9FAFB] border-b border-[#E4E7EC]"><tr>
                <th className="w-10 pl-4 text-left"><Check on={allOn} onChange={() => setPicked(allOn ? new Set() : new Set(selectable.map(u => u.id)))} label="all" /></th>
                {['Person', 'Role', 'Scope', 'Sign-in', 'Last sign-in', 'Status', ''].map(h => <th key={h} className={thCls}>{h}</th>)}</tr></thead>
              <tbody>
                {rows.map(u => (
                  <tr key={u.id} className={cx('border-t border-[#EEF0F3] transition-colors', picked.has(u.id) ? 'bg-indigo-50/50' : 'hover:bg-slate-50/70', !u.isActive && 'opacity-60')}>
                    <td className="pl-4"><Check on={picked.has(u.id)} disabled={u.id === me?.id} onChange={() => toggle(u.id)} label={u.name} /></td>
                    <td className="px-4 py-3"><div className="flex items-center gap-3"><Avatar name={u.name} role={u.role} /><div className="min-w-0"><div className="font-semibold text-slate-900 truncate">{u.name}{u.id === me?.id && <span className="ml-1.5 text-[11px] font-normal text-slate-400">(you)</span>}</div><div className="text-[12px] text-slate-500 truncate">{u.email}{u.phone ? ` · ${u.phone}` : ''}</div></div></div></td>
                    <td className="px-4 py-3"><RolePill role={u.role} /></td>
                    <td className="px-4 py-3 text-slate-700">{scopeOf(u)}</td>
                    <td className="px-4 py-3 text-[12px] text-slate-600">{u.supabaseLinked ? 'Supabase Auth' : 'Password'}{u.hasPin ? ' · PIN' : ''}</td>
                    <td className="px-4 py-3 text-[12px] text-slate-600 whitespace-nowrap">{when(u.lastLoginAt)}</td>
                    <td className="px-4 py-3"><StatusTag u={u} /></td>
                    <td className="px-4 py-3 text-right"><Button size="sm" icon={<UserCog size={14} />} onClick={() => setEditing(u)}>Manage</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>}
      </Card>
      {editing && <UserDialog user={editing === 'new' ? null : editing} me={me?.id} onClose={() => setEditing(null)} onSecret={s => { setEditing(null); setSecret(s); }} />}
      {confirm && (
        <Modal title={`${BULK[confirm].label} ${sel.length} ${sel.length === 1 ? 'person' : 'people'}?`} onClose={() => setConfirm(null)} width={440}>
          <p className="text-[13px] text-slate-600">{BULK[confirm].note}</p>
          <ul className="mt-3 max-h-40 overflow-y-auto rounded-lg bg-slate-50 ring-1 ring-[#EEF0F3] divide-y divide-[#EEF0F3] text-[13px]">{sel.map(u => <li key={u.id} className="px-3 py-1.5 flex justify-between gap-2"><span className="truncate">{u.name}</span><span className="text-slate-500 text-[12px]">{ROLE_LABEL[u.role]}</span></li>)}</ul>
          <div className="mt-6 flex justify-end gap-2"><Button onClick={() => setConfirm(null)}>Cancel</Button><Button variant={confirm === 'disable' ? 'danger' : 'primary'} disabled={bulk.isPending} loading={bulk.isPending} onClick={() => bulk.mutate(confirm)}>{BULK[confirm].label}</Button></div>
        </Modal>
      )}
      {secret && (
        <Modal title={secret.title} onClose={() => setSecret(null)} width={440}>
          <p className="text-[13px] text-slate-600 mb-3">{secret.note}</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 min-w-0 h-11 px-3 flex items-center rounded-lg bg-slate-900 text-white text-[16px] font-semibold tracking-wide select-all overflow-x-auto">{secret.value}</code>
            <Button onClick={() => { void navigator.clipboard?.writeText(secret.value); toast('success', 'Copied'); }}>Copy</Button>
          </div>
          <p className="mt-3 text-[12px] text-slate-500">This is shown once. It is not stored anywhere readable.</p>
          <div className="mt-5 flex justify-end"><Button variant="primary" onClick={() => setSecret(null)}>Done</Button></div>
        </Modal>
      )}
    </AdminPage>
  );
}

type BulkAction = 'sign-out' | 'unlock' | 'enable' | 'disable';
const BULK: Record<BulkAction, { label: string; done: string; note: string; icon: ReactNode }> = {
  'sign-out': { label: 'Sign out', done: 'Signed out', icon: <LogOut size={13} />, note: 'They are signed out on every device and must sign in again.' },
  unlock: { label: 'Unlock', done: 'Unlocked', icon: <Unlock size={13} />, note: 'Clears the wrong-password lock so they can try again now.' },
  enable: { label: 'Enable', done: 'Enabled', icon: <ShieldCheck size={13} />, note: 'They can sign in again with their current password.' },
  disable: { label: 'Disable', done: 'Disabled', icon: <Ban size={13} />, note: 'They are signed out everywhere and cannot sign in until enabled. The last active administrator cannot be disabled.' },
};
const STATUS_DOT: Record<Status, string> = { active: '#059669', locked: '#DC2626', must_set: '#D97706', disabled: '#94A3B8' };
const scopeOf = (u: any) => u.outletId ?? u.vehicleId ?? (u.depot ? `${u.depot} DC` : 'All depots');
const RolePill = ({ role }: { role: string }) => <span className={cx('inline-flex h-6 px-2 items-center rounded-full text-[11px] font-semibold whitespace-nowrap', ROLE_TONE[role])}>{ROLE_LABEL[role]}</span>;
function StatusTag({ u }: { u: any }) {
  const s = statusOf(u);
  const icon = s === 'locked' ? <Lock size={12} /> : s === 'active' ? <ShieldCheck size={12} /> : null;
  const tone = { active: 'text-emerald-700', locked: 'text-red-700', must_set: 'text-amber-700', disabled: 'text-slate-500' }[s];
  return <span className={cx('inline-flex items-center gap-1 text-[12px] font-semibold whitespace-nowrap', tone)}>{icon}{STATUS_LABEL[s]}</span>;
}
const AVATAR: Record<string, string> = { admin: '#4F46E5', dispatcher: '#0F766E', loader: '#6D28D9', driver: '#0369A1', store_manager: '#B45309' };
const Avatar = ({ name, role }: { name: string; role: string }) => <span className="w-8 h-8 rounded-full flex items-center justify-center text-white text-[11px] font-semibold flex-shrink-0" style={{ background: AVATAR[role] ?? '#475569' }}>{name.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase()}</span>;
function Check({ on, onChange, disabled, label }: { on: boolean; onChange: () => void; disabled?: boolean; label: string }) {
  return <input type="checkbox" checked={on} disabled={disabled} onChange={onChange} aria-label={`Select ${label}`} className="w-4 h-4 mt-0.5 rounded border-slate-300 accent-indigo-600 cursor-pointer disabled:cursor-not-allowed disabled:opacity-30" />;
}

function UserDialog({ user, me, onClose, onSecret }: { user: any | null; me?: number; onClose: () => void; onSecret: (s: { title: string; value: string; note: string }) => void }) {
  const ref = useReference();
  const toast = useToast();
  const isNew = !user;
  const [f, setF] = useState({ name: user?.name ?? '', email: user?.email ?? '', role: user?.role ?? 'store_manager', depot: user?.depot ?? '', outletId: user?.outletId ?? '', vehicleId: user?.vehicleId ?? '', phone: user?.phone ?? '', pin: '' });
  const [err, setErr] = useState<Record<string, string>>({});
  const set = (k: string, v: string) => { setF(x => ({ ...x, [k]: v })); setErr(e => ({ ...e, [k]: '' })); };
  const body = () => ({
    name: f.name.trim(), role: f.role, phone: f.phone.trim() || null,
    depot: f.role === 'loader' || f.role === 'dispatcher' ? f.depot || null : null,
    outletId: f.role === 'store_manager' ? f.outletId || null : null,
    vehicleId: f.role === 'driver' ? f.vehicleId || null : null,
  });
  const onError = (e: ApiError) => { if (Object.keys(e.fields).length) setErr(e.fields); toast('error', e.message); };
  const save = useAct(() => isNew ? post('/admin/users', { ...body(), email: f.email.trim(), ...(f.role === 'loader' && f.pin ? { pin: f.pin } : {}) }) : patch(`/admin/users/${user.id}`, body()), {
    invalidate: ['admin-users'], onError,
    onDone: (r: any) => { if (isNew && r.temporaryPassword) onSecret({ title: `${r.user.name} can sign in`, value: r.temporaryPassword, note: `Give ${r.user.email} this temporary password. They choose their own at first sign-in.` }); else { toast('success', 'Saved'); onClose(); } },
  });
  const act = useAct((a: { path: string; body?: any }) => post(a.path, a.body ?? {}), { invalidate: ['admin-users'] });
  const toggle = useAct(() => patch(`/admin/users/${user.id}`, { isActive: !user.isActive }), { invalidate: ['admin-users'], success: user?.isActive ? 'Disabled and signed out everywhere' : 'Enabled', onDone: onClose });
  const outlets: any[] = ref.data?.outlets ?? [];
  const vehicles: any[] = ref.data?.vehicles ?? [];
  const self = user?.id === me;
  const locked = user?.lockedUntil && new Date(user.lockedUntil).getTime() > Date.now();
  return (
    <Modal title={isNew ? 'Add a person' : user.name} onClose={onClose} width={560}>
      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="Full name"><input className={inputCls} value={f.name} onChange={e => set('name', e.target.value)} />{err.name && <span className="text-[12px] text-red-700">{err.name}</span>}</Field>
        <Field label="Work email"><input className={inputCls} type="email" value={f.email} disabled={!isNew} onChange={e => set('email', e.target.value)} />{err.email && <span className="text-[12px] text-red-700">{err.email}</span>}</Field>
        <Field label="Role"><Select value={f.role} disabled={self} onChange={v => set('role', v)} aria-label="Role" options={Object.entries(ROLE_LABEL).map(([value, label]) => ({ value, label, icon: <span className="block w-2 h-2 rounded-full" style={{ background: AVATAR[value] }} /> }))} /></Field>
        <Field label="Phone (optional)"><input className={inputCls} value={f.phone} placeholder="+94 77 123 4567" onChange={e => set('phone', e.target.value)} />{err.phone && <span className="text-[12px] text-red-700">{err.phone}</span>}</Field>
        {f.role === 'store_manager' && <Field label="Outlet"><Select value={f.outletId} onChange={v => set('outletId', v)} aria-label="Outlet" options={outlets.map(o => ({ value: o.id as string, label: `${o.id} · ${o.brand} ${o.district}`, hint: o.name }))} /></Field>}
        {f.role === 'driver' && <Field label="Vehicle"><Select value={f.vehicleId} onChange={v => set('vehicleId', v)} aria-label="Vehicle" options={vehicles.map(v => ({ value: v.id as string, label: `${v.id} · ${v.type} ${v.temp}`, hint: `${v.depot} depot` }))} /></Field>}
        {(f.role === 'loader' || f.role === 'dispatcher') && <Field label={f.role === 'loader' ? 'Depot' : 'Home depot (optional)'}><Select value={f.depot} onChange={v => set('depot', v)} aria-label="Depot" options={[...(f.role === 'loader' ? [] : [{ value: '', label: 'Both depots' }]), { value: 'Peliyagoda', label: 'Peliyagoda' }, { value: 'Kandy', label: 'Kandy' }]} /></Field>}
        {isNew && f.role === 'loader' && <Field label="Dock PIN (4 digits, optional)" hint="Leave empty and set one later"><input className={inputCls} inputMode="numeric" maxLength={4} value={f.pin} onChange={e => set('pin', e.target.value.replace(/\D/g, ''))} /></Field>}
      </div>
      {isNew && <p className="mt-4 text-[12px] text-slate-500">A temporary password is created and shown once. The person must choose their own at first sign-in.</p>}
      {!isNew && (
        <div className="mt-5 pt-4 border-t border-[#EEF0F3] grid sm:grid-cols-2 gap-2">
          <Button icon={<KeyRound size={14} />} onClick={() => act.mutate({ path: `/admin/users/${user.id}/reset-password` }, { onSuccess: (r: any) => onSecret({ title: 'Temporary password', value: r.temporaryPassword, note: `${user.name} was signed out everywhere and must choose a new password at the next sign-in.` }) })}>Set temporary password</Button>
          {user.supabaseLinked && <Button icon={<Mail size={14} />} onClick={() => act.mutate({ path: `/admin/users/${user.id}/reset-password`, body: { sendEmail: true } }, { onSuccess: () => toast('success', `Reset link emailed to ${user.email}`) })}>Email a reset link</Button>}
          {user.role === 'loader' && <Button icon={<KeyRound size={14} />} onClick={() => act.mutate({ path: `/admin/users/${user.id}/reset-pin` }, { onSuccess: (r: any) => onSecret({ title: 'New dock PIN', value: r.pin, note: `${user.name}'s new PIN for ${user.depot} DC. The old PIN stops working now.` }) })}>New dock PIN</Button>}
          {locked && <Button icon={<Unlock size={14} />} onClick={() => act.mutate({ path: `/admin/users/${user.id}/unlock` }, { onSuccess: () => { toast('success', 'Unlocked'); onClose(); } })}>Unlock sign-in</Button>}
          <Button icon={<LogOut size={14} />} onClick={() => act.mutate({ path: `/admin/users/${user.id}/sign-out` }, { onSuccess: () => toast('success', 'Signed out on every device') })}>Sign out everywhere</Button>
          {!self && <Button variant="danger" onClick={() => toggle.mutate()}>{user.isActive ? 'Disable account' : 'Enable account'}</Button>}
        </div>
      )}
      <div className="mt-6 flex justify-end gap-2">
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={save.isPending || !f.name.trim() || (isNew && !f.email.trim())} loading={save.isPending} onClick={() => save.mutate()}>{isNew ? 'Create account' : 'Save changes'}</Button>
      </div>
    </Modal>
  );
}
