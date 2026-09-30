import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ClipboardList, Truck, CalendarClock, ChevronRight, KanbanSquare, Snowflake, CloudRain, PartyPopper, Wallet, AlertTriangle, CheckCircle2, MapPin } from 'lucide-react';
import { Card, CardHeader, Button, IconChip, HUE, Overline, cx, type Hue } from '../../components/ds';
import { ErrorState, Loading, useApi } from '../../components/common';
import { BRAND_COLOR } from '../../components/tags';
import { useAuth } from '../../lib/auth';
import { dayLabel, hhmm, useNow } from '../../lib/clock';

type Seg = { pct: number; color: string };
const TINT = {
  indigo: { bg: '#EEF2FF', border: '#E0E7FF', track: '#DCE3FE' },
  teal: { bg: '#ECFDF5', border: '#D1FAE5', track: '#C9F2E4' },
  rose: { bg: '#FFF1F2', border: '#FFE4E6', track: '#FFDDE1' },
  sky: { bg: '#F0F9FF', border: '#E0F2FE', track: '#D6EDFC' },
};
function Stat({ label, value, badge, badgeTone = 'teal', note, onClick, tint, bar }: { label: string; value: ReactNode; badge?: string; badgeTone?: 'teal' | 'rose' | 'slate'; note: ReactNode; onClick?: () => void; tint: keyof typeof TINT; bar: Seg[] }) {
  const tone = { teal: 'bg-teal-50 text-teal-700 ring-teal-200', rose: 'bg-rose-50 text-rose-700 ring-rose-200', slate: 'bg-slate-100 text-slate-600 ring-slate-200' }[badgeTone];
  const t = TINT[tint];
  return (
    <button onClick={onClick} disabled={!onClick} className="group text-left px-6 py-5 flex flex-col min-w-0 rounded-2xl border transition-shadow enabled:hover:shadow-[0_8px_20px_-12px_rgba(15,23,42,.25)]" style={{ background: t.bg, borderColor: t.border }}>
      <span className="flex items-center justify-between gap-2 text-[13px] font-medium text-slate-500">{label}{onClick && <ChevronRight size={15} className="text-slate-300 group-hover:text-slate-500 transition" />}</span>
      <span className="mt-2 flex items-center gap-2.5">
        <span className="text-[32px] font-semibold leading-10 tabular tracking-[-0.03em] text-slate-900">{value}</span>
        {badge && <span className={cx('h-6 px-2 rounded-md text-[12px] font-semibold tabular inline-flex items-center ring-1', tone)}>{badge}</span>}
      </span>
      <span className="mt-3 flex h-2 gap-[2px] rounded-full overflow-hidden" style={{ background: t.track }}>
        {bar.map((b, k) => <span key={k} className="h-full first:rounded-l-full last:rounded-r-full" style={{ width: `${b.pct}%`, background: b.color }} />)}
      </span>
      <span className="mt-2.5 text-[13px] leading-5 text-slate-500">{note}</span>
    </button>
  );
}
function Ring({ value, total, hue, size = 120, label }: { value: number; total: number; hue: Hue; size?: number; label: ReactNode }) {
  const r = size / 2 - 10, c = 2 * Math.PI * r, p = total ? Math.min(value / total, 1) : 0;
  const h = HUE[hue];
  return (
    <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={h.soft} strokeWidth="12" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={h.to} strokeWidth="12" strokeLinecap="round" strokeDasharray={`${c * p} ${c}`} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">{label}</div>
    </div>
  );
}
function MiniBar({ used, total }: { used: number; total: number }) {
  const p = Math.min(used / total, 1) * 100; const over = used / total > 0.95;
  return <div className="h-1.5 rounded-full overflow-hidden" style={{ background: over ? HUE.rose.soft : HUE.teal.soft }}><div className="h-full rounded-full" style={{ width: `${p}%`, background: over ? HUE.rose.to : HUE.teal.to }} /></div>;
}

export default function Overview() {
  const nav = useNavigate();
  const { user } = useAuth();
  const now = useNow(30_000);
  const q = useApi<any>(['overview'], '/overview', { refetchInterval: 15_000 });
  const tr = useApi<any>(['tracking'], '/tracking', { refetchInterval: 20_000 });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorState error={q.error} retry={q.refetch} />;
  const o = q.data;
  const h = Number(hhmm(now).slice(0, 2));
  const greet = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  const pub = o.plan.published;
  const nextRun = o.nextDay?.holiday ? 'the next operating day' : dayLabel(o.nextDay?.date ?? o.date);
  const trips = tr.data?.trips ?? [];
  const offline = trips.filter((t: any) => t.offline);
  const onRoad = trips.filter((t: any) => t.status === 'in_progress');
  const lateRisk = trips.filter((t: any) => t.lateRisk?.length);
  const stages: [string, string, 'done' | 'now' | 'next'][] = [
    ['Cutoff', 'Eve 16:00', 'done'],
    ['Published', pub ? `v${pub.version} · ${hhmm(pub.publishedAt)}` : o.plan.draft ? 'draft open' : 'not yet', pub ? 'done' : 'now'],
    ['Loaded', o.trips.released || o.trips.in_progress || o.trips.completed ? `${(o.trips.released ?? 0) + (o.trips.in_progress ?? 0) + (o.trips.completed ?? 0)} of ${o.trips.total}` : 'from 03:00', pub ? (o.trips.planned || o.trips.loading ? 'now' : 'done') : 'next'],
    ['On road', onRoad.length ? `${onRoad.length} trips` : '—', onRoad.length ? 'now' : o.trips.completed === o.trips.total && o.trips.total ? 'done' : 'next'],
    ['Delivered', `${o.orders.delivered} orders`, o.orders.delivered ? 'now' : 'next'],
  ];
  const attention: { icon: ReactNode; hue: Hue; label: string; detail: string; to: string; tag: string }[] = [
    ...o.attention.slice(0, 4).map((e: any) => ({ icon: <AlertTriangle size={16} />, hue: (e.severity === 'high' || e.type === 'sync_conflict' ? 'rose' : 'amber') as Hue, label: e.title, detail: `Raised ${hhmm(e.raisedAt)} · ${e.type.replace('_', ' ')}`, to: `/d/exceptions?id=${e.id}`, tag: 'Decide' })),
    ...(!pub && !o.plan.draft ? [{ icon: <KanbanSquare size={16} />, hue: 'indigo' as Hue, label: `${o.orders.confirmed} confirmed orders are waiting for a plan`, detail: 'Run auto-plan on the plan board, check the result, then publish.', to: '/d/plan', tag: 'Plan' }] : []),
    ...(o.plan.draft ? [{ icon: <KanbanSquare size={16} />, hue: 'amber' as Hue, label: `Draft v${o.plan.draft.version} is not published`, detail: 'Loaders, drivers and stores still see the last published plan.', to: '/d/plan', tag: 'Publish' }] : []),
    ...offline.map((t: any) => ({ icon: <MapPin size={16} />, hue: 'slate' as Hue, label: `${t.vehicleId} has no signal`, detail: `Last contact ${t.lastSeen ? hhmm(t.lastSeen) : 'none'} · work is saved on the phone · next ${t.next?.outletId ?? '—'}`, to: '/d/tracking', tag: 'Live' })),
    ...lateRisk.slice(0, 2).map((t: any) => ({ icon: <AlertTriangle size={16} />, hue: 'amber' as Hue, label: `${t.vehicleId} may be late at ${t.lateRisk.join(', ')}`, detail: t.hold ? `${t.hold.label} reported ${t.hold.at} (~${t.hold.minutes} min) · expected times include it` : 'Expected close to or after the window closes, with traffic.', to: '/d/tracking', tag: 'Watch' })),
    ...(o.orders.unconfirmedReceipts ? [{ icon: <CalendarClock size={16} />, hue: 'slate' as Hue, label: `${o.orders.unconfirmedReceipts} deliveries not yet confirmed by the store`, detail: 'Past the receipt deadline. Stores see them flagged as overdue.', to: '/d/tracking', tag: 'Follow up' }] : []),
    ...(o.orders.deferred || o.orders.partial ? [{ icon: <CalendarClock size={16} />, hue: 'amber' as Hue, label: `${o.orders.deferred} orders deferred`, detail: `${o.orders.forced} forced by the rules, ${o.orders.chosen} chosen to protect others${o.orders.partial ? ` · plus ${o.orders.partial} part-order${o.orders.partial > 1 ? 's' : ''} moved` : ''} · stores told`, to: '/d/deferrals', tag: 'Review' }] : []),
  ];
  const brandsTotal = o.orders.byBrand.reduce((a: number, b: any) => a + b.n, 0) || 1;
  const fleetHue: Hue[] = ['sky', 'indigo', 'violet', 'teal'];
  return (
    <div className="mx-auto w-full max-w-[1600px] px-4 sm:px-6 py-6 space-y-6">
      <section className="bg-white rounded-2xl border border-[#E6E9F0] shadow-[0_1px_2px_rgba(16,24,40,.04)] overflow-hidden grid lg:grid-cols-[minmax(0,1fr)_minmax(360px,440px)]">
        <div className="p-6 flex gap-5" style={{ background: '#F0FDFA' }}>
          <div className="hidden sm:block self-start w-[68px] flex-shrink-0 rounded-xl overflow-hidden bg-white ring-1 ring-[#E4E7EC] shadow-[0_6px_16px_-10px_rgba(15,23,42,.35)] text-center">
            <div className="h-6 flex items-center justify-center text-[11px] font-bold tracking-[0.12em] text-white bg-teal-700">{o.dateLabel.slice(0, 3).toUpperCase()}</div>
            <div className="text-[28px] font-semibold leading-8 tabular text-slate-900 pt-1.5">{o.dateLabel.split(' ')[1]}</div>
            <div className="text-[11px] font-semibold tracking-[0.1em] text-slate-500 pb-1.5">{o.dateLabel.split(' ')[2]?.toUpperCase()}</div>
          </div>
          <div className="min-w-0">
            <h1 className="text-[24px] font-semibold leading-8 tracking-[-0.02em] text-slate-900">{greet}, {user?.name.split(' ')[0]}</h1>
            <p className="mt-1 text-[14px] leading-6 text-slate-600">
              {pub
                ? <><span className="font-semibold text-slate-900 tabular">{o.orders.planned}</span> of {o.orders.confirmed} orders go out on {o.dateLabel}. <span className="font-semibold text-slate-900 tabular">{o.orders.deferred}</span> move to {nextRun}, and every store affected has been told why.</>
                : <><span className="font-semibold text-slate-900 tabular">{o.orders.confirmed}</span> confirmed orders for {o.dateLabel}. No plan is published yet.</>}
            </p>
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-[13px] text-slate-600">
              {o.calendar?.isPayday && <span className="inline-flex items-center gap-1.5"><Wallet size={14} className="text-amber-600" />Payday</span>}
              {o.nextDay?.holiday && <span className="inline-flex items-center gap-1.5"><PartyPopper size={14} className="text-violet-600" />{o.nextDay.holiday} tomorrow · no deliveries</span>}
              {o.calendar?.monsoon && <span className="inline-flex items-center gap-1.5"><CloudRain size={14} className="text-sky-600" />Monsoon, slower roads</span>}
            </div>
            <div className="mt-5 flex flex-wrap gap-2">
              <Button variant="primary" icon={<KanbanSquare size={15} />} onClick={() => nav('/d/plan')}>Open plan board</Button>
              <Button icon={<ClipboardList size={15} />} onClick={() => nav('/d/orders')}>Order queue</Button>
            </div>
          </div>
        </div>
        <div className="border-t lg:border-t-0 lg:border-l border-[#EEF1F5] bg-white p-6 flex flex-col">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[13px] font-semibold text-slate-900">Today's run</span>
            <span className="text-[12px] font-medium text-slate-500 whitespace-nowrap">{pub ? `Plan v${pub.version} · ${hhmm(pub.publishedAt)}` : 'Not published'}</span>
          </div>
          <div className="mt-3 flex items-start gap-2.5">
            <span className={cx('mt-1.5 w-2 h-2 rounded-full flex-shrink-0', offline.length ? 'bg-slate-400' : o.attention.length ? 'bg-amber-500' : 'bg-emerald-500')} />
            <span className="text-[14px] leading-5 font-medium text-slate-800">{o.trips.total ? `${o.trips.total} trips · ${onRoad.length} on the road · ${o.trips.completed ?? 0} completed` : 'Waiting for a plan'}
              <span className="block text-[13px] font-normal text-slate-500">{offline.length ? `${offline.map((t: any) => t.vehicleId).join(', ')} out of signal · work saved on the phone` : o.attention.length ? `${o.attention.length} open exception${o.attention.length > 1 ? 's' : ''}` : 'Everything on track'}</span></span>
          </div>
          <ol className="mt-auto pt-5 grid grid-cols-5 gap-1.5">
            {stages.map(([l, t, st]) => (
              <li key={l} className="min-w-0">
                <span className={cx('block h-1.5 rounded-full', st === 'done' ? 'bg-teal-600' : st === 'now' ? 'bg-teal-200' : 'bg-[#E4E7EC]')} />
                <span className={cx('mt-2 hidden sm:block text-[12px] font-semibold truncate', st === 'next' ? 'text-slate-400' : 'text-slate-800')}>{l}</span>
                <span className="hidden sm:block text-[11px] text-slate-500 tabular truncate">{t}</span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 xl:gap-5">
        <Stat tint="indigo" bar={o.orders.byBrand.map((b: any) => ({ pct: b.n / brandsTotal * 100, color: BRAND_COLOR[b.brand] }))} label="Confirmed orders" value={o.orders.confirmed} onClick={() => nav('/d/orders')}
          note={<span className="flex flex-wrap gap-x-3">{o.orders.byBrand.map((b: any) => <span key={b.brand} className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: BRAND_COLOR[b.brand] }} />{b.brand} <span className="tabular text-slate-800 font-medium">{b.n}</span></span>)}</span>} />
        <Stat tint="teal" bar={[{ pct: pub ? o.orders.planned / Math.max(1, o.orders.confirmed) * 100 : 0, color: 'linear-gradient(90deg,#2DD4BF,#0F766E)' }]} label="Planned to serve" value={pub ? o.orders.planned : '—'} badge={pub ? `${Math.round(o.orders.planned / Math.max(1, o.orders.confirmed) * 100)}%` : undefined} onClick={() => nav('/d/plan')}
          note={pub ? `Plan v${pub.version} published with 0 rule breaks` : 'Run auto-plan to fill the board'} />
        <Stat tint="rose" bar={o.orders.deferred ? [{ pct: o.orders.forced / o.orders.deferred * 100, color: '#F43F5E' }, { pct: o.orders.chosen / o.orders.deferred * 100, color: '#FBBF24' }] : []} label="Deferred" value={o.orders.deferred} badge={o.orders.deferred ? `${o.orders.forced} forced` : undefined} badgeTone="rose" onClick={() => nav('/d/deferrals')}
          note={<span className="flex flex-wrap gap-x-3"><span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-rose-500" />Forced <span className="tabular text-slate-800 font-medium">{o.orders.forced}</span></span><span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-amber-400" />Chosen <span className="tabular text-slate-800 font-medium">{o.orders.chosen}</span></span>{o.orders.partial > 0 && <span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-orange-400" />Part <span className="tabular text-slate-800 font-medium">{o.orders.partial}</span></span>}</span>} />
        <Stat tint="sky" onClick={() => nav('/d/tracking')} bar={[{ pct: o.fleet.available / o.fleet.total * 100, color: 'linear-gradient(90deg,#38BDF8,#0284C7)' }]} label="Vehicles ready" value={<>{o.fleet.available}<span className="text-[18px] text-slate-400 font-medium"> / {o.fleet.total}</span></>}
          note={<>{o.fleet.notRunning.length} not running: {o.fleet.notRunning.map((v: any) => v.id).join(', ') || 'none'}</>} />
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <Card className="xl:col-span-2" pad={false}>
          <div className="px-6 pt-5 pb-3 flex items-center justify-between">
            <div><h3 className="text-[16px] font-semibold text-slate-900">Needs your attention</h3><p className="text-[13px] text-slate-500">Updated {hhmm(o.now)}</p></div>
            <span className="h-7 px-3 rounded-full bg-rose-50 text-rose-700 text-[12px] font-semibold inline-flex items-center ring-1 ring-rose-200">{attention.filter(a => a.hue === 'rose' || a.hue === 'amber').length} to act on</span>
          </div>
          <div className="px-3 pb-3">
            {attention.length === 0 && <div className="px-3 py-6 text-[13px] text-slate-500 flex items-center gap-2"><CheckCircle2 size={16} className="text-emerald-600" />Nothing needs you right now.</div>}
            {attention.map((r, i) => (
              <button key={i} onClick={() => nav(r.to)} className="group w-full text-left flex items-center gap-4 px-3 py-3 rounded-xl hover:bg-slate-50 transition-colors">
                <IconChip hue={r.hue} soft size={40}>{r.icon}</IconChip>
                <span className="flex-1 min-w-0">
                  <span className="block text-[14px] font-semibold text-slate-900">{r.label}</span>
                  <span className="block text-[13px] text-slate-500 truncate">{r.detail}</span>
                </span>
                <span className="hidden sm:inline-flex h-6 px-2.5 rounded-full text-[12px] font-semibold items-center" style={{ background: HUE[r.hue].soft, color: HUE[r.hue].ink }}>{r.tag}</span>
                <ChevronRight size={16} className="text-slate-300 group-hover:text-slate-500" />
              </button>
            ))}
          </div>
        </Card>
        <Card>
          <CardHeader icon={<IconChip hue="sky" size={32}><Snowflake size={16} /></IconChip>} title="Refrigerated capacity" subtitle="Usually today's binding limit" />
          {o.chilled ? (
            <div className="flex items-center gap-5">
              <Ring value={o.chilled.reeferTrips} total={o.chilled.possible} hue="sky" label={<><div className="text-[24px] font-semibold tabular leading-8 text-slate-900">{o.chilled.reeferTrips}<span className="text-[14px] text-slate-400">/{o.chilled.possible}</span></div><div className="text-[11px] text-slate-500">reefer trips</div></>} />
              <div className="space-y-3 text-[13px]">
                <div><div className="text-[22px] font-semibold text-slate-900 tabular leading-7">{o.fleet.reeferAvailable}<span className="text-[14px] text-slate-400">/{o.fleet.reeferTotal}</span></div><div className="text-slate-500">reefer vehicles working</div></div>
                <div><div className={cx('text-[22px] font-semibold tabular leading-7', o.chilled.deferredChilled ? 'text-rose-600' : 'text-slate-900')}>{o.chilled.deferredChilled}</div><div className="text-slate-500">chilled orders deferred</div></div>
              </div>
            </div>
          ) : <p className="text-[13px] text-slate-500">Shown once a plan is published. {o.fleet.reeferAvailable} of {o.fleet.reeferTotal} refrigerated vehicles are working today.</p>}
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <Card className="xl:col-span-2" pad={false}>
          <div className="px-6 pt-5 pb-2"><h3 className="text-[16px] font-semibold text-slate-900">Vehicles closest to a limit</h3><p className="text-[13px] text-slate-500">Fresh time must fit 270 min (03:30–08:00) · weekly fuel quota</p></div>
          <div className="px-6 pb-5 overflow-x-auto">
            {o.closest.length === 0 ? <p className="py-4 text-[13px] text-slate-500">No published plan yet.</p> : <>
              <div className="grid grid-cols-[1fr_1.3fr_1.3fr] gap-x-6 pb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-400 min-w-[420px]"><span>Vehicle</span><span>Fresh time</span><span>Weekly fuel</span></div>
              {o.closest.map((l: any) => (
                <div key={l.id} className="grid grid-cols-[1fr_1.3fr_1.3fr] gap-x-6 items-center py-3 border-t border-[#EEF1F5] min-w-[420px]">
                  <span className="text-[14px] font-semibold text-slate-900">{l.id}<span className="block text-[12px] font-normal text-slate-500">{l.depot}</span></span>
                  <span><span className="flex justify-between text-[12px] mb-1.5"><span className="font-semibold tabular text-slate-800">{l.fresh} min</span><span className="text-slate-400 tabular">{l.freshBudget}</span></span><MiniBar used={l.fresh} total={l.freshBudget} /></span>
                  <span><span className="flex justify-between text-[12px] mb-1.5"><span className="font-semibold tabular text-slate-800">{l.fuelAfter} L</span><span className="text-slate-400 tabular">{l.fuelQuota}</span></span><MiniBar used={l.fuelAfter} total={l.fuelQuota} /></span>
                </div>
              ))}
            </>}
          </div>
        </Card>
        <Card>
          <CardHeader icon={<IconChip hue="violet" size={32}><Truck size={16} /></IconChip>} title="Orders and fleet" subtitle="Orders by brand" />
          <div className="flex h-3 rounded-full overflow-hidden gap-[2px]">
            {o.orders.byBrand.map((b: any) => <div key={b.brand} style={{ width: `${b.n / brandsTotal * 100}%`, background: BRAND_COLOR[b.brand] }} />)}
          </div>
          <div className="mt-3 space-y-2">
            {o.orders.byBrand.map((b: any) => (
              <div key={b.brand} className="flex items-center justify-between text-[13px]">
                <span className="inline-flex items-center gap-2 text-slate-700"><span className="w-2.5 h-2.5 rounded-[3px]" style={{ background: BRAND_COLOR[b.brand] }} />Waypoint {b.brand}</span>
                <span className="tabular font-semibold text-slate-900">{b.n}</span>
              </div>
            ))}
          </div>
          <Overline className="mt-6 mb-2.5">Fleet available</Overline>
          <div className="grid grid-cols-2 gap-2.5">
            {o.fleet.groups.map((f: any, i: number) => {
              const hh = HUE[fleetHue[i]];
              return (
                <div key={f.label} className="rounded-lg px-3 py-2.5" style={{ background: hh.soft }}>
                  <div className="text-[18px] font-semibold tabular leading-6" style={{ color: hh.ink }}>{f.available}<span className="text-[12px] font-medium opacity-70">/{f.total}</span></div>
                  <div className="text-[12px] text-slate-600">{f.label}</div>
                </div>
              );
            })}
          </div>
        </Card>
      </div>
      <p className="text-[12px] text-slate-400 text-center">Data: outlets.csv, vehicles.csv, district_travel.csv, service_allowance.csv, calendar.csv</p>
    </div>
  );
}
