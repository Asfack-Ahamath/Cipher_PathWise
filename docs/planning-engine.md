# Planning engine

Code: [`packages/core/src`](../packages/core/src) · tests: [`packages/core/test/planner.test.ts`](../packages/core/test/planner.test.ts)

The engine is a set of pure functions over a `Network` (outlets, vehicles, travel times, service allowances, rules) and a list of orders. Nothing in it touches the database or the clock, so the same code runs in the API, in the tests and in the capacity forecast.

## 1. Trip time (the booklet formula)

`scheduleTrip(net, trip, orders)` in `schedule.ts`:

```
trip minutes = outbound(depot → district)
             + inter_stop(district) × (stops − 1)
             + Σ handling(brand, dock) per stop
             + waiting, when the vehicle reaches a stop before its window opens
```

- Outbound and inter-stop minutes and km come from `district_travel.csv`, handling minutes from `service_allowance.csv` (by brand and dock type).
- Each stop gets `arrive`, `start` (= max(arrive, window open)), `leave`, `waitMin`, and two flags: `late` (starts after the window closes — a rule break) and `lateRisk` (starts within 15 minutes of closing — a warning).
- Mall outlets use their mall delivery window instead of opening hours.
- The trip's return time is the last leave + the same outbound leg back. Fuel = km ÷ km/L.

Stops are ordered by `sequenceOrders`: earliest-closing window first, chilled before ambient at the same close time, so the tightest windows are served first.

## 2. Validation — every rule, on every change

`validatePlan(net, trips, orders)` in `validate.ts` returns errors (block publishing) and warnings (shown, don't block):

| Rule | Code | Severity |
|---|---|---|
| Order exists and is on only one trip | `unknown_order`, `duplicate_order` | error |
| Vehicle not in the workshop | `vehicle_unavailable` | error |
| Volume and weight within capacity (per trip) | `over_volume`, `over_weight` | error |
| One brand and one district per trip | `mixed_brand`, `mixed_district` | error |
| Chilled goods only on reefer vehicles | `reefer_required` | error |
| Van-only outlets only on vans | `van_only` | error |
| Vehicle loads at the outlet's home depot | `home_depot` | error |
| Every stop inside its window (mall window for mall outlets) | `window_breach` | error |
| Stop within 15 min of the window closing | `window_breach` (late risk) | warning |
| At most 2 trips per vehicle, and a trip never leaves before the previous one is back | `too_many_trips` | error |
| Fresh work ≤ 270 min per vehicle (03:30–08:00) | `fresh_budget` | error |
| Style + Tech work ≤ 480 min per vehicle | `style_tech_budget` | error |
| Weekly fuel quota not exceeded (used + today's trips) | `fuel_quota` | error |

The API re-runs this on every draft change and again, server-side, on publish. The plan board shows each issue on the vehicle and trip it belongs to.

## 3. Auto-plan — priority greedy with a repair pass

`autoPlan(net, orders)` in `planner.ts`.

**Priority.** Orders are ranked by

```
priority = 1,000,000 × skipped on the last run
         +     1,000 × days since the outlet was last served
         +       100 × chilled
         +        10 × brand weight (Fresh > Tech > Style)
```

so an outlet deferred yesterday is always served first today (repeat-skip protection), then the outlets waiting longest, then perishables.

**Groups.** A trip can only carry one brand to one district from one depot, so orders are grouped by `depot | brand | district`.

**Placement.** For each order, highest priority first:

1. Try to add it to an open trip of its group (re-scheduling and re-validating that trip with the new stop). Reefer trips are kept for chilled work and van trips for van-only outlets in this first pass, unless the outlet is already a stop on that trip.
2. Otherwise open a new trip on the best compatible vehicle. The vehicle score prefers vehicles that are *not* scarce for this order: a dry truck over a reefer for ambient goods, a truck over a van when the outlet isn't van-only, fewer trips already, fuel headroom, and the smallest vehicle that fits (so the big reefers stay free for big chilled loads). A second trip on the same vehicle departs after the first returns plus the reload time.
3. Once a new trip is open, fill it with the next orders of the same group, highest priority first.

**Repair pass.** Orders that did not fit are retried in priority order, now allowing any spare room on reefer and van trips of the group, or a fresh trip on a vehicle that became feasible.

**Explained deferrals.** Whatever is left is deferred with one of the reason codes and a sentence:

- **forced** — no vehicle could ever take it today: no compatible vehicle at the depot, all of them in the workshop, or even alone on an empty vehicle it would break a rule (window unreachable, time budget, weight, volume, fuel quota).
- **chosen** — it would fit on its own, but the compatible vehicles are full with higher-priority orders. The sentence says which vehicles and why they were preferred.

Every deferral carries a store-facing text ("All refrigerated vehicles were full for this run.") and moves to the next *operating* day from `calendar.csv` (Fri 1 May is Vesak, so Thursday's deferrals go to Saturday). A deferral of an order that was already deferred is marked **escalated**.

## 4. The seeded day

`demoDay.ts` builds a deterministic Thursday 30 April 2026 from the datasets: 143 confirmed orders (80 ambient Fresh, 52 chilled Fresh, 5 Style, 6 Tech) plus the story's outlets (OUT116–OUT119 in Kegalle), 3 outlets skipped on Wednesday, 4 after-cutoff orders, and 4 vehicles in the workshop. Chilled demand (124 m³) is higher than what the working reefers can carry that morning, which is the day's binding constraint.

Result on the seeded day (asserted in the tests):

| | |
|---|---|
| Orders | 143 |
| Served | 135 on 36–37 trips, 0 rule breaks |
| Deferred | 8 chilled Fresh orders (Kurunegala / Puttalam area), reason `no_reefer_capacity`, kind *chosen* |
| Skipped yesterday | OUT116, OUT030, OUT079 all served |
| Story trip | Kegalle goes on VEH041 (the smallest reefer that fits), Kandy depot |

Auto-plan runs in well under a second for the full day.

## 5. Live changes after publishing

- `moveOptions(tripId, outletId)` simulates moving a stop to every other vehicle of the depot (existing trips and a new trip) at the current business time and returns the ETA and the first rule it would break. The dispatcher can only pick a valid one.
- Released or running trips are locked when re-planning; auto-plan works around them.
- A dock shortfall resolved as "send partial" splits the order: what is on board travels, the remainder becomes a child order on the next run with a forced `dock_shortfall` deferral.

## Limits (honest)

- Greedy, not optimal. It is explainable (every placement and deferral has a reason) and fast, which matters more to a dispatcher at 03:00 than a few percent of utilisation; a local-search improvement step is the natural next step.
- Travel times are district-level averages from the dataset, not road routing; the map draws straight lines.
- Late-risk uses plan slack (15 min), not the Datathon ML prediction yet — the hook is `lateRisk` on each stop.
