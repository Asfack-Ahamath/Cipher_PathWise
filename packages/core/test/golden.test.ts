/* Regression guard for refactoring: pins the planner's concrete decisions (which vehicle takes which orders, which
   orders are deferred and why) and the validator's issue order on the seeded demo day. The projections keep only
   discrete values (ids, codes, texts), so the snapshot is stable across machines. */
import { describe, expect, it } from 'vitest';
import { demoNetwork } from './helpers';
import { autoPlan, generateDemoOrders, validatePlan, type Issue, type Order, type PlanResult } from '../src/index';

const projectPlan = (res: PlanResult) => ({
  stats: { orders: res.stats.orders, served: res.stats.served, deferred: res.stats.deferred, trips: res.stats.trips, vehiclesUsed: res.stats.vehiclesUsed, reeferTrips: res.stats.reeferTrips },
  trips: res.trips.map(t => `${t.vehicleId}#${t.trip}@${t.depart}: ${t.orderIds.join(',')}`),
  deferrals: res.deferrals.map(d => `${d.orderId} | ${d.reason} | ${d.kind} | ${d.why}`),
});
const projectIssues = (issues: Issue[]) => issues.map(i => `${i.severity} ${i.code} ${i.vehicleId}#${i.trip ?? '-'} ${i.orderId ?? '-'} | ${i.title}`);

describe('golden: seeded demo day', () => {
  const scenarios: [string, string[] | undefined][] = [['default workshop', undefined], ['no vehicles in workshop', []]];
  for (const [label, workshop] of scenarios) {
    const { net, outlets } = demoNetwork(workshop);
    const orders = generateDemoOrders(outlets);
    const byId = new Map<string, Order>(orders.map(o => [o.id, o]));
    const res = autoPlan(net, orders);

    it(`auto-plan decisions are unchanged (${label})`, () => {
      expect(projectPlan(res)).toMatchSnapshot();
    });
    it(`the generated plan validates with no issues (${label})`, () => {
      expect(projectIssues(validatePlan(net, res.trips, byId).issues)).toMatchSnapshot();
    });
  }

  it('reports issues for a broken plan in a stable order', () => {
    const { net, outlets } = demoNetwork();
    const orders = generateDemoOrders(outlets);
    const byId = new Map<string, Order>(orders.map(o => [o.id, o]));
    const vehicleId = [...net.vehicles.keys()][0];
    const broken = [
      { vehicleId, trip: 1, depart: '06:00', orderIds: [...orders.slice(0, 40).map(o => o.id), orders[0].id, 'ORD_UNKNOWN'] },
      { vehicleId, trip: 2, depart: '06:00', orderIds: orders.slice(40, 60).map(o => o.id) },
      { vehicleId, trip: 3, depart: '07:00', orderIds: orders.slice(60, 70).map(o => o.id) },
    ];
    expect(projectIssues(validatePlan(net, broken, byId).issues)).toMatchSnapshot();
  });
});
