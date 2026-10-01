import { buildNetwork, OUTLET_ROWS, SERVICE_ALLOWANCE, TRAVEL_ROWS, VEHICLE_ROWS, type Outlet, type TravelRow, type Vehicle, type Depot } from '../src/index';

export function demoNetwork(workshop = ['VEH004', 'VEH017', 'VEH025', 'VEH058']) {
  const outlets: Outlet[] = OUTLET_ROWS.map(o => ({ ...o, vanOnly: o.parking === 'van_only', name: `Waypoint ${o.brand} ${o.district} · ${o.id}` }));
  const vehicles: Vehicle[] = VEHICLE_ROWS.map(([id, type, temp, weightCap, volumeCap, kmPerL, fuelQuotaL, depot]) => ({ id, type, temp, depot, weightCap, volumeCap, kmPerL, fuelQuotaL, fuelUsedL: Math.round(fuelQuotaL * 0.45), status: workshop.includes(id) ? 'in_workshop' : 'available' }));
  const travel: TravelRow[] = Object.entries(TRAVEL_ROWS).map(([k, v]) => { const [depot, district] = k.split('|'); return { depot: depot as Depot, district, ...v }; });
  return { net: buildNetwork({ outlets, vehicles, travel, allowance: SERVICE_ALLOWANCE }), outlets };
}

