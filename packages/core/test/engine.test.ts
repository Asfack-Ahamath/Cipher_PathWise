import { describe, expect, it } from 'vitest';
import { allocationFromTrips, autoPlan, checkAllocation, expectedStops, forecastWeek, generateDemoOrders, historyFromRows, PEAK_DAY_FLEET, PEAK_DAY_ORDERS, ROAD_DISRUPTION, scheduleTrip, TRAFFIC_SPEED, WEEKLY_DEMAND, buildNetwork, type Order } from '../src/index';
import { demoNetwork } from './helpers';

describe('booklet trip-time formula', () => {
  const { net } = demoNetwork();
  it('matches the worked example: Fresh to Gampaha, two rear docks and one street = 101 min', () => {
    const outs = [...net.outlets.values()].filter(o => o.district === 'Gampaha' && o.brand === 'Fresh');
    const rear = outs.filter(o => o.dock === 'rear_dock').slice(0, 2), street = outs.filter(o => o.dock === 'street').slice(0, 1);
    const picked = [...rear, ...street];
    expect(picked.length).toBe(3);
    const orders = new Map<string, Order>(picked.map((o, i) => [`X${i}`, { id: `X${i}`, outletId: o.id, date: '2026-04-30', temp: 'ambient', units: 1, kg: 10, m3: 0.1 }]));
    const s = scheduleTrip(net, { vehicleId: [...net.vehicles.values()].find(v => v.depot === 'Peliyagoda')!.id, trip: 1, depart: '03:30', orderIds: [...orders.keys()] }, orders);
    expect(s.tripMinutes).toBe(101);
  });
  it('counts handling per order and inter-stop per order, even for two orders at one outlet', () => {
    const o = [...net.outlets.values()].find(x => x.district === 'Colombo' && x.brand === 'Fresh' && x.dock === 'street')!;
    const orders = new Map<string, Order>([['A', { id: 'A', outletId: o.id, date: '2026-04-30', temp: 'ambient', units: 1, kg: 1, m3: 0.1 }], ['B', { id: 'B', outletId: o.id, date: '2026-04-30', temp: 'chilled', units: 1, kg: 1, m3: 0.1 }]]);
    const s = scheduleTrip(net, { vehicleId: 'VEH001', trip: 1, depart: '03:30', orderIds: ['A', 'B'] }, orders);
    expect(s.tripMinutes).toBe(24 + 8 + 16 * 2);
  });
});

describe('Task 2B peak day (S1)', () => {
  const base = demoNetwork([]).net;
  const available = new Set(PEAK_DAY_FLEET.filter(([, s]) => s === 'available').map(([v]) => v));
  const net = buildNetwork({ outlets: [...base.outlets.values()], vehicles: [...base.vehicles.values()].map(v => ({ ...v, fuelUsedL: 0, status: available.has(v.id) ? 'available' : 'in_workshop' })), travel: [...base.travel.values()], allowance: base.allowance });
  const orders: Order[] = PEAK_DAY_ORDERS.map(([id, outletId, temp, units, kg, m3, dy, days]) => ({ id, outletId, temp, units, kg, m3, date: '2026-04-30', deferredYesterday: dy === 1, daysSinceServed: days }));
  const res = autoPlan(net, orders);
  const alloc = allocationFromTrips(orders.map(o => o.id), res.trips);
  it('passes every official feasibility rule', () => {
    expect(checkAllocation(net, new Map(orders.map(o => [o.id, o])), alloc, available)).toEqual([]);
  });
  it('defers some orders (demand exceeds capacity) and serves every outlet skipped yesterday', () => {
    expect(res.deferrals.length).toBeGreaterThan(0);
    const served = new Set(alloc.filter(a => a.decision === 'served').map(a => a.orderId));
    for (const o of orders.filter(x => x.deferredYesterday)) expect(served.has(o.id)).toBe(true);
  });
  it('the checker catches a broken allocation', () => {
    const bad = alloc.map(a => a.decision === 'served' ? { ...a, vehicleId: 'VEH037' } : a);
    expect(checkAllocation(net, new Map(orders.map(o => [o.id, o])), bad, available).length).toBeGreaterThan(0);
  });
});

describe('expected arrival times', () => {
  const { net: n0, outlets } = demoNetwork();
  const net = buildNetwork({ outlets: [...n0.outlets.values()], vehicles: [...n0.vehicles.values()], travel: [...n0.travel.values()], allowance: n0.allowance, traffic: new Map(Object.entries(TRAFFIC_SPEED)), roads: new Map(Object.entries(ROAD_DISRUPTION)) });
  const orders = generateDemoOrders(outlets);
  const byId = new Map(orders.map(o => [o.id, o]));
  const trip = autoPlan(net, orders).trips.find(t => t.vehicleId === 'VEH041')!;
  it('are never earlier than the free-flow plan', () => {
    const e = expectedStops(net, trip, byId, { date: '2026-04-30', monsoon: true });
    for (const s of e) expect(s.expectedArrive).toBeGreaterThanOrEqual(s.plannedArrive);
  });
  it('carry a reported delay forward and flag late risk', () => {
    const e = expectedStops(net, trip, byId, { date: '2026-04-30', monsoon: true, reportedDelayMin: 240 });
    expect(e[0].expectedArrive).toBeGreaterThanOrEqual(e[0].plannedArrive + 240);
    expect(e.some(s => s.late || s.lateRisk)).toBe(true);
  });
});

describe('weekly demand forecast', () => {
  const h = historyFromRows(WEEKLY_DEMAND);
  it('forecasts positive total and zero chilled for Style', () => {
    const f = forecastWeek(h, 'Peliyagoda', 'Style', 2026, 18);
    expect(f.total).toBeGreaterThan(0); expect(f.chilled).toBe(0);
  });
  it('keeps chilled within total for Fresh', () => {
    const f = forecastWeek(h, 'Kandy', 'Fresh', 2026, 18);
    expect(f.chilled).toBeGreaterThan(0); expect(f.chilled).toBeLessThanOrEqual(f.total);
  });
});
