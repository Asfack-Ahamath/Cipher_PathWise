# API reference

Base path `/api`, JSON in and out. Send `Authorization: Bearer <token>` on every route except those marked *public*.

Errors: `{ "error": "sentence for a person", "code": "machine_code", "details": … }` —
`400` bad input (zod; `details` lists fields) · `401` not signed in / session ended (`session_expired`, `session_revoked`, `account_disabled`) ·
`403` wrong role or `password_change_required` · `404` · `409` business rule (e.g. `TRIP_CLAIMED`) · `423` locked account · `429` rate limited · `502/503` Supabase unreachable.

## Auth
| Method | Path | Who | What |
|---|---|---|---|
| GET | `/auth/config` | public | `{demoMode, passwordRecovery}` for the sign-in page |
| POST | `/auth/login` | public | `{email, password}` → `{token, user, expiresInHours}` |
| POST | `/auth/pin` | public | `{pin, depot}` loader dock tablet |
| POST | `/auth/forgot` | public | `{email}` — sends a reset link (Supabase) or explains to ask the admin |
| POST | `/auth/recover` | public | `{accessToken, password}` from the emailed link → signed in |
| POST | `/auth/logout` | any | `{everywhere?}` |
| GET | `/me` | any | the signed-in user |
| POST | `/me/password` | any | `{current, next}` → new token (other sessions end) |
| POST | `/events/ticket` | any | 60-s ticket for `GET /events?ticket=` (Server-Sent Events: `{topics:[…]}`) |

## Shared
| Method | Path | Who | What |
|---|---|---|---|
| GET | `/health` | public | `{ok}` |
| GET | `/clock` | any | business time, delivery day, demo mode |
| PUT | `/clock` | dispatcher | `{at}` move the demo clock (demo mode) |
| POST | `/demo/reset` | dispatcher | reload the demo day (demo mode) |
| GET | `/reference` | any | outlets, vehicles, rules, operations settings, reason codes, calendar, depots |
| GET | `/notifications` · POST `/notifications/read` | any | inbox for the user's audiences |
| GET | `/files/:id` | any (checked) | proof photo / signature (bytes, or 302 to a signed Supabase URL) |

## Dispatcher (admins too)
| Method | Path | What |
|---|---|---|
| GET | `/overview` | day summary, attention list, capacity |
| GET | `/orders?date=` · GET `/orders.csv?date=` | order queue, after-cutoff, cancelled · CSV export |
| POST | `/orders/phone` | `{outletId, temp, lines[]}` phone order |
| PATCH | `/orders/:id` · POST `/orders/:id/cancel` | change quantities · cancel `{reason}` (confirmed, not yet on a trip) |
| GET | `/plans/:date` · `/plans/:date/versions` | plan board · every version with stats and changes |
| POST | `/plans/:date/auto` · `/move` · `/publish` · DELETE `/plans/:date/draft` | auto-plan · manual move `{orderId, target, reason?}` · publish · discard |
| GET | `/trips/:id` | trip detail (also loaders of the depot and the trip's driver) |
| GET | `/trips/:id/move-options?outletId=` | `{keep, why, recommendMove, options[]}` — keep-it row with live ETA first |
| POST | `/trips/:id/move-stop` | `{outletId, to:{vehicleId, trip?}, reason}` |
| GET | `/tracking` · `/deferrals` · `/exceptions` | live trips with expected ETAs and holds · deferrals · exceptions |
| POST | `/exceptions/:id/resolve` | `{decision, note?, vehicleId?}` |
| GET | `/forecast` · `/peak-day` · `/peak-day.csv` | weekly demand vs capacity · Task 2B S1 allocation + feasibility · submission CSV |
| PATCH | `/vehicles/:id` | `{status, note}` take a vehicle in/out of service |

## Loader
| Method | Path | What |
|---|---|---|
| GET | `/loader/queue` · `/loader/trips/:id` | dock queue for the depot · load list |
| POST / DELETE | `/loader/trips/:id/claim` | claim the trip for this tablet `{device, takeOver?}` · give it back |
| POST | `/loader/trips/:id/lines/:orderId` | `{state: loaded|pending}` |
| POST | `/loader/trips/:id/lines/:orderId/flag` | shortfall `{reason, loadedUnits, item?, note?}` |
| POST | `/loader/trips/:id/lines/:orderId/size` | real size `{actualKg, actualM3, note?}` |
| POST | `/loader/trips/:id/ack` · `/release` · `/fault` | acknowledge a plan change · release · vehicle fault |

## Driver
| Method | Path | What |
|---|---|---|
| GET | `/driver/run` | today's trips with expected ETAs, hold, route changes (cached on the phone) |
| POST | `/driver/sync` | `{events:[{clientEventId, type, tripId, outletId?, deviceTime, payload}]}` — idempotent; types `trip_started`, `arrived`, `delivered`, `problem` (`delayMin`), `trip_closed` (`unrecorded[]`), `conflict_answer`, `route_ack` |

## Store manager
| Method | Path | What |
|---|---|---|
| GET | `/store/overview` · `/store/order-window` | deliveries with ETAs, orders, notices, to confirm, upcoming |
| POST | `/store/orders` | `{temp, lines[], note?}` |
| PATCH / DELETE | `/store/orders/:id` | change quantities · cancel `{reason}` (until the cutoff) |
| POST | `/store/deferrals/:id/ack` | read a notice |
| POST | `/store/receipts` | `{orderId, lines[], note?, photos?[]}` |
| GET | `/store/history?temp=&status=&days=` · `/store/pod/:orderId` | history · driver's proof |

## Administrator
| Method | Path | What |
|---|---|---|
| GET / POST | `/admin/users` | list (`q`, `role`, `active`) · create (temporary password returned once) |
| PATCH | `/admin/users/:id` | name, role, scope, phone, active |
| POST | `/admin/users/:id/reset-password` · `/reset-pin` · `/unlock` · `/sign-out` | account actions |
| GET / POST / PATCH | `/admin/vehicles` · `/admin/vehicles/:id` | fleet; POST adds a vehicle (id optional, next free `VEH###` otherwise) |
| GET / POST / PATCH | `/admin/outlets` · `/admin/outlets/:id` | outlets, windows, access, active; POST adds an outlet (needs `travel` when its depot has no travel times to the district) |
| GET | `/admin/travel` | travel times from each depot to each district |
| GET | `/admin/next-ids` | next free vehicle and outlet ids |
| GET / PUT | `/admin/settings` · `/admin/settings/:key` | `rules` or `operations` |
| GET | `/admin/data` · POST / DELETE `/admin/data/forecast` | data status · import / remove the Task 2A forecast `{csv}` |
| GET | `/admin/audit?action=&entity=&before=&limit=` · `/admin/system` | audit log (paged) · health |
