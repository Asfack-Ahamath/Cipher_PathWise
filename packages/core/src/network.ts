import type { Brand, Depot, Dock, Network, Outlet, PlanningRules, TravelRow, Vehicle } from './types.js';

/* Planning rules from the booklet (Task 2B), adopted as the system's rules. */
export const DEFAULT_RULES: PlanningRules = {
  freshBudgetMin: 270,        // 03:30–08:00
  styleTechBudgetMin: 480,
  maxTripsPerVehicle: 2,
  freshDepart: '03:30',
  reloadMin: 20,
  lateRiskSlackMin: 15,
};

/* The datasets have districts, not coordinates. These are district centres for the map;
   each outlet is placed near its centre with a stable offset (see outletPosition). */
export const DISTRICT_CENTRE: Record<string, [number, number]> = {
  Colombo: [6.9271, 79.8612], Gampaha: [7.0873, 80.0144], Kalutara: [6.5854, 79.9607], Galle: [6.0535, 80.221],
  Matara: [5.9549, 80.555], Kurunegala: [7.4863, 80.3647], Puttalam: [8.0362, 79.8283], Kandy: [7.2906, 80.6337],
  Matale: [7.4675, 80.6234], 'Nuwara Eliya': [6.9497, 80.7891], Badulla: [6.9934, 81.055], Kegalle: [7.2513, 80.3464],
};
export const DEPOT_POSITION: Record<Depot, [number, number]> = { Peliyagoda: [6.9612, 79.881], Kandy: [7.2826, 80.6068] };

const hash = (s: string) => { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
export function outletPosition(o: Pick<Outlet, 'id' | 'district'>): [number, number] {
  const c = DISTRICT_CENTRE[o.district] ?? [7.0, 80.3];
  const h = hash(o.id);
  const a = (h % 360) * Math.PI / 180, r = 0.012 + ((h >> 9) % 100) / 100 * 0.035;
  return [c[0] + Math.sin(a) * r, c[1] + Math.cos(a) * r];
}

export function buildNetwork(input: { outlets: Outlet[]; vehicles: Vehicle[]; travel: TravelRow[]; allowance: Record<Brand, Record<Dock, number>>; rules?: Partial<PlanningRules>; traffic?: Map<string, number>; roads?: Map<string, number> }): Network {
  return {
    outlets: new Map(input.outlets.map(o => [o.id, o])),
    vehicles: new Map(input.vehicles.map(v => [v.id, v])),
    travel: new Map(input.travel.map(t => [`${t.depot}|${t.district}`, t])),
    allowance: input.allowance,
    rules: { ...DEFAULT_RULES, ...(input.rules ?? {}) },
    traffic: input.traffic, roads: input.roads,
  };
}
