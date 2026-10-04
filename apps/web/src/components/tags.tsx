import { Snowflake, Package, Truck, Building2, Warehouse, ParkingMeter } from 'lucide-react';

export const BRAND_COLOR: Record<string, string> = { Fresh: '#0F766E', Style: '#7C3AED', Tech: '#0369A1' };

/* Domain tags. One shape for all of them: 20 px high, 6 px radius, 11 px semibold. */
const tag = 'inline-flex items-center gap-1 h-5 px-1.5 rounded-md text-[11px] font-semibold whitespace-nowrap';

export function BrandTag({ brand }: { brand: string }) {
  return <span className={`${tag} bg-white border border-[#E4E7EC] text-slate-700`}><span className="w-1.5 h-1.5 rounded-full" style={{ background: BRAND_COLOR[brand] ?? '#64748B' }} />{brand}</span>;
}
export function TempTag({ temp, size = 'sm' }: { temp: string; size?: 'sm' | 'md' }) {
  const big = size === 'md' ? 'h-6 px-2 text-[12px]' : '';
  return temp === 'chilled'
    ? <span className={`${tag} ${big} bg-sky-50 text-sky-800 border border-sky-200`}><Snowflake size={11} />Chilled</span>
    : <span className={`${tag} ${big} bg-slate-50 text-slate-600 border border-[#E4E7EC]`}><Package size={11} />Ambient</span>;
}
const DOCK_LABEL: Record<string, string> = { rear_dock: 'Rear dock', street: 'Street', mall_bay: 'Mall bay' };
export function DockBadge({ dock }: { dock: string }) {
  const Icon = dock === 'mall_bay' ? Building2 : dock === 'street' ? ParkingMeter : Warehouse;
  return <span className={`${tag} bg-white border border-[#E4E7EC] text-slate-600 font-medium`}><Icon size={11} />{DOCK_LABEL[dock] ?? dock}</span>;
}
export function VanOnlyBadge() { return <span className={`${tag} bg-amber-50 text-amber-800 border border-amber-200`}><Truck size={11} />Van only</span>; }
export function MallBadge({ window: w }: { window: string }) { return <span className={`${tag} bg-violet-50 text-violet-800 border border-violet-200`}><Building2 size={11} />Mall {w.replace('-', '–')}</span>; }
export function OutletBadges({ o }: { o: { vanOnly?: boolean; mallWindow?: string | null; dock?: string } }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {o.vanOnly && <VanOnlyBadge />}
      {o.mallWindow && <MallBadge window={o.mallWindow} />}
      {o.dock && <DockBadge dock={o.dock} />}
    </span>
  );
}
