import type { ReasonCode } from './types.js';

/* One list of deferral reasons, used by the planner, the API, the dispatcher and the store. */
export const REASONS: Record<ReasonCode, { label: string; store: string }> = {
  capacity_volume:      { label: 'Vehicle volume full', store: 'The vehicles for your area were full by volume.' },
  capacity_weight:      { label: 'Vehicle weight limit', store: 'The vehicles for your area reached their weight limit.' },
  no_reefer_capacity:   { label: 'No refrigerated capacity', store: 'All refrigerated vehicles were full for this run.' },
  no_van_capacity:      { label: 'Van-only outlet, no van free', store: 'Your outlet needs a small van and none was free.' },
  vehicle_in_workshop:  { label: 'Vehicle in workshop', store: 'The vehicle for your area is under repair.' },
  time_budget_exceeded: { label: 'Trip time over budget', store: 'Your delivery could not fit in the delivery window.' },
  window_unreachable:   { label: 'Window cannot be reached', store: 'No vehicle could reach you inside your delivery window.' },
  fuel_quota:           { label: 'Weekly fuel quota reached', store: 'The vehicle for your area reached its weekly fuel allowance.' },
  after_cutoff:         { label: 'Ordered after 16:00 cutoff', store: 'Your order arrived after the 16:00 cutoff.' },
  dock_shortfall:       { label: 'Stock short at the dock', store: 'Some items were not available at the depot.' },
  other:                { label: 'Other (note required)', store: 'See the dispatcher’s note.' },
};
