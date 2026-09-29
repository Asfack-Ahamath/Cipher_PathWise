# API reference

Base path `/api`. JSON in and out. Every route except `/health` and `/auth/login` needs `Authorization: Bearer <token>`. Role guards return `403` for the wrong role; rule violations return `409` with a message a person can act on; bad input returns `400` (validated with zod).

## Auth and shared

| Method | Path | Who | What |
|---|---|---|---|
| GET | `/health` | anyone | DB check and the business clock |
| POST | `/auth/login` | anyone | `{email, password}` or `{pin, depot}` (loader dock tablet) → `{token, user}` |
| GET | `/me` | any role | The signed-in user |
| GET | `/clock` | any role | Business time and the active delivery day |
| PUT | `/clock` | dispatcher | `{at}` — move the demo clock |
| GET | `/reference` | any role | Outlets, vehicles, rules, reason codes, calendar, depots |
| GET | `/notifications` | any role | Notifications for the user's audiences, with read state |
| POST | `/notifications/read` | any role | `{ids?}` — mark read (all when empty) |

## Dispatcher

| Method | Path | What |
|---|---|---|
| GET | `/overview` | Day summary: orders by brand, planned/deferred (forced/chosen), fleet, reefer capacity, vehicles closest to a limit, open exceptions |
| GET | `/orders?date=` | Orders for the day with placement or deferral, plus after-cutoff orders |
| POST | `/orders/phone` | `{outletId, temp, lines[]}` — record a phone order |
| GET | `/plans/:date` | Plan view: draft or live trips with schedule, usage per vehicle, issues, unassigned orders with proposed deferrals |
| POST | `/plans/:date/auto` | Run the planning engine into the draft (released/running trips locked) |
| POST | `/plans/:date/move` | `{orderId, target: {vehicleId, trip} \| null, reason?}` — move or defer one order in the draft; response includes re-validated issues |
| DELETE | `/plans/:date/draft` | Discard the draft |
| POST | `/plans/:date/publish` | Validate and publish; `409` with the broken rules if any; notifies loaders, drivers and stores |
| GET | `/deferrals?date=` | Today's deferrals, history, outlets protected by repeat-skip |
| GET | `/tracking` | Every trip with progress, last contact, position / estimate, conflicts, late risk |
| GET | `/trips/:id` | Trip detail (stops, lines, events, moved stops, exceptions) |
| GET | `/trips/:id/move-options?outletId=` | Every vehicle/trip a stop could move to now, with ETA and the first rule it would break |
| POST | `/trips/:id/move-stop` | `{outletId, toVehicleId, toTrip?, reason}` — move a stop on a live plan |
| GET | `/exceptions` | Open and today's resolved exceptions |
| POST | `/exceptions/:id/resolve` | `{decision, note?, vehicleId?}` — see decisions below |
| GET | `/forecast` | Weekly chilled demand vs usable reefer capacity |
| PATCH | `/vehicles/:id` | `{status: available \| in_workshop}` |
| POST | `/demo/reset` | Reset the demo day (orders, plans, trips, events) and the clock |

Exception decisions: `dock_shortfall` → `send_partial` · `substitute` · `hold`; `vehicle_fault` → `swap` (+`vehicleId`) · `continue`; `non_delivery` → `return_to_depot` · `retry_today`; `sync_conflict` → `keep_driver` · `keep_reassignment`; `receipt_issue` → `redeliver` · `credit`; `road_problem` → `acknowledge`.

## Loader

| Method | Path | What |
|---|---|---|
| GET | `/loader/queue` | Trips loading at the user's depot, by departure, with progress |
| GET | `/loader/trips/:id` | Load list (stops and lines) |
| POST | `/loader/trips/:id/ack` | Acknowledge a plan change |
| POST | `/loader/trips/:id/lines/:orderId` | `{state: loaded \| pending}` |
| POST | `/loader/trips/:id/lines/:orderId/flag` | `{reason: missing \| damaged \| wrong_item, loadedUnits, item?, note?}` → dock_shortfall exception |
| POST | `/loader/trips/:id/release` | `409` until every line is done, decisions are made and changes acknowledged |
| POST | `/loader/trips/:id/fault` | `{type, severity: blocking \| advisory, note?}` → vehicle_fault exception |

## Driver

| Method | Path | What |
|---|---|---|
| GET | `/driver/run` | Today's trips for the driver's vehicle (cached on the phone) |
| POST | `/driver/sync` | `{events: [{clientEventId (uuid), type, tripId, outletId?, deviceTime, payload}]}` → per-event `applied` · `duplicate` · `conflict` · `rejected` |

Event types: `trip_started`, `arrived`, `delivered` (payload: `outcome` full · partial · refused · no_access · closed, `receiver`, `photo`, `signature`, `recommendation`, `note`), `problem` (`kind`, `label`, `note`), `conflict_answer` (`answer`), `trip_closed`.

## Store manager

| Method | Path | What |
|---|---|---|
| GET | `/store/overview` | Today's orders, delivery ETA (estimated when the driver is offline), deferral notices, lines to confirm, order window |
| GET | `/store/order-window` | Next delivery day, 16:00 cutoff, skipped holidays, calendar flags |
| POST | `/store/orders` | `{temp, lines: [{category, units}], note?}` |
| POST | `/store/deferrals/:id/ack` | Mark a deferral notice read |
| POST | `/store/receipts` | `{orderId, lines: [{orderId, status: ok \| short \| damaged \| temperature, received, expected}], note?}` |
| GET | `/store/history` | Last 30 days of orders with deferrals and receipts |
| GET | `/store/pod/:orderId` | The driver's proof of delivery (receiver, photo, signature) |
