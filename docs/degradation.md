# When things go wrong

How PathWise behaves when the day doesn't go to plan. Each scenario can be reproduced in the running app; the steps are in the README walkthrough.

## A. The driver loses signal (Kandy–Kegalle road)

| | What happens |
|---|---|
| Phone | The run was saved to IndexedDB when it was last fetched, and the app shell is cached by the service worker, so the app opens and works with no network — even after a reload. The header turns grey (never red: offline is not an error) and shows "No signal since hh:mm · your work is saved on this phone" with a count of records waiting. |
| Records | Start, arrive, delivery outcome, receiver, photo, signature, problem reports and trip close are written to an outbox with a UUID and the **device time** (business clock), before anything is sent. |
| Dispatcher | Live tracking marks the vehicle "No signal" after 10 minutes without contact, shows the last contact time and a dashed marker where the plan says the truck should be now. |
| Store | The ETA becomes "~hh:mm estimated", carried forward from the last stop the driver synced, with a plain explanation. |
| Reconnect | On the browser `online` event (or when "No signal" is unticked, or every 20 s while records wait) the outbox is sent in batches of 50. The server sorts by device time and applies each record once; a replay returns `duplicate`. The phone shows "Back online · n records synced". |

The demo has a **"No signal"** switch on the driver screen that makes every request fail exactly like a dead network, so judges don't need airplane mode. Real offline (DevTools → Network → Offline, or airplane mode) works the same way.

## B. A stop is moved while the driver is offline — sync conflict

1. At 05:55 the dispatcher moves OUT119 from VEH041 to another vehicle (only moves that keep every rule are offered, with their ETA).
2. VEH041, still without signal, delivers OUT119 anyway and saves proof on the phone.
3. When the phone syncs, the server sees the stop was moved (`stop_moves` / `trip_orders.moved_at`), **keeps the delivery and its proof**, marks the event as a conflict and raises a `sync_conflict` exception.
4. The driver is asked one question — "Where are the goods now?" — and the answer is attached to the exception.
5. The dispatcher decides: keep the driver's delivery (the other vehicle is told to skip the stop) or let the other vehicle deliver (VEH041's goods go back to the depot). Nothing is silently overwritten either way.

## C. Short at the dock

The loader flags a line (missing / damaged / wrong item) with the units actually loaded. Release is blocked until the dispatcher decides:

- **Send partial** — the line is marked loaded with what is on board, the remainder becomes a child order on the next operating day with a forced `dock_shortfall` deferral, the store is told immediately, and the driver sees "short by plan".
- **Substitute** or **hold up to 15 minutes** — the loader is told what to do.

## D. Vehicle fault before departure

The loader reports a fault as *cannot leave* or *advisory*. A blocking fault freezes the trip (`blocked`). The dispatcher swaps to a free vehicle: the old one goes to the workshop, the trip moves to the new vehicle, every loaded line is reset so the loader re-ticks it onto the new vehicle, and both drivers are told.

## E. Store closed / refused / no access

The driver records the outcome with a photo and a recommendation (retry later today, or bring it back). A `non_delivery` exception asks the dispatcher to decide; "return to depot" creates the next-run order and tells the store.

## F. Store finds a problem on receipt

The store checks each line against the driver's proof (photo and signature are viewable). Anything short, damaged or too warm raises a `receipt_issue` exception with the counts; the dispatcher chooses a replacement on the next run or a credit, and the store is told.

## G. Plan changes after loading has started

A republish or a live move marks the affected trips as changed. The loader sees a "The plan changed" banner explaining the move and must press **Got it** before release. Released or running trips are never re-planned silently.

## H. Demand higher than capacity

The planner defers what cannot fit, each with a reason code, forced/chosen, the sentence the store will read and the new date (skipping non-operating days such as Vesak). An outlet deferred yesterday is served first today; a second deferral in a row is marked **escalated**.

## I. Server or database unreachable

The API waits for the database on start (30 s) before migrating. Web screens show a clear error with **Try again**; queries retry twice. The driver app keeps working from its saved run and outbox regardless.
