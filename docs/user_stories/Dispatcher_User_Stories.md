# Dispatcher Role - End-to-End User Stories - Tech-Triathlon 2026

7 stories, 1 warnings matrix, 1 database storage schema, cross-phase dependencies documented. Verdict per story = which paths are grounded in the Challenge Booklet vs. assumed vs. enriched by competition datasets (`outlets.csv`, `vehicles.csv`, `calendar.csv`, `district_travel.csv`, `service_allowance.csv`, `task2b_peak_day_scenarios.csv`, `task2b_peak_day_fleet.csv`, Datathon Task 1 and Task 2A).

---

## Scope Notes and Assumptions (Booklet & Dataset Grounding)

**1. Dispatcher connectivity and device context**
- Directly grounded (p.6): dispatcher works on a large screen in Peliyagoda with stable connectivity.
- Scope call: no offline UX required for this role; offline complexity belongs to driver field workflows.

**2. Explainable deferrals are mandatory, optimization quality is judged separately**
- Grounded (p.4, p.5): when capacity is insufficient, some orders must be deferred and the reason must be clear.
- Scope call: this document defines auditable reason codes and priority cues, not a promise of global optimality.

**3. Two trips per vehicle is a hard daily ceiling**
- Grounded (p.5): each vehicle can run up to two routes per day.
- Enforcement: dispatcher UI must prevent creating `trip_id = 3` or silently overloading trip time budgets.

**4. Planning purity constraints are non-negotiable**
- Grounded by challenge rules and validation logic: each `(vehicle_id, trip_id)` is single-brand and single-district; chilled orders require reefer vehicles; `van_only` outlets require vans.
- Scope call: dispatcher can override prioritization, but never these physical feasibility constraints.

**5. Time-budget windows are brand-dependent**
- Fresh pre-opening service window implies stricter route time budgets than Style/Tech.
- Grounded in Task 2B framing and validation norms: Fresh planning should stay within pre-dawn operating limits; Style/Tech use full trading-day budgets.

**6. Visibility into already-skipped outlets**
- Directly grounded (p.6): dispatcher must identify outlets already skipped.
- Dataset grounding: `deferred_yesterday` and `days_since_last_served` in `task2b_peak_day_scenarios.csv` provide explicit service-risk signals.

**7. Forecasts are judged in Datathon but still useful in dispatch UX**
- Grounded (p.15): Datathon is scored separately and integration is not required.
- Scope call: forecast outputs should be surfaced as advisory signals in dispatcher planning, not mandatory algorithm inputs.

---

## Core User Stories

**1. Close Orders and Create a Confirmed Planning Queue**

As a Dispatcher, I close the order intake after cutoff and receive one clean planning queue, so I can allocate only confirmed demand instead of chasing phone/message fragments.

- **Data Surfaced on Screen**:
  - Cutoff status: `order_cutoff_time = 16:00`.
  - Order pool grouped by `brand`, `district`, `depot`, `temp_requirement`.
  - Late flag: post-cutoff orders marked for subsequent operating run.
  - Calendar context from `calendar.csv`: `is_operating`, `is_payday`, `festival`, `festival_ramp`, `monsoon`.
- **Happy Path**: At 16:00, intake closes for next-day run; queue locks with all confirmed orders and summary cards per brand.
- **Edge Case - Non-operating day transition**: If next calendar day is non-operating (`is_operating = 0`), queue auto-targets the next valid operating day.
- **Edge Case - Fresh dual-order outlets**: Same outlet may contribute separate ambient and chilled orders; queue keeps them as separate demand lines.
- *Grounded - Booklet* (p.4, p.6): cutoff behavior and multi-order Fresh pattern are explicit.

**2. Build a Feasible Allocation by Vehicle and Trip**

As a Dispatcher, I assign queued orders to vehicles and trips while honoring all operating constraints, so each generated plan is executable at dock and road level.

- **Data Surfaced on Screen**:
  - Vehicle capability from `vehicles.csv`: `type`, `temp`, `weight_cap_kg`, `volume_cap_m3`, `depot`, `weekly_fuel_quota_l`.
  - Outlet constraints from `outlets.csv`: `parking_constraint`, `dock_type`, `mall_window`, `window_open_time`, `window_close_time`.
  - Capacity bars per trip: used vs remaining weight/volume.
  - Time budget estimator using `district_travel.csv` + `service_allowance.csv`.
- **Happy Path**: Dispatcher assigns orders into `(vehicle_id, trip_id)` bundles that pass capacity, access, temperature, and route-time checks.
- **Edge Case - Chilled capacity saturation**: Reefer shortage triggers explicit reefer bottleneck indicator and forces either reallocation or deferral.
- **Edge Case - Van-only access conflict**: Any truck assignment to `van_only` outlet is blocked at assignment time.
- **Edge Case - Trip sequencing**: Trip 2 assignment allowed only if same vehicle's Trip 1 exists and remains within daily constraints.
- *Grounded - Booklet + Dataset*: all constraint families are explicitly listed in operating rules and reference tables.

**3. Make and Explain Deferral Decisions**

As a Dispatcher, I record which orders are deferred and why, so the system keeps an auditable history instead of repeated silent skips.

- **Data Captured & Surfaced**:
  - Decision field: `decision = served | deferred`.
  - Deferral reason code: `fleet_capacity_shortage`, `reefer_capacity_exceeded`, `van_access_shortage`, `vehicle_in_workshop`, `time_budget_exceeded`, `fuel_quota_guardrail`.
  - Risk indicators: `deferred_yesterday`, `days_since_last_served`.
  - Reschedule target date: next operating date.
- **Happy Path**: Deferred rows are saved with reason + timestamp and instantly visible in downstream Store Manager notifications.
- **Edge Case - Repeat-skip protection**: Outlets with `days_since_last_served >= 2` are highlighted red before finalizing deferrals.
- **Edge Case - Workshop shock**: If `task2b_peak_day_fleet.csv` marks a vehicle `in_workshop`, affected assignments auto-revert to unassigned and require a fresh decision.
- *Grounded - Booklet* (p.4, p.6): explainable deferrals and skipped-outlet visibility are explicit needs.

**4. Publish Plan to Loader and Driver Roles**

As a Dispatcher, I publish the finalized plan to loading and driving workflows, so every downstream role receives the same current assignment state.

- **Data Published**:
  - Loader payload: sequenced stop list, item lines, vehicle/trip headers.
  - Driver payload: route sequence, planned arrival times, proof-of-delivery checklist requirements.
  - Shared identifiers: `route_id`, `delivery_id`, `seq_in_route`, `vehicle_id`, `trip_id`.
- **Happy Path**: "Publish Plan" creates immutable version snapshot `plan_version_n`; loader and driver apps consume this version.
- **Edge Case - Late replan before departure**: Publishing a superseding version sends explicit "plan updated" signal to active loader sessions.
- **Edge Case - Partial republish**: Only trips touched by edits get version bump; unrelated trips stay unchanged.
- *Grounded - Booklet* (p.4, p.6): directly addresses stale printed run sheets and broken cross-role communication.

**5. Monitor In-Transit Progress and Operational Incidents**

As a Dispatcher, I track live route progress and exception events after vehicles leave, so problems are handled while recovery is still possible.

- **Data Surfaced on Screen**:
  - Planned vs actual milestones from route legs: `planned_arrival_time`, `arrival_time`, `leave_outlet_time`.
  - Stop status progression: `not_started -> in_transit -> arrived -> serviced -> departed`.
  - Incident feed: shortfalls, delivery failures, damage, POD mismatch flags.
  - Delay risk advisory from Datathon Task 1: `pred_late_prob`.
- **Happy Path**: Dispatcher sees each trip timeline update as driver records events and can identify at-risk stops before window close.
- **Edge Case - Connectivity gaps**: A trip can temporarily freeze in status while driver works offline; UI shows "awaiting sync" instead of falsely marking inactivity.
- **Edge Case - Mall window breach risk**: If projected arrival exceeds `mall_window`/`window_close_time`, system raises high-priority intervention alert.
- *Grounded - Booklet* (p.6): dispatcher explicitly needs post-departure visibility.

**6. Replan During Degradation Events**

As a Dispatcher, I reallocate orders when the active plan degrades (vehicle fault, loader shortfall, or severe delay), so service impact is minimized and decisions stay explainable.

- **Degradation Triggers**:
  - Vehicle incident marked `trip_blocking`.
  - Loader-reported item shortfall before departure.
  - In-transit escalation that makes remaining stops infeasible within windows.
- **Happy Path**: Dispatcher opens impacted trip, applies reassignment or defer action, and republishes a new plan version with full change log.
- **Edge Case - Mid-load removal**: Removing an order from an active load requires loader acknowledgment before finalizing the revised route.
- **Edge Case - No feasible substitute vehicle**: System forces deferred decision with required reason, not silent drop.
- *Grounded - Designathon/Hackathon requirement*: dedicated degradation handling is directly scored.

**7. Plan Forward Capacity Using Forecast Signals**

As a Dispatcher, I review near-term demand forecasts and risk periods, so I can proactively prepare refrigerated capacity and avoid avoidable deferrals.

- **Forecast Inputs**:
  - Task 2A-style projected demand by `depot`, `brand`, `iso_week`.
  - Calendar demand amplifiers: payday/festival/monsoon indicators.
  - Historical pressure metrics: recent deferral rates by district and temp requirement.
- **Happy Path**: Dispatcher dashboard shows "next-week risk outlook" and suggested prep actions (reefer prioritization, van allocation focus).
- **Edge Case - Forecast uncertainty**: Low-confidence forecasts are shown as advisory bands, not hard constraints.
- *Grounded - Objective* (p.6): dispatcher must plan future vehicles/drivers/reefer capacity.

---

## Data Storage & State Transitions (Hackathon Schema Grounding)

To fulfill the Hackathon `docs/data-model` expectation and support dispatcher auditability, the Dispatcher UI reads/writes `dispatch_plan_runs`, `dispatch_allocations`, and `dispatch_deferral_decisions`.

```sql
-- One planning run per operating day and plan version
CREATE TABLE dispatch_plan_runs (
    plan_run_id VARCHAR(36) PRIMARY KEY,
    planning_date DATE NOT NULL,
    plan_version INT NOT NULL,
    created_by VARCHAR(30) NOT NULL,
    created_at TIMESTAMP NOT NULL,
    status VARCHAR(20) NOT NULL, -- draft, published, superseded, closed
    notes TEXT
);

-- Served allocations tied to a published/draft run
CREATE TABLE dispatch_allocations (
    allocation_id VARCHAR(36) PRIMARY KEY,
    plan_run_id VARCHAR(36) REFERENCES dispatch_plan_runs(plan_run_id),
    delivery_id VARCHAR(20) NOT NULL,
    order_ref VARCHAR(20),
    vehicle_id VARCHAR(10) NOT NULL,
    trip_id INT NOT NULL CHECK (trip_id IN (1,2)),
    route_id VARCHAR(30) NOT NULL,
    seq_in_route INT NOT NULL,
    planned_arrival_time VARCHAR(5) NOT NULL,
    created_at TIMESTAMP NOT NULL
);

-- Deferred decisions with explicit reason and recovery date
CREATE TABLE dispatch_deferral_decisions (
    deferral_id VARCHAR(36) PRIMARY KEY,
    plan_run_id VARCHAR(36) REFERENCES dispatch_plan_runs(plan_run_id),
    delivery_id VARCHAR(20) NOT NULL,
    outlet_id VARCHAR(10) NOT NULL,
    deferral_reason VARCHAR(40) NOT NULL,
    deferred_on DATE NOT NULL,
    rescheduled_for DATE NOT NULL,
    deferred_yesterday BOOLEAN,
    days_since_last_served INT,
    decided_by VARCHAR(30) NOT NULL,
    decided_at TIMESTAMP NOT NULL
);
```

---

## Datathon / ML Prediction Hooks for Dispatcher

1. **Lateness Risk (`pred_late_prob`)**:
   - Surface on active trip timeline and pre-dispatch simulation.
   - Use for intervention priority (which at-risk outlets to call/replan first).
2. **Service Duration Prediction (`pred_service_min`)**:
   - Replace static allowance in what-if route simulation when available.
   - Helps avoid optimistic route packing on dense Fresh runs.
3. **Weekly Demand Forecasts (Task 2A output)**:
   - Show next-week demand pressure by depot/brand.
   - Provide early warning for reefer-heavy periods and potential deferral spikes.

---

## Warnings and Notifications Matrix

| ID | Event / Condition | Data Trigger / Threshold | Severity | Notification Target & Action |
| :--- | :--- | :--- | :--- | :--- |
| **1** | Cutoff reached; queue locked | Current time >= `16:00` | Info | Intake closes for next-day run; planning queue snapshot created. |
| **2** | Capacity exceeded on assignment | Trip load > weight or volume cap | Hard Block | Assignment rejected; dispatcher must reallocate. |
| **3** | Reefer rule violation | `temp_requirement='chilled'` on ambient vehicle | Hard Block | Invalid assignment blocked; reefer required. |
| **4** | Van-only rule violation | `parking_constraint='van_only'` on truck | Hard Block | Invalid assignment blocked; van required. |
| **5** | Route-time budget risk | Estimated trip time near/exceeds brand window | Warning/High | Amber then red budget indicator; re-sequence or defer. |
| **6** | Repeat deferral risk | `deferred_yesterday=1` or `days_since_last_served>=2` | Urgent | Deferral row highlighted; explicit justification required. |
| **7** | Vehicle unavailable | Fleet status `in_workshop` for assigned vehicle | High | Affected allocations invalidated; replan required. |
| **8** | Loader shortfall reported | Pre-departure shortfall event received | High | Dispatcher chooses reassign/defer and republishes impacted trip. |
| **9** | Driver offline delayed sync | No sync heartbeat beyond threshold | Advisory | Trip marked "awaiting sync"; do not treat as completed. |
| **10** | POD dispute raised | Store vs driver quantity mismatch | Escalated | Exception ticket created for investigation and closure. |

---

## Cross-Phase Dependencies

**1. Designathon -> Hackathon fidelity**
- Dispatcher screens for queue close, allocation, deferral reasoning, monitoring, and replanning must map directly to implemented workflows and database states.

**2. Dispatcher -> Loader coupling**
- Published plan versioning must drive dock workflows so stale print-style behavior is eliminated.

**3. Dispatcher -> Driver -> Store loop**
- Allocation and replan decisions must propagate into driver route execution and ultimately store receipt confirmation/dispute handling.

**4. Datathon continuity**
- Forecast and lateness outputs are optional for Hackathon scoring but materially strengthen planning rationale and explainability.

---

## Summary of Data Enrichments

- **Constraint-safe planning**: Encoded temperature, access, capacity, and trip-count limits into dispatcher decisions.
- **Explainable deferral ledger**: Added reasoned, auditable deferred-order records with repeat-skip risk indicators.
- **Versioned cross-role publishing**: Formalized plan snapshots that synchronize loader and driver workflows.
- **Predictive planning context**: Mapped Datathon outputs to practical dispatcher risk signals without forcing hard dependency.
