import { describe, expect, it } from 'vitest';
import { autoPlan, buildNetwork, generateDemoOrders, OUTLET_ROWS, SERVICE_ALLOWANCE, TRAVEL_ROWS, validatePlan, VEHICLE_ROWS, type Outlet, type TravelRow, type Vehicle, type Depot } from '../src/index';

export function demoNetwork(workshop = ['VEH004', 'VEH017', 'VEH025', 'VEH058']) {
  const outlets: Outlet[] = OUTLET_ROWS.map(o => ({ ...o, vanOnly: o.parking === 'van_only', name: `Waypoint ${o.brand} ${o.district} · ${o.id}` }));
  const vehicles: Vehicle[] = VEHICLE_ROWS.map(([id, type, temp, weightCap, volumeCap, kmPerL, fuelQuotaL, depot]) => ({ id, type, temp, depot, weightCap, volumeCap, kmPerL, fuelQuotaL, fuelUsedL: Math.round(fuelQuotaL * 0.45), status: workshop.includes(id) ? 'in_workshop' : 'available' }));
  const travel: TravelRow[] = Object.entries(TRAVEL_ROWS).map(([k, v]) => { const [depot, district] = k.split('|'); return { depot: depot as Depot, district, ...v }; });
  return { net: buildNetwork({ outlets, vehicles, travel, allowance: SERVICE_ALLOWANCE }), outlets };
}

describe('auto-plan on the seeded day', () => {
  const { net, outlets } = demoNetwork();
  const orders = generateDemoOrders(outlets);
  const res = autoPlan(net, orders);
  const byId = new Map(orders.map(o => [o.id, o]));

  it('has 143 orders', () => { expect(orders.length).toBe(143); });
  it('produces a plan with zero rule violations', () => {
    const v = validatePlan(net, res.trips, byId);
    expect(v.errors).toEqual([]);
  });
  it('accounts for every order exactly once', () => {
    const planned = res.trips.flatMap(t => t.orderIds);
    expect(new Set(planned).size).toBe(planned.length);
    expect(planned.length + res.deferrals.length).toBe(orders.length);
  });
  it('defers some orders on a day when demand exceeds capacity, each with a reason', () => {
    expect(res.deferrals.length).toBeGreaterThan(0);
    for (const d of res.deferrals) { expect(d.reason).toBeTruthy(); expect(d.why.length).toBeGreaterThan(10); }
  });
  it('serves the outlets skipped yesterday', () => {
    const skipped = orders.filter(o => o.deferredYesterday).map(o => o.id);
    const planned = new Set(res.trips.flatMap(t => t.orderIds));
    for (const id of skipped) expect(planned.has(id)).toBe(true);
  });
  it('keeps chilled goods on refrigerated vehicles and van-only outlets on vans', () => {
    for (const t of res.trips) {
      const v = net.vehicles.get(t.vehicleId)!;
      for (const id of t.orderIds) {
        const o = byId.get(id)!; const ot = net.outlets.get(o.outletId)!;
        if (o.temp === 'chilled') expect(v.temp).toBe('reefer');
        if (ot.vanOnly) expect(v.type).toBe('van');
      }
    }
  });
  it('prints a summary', () => {
    console.log(res.stats, res.deferrals.map(d => `${d.orderId} ${byId.get(d.orderId)!.outletId} ${d.reason} ${d.kind}`));
    const kegalle = res.trips.filter(t => t.orderIds.some(id => byId.get(id)!.outletId === 'OUT116'));
    console.log('Kegalle trips', kegalle);
  });
});

describe('validator catches rule breaks', () => {
  const { net, outlets } = demoNetwork();
  const orders = generateDemoOrders(outlets);
  const byId = new Map(orders.map(o => [o.id, o]));
  it('flags chilled on a dry truck and a van-only outlet on a truck', () => {
    const chilledKandyVanOnly = orders.find(o => o.temp === 'chilled' && net.outlets.get(o.outletId)!.vanOnly)!;
    const v = validatePlan(net, [{ vehicleId: 'VEH044', trip: 1, depart: '03:30', orderIds: [chilledKandyVanOnly.id] }], byId);
    const codes = v.errors.map(e => e.code);
    expect(codes).toContain('reefer_required');
    expect(codes).toContain('van_only');
  });
  it('flags a vehicle in the workshop and mixed districts', () => {
    const a = orders.find(o => o.outletId === 'OUT005')!, b = orders.find(o => o.outletId === 'OUT025')!;
    const v = validatePlan(net, [{ vehicleId: 'VEH004', trip: 1, depart: '03:30', orderIds: [a.id, b.id] }], byId);
    const codes = v.errors.map(e => e.code);
    expect(codes).toContain('vehicle_unavailable');
    expect(codes).toContain('mixed_district');
  });
});
