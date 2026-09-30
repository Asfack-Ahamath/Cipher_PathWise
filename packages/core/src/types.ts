/* Domain types shared by the API, the planner and the web app. */
export type Brand = 'Fresh' | 'Style' | 'Tech';
export type Depot = 'Peliyagoda' | 'Kandy';
export type Dock = 'rear_dock' | 'street' | 'mall_bay';
export type Parking = 'normal' | 'van_only' | 'mall_dock';
export type Temp = 'chilled' | 'ambient';
export type VehicleType = 'truck' | 'van';
export type VehicleTemp = 'reefer' | 'ambient';
export type Role = 'admin' | 'dispatcher' | 'loader' | 'driver' | 'store_manager';

export interface Outlet {
  id: string; brand: Brand; district: string; depot: Depot; dock: Dock; parking: Parking;
  open: string; close: string; mallWindow?: string | null; vanOnly: boolean; name: string;
  lat?: number; lng?: number;
}

export interface Vehicle {
  id: string; type: VehicleType; temp: VehicleTemp; depot: Depot;
  weightCap: number; volumeCap: number; kmPerL: number; fuelQuotaL: number;
  /** litres already used this week before the plan date */
  fuelUsedL: number;
  status: 'available' | 'in_workshop';
  driverName?: string | null;
}

export interface TravelRow { depot: Depot; district: string; outMin: number; interMin: number; outKm: number; interKm: number; roadClass: string }

export interface Order {
  id: string; outletId: string; date: string; temp: Temp; units: number; kg: number; m3: number;
  /** was this outlet's order deferred on the previous run? */
  deferredYesterday?: boolean;
  daysSinceServed?: number;
  description?: string;
}

/** Everything the planner needs to know about the network. Passed in, never global. */
export interface Network {
  outlets: Map<string, Outlet>;
  vehicles: Map<string, Vehicle>;
  travel: Map<string, TravelRow>; // key `${depot}|${district}`
  allowance: Record<Brand, Record<Dock, number>>; // service_allowance.csv, minutes per stop
  rules: PlanningRules;
  /** traffic_speed.csv, key `${district}|${hour}|${monsoon}` → speed index (100 = free flow) */
  traffic?: Map<string, number>;
  /** road_conditions.csv, key `${district}|${date}` → disruption index (100 = clear) */
  roads?: Map<string, number>;
}

export interface PlanningRules {
  freshBudgetMin: number;      // per vehicle, all Fresh trips combined (03:30–08:00)
  styleTechBudgetMin: number;  // per vehicle, Style + Tech trips combined
  maxTripsPerVehicle: number;
  freshDepart: string;         // first Fresh departure
  reloadMin: number;           // turnaround at the depot between trips
  lateRiskSlackMin: number;    // warn when arrival is this close to the window closing
}

export interface PlanTrip {
  vehicleId: string;
  trip: number;       // 1 or 2
  depart: string;     // HH:MM
  orderIds: string[]; // in stop order (orders of the same outlet are adjacent)
}

export interface StopPlan {
  seq: number; outletId: string; orderIds: string[];
  arrive: number; start: number; leave: number; waitMin: number; allowance: number; late: boolean; lateRisk: boolean;
}

export interface TripSchedule {
  stops: StopPlan[]; tripMinutes: number; km: number; fuelL: number; returnAt: number;
  brand?: Brand; district?: string; kg: number; m3: number;
}

export type IssueCode = 'over_volume' | 'over_weight' | 'reefer_required' | 'van_only' | 'home_depot' | 'mixed_brand' | 'mixed_district'
  | 'fresh_budget' | 'style_tech_budget' | 'window_breach' | 'fuel_quota' | 'too_many_trips' | 'vehicle_unavailable' | 'unknown_order' | 'duplicate_order';

export interface Issue { code: IssueCode; severity: 'error' | 'warn'; vehicleId: string; trip?: number; orderId?: string; title: string; detail: string }

export type ReasonCode = 'capacity_volume' | 'capacity_weight' | 'no_reefer_capacity' | 'no_van_capacity' | 'vehicle_in_workshop'
  | 'time_budget_exceeded' | 'fuel_quota' | 'after_cutoff' | 'dock_shortfall' | 'window_unreachable' | 'other';

export interface DeferralDecision {
  orderId: string; reason: ReasonCode;
  /** forced: no vehicle could ever take it today; chosen: capacity went to higher-priority orders */
  kind: 'forced' | 'chosen';
  why: string;
}

export interface PlanResult {
  trips: PlanTrip[];
  deferrals: DeferralDecision[];
  stats: { orders: number; served: number; deferred: number; trips: number; vehiclesUsed: number; reeferTrips: number; chilledServedM3: number; chilledDemandM3: number };
  log: string[];
}
