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

## B. A delay is reported, a stop is moved, and the phone is offline — sync conflict

No signal on its own is **not** a reason to move a stop: the phone keeps working and delivers normally. A stop is moved only when the *expected* arrival misses the store's window.

1. 05:35 — VEH041 reports **Road closed · 2 h** (problem report with a delay). Expected arrival times for its remaining stops now include the hold (and traffic and road conditions from the datasets). OUT119 is now expected at about 08:26; it closes at 08:00. The affected stores are told their delivery is running late.
2. The phone then loses signal in the hills.
3. 05:55 — the dispatcher opens **Move stop** on OUT119. The first row is always **Keep on VEH041** with its expected time and the reason ("VEH041 reported Road closed … expected 08:26 vs close 08:00"); below it, only vehicles that keep every rule, each with its ETA. The dispatcher moves it to a vehicle that arrives in time. The Kandy loaders are told to pick and load the goods for OUT119 on that vehicle; the store gets the new ETA.
4. VEH041, still without signal, delivers OUT119 anyway (the road reopened) and saves proof on the phone.
5. When the phone syncs, the server sees the stop was moved (`stop_moves` / `trip_orders.moved_at`), **keeps the delivery and its proof**, marks the event as a conflict and raises a `sync_conflict` exception. The driver sees *Your route changed* (acknowledged with **Got it**) and is asked one question — "Where are the goods now?" — and the answer is attached to the exception.
6. The dispatcher decides: keep the driver's delivery (the other vehicle is told to skip the stop) or let the other vehicle deliver (VEH041's goods go back to the depot). Nothing is silently overwritten either way.

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

## I. Goods bigger or heavier than ordered

The loader records the real size of a line. Small differences are just logged. If the truck would go over its weight or volume limit, a `size_divergence` exception blocks release until the dispatcher either takes the order off (it moves to the next run with priority and the store is told) or overrides with a written reason.

## J. Two loaders on one trip

Opening a trip claims it for that tablet (heartbeat every minute). A second tablet sees who is loading and cannot tick lines unless it presses **Take over** (recorded in the audit log) or the first claim has been quiet for `loaderClaimMinutes`.

## K. Trip 2 before the truck is back

Trip 2 of a vehicle can be staged but not ticked or released until the driver closes Trip 1; the depot is notified the moment the truck is back.

## L. A driver ends the trip with stops not done

Closing a trip asks for a reason for every stop without an outcome (*ran out of time*, *road closed*, …). Each becomes a `non_delivery` exception so the dispatcher can re-plan it and the store is told.

## M. Access changes during the day

Disabling an account, changing someone's role or scope, or resetting their password ends every session of that person within seconds (token version check). A temporary password forces a new password before anything else works.

## N. Supabase unavailable

With `AUTH_PROVIDER=supabase`, sign-in answers "Sign-in service is not reachable — try again in a minute" (503) while existing sessions keep working (PathWise issues its own tokens). With `STORAGE_PROVIDER=supabase`, a failed upload rejects that one record and the phone keeps it in the outbox to retry; photos already stored are still served. Admin → System health shows which part is down.

## O. Server or database unreachable

The API waits for the database on start (30 s) before migrating. Web screens show a clear error with **Try again**; queries retry twice. The driver app keeps working from its saved run and outbox regardless.
