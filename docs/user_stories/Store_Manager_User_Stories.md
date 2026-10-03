# Store Manager Role — End-to-End User Stories

---

## Scope Notes and Assumptions (Booklet & Dataset Grounding)

**1. Connectivity**
- The Connectivity section (p.5) names no role by name — it just says mobile coverage can drop across hill country, the Kandy corridor, and rural districts, and that work away from the depot must remain usable offline. The Driver's own offline need is stated explicitly (p.6); the Loader's exposure at the Kandy dock is a reasonable inference from the same section, not a named requirement. The Store Manager works at the outlet counter on a desktop or phone (p.6), with no offline requirement stated or implied.
- Assumption: treat the Store Manager's connectivity as stable, same as the Dispatcher's planning office. No offline/reconciliation design needed for this role.

**2. Order and deferral history view**
- The booklet gives the Dispatcher the job of identifying outlets already skipped (p.6), but never explicitly grants the Store Manager a look-back view of their own outlet's order and deferral history.
- Added — a history view is the natural counterpart to "deferrals lack a clear record" (p.4) from the store's side, but it's a design addition, not a quoted requirement. Flag it as such in the rationale.

**3. Real-time "en route" tracking**
- Not stated anywhere in the booklet. The Store Manager's stated needs stop at an expected arrival time and a deferral notice (p.6) — nothing about live vehicle tracking.
- Scope call: treat as a nice-to-have, not a required screen, to avoid over-building past what's asked.

**4. Surfacing late-arrival predictions**
- Datathon Task 1's `pred_late_prob` is explicitly not required to integrate into the Hackathon build (p.15).
- A "your delivery may run late" indicator on the store manager's expected-arrival screen is a reasonable, low-cost UI idea to describe conceptually, but wiring a real model into it is out of scope for the Hackathon's higher-weighted criteria.

**5. Dual Fresh orders, same delivery day**
- A Fresh outlet can place a separate dry-goods order and a separate chilled order for the same delivery day (p.4).
- The Store Manager's order screen needs to keep these as two distinct order records, each with its own confirmation, arrival time, and receipt-confirmation flow — not merged into one line.

**6. Mall window visibility vs. control**
- Mall outlets accept deliveries only within the mall's fixed access window (p.5), and this window is stored per outlet (`mall_window` in `outlets.csv`).
- Assumption: the Store Manager can see this window on their own order/arrival screens but cannot edit it — it's a fixed outlet attribute the dispatcher plans against, not something the store manager negotiates per order.

**7. Operational Calendar & Deferral Metrics (Task 2B Grounding)**
- Grounded in `calendar.csv` and `task2b_peak_day_scenarios.csv`:
  - Standard next-day order cutoff is strictly **16:00 (4:00 PM)**.
  - Waypoint operates Monday through Saturday (`calendar.is_operating == 1`). Sunday and public holiday orders automatically route to the next operating day.
  - The system tracks `deferred_yesterday` (0 or 1) and `days_since_last_served` (integer 1–5). A store manager with `days_since_last_served >= 2` faces critical stockout risk, which the UI must visibly highlight.

---

## Core User Stories

**1. Place an Order Before the Cutoff**

As a Store Manager, I place an order according to my brand's delivery schedule and get confirmation that it was received and will be scheduled, so I'm not left wondering whether my order reached anyone.

- **Data Surfaced & Input on Screen**:
  - *Outlet Context*: `outlet_id` (e.g., OUT012), `brand`, `district`, `dock_type` (`rear_dock`, `street`, `mall_bay`), `parking_constraint` (`normal`, `van_only`, `mall_dock`).
  - *Cutoff Countdown*: Live clock counting down to `16:00` daily cutoff.
  - *Calendar Demand Alerts* (from `calendar.csv`):
    - Festival alert: Upcoming `festival` and `festival_ramp` (e.g. "Vesak Festival in 3 days — Peak demand expected, ensure safety stock").
    - Payday surge badge: `is_payday == 1`.
  - *Order Fields*: `order_date` (default: next operating day), `temp_requirement` (`ambient` vs `chilled`), `order_units`, estimated `order_weight_kg`, estimated `order_volume_m3`.
- **Happy Path**: Store manager enters item counts before 16:00 $\rightarrow$ Taps "Submit Order" $\rightarrow$ System captures order, assigns `order_ref`, and displays instant confirmation with timestamp and "Queued for 16:00 Dispatch Planning" status.
- **Edge Case — Post-Cutoff Submission**: An order submitted after 16:00 is accepted by the system but marked with an amber badge: `is_post_cutoff = true` ("Submitted after 4:00 PM cutoff — Queued for subsequent operating run on [Next Date]").
- **Edge Case — Fresh Split Orders (Ambient vs Chilled)**: Fresh outlets see two distinct order tiles:
  - Card A: *Dry Grocery Order* (`temp_requirement = 'ambient'`)
  - Card B: *Chilled & Dairy Order* (`temp_requirement = 'chilled'`)
  Each tile generates its own independent `order_ref`, tracked and confirmed separately.
- **Edge Case — Style Seasonal Peak & Tech Single Appliance**:
  - Style: Orders are weekly; UI allows bulk entry with volume estimation (volume binds vehicle capacity before weight).
  - Tech: Often placed for single large appliances (e.g., refrigerator or TV); UI shows weight estimation (weight binds vehicle capacity before volume).
- *Grounded — Booklet* (p.4, p.6): cutoff, two-orders-same-day, and "no confirmation" gap are direct statements. *Assumption*: order-size fields (`order_units`, weight/volume estimates) are not independently verified here — `deliveries_train.csv` was not available for this pass; treat displayed averages as illustrative until checked.

**2. Receive an Expected Arrival Time**

As a Store Manager, I get an expected arrival time once the dispatcher allocates my order to a vehicle and trip, so I can schedule staff to receive the goods.

- **Data Surfaced on Screen**:
  - `planned_arrival_time` (e.g., `06:15 AM` for Fresh; `10:30 AM` for Style/Tech).
  - Vehicle assignment: `vehicle_id` (`VEH014`), `vehicle_type` (`truck` vs `van`), `trip_id` (Trip 1 morning vs Trip 2 afternoon).
  - Transit sequence: "Stop #2 of 4 on Colombo Route" (`seq_in_route = 1`).
  - Outlet receiving window: `window_open_time`–`window_close_time`.
  - Mall fixed access window (if applicable): `mall_window` (e.g. `09:00–11:00`).
  - **Datathon Task 1 Predictive Intelligence**:
    - Lateness Risk Indicator (`pred_late_prob`): Low Risk ($<20\%$), Moderate Risk ($20–50\%$), High Risk ($>50\%$).
    - Unload Handling Estimate (`pred_service_min`): e.g. "Estimated unloading time: 22 min (Standard allowance: 16 min) — Recommend 2 receiving staff".
- **Happy Path**: Dispatcher closes allocation at 17:00 $\rightarrow$ Store Manager's dashboard updates with specific `planned_arrival_time`, vehicle ID, and expected handling duration, allowing shift staff scheduling.
- **Edge Case — Deferred Order**: If order is not allocated, screen displays no arrival time and routes directly to the Deferral Notice (Story 3).
- **Edge Case — Fresh Dual Orders on Separate Trips**: A Fresh outlet's dry and chilled orders may be assigned to different vehicles (e.g. ambient truck on Trip 1 at 05:30 AM; reefer van on Trip 2 at 07:15 AM); dashboard displays two separate arrival cards with independent staff scheduling recommendations.
- **Edge Case — Mall Delivery Window Alignment**: For mall outlets, UI displays `planned_arrival_time` side-by-side with `mall_window`, visually confirming arrival falls strictly inside authorized mall loading hours.
- *Grounded — Booklet* (p.6): directly stated as a Store Manager need. *Grounded — Dataset*: `mall_window` confirmed in `outlets.csv` (12 outlets carry a fixed window, matching the 12 `mall_bay`/`mall_dock` outlets).

**3. Receive Clear Notice When an Order Is Deferred**

As a Store Manager, I get a clear, explained notice when my order is deferred, so I'm not left discovering the failure only when the delivery doesn't show up.

- **Data Surfaced on Screen**:
  - Explicit Status: `dispatch_status = 'deferred'`.
  - Deferral Reason Code: `fleet_capacity_shortage`, `reefer_capacity_exceeded`, `van_access_shortage`, `vehicle_in_workshop`, `time_budget_exceeded`.
  - Rescheduled Date: Next operating day (`calendar.is_operating == 1`).
  - Stockout Risk Context (from `task2b_peak_day_scenarios.csv`):
    - `days_since_last_served`: Days since last delivery (e.g. "Last served 2 days ago").
    - `deferred_yesterday`: Indicator showing if order was also skipped on the previous run.
- **Happy Path**: Dispatcher marks order deferred $\rightarrow$ Store manager receives push notification and dashboard alert stating reason ("Peliyagoda refrigerated capacity reached daily limit") and confirming reschedule date.
- **Edge Case — Consecutive Deferral Escalation**: If `days_since_last_served >= 2` or `deferred_yesterday == 1`, notice displays an urgent red alert banner: "Critical Supply Notice: Second consecutive deferral — Priority escalated for tomorrow's run".
- **Edge Case — Pre-Departure Partial Shortfall Notice**: If the loader flagged a shortfall at the depot (e.g., 3 of 5 units loaded), store manager receives a distinct "Partial Delivery Scheduled" notice itemizing the missing goods, rather than a full deferral notice.
- *Grounded — Booklet* (p.4, p.6): stated Store Manager need; directly solves "deferrals lack a clear record". *Assumption*: `days_since_last_served`/`deferred_yesterday` field shapes are inferred from the guide's description of `task2b_peak_day_scenarios.csv`, which was not part of this data pass — verify field names before implementation.

**4. Confirm Receipt and Report Issues**

As a Store Manager, I confirm what actually arrived and report any issues, so disputes about a delivery don't depend on memory or a phone call after the fact.

- **Data Surfaced from Driver POD (via `route_legs_train.csv`)**:
  - Driver operational times: `arrival_time`, `leave_outlet_time`, `actual_service_min`.
  - Driver-reported delivery status and driver timestamp.
- **Data Captured & Stored by Store Manager**:
  - `received_units`: Actual physical count verified at counter/dock.
  - `damaged_units`: Count of damaged or spoiled items.
  - `damage_category`: `packaging_tear`, `crushed_carton`, `temperature_spoilage/defrost`, `seal_broken`.
  - `acceptance_verdict`: `accepted_full`, `accepted_partial`, `rejected_damaged`.
  - `store_notes`: Text explanation of discrepancy.
  - `driver_pod_mismatch`: Boolean flag set to true if store count != driver POD count.
- **Happy Path**: Driver completes delivery and submits POD on phone $\rightarrow$ Store manager's screen displays delivery summary $\rightarrow$ Store manager verifies physical crates, enters zero damages, taps "Confirm Receipt" $\rightarrow$ Closed-loop record locked.
- **Edge Case — Reconciling Pre-Flagged Depot Shortfall**: If loader flagged a shortfall before departure (Story 3), store receipt screen pre-populates with the reduced count: "Depot shortfall noted: 3 units shipped of 5 ordered. Please verify 3 units received."
- **Edge Case — Concealed Damage at Receipt**: Damage discovered only while unboxing at the store counter is logged independently with damage category and photo upload.
- **Edge Case — Driver / Store Count Mismatch**: If driver POD claims 50 units delivered but store manager confirms only 46 received, both numbers are permanently preserved, neither overwrites the other, and an escalated dispute flag is sent to the dispatcher.
- **Edge Case — Unconfirmed Timeout**: If store manager does not confirm within 4 hours, delivery record status transitions to "Delivered (Unconfirmed by Store)" without blocking driver completion.
- *Grounded — Booklet* (p.4, p.6): directly solves "communication does not support feedback" and "disputes do not depend on memory."

**5. Review Order and Deferral History**

As a Store Manager, I can look back at my outlet's recent orders and deferrals, so I can see whether a problem (like a repeatedly skipped chilled order) is a one-off or a pattern.

- **Data Surfaced on Screen**:
  - Historical timeline: Calendar view of past 30 days showing order dates, dispatch dates, and delivery statuses (`attempted`, `deferred`, `not_run`).
  - Fulfillment Rate %: $\frac{\text{Orders Fulfilled On-Time}}{\text{Total Orders Placed}}$.
  - Category Breakdown: Fulfillment rate split by Ambient vs Chilled goods (identifies if chilled orders are disproportionately deferred due to reefer scarcity).
  - Deferral Log: List of all skipped orders with dispatcher-provided reason codes and days between deliveries (`days_since_last_served`).
- **Happy Path**: Store manager opens history tab, filters by "Chilled Orders", and views a clear log of fulfilled vs deferred deliveries to support inventory replenishment discussions.
- *Added* — Natural counterpart to "deferrals lack a clear record" (p.4) from the store perspective.

---

## Data Storage & State Transitions (Hackathon Schema Grounding)

To fulfill the Hackathon rubric's data model requirement (`docs/` architecture & seed data), the Store Manager UI directly reads from and writes to `store_orders`, `store_deferral_logs`, and `store_receipt_confirmations`. Full DDL: see `docs/data-model.md`.


---

## Datathon / ML Prediction Hooks for Store Manager

1. **Lateness Probability Indicator (`pred_late_prob` from Task 1)**:
   - Sourced from Datathon Task 1 model predicting whether arrival occurs after `window_close_time`.
   - Surfaced on the Store Manager's ETA screen as an operational confidence rating:
     - `pred_late_prob < 0.20`: Green badge ("High On-Time Confidence").
     - `0.20 <= pred_late_prob <= 0.50`: Amber badge ("Moderate Transit Risk — Weather / Traffic Delays").
     - `pred_late_prob > 0.50`: Red badge ("High Delay Risk — Arrival Projected Near Window Close").
2. **Predicted Handling Duration (`pred_service_min` from Task 1)**:
   - Predicts outlet handling duration based on order size and dock characteristics.
   - Enables store manager to schedule the appropriate number of receiving staff (e.g. "Estimated handling: 35 min — Allocate 2 counter staff").
3. **Depot Demand Trends (Task 2A)**:
   - Aggregated weekly forecasts (`pred_total_volume_m3`, `pred_chilled_volume_m3`) can provide high-level contextual banners during peak festival weeks.

---

## Warnings and Notifications Matrix

| ID | Event / Condition | Data Trigger / Threshold | Severity | Notification Target & Action |
| :--- | :--- | :--- | :--- | :--- |
| **1** | Order Confirmed Before Cutoff | `submitted_at <= 16:00` on operating date | Confirmation | Green banner on Store UI; order summary card generated. |
| **2** | Post-Cutoff Submission | `submitted_at > 16:00` | Warning | Amber warning badge: "Queued for next operating cycle". |
| **3** | ETA Assigned After Allocation | Dispatcher finalizes vehicle & trip assignment | Notification | Push notification with `planned_arrival_time` and vehicle ID. |
| **4** | Order Deferred by Dispatcher | Order marked `deferred` during allocation | Notification | Push notice with reason code and confirmed reschedule date. |
| **5** | Consecutive Deferral Alert | `days_since_last_served >= 2` OR `deferred_yesterday == 1` | Urgent Alert | Red banner on Store UI; escalated priority flag on Dispatcher console. |
| **6** | Pre-Notified Shortfall from Dock | Loader flags shortfall in `loading_item_verifications` | Advisory Notice | Inbound delivery card updates: "Partial load: [X] units short at depot". |
| **7** | Driver Arrived at Outlet | Driver submits arrival ping via mobile app | Prompt | Dashboard badge: "Driver on site — Ready for receiving". |
| **8** | Delivery Unconfirmed Past Window | $> 4\text{ hours}$ post-delivery with no receipt confirmation | Soft Flag | Status set to "Delivered (Unconfirmed)"; flagged on Dispatcher audit view. |
| **9** | Arrival Window Breach Warning | `planned_arrival_time > window_close_time` OR `mall_window` | High Alert | Warning banner: "Delivery projected outside authorized mall window". |
| **10**| Driver / Store POD Mismatch | `received_units != delivered_units` | Escalated Flag | Red dispute record created; both quantities stored; sent to Dispatcher. |

---

## Cross-Phase Dependencies

**1. Designathon $\rightarrow$ Hackathon Fidelity**
- All Store Manager screens (Order placement with 16:00 cutoff countdown, Dual Fresh cards, ETA with predictive late risk, Deferral notice with consecutive tracker, and POD receipt reconciliation) must exist in the Designathon submission and be functionally backed by database tables in the Hackathon build.
- Directly weighted: "Fidelity to the Day 5 design" (10%) and "Functional completeness across all four roles" (20%).

**2. Closed-Loop Connection: Driver POD $\rightarrow$ Store Manager Confirmation**
- The Designathon emphasizes that "a driver's delivery record should give the store manager information they can act on" (p.9). In the Hackathon build, Driver POD submission must trigger the receipt confirmation screen on the Store Manager account, demonstrating a complete end-to-end workflow.

**3. Dispatcher Deferral Push to Store Dashboard**
- Store Manager Story 3 directly depends on Dispatcher deferral decisions being pushed with structured reason codes. This satisfies the Hackathon's cross-role communication and audit logging requirements.

**4. Datathon Model Continuity**
- Surfacing Task 1's `pred_late_prob` as a staff-scheduling confidence indicator bridges the ML and application engineering tracks into a cohesive narrative.

---

## Summary of Data Enrichments

- **Operational Rigor**: Integrated the 16:00 daily cutoff, operating day calendars, and festival demand surge indicators from `calendar.csv`.
- **Fresh Multi-Order Handling**: Designed distinct data cards and independent tracking for ambient dry groceries vs chilled dairy/produce.
- **Stockout Urgency Tracking**: Grounded deferral handling in `task2b_peak_day_scenarios.csv` metrics (`deferred_yesterday`, `days_since_last_served`).
- **Closed-Loop Reconciliation**: Created data structures comparing driver POD records (`arrival_time`, `leave_outlet_time`) against store manager verification counts.
- **Persistence Architecture**: Added full SQL schemas (`store_orders`, `store_deferral_logs`, `store_receipt_confirmations`) for the Hackathon deliverables.
