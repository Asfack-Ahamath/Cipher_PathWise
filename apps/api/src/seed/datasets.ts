import { step } from '../lib/console.js';
import fs from 'node:fs';
import path from 'node:path';
import { OUTLET_ROWS, SERVICE_ALLOWANCE, TRAVEL_ROWS, VEHICLE_ROWS, outletPosition, type Brand, type Depot, type Dock } from '@pathwise/core';

/* ──────────────────────────────────────────────────────────────────────────
   Reads the challenge datasets from DATA_DIR (outlets.csv, vehicles.csv,
   district_travel.csv, service_allowance.csv, calendar.csv). Column names are
   matched loosely so the official files and our copies both work. Any file
   that is missing falls back to the rows bundled in @pathwise/core.
   ────────────────────────────────────────────────────────────────────────── */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = []; let cur: string[] = []; let cell = ''; let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) { if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') quoted = false; else cell += ch; continue; }
    if (ch === '"') quoted = true;
    else if (ch === ',') { cur.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; cur.push(cell); if (cur.some(c => c !== '')) rows.push(cur); cur = []; cell = ''; }
    else cell += ch;
  }
  if (cell !== '' || cur.length) { cur.push(cell); rows.push(cur); }
  const [head, ...body] = rows;
  const keys = head.map(h => h.trim().toLowerCase());
  return body.map(r => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? '').trim()])));
}
const pick = (r: Record<string, string>, ...names: string[]) => { for (const n of names) if (r[n] !== undefined && r[n] !== '') return r[n]; return undefined; };
const truthy = (v?: string) => !!v && /^(1|true|yes|y)$/i.test(v);
const hhmm = (v?: string) => { if (!v) return v; const m = v.match(/(\d{1,2}):(\d{2})/); return m ? `${m[1].padStart(2, '0')}:${m[2]}` : v; };
export const readCsv = (dir: string, f: string) => { for (const sub of ['', 'General Data']) { const p = path.join(dir, sub, f); if (fs.existsSync(p)) return parseCsv(fs.readFileSync(p, 'utf8')); } return null; };
const read = (dir: string, f: string) => readCsv(dir, f);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

export interface OutletRow { id: string; name: string; brand: Brand; district: string; depot: Depot; dock: Dock; parking: string; open: string; close: string; mallWindow: string | null; vanOnly: boolean; lat: number; lng: number }
export interface VehicleRow { id: string; type: 'truck' | 'van'; temp: 'reefer' | 'ambient'; depot: Depot; weightCap: number; volumeCap: number; kmPerL: number; fuelQuotaL: number }

export function loadDatasets(dir: string, log: (m: string) => void = step) {
  const src: Record<string, string> = {};
  let outlets: OutletRow[];
  const oc = read(dir, 'outlets.csv');
  if (oc) {
    src.outlets = 'outlets.csv';
    outlets = oc.map(r => {
      const id = pick(r, 'outlet_id', 'id')!;
      const parking = (pick(r, 'parking_constraint', 'parking', 'access') ?? 'normal').toLowerCase();
      const mall = pick(r, 'mall_window', 'mall_access_window') ?? null;
      const brand = cap(pick(r, 'brand')!.replace(/^waypoint\s*/i, '')) as Brand;
      const district = pick(r, 'district')!;
      const [lat, lng] = outletPosition({ id, district });
      return {
        id, brand, district, depot: cap(pick(r, 'depot', 'home_depot', 'serving_depot')!) as Depot,
        dock: (pick(r, 'dock_type', 'dock', 'unloading') ?? 'rear_dock').toLowerCase() as Dock, parking,
        open: hhmm(pick(r, 'window_open_time', 'window_open', 'open'))!, close: hhmm(pick(r, 'window_close_time', 'window_close', 'close'))!,
        mallWindow: mall ? mall.replace('-', '–') : null, vanOnly: parking === 'van_only' || truthy(pick(r, 'van_only')),
        name: `Waypoint ${brand} ${district} · ${id}`, lat, lng,
      };
    });
  } else {
    outlets = OUTLET_ROWS.map(o => { const [lat, lng] = outletPosition(o); return { ...o, mallWindow: o.mallWindow ?? null, vanOnly: o.parking === 'van_only', name: `Waypoint ${o.brand} ${o.district} · ${o.id}`, lat, lng }; });
  }
  let vehicles: VehicleRow[];
  const vc = read(dir, 'vehicles.csv');
  if (vc) {
    src.vehicles = 'vehicles.csv';
    vehicles = vc.map(r => {
      const type = (pick(r, 'vehicle_type', 'type') ?? 'truck').toLowerCase();
      const tempRaw = (pick(r, 'temperature', 'temp', 'temp_capability', 'refrigerated', 'is_reefer') ?? '').toLowerCase();
      return {
        id: pick(r, 'vehicle_id', 'id')!, type: type.includes('van') ? 'van' : 'truck',
        temp: /reefer|refrig|chill|true|^1$|yes/.test(tempRaw) || type.includes('reefer') ? 'reefer' : 'ambient',
        depot: cap(pick(r, 'home_depot', 'depot')!) as Depot,
        weightCap: Number(pick(r, 'weight_cap_kg', 'weight_limit_kg', 'capacity_kg', 'max_weight_kg', 'weight_cap')),
        volumeCap: Number(pick(r, 'volume_cap_m3', 'volume_limit_m3', 'capacity_m3', 'max_volume_m3', 'volume_cap')),
        kmPerL: Number(pick(r, 'km_per_litre', 'km_per_l', 'fuel_efficiency_kmpl', 'kmpl')),
        fuelQuotaL: Number(pick(r, 'weekly_fuel_quota_l', 'fuel_quota_l', 'weekly_fuel_quota', 'fuel_quota')),
      };
    });
  } else {
    vehicles = VEHICLE_ROWS.map(([id, type, temp, weightCap, volumeCap, kmPerL, fuelQuotaL, depot]) => ({ id, type, temp, depot, weightCap, volumeCap, kmPerL, fuelQuotaL }));
  }
  let travel = Object.entries(TRAVEL_ROWS).map(([k, v]) => { const [depot, district] = k.split('|'); return { depot: depot as Depot, district, ...v }; });
  const tc = read(dir, 'district_travel.csv');
  if (tc) {
    src.travel = 'district_travel.csv';
    travel = tc.map(r => ({
      depot: cap(pick(r, 'depot', 'from_depot')!) as Depot, district: pick(r, 'district', 'to_district')!,
      outMin: Number(pick(r, 'depot_to_district_freeflow_min', 'outbound_min', 'out_min', 'depot_to_district_min')), interMin: Number(pick(r, 'inter_stop_freeflow_min', 'inter_stop_min', 'inter_min')),
      outKm: Number(pick(r, 'outbound_km', 'out_km', 'depot_to_district_km')), interKm: Number(pick(r, 'inter_stop_km', 'inter_km')), roadClass: pick(r, 'road_class') ?? 'suburban',
    }));
  }
  let allowance = SERVICE_ALLOWANCE;
  const ac = read(dir, 'service_allowance.csv');
  if (ac) {
    src.allowance = 'service_allowance.csv';
    const a: any = { Fresh: {}, Style: {}, Tech: {} };
    for (const r of ac) a[cap(pick(r, 'brand')!)][(pick(r, 'dock_type', 'dock')!).toLowerCase()] = Number(pick(r, 'service_allowance_min', 'allowance_min', 'service_min', 'minutes'));
    allowance = a;
  }
  const bad = [...vehicles.filter(v => ![v.weightCap, v.volumeCap, v.kmPerL, v.fuelQuotaL].every(Number.isFinite)).map(v => v.id), ...travel.filter(t => ![t.outMin, t.interMin, t.outKm, t.interKm].every(Number.isFinite)).map(t => t.district)];
  if (bad.length) throw new Error(`Dataset columns not recognised (missing numbers for ${bad.slice(0, 5).join(', ')}). Check the CSV headers in ${dir}.`);
  if (readCsv(dir, 'calendar.csv')) src.calendar = 'calendar.csv';
  log(`datasets: ${Object.keys(src).length ? Object.entries(src).map(([k, v]) => `${k} ← ${v}`).join(', ') : 'bundled rows (no CSV files in ' + dir + ')'}`);
  return { outlets, vehicles, travel, allowance };
}

