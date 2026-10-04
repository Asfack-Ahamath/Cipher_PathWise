import { useMemo, useState } from 'react';
import { KeyRound, Lock, LogOut, Mail, Plus, Search, ShieldCheck, Unlock, UserCog, Users as UsersIcon } from 'lucide-react';
import { Button, Card, Empty, Field, Modal, Segmented, cx, inputCls, thCls } from '../../components/ds';
import { ErrorState, Loading, useAct, useApi, useReference, useToast } from '../../components/common';
import { patch, post, type ApiError } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { hhmm, dayLabel } from '../../lib/clock';
import { AdminPage } from './AdminApp';

export const ROLE_LABEL: Record<string, string> = { admin: 'Administrator', dispatcher: 'Dispatcher', loader: 'Loader', driver: 'Driver', store_manager: 'Store manager' };
const ROLE_TONE: Record<string, string> = { admin: 'bg-indigo-50 text-indigo-800', dispatcher: 'bg-teal-50 text-teal-800', loader: 'bg-violet-50 text-violet-800', driver: 'bg-sky-50 text-sky-800', store_manager: 'bg-amber-50 text-amber-800' };
const when = (d?: string | null) => (d ? `${dayLabel(d)} ${hhmm(d)}` : 'Never');

export default function Users() {
  const [text, setText] = useState('');
  const [role, setRole] = useState<string>('all');
  const [editing, setEditing] = useState<any | 'new' | null>(null);
  const [secret, setSecret] = useState<{ title: string; value: string; note: string } | null>(null);
  const q = useApi<any[]>(['admin-users'], '/admin/users');
  const { user: me } = useAuth();
  const rows = useMemo(() => (q.data ?? []).filter(u => (role === 'all' || u.role === role) && (!text || `${u.name} ${u.email} ${u.outletId ?? ''} ${u.vehicleId ?? ''} ${u.depot ?? ''}`.toLowerCase().includes(text.toLowerCase()))), [q.data, role, text]);
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorState error={q.error} retry={q.refetch} />;
  const counts = (r: string) => (q.data ?? []).filter(u => u.role === r).length;
  return (
    <AdminPage title="People and access" subtitle="Who can sign in, what they can reach, and how." actions={<Button variant="primary" icon={<Plus size={15} />} onClick={() => setEditing('new')}>Add person</Button>}>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <span className="relative"><Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" /><input value={text} onChange={e => setText(e.target.value)} placeholder="Name, email, outlet, vehicle" className={cx(inputCls, 'pl-8 w-64')} aria-label="Search people" /></span>
        <Segmented size="sm" value={role} onChange={setRole} options={[{ id: 'all', label: `All ${q.data?.length ?? 0}` }, ...Object.keys(ROLE_LABEL).map(r => ({ id: r, label: `${ROLE_LABEL[r]} ${counts(r)}` }))]} />
      </div>
      <Card pad={false}>
        {rows.length === 0 ? <Empty icon={<UsersIcon size={20} />} title="No one matches">Change the search or the role filter.</Empty> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-[13px]">
              <thead className="bg-[#F9FAFB] border-b border-[#E4E7EC]"><tr>{['Person', 'Role', 'Scope', 'Sign-in', 'Last sign-in', 'Status', ''].map(h => <th key={h} className={thCls}>{h}</th>)}</tr></thead>
              <tbody>
                {rows.map(u => {
                  const locked = u.lockedUntil && new Date(u.lockedUntil).getTime() > Date.now();
                  return (
                    <tr key={u.id} className={cx('border-t border-[#EEF0F3]', !u.isActive && 'opacity-60')}>
                      <td className="px-4 py-3"><div className="font-semibold text-slate-900">{u.name}{u.id === me?.id && <span className="ml-1.5 text-[11px] text-slate-400">(you)</span>}</div><div className="text-[12px] text-slate-500">{u.email}{u.phone ? ` · ${u.phone}` : ''}</div></td>
                      <td className="px-4 py-3"><span className={cx('inline-flex h-6 px-2 items-center rounded-full text-[11px] font-semibold', ROLE_TONE[u.role])}>{ROLE_LABEL[u.role]}</span></td>
                      <td className="px-4 py-3 text-slate-700">{u.outletId ?? u.vehicleId ?? (u.depot ? `${u.depot} DC` : 'All depots')}</td>
                      <td className="px-4 py-3 text-[12px] text-slate-600">{u.supabaseLinked ? 'Supabase Auth' : 'Password'}{u.hasPin ? ' · PIN' : ''}</td>
                      <td className="px-4 py-3 text-[12px] text-slate-600 whitespace-nowrap">{when(u.lastLoginAt)}</td>
                      <td className="px-4 py-3">
                        {!u.isActive ? <span className="text-[12px] font-semibold text-slate-500">Disabled</span>
                          : locked ? <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-red-700"><Lock size={12} />Locked</span>
                          : u.mustChangePassword ? <span className="text-[12px] font-semibold text-amber-700">Must set password</span>
                          : <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-emerald-700"><ShieldCheck size={12} />Active</span>}
                      </td>
                      <td className="px-4 py-3 text-right"><Button size="sm" icon={<UserCog size={14} />} onClick={() => setEditing(u)}>Manage</Button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {editing && <UserDialog user={editing === 'new' ? null : editing} me={me?.id} onClose={() => setEditing(null)} onSecret={s => { setEditing(null); setSecret(s); }} />}
      {secret && (
        <Modal title={secret.title} onClose={() => setSecret(null)} width={440}>
          <p className="text-[13px] text-slate-600 mb-3">{secret.note}</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 h-11 px-3 flex items-center rounded-lg bg-slate-900 text-white text-[16px] font-semibold tracking-wide select-all">{secret.value}</code>
            <Button onClick={() => void navigator.clipboard?.writeText(secret.value)}>Copy</Button>
          </div>
          <p className="mt-3 text-[12px] text-slate-500">This is shown once. It is not stored anywhere readable.</p>
          <div className="mt-5 flex justify-end"><Button variant="primary" onClick={() => setSecret(null)}>Done</Button></div>
        </Modal>
      )}
    </AdminPage>
  );
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
        <Field label="Role"><select className={inputCls} value={f.role} disabled={self} onChange={e => set('role', e.target.value)}>{Object.entries(ROLE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <Field label="Phone (optional)"><input className={inputCls} value={f.phone} placeholder="+94 77 123 4567" onChange={e => set('phone', e.target.value)} />{err.phone && <span className="text-[12px] text-red-700">{err.phone}</span>}</Field>
        {f.role === 'store_manager' && <Field label="Outlet"><select className={inputCls} value={f.outletId} onChange={e => set('outletId', e.target.value)}><option value="">Choose…</option>{outlets.map(o => <option key={o.id} value={o.id}>{o.id} · {o.brand} {o.district}</option>)}</select></Field>}
        {f.role === 'driver' && <Field label="Vehicle"><select className={inputCls} value={f.vehicleId} onChange={e => set('vehicleId', e.target.value)}><option value="">Choose…</option>{vehicles.map(v => <option key={v.id} value={v.id}>{v.id} · {v.type} {v.temp} · {v.depot}</option>)}</select></Field>}
        {(f.role === 'loader' || f.role === 'dispatcher') && <Field label={f.role === 'loader' ? 'Depot' : 'Home depot (optional)'}><select className={inputCls} value={f.depot} onChange={e => set('depot', e.target.value)}><option value="">{f.role === 'loader' ? 'Choose…' : 'Both depots'}</option><option>Peliyagoda</option><option>Kandy</option></select></Field>}
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
