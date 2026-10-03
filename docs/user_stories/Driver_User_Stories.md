# Driver Role - End-to-End User Stories - Tech-Triathlon 2026

7 stories, 1 warnings matrix, 1 database storage schema, cross-phase dependencies documented. Verdict per story = which paths are grounded in the Challenge Booklet vs. assumed vs. enriched by competition datasets (`route_legs_train.csv`, `deliveries_train.csv`, `outlets.csv`, `calendar.csv`, `traffic_speed.csv`, `road_conditions.csv`, Datathon Task 1).

---

## Scope Notes and Assumptions (Booklet & Dataset Grounding)

**1. Driver device and interaction mode**
- Directly grounded (p.6): driver uses a personal phone, historically with paper run sheet and calls.
- Scope call: interactions are designed for safe-stop use (no complex in-motion input flows).

**2. Offline-first behavior is mandatory**
- Directly grounded (p.4, p.6): field connectivity is unreliable; records must work offline and reconcile later.
- Implementation implication: local queue with timestamped event replay is required, not optional.

**3. Proof of delivery is operational, not decorative**
- Directly grounded (p.6): POD must reduce memory-based disputes.
- Scope call: each stop requires explicit outcome + POD artifact or reason code for non-delivery.

**4. Driver is not a planning actor**
- Driver follows assigned route/trip and reports execution reality.
- Scope call: route editing remains dispatcher-owned; driver can only raise incidents and outcomes.

**5. Arrival-window reality**
- Grounded by outlet columns: each stop has `window_open_time` and `window_close_time`; mall deliveries are constrained by `mall_window`.
- Scope call: app must show if arrival is early/on-time/late and preserve actual timestamps for audit.

**6. Handling duration is measured in the field**
- `arrival_time` and `leave_outlet_time` in route-leg training data imply service duration observability.
- Scope call: driver records stop milestones so actual handling can be compared to planned expectations.

**7. Deferred/non-delivered attempts must remain traceable**
- Grounded in challenge framing: no silent failures; unmet service needs explicit records and downstream visibility.
- Scope call: failed/partial outcomes must notify dispatcher and store manager channels.

---

## Core User Stories

**1. Receive Route and Start Trip**

As a Driver, I receive a clear stop-by-stop route for my assigned vehicle and trip, so I can begin delivery execution without depending on paper notes.

- **Data Surfaced on Screen**:
  - Trip header: `vehicle_id`, `trip_id`, `route_id`, `brand`, `district`, depot origin.
  - Stop cards: `seq_in_route`, `to_outlet`, planned ETA, window/mall constraints.
  - Stop metadata: dock/access hints (`dock_type`, `parking_constraint`).
- **Happy Path**: Driver opens assigned trip, reviews first stop and sequence, taps "Start Trip", and route enters active state.
- **Edge Case - Superseded plan version**: If dispatcher republishes before departure, driver is forced to accept latest route version before continuing.
- *Grounded - Booklet* (p.6): directly addresses paper-run-sheet dependency and cross-role visibility gap.

**2. Navigate Stops with Safe-Stop Interaction**

As a Driver, I can quickly view the next stop, expected window, and key constraints at each safe stop, so I avoid access/window mistakes under time pressure.

- **Data Surfaced on Screen**:
  - Next-stop summary with planned vs current ETA.
  - Window indicator: early / within window / at-risk / late.
  - Access reminders: `van_only`, `mall_window`, rear dock vs street unload context.
- **Happy Path**: Driver arrives in sequence, checks stop details in a few taps, and proceeds with unload flow.
- **Edge Case - Early arrival wait**: If arrival before `window_open_time`, app marks "Wait until window opens" and logs waiting time.
- **Edge Case - Mall gate restriction**: If current time outside `mall_window`, app prompts driver to contact dispatcher for replan guidance.
- *Grounded - Dataset*: window and access attributes come directly from outlet and route-leg references.

**3. Record Stop Milestones and Proof of Delivery**

As a Driver, I record arrival, unload completion, and proof-of-delivery for each stop, so service outcomes are verifiable and disputes do not rely on memory.

- **Data Captured**:
  - Stop lifecycle timestamps: `arrival_time`, `leave_outlet_time`.
  - POD fields: delivered quantity, recipient confirmation, photo/signature artifact reference.
  - Outcome status: `delivered_full`, `delivered_partial`, `delivery_failed`.
- **Happy Path**: On arrival, driver logs arrival; after handover, logs delivered quantity + POD and marks stop complete.
- **Edge Case - Partial unload accepted**: Driver records delivered subset and reason; unresolved remainder is surfaced as exception.
- **Edge Case - Recipient unavailable**: Driver records non-delivery reason with evidence and notifies dispatcher.
- *Grounded - Booklet* (p.6) and route-leg schema: required outcome capture and milestone timestamps are explicit operational needs.

**4. Report Delivery Problems in Real Time**

As a Driver, I can report at-stop problems (damage, mismatch, refusal, blocked access), so dispatch can intervene while recovery options still exist.

- **Data Captured**:
  - Exception type: `damage_found`, `quantity_mismatch`, `access_blocked`, `store_refused`, `unable_to_locate_recipient`.
  - Exception notes and optional photo evidence.
  - Immediate recommendation action: retry, defer, or escalate.
- **Happy Path**: Driver submits exception; dispatcher incident feed updates instantly; store-facing status reflects operational reality.
- **Edge Case - Count mismatch at handover**: Driver-provided count is preserved even if store later confirms a different received count.
- **Edge Case - Safety constraint**: If unloading area is unsafe/blocked, driver can halt stop with documented reason instead of forced completion.
- *Grounded - Booklet* (p.4): directly addresses weak feedback loop and delayed problem discovery.

**5. Continue Working Offline and Sync Later**

As a Driver, I can continue recording all stop events without network access and sync them later, so connectivity drops never erase delivery evidence.

- **Offline Behavior**:
  - Local event queue stores all milestone and POD events with device timestamp and stop IDs.
  - Clear sync state labels per event: `queued_offline`, `syncing`, `synced`, `sync_failed`.
- **Happy Path**: Driver records multiple stops offline; once signal returns, app syncs in order and reconciles with server.
- **Edge Case - Duplicate submit on reconnect**: Idempotency keys prevent creating duplicate stop events.
- **Edge Case - Conflict with route update**: If dispatcher changed route while driver was offline, sync preserves completed events and requests resolution only for future unsafely affected stops.
- *Grounded - Booklet* (p.4, p.6): offline recording and later reconciliation are explicitly required.

**6. Handle Failed or Deferred Stop Outcomes**

As a Driver, I can explicitly mark a stop as not delivered with a coded reason, so unmet service is visible and traceable instead of disappearing from records.

- **Data Captured**:
  - Non-delivery reason: `outlet_closed`, `window_missed`, `access_denied`, `goods_damaged_in_transit`, `customer_refused`, `route_time_exhausted`.
  - Retry intent: `same_trip_retry`, `next_run_defer`, `dispatcher_decision_required`.
- **Happy Path**: Driver marks failed stop, app records exact reason and timestamp, and dispatcher/store systems receive immediate status update.
- **Edge Case - Window missed at final stop**: App enforces non-delivery reason + evidence before allowing trip closure.
- *Grounded - Booklet* (deferral clarity and service traceability): aligns execution records with explainable decision requirements.

**7. Close Trip and Return Operational Summary**

As a Driver, I close my trip with a final summary, so dispatch has complete execution telemetry for follow-up and next-run planning.

- **Data Surfaced on Closeout**:
  - Stops completed vs failed.
  - Total service time and delay indicators (planned vs actual).
  - Open exception count requiring dispatcher action.
- **Happy Path**: Driver closes trip after final stop, submits summary, and trip status changes to `completed`.
- **Edge Case - Open exceptions remain**: Trip closure allowed with warning, but unresolved exceptions are auto-escalated for dispatcher review.
- *Grounded - Booklet objective*: supports end-to-end delivery workflow completion and post-route visibility.

---

## Data Storage & State Transitions (Hackathon Schema Grounding)

To satisfy Hackathon data-model expectations and support offline-safe delivery logging, the Driver UI reads/writes `driver_trip_sessions`, `driver_stop_events`, and `driver_delivery_proofs`.

```sql
-- Driver-level trip lifecycle
CREATE TABLE driver_trip_sessions (
    trip_session_id VARCHAR(36) PRIMARY KEY,
    driver_id VARCHAR(30) NOT NULL,
    vehicle_id VARCHAR(10) NOT NULL,
    trip_id INT NOT NULL CHECK (trip_id IN (1,2)),
    route_id VARCHAR(30) NOT NULL,
    started_at TIMESTAMP NOT NULL,
    closed_at TIMESTAMP,
    session_status VARCHAR(20) NOT NULL, -- assigned, in_progress, completed, closed_with_exceptions
    plan_version INT NOT NULL
);

-- Event stream for each stop (offline-safe, append-only)
CREATE TABLE driver_stop_events (
    event_id VARCHAR(36) PRIMARY KEY,
    trip_session_id VARCHAR(36) REFERENCES driver_trip_sessions(trip_session_id),
    delivery_id VARCHAR(20) NOT NULL,
    outlet_id VARCHAR(10) NOT NULL,
    seq_in_route INT NOT NULL,
    event_type VARCHAR(30) NOT NULL, -- arrived, unload_started, delivered, failed, departed, exception_reported
    event_time TIMESTAMP NOT NULL,
    sync_status VARCHAR(20) NOT NULL, -- queued_offline, synced, sync_failed
    idempotency_key VARCHAR(64) UNIQUE NOT NULL,
    event_payload JSON NOT NULL
);

-- POD and exception outcome details
CREATE TABLE driver_delivery_proofs (
    proof_id VARCHAR(36) PRIMARY KEY,
    trip_session_id VARCHAR(36) REFERENCES driver_trip_sessions(trip_session_id),
    delivery_id VARCHAR(20) NOT NULL,
    outlet_id VARCHAR(10) NOT NULL,
    outcome_status VARCHAR(20) NOT NULL, -- delivered_full, delivered_partial, delivery_failed
    delivered_units INT,
    failure_reason VARCHAR(40),
    recipient_name VARCHAR(80),
    pod_photo_url TEXT,
    pod_signature_ref TEXT,
    notes TEXT,
    captured_at TIMESTAMP NOT NULL
);
```

---

## Datathon / ML Prediction Hooks for Driver

1. **Lateness Risk (`pred_late_prob`)**:
   - Show risk color on upcoming stops so driver anticipates sensitive windows.
   - Helps prioritize escalation when delay is likely unavoidable.
2. **Service Time Prediction (`pred_service_min`)**:
   - Previews expected handling duration for next stop.
   - Supports better pacing decisions and dispatcher expectation management.
3. **Context overlays from traffic/disruption signals**:
   - District-hour congestion (`traffic_speed.csv`) and disruption context (`road_conditions.csv`) can annotate why ETA drift occurred.

---

## Warnings and Notifications Matrix

| ID | Event / Condition | Data Trigger / Threshold | Severity | Notification Target & Action |
| :--- | :--- | :--- | :--- | :--- |
| **1** | Route version changed pre-departure | Dispatcher publishes newer plan version | High | Driver must acknowledge latest route before starting. |
| **2** | Window at risk | ETA approaching `window_close_time` | Warning | Amber alert; suggest dispatcher contact/escalation. |
| **3** | Window breach | Arrival after `window_close_time` or outside `mall_window` | High | Red alert; require outcome reason before proceeding. |
| **4** | Offline mode entered | Connectivity lost while trip active | Advisory | Banner: "Offline recording active"; all events queued locally. |
| **5** | Sync failure after reconnect | Event replay error/timeout | Warning | Event marked `sync_failed`; retry flow required. |
| **6** | POD missing on completion | Stop marked delivered without mandatory POD fields | Hard Block | Prevent stop completion until required proof captured. |
| **7** | Quantity mismatch logged | Delivered units differ from expected/store count | Escalated | Exception sent to dispatcher and store workflow. |
| **8** | Safety/access block at stop | Driver reports blocked or unsafe unload condition | High | Stop paused with reason; dispatcher intervention requested. |
| **9** | Trip closure with open exceptions | Unresolved failed/partial stops remain | Warning | Trip can close with escalation ticket auto-created. |
| **10** | Duplicate event attempt | Replayed event with same idempotency key | Info | Duplicate ignored; existing server event referenced. |

---

## Cross-Phase Dependencies

**1. Designathon -> Hackathon fidelity**
- Driver route flow, POD capture, exception handling, and offline-sync recovery screens must appear in design artifacts and be implemented in production workflow.

**2. Driver -> Dispatcher visibility**
- Driver stop events and exceptions must feed dispatcher monitoring in near real time (or on reconnect for offline batches).

**3. Driver -> Store Manager confirmation loop**
- Completed delivery/POD records must trigger store receipt confirmation paths and dispute reconciliation.

**4. Datathon continuity**
- Lateness/service predictions are optional for Hackathon scoring but strengthen execution transparency and planning-feedback loop quality.

---

## Summary of Data Enrichments

- **Offline-first execution log**: Added explicit local queue and sync states for unreliable field connectivity.
- **Proof-of-delivery rigor**: Structured stop milestone + POD capture to reduce memory-based disputes.
- **Exception transparency**: Codified failed/partial outcomes with reasons that propagate upstream.
- **Route telemetry quality**: Preserved planned-vs-actual timing and event trail for operational analytics.
