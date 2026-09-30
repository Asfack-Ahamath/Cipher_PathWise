# Tight Coupling Analysis — PathWise (Cipher)

Analysis date: 2026-09-30  
Scope: monorepo `packages/core`, `apps/api`, `apps/web`, deployment/config, and API walkthrough tests.

---

## 1. Executive Summary

| Metric | Value |
| --- | --- |
| Components analysed | ~25 (3 packages/apps, 8 API services, route layer, seed/migrate, web libs + 4 role UIs, clock/auth/db infrastructure) |
| Critical findings | 1 |
| High findings | 4 |
| Medium findings | 5 |
| Low / necessary | Noted separately; not treated as defects |

**Main coupling patterns**

1. **Cross-layer SQL in the HTTP route layer** — handlers query PostgreSQL and reuse SQL fragments instead of staying at the service boundary.
2. **Shared mutable business clock** — module-level cache on the API and offset state on the web; most write paths assume it was loaded first.
3. **Untyped, fat API payloads** — React screens bind deeply to response shapes via `any`, so API field changes ripple across UI.
4. **Duplicated domain constants** — category kg/m³ tables and `Role` types live in both API and web.
5. **Hub services** — `plans.ts` / `planView` and `ORDER_COLS` / `loadNetwork` sit at the centre of many call graphs.

**Most significant relationships**

- `routes` → PostgreSQL (bypassing services)
- `clock` cache → almost every API service via `nowSync`
- Web role pages → exact JSON shapes from `planView` / `tripDetail` / overview endpoints
- `CATEGORIES` mirrored in `apps/api` and `apps/web`

**Architectural areas affected**

- API presentation vs persistence boundary
- Demo/business time infrastructure
- Web–API contract
- Single-image deployment (API + static web) — intentional for this product, still deployment-coupled

**What is *not* a problem here**

- `apps/api` → `@pathwise/core` for planning/validation is a **necessary domain dependency** on a pure library with a clear public surface.
- Service → `db.q` / `tx` with plain SQL is the chosen persistence style; coupling to the schema is expected, not accidental, as long as SQL stays behind services.
- No bidirectional import cycles were found among API services (`views` → `plans` is one-way).

---

## 2. Coupling Map

### Subsystem: packages/core (planning engine)

```text
types
  ↑ (types only)
time / reasons / dataset / demoDay
  ↑
schedule → validate
  ↑         ↑
planner ───┘
  ↑
index (public barrel)

No DB, no Fastify, no circular imports.
```

### Subsystem: apps/api

```text
index
  ↓ temporal: waitForDb → migrate → seedIfEmpty → loadClock → listen
server → routes ──────────────────────────────┐
                                              │
routes ──SQL──→ PostgreSQL   ←── CROSS-LAYER  │
routes → auth / clock / audit / seed          │
routes → services/*                           │
                                              │
network (loadNetwork, ORDER_COLS, activePlanDate, …)
  ↑ used by plans, views, store, trips, loader, driver, exceptions, routes
                                              │
plans (planView, publish, move*, auto)        │
  ↑ used by views.overview / forecast         │
  ↓ concrete → @pathwise/core + db + clock    │
                                              │
trips.tripDetail ← loader, driver, routes     │
views ← routes (read models)                  │
store / loader / driver / exceptions ← routes │
                                              │
clock (module `cache`) ←── shared mutable ─── ┘
  ↑ audit, plans, store, loader, driver, exceptions, views, routes, seed
db.pool ←── every service + routes + migrate
```

### Subsystem: apps/web

```text
main → AuthProvider → App (role routes)
lib/api (session + fetch) ← all pages
lib/clock (module `offset` + listeners) ← auth, outbox, all role UIs
lib/categories  ≈  api/services/store.CATEGORIES   ←── duplicated constant
lib/outbox → api + clock

pages/* (PlanBoard, DriverApp, …)
  ↓ deep property access on untyped API JSON
  planView / tripDetail / overview shapes
```

### Subsystem: deployment

```text
Dockerfile
  builds core + api + web
  runs single process: apps/api (serves /api + static web)
docker-compose / render.yaml
  app container + PostgreSQL
```

---

## 3. Findings

### Finding: TC-001

```text
Components:
routes (apps/api/src/routes/index.ts) → PostgreSQL / ORDER_COLS

Type:
Cross-layer coupling (Controller → Database)

Severity:
Critical

Evidence:
- GET /api/orders builds multi-join SQL in the route handler using ORDER_COLS
  (apps/api/src/routes/index.ts ≈ L58–66).
- PATCH /api/vehicles/:id updates vehicles and writes audit in the route
  (≈ L105–110).
- GET /api/deferrals and GET /api/store/pod/:orderId likewise query via q()/one()
  in the route module (≈ L89–98, L140–143).
- Dependency direction: HTTP layer → SQL schema + network.ORDER_COLS.

Why this is coupling:
The route layer knows table names, join graphs, and column aliases. Changing
the orders/outlets/deferrals schema or ORDER_COLS requires editing handlers,
not only a repository/service. This breaks the intended
Controller → Service → DB layering described in the skill (and implied by the
rest of the API, which otherwise delegates to services).

Independent change: Low  
Independent testing: Low (route tests need real SQL shape)

Necessary vs accidental:
Accidental presentation/persistence mixing. Domain still needs those queries;
they belong behind a service/read-model module.

Recommended direction:
Move each SQL-backed handler body into services (e.g. listOrders, listDeferrals,
setVehicleStatus, storePod) and keep routes as parse → call → return.
```

### Finding: TC-002

```text
Components:
clock (apps/api/src/clock.ts) ↔ almost all API services / routes / audit / seed

Type:
Shared mutable state + temporal coupling

Severity:
High

Evidence:
- Module-level `let cache: ClockSetting | null = null` (clock.ts L11).
- nowSync() reads cache without requiring a prior await (L18–21).
- index.ts loads clock only after migrate/seed (index.ts L15–18).
- Consumers: audit, plans, store, loader, driver, exceptions, views, routes,
  seed (via setClock).

Why this is coupling:
Correct “business now” depends on shared process memory and startup order.
Calling nowSync() before loadClock() silently falls back to config.demoClockStart
with a fresh setAt, which can disagree with the DB settings row. Tests and
workers that import services without going through index.ts inherit this hazard.

Independent change: Medium (clock API is small)  
Independent testing: Low without controlling cache / DB settings

Necessary vs accidental:
A single demo clock is a necessary product concept; the module singleton cache
and silent fallback are accidental implementation coupling.

Recommended direction:
Require explicit ClockContext (passed or DI), or make now() always async and
fail closed if unloaded; avoid silent cache miss defaults in production paths.
```

### Finding: TC-003

```text
Components:
Web role pages (esp. PlanBoard, DriverApp, LoaderApp, Overview)
  → API response shapes from planView / tripDetail / overview / tracking

Type:
Data-structure coupling

Severity:
High

Evidence:
- PlanBoard uses `v.trips`, `v.mode`, `v.draft.version`, `v.unassigned`,
  nested `t.vehicle.depot`, etc. with `any` (PlanBoard.tsx).
- DriverApp / LoaderApp walk `run.trips`, `t.exceptions`, stop `lines`, status
  string unions hardcoded in the UI.
- ~150+ `: any` / `as any` usages under apps/web/src, concentrated in pages.
- planView returns a large aggregated object (plans.ts L31–75) that is the
  de-facto UI contract.

Why this is coupling:
There is no shared typed DTO. Renaming or nesting a field in planView or
tripDetail forces UI edits across multiple role apps. The public HTTP contract
is implicit and duplicated in screen logic.

Independent change: Low  
Independent testing: Medium (UI can mock JSON, but mocks mirror internals)

Necessary vs accidental:
UI must show plan data (necessary). Untyped deep binding to one mega-payload
is accidental.

Recommended direction:
Export response types (Zod or TS types shared from api or a small contracts
package); split planView into smaller endpoints or view-models per screen where
practical; type useApi<T> at call sites.
```

### Finding: TC-004

```text
Components:
apps/api/src/services/store.ts CATEGORIES
  ↔ apps/web/src/lib/categories.ts CATEGORIES

Type:
Duplicated concrete data / configuration coupling

Severity:
High

Evidence:
- store.ts L9–17 defines Fresh/Style/Tech category kg and m³ tables.
- web categories.ts L1–9 states it “Mirrors CATEGORIES in … store.ts” with the
  same literals.
- Orders.tsx imports web CATEGORIES for phone-order sizing; placeOrder uses
  API CATEGORIES for authoritative sizing.

Why this is coupling:
Changing a unit weight on one side without the other produces UI estimates that
disagree with persisted order kg/m³. Two deployables must change together.

Independent change: Low  
Independent testing: Medium

Necessary vs accidental:
Category catalogue is necessary domain data; dual maintenance is accidental.

Recommended direction:
Single source in @pathwise/core (or API /reference), web reads from /api/reference
or imports the shared package.
```

### Finding: TC-005

```text
Components:
plans.planView / plans service → network, core, db, clock, audit;
views.overview / forecast → planView

Type:
High dependency count + hub / concrete aggregation coupling

Severity:
High

Evidence:
- plans.ts imports many core symbols and owns draft CRUD, validation, publish,
  live moves, and the board read-model (~272 lines).
- views.ts imports planView and calls it when a published plan exists
  (views.ts L6, L28) to compute “closest to budget” usage.
- Routes call planView after almost every plan mutation.

Why this is coupling:
planView is both a write-side collaborator and the dispatcher board’s read
model. Changes for overview metrics risk the plan board and vice versa. The
function loads network + orders + deferrals + live trips + validatePlan every
time — many reasons to change one unit.

Independent change: Medium–Low  
Independent testing: Medium (needs DB + network seed for full path)

Necessary vs accidental:
Publishing/planning orchestration is necessary. Packing board projection,
validation, and publish workflow in one module is accidental cohesion loss.

Recommended direction:
Split “PlanCommands” (auto/move/publish) from “PlanBoardQuery” (planView);
have overview use a narrower usage query instead of full planView.
```

### Finding: TC-006

```text
Components:
network.ORDER_COLS → routes, views, store, ordersForDate

Type:
Internal knowledge / schema fragment leakage

Severity:
Medium

Evidence:
- ORDER_COLS SQL string exported from network.ts L20–21.
- Interpolated into queries in routes/index.ts, views.ts, store.ts, and
  network.ordersForDate.

Why this is coupling:
Callers embed a shared column list into their own SQL. Altering an orders
column alias forces coordinated edits across modules that only needed “an order
row”. The fragment also assumes table alias `o`.

Independent change: Medium  
Independent testing: Medium

Necessary vs accidental:
Consistent order projections are useful; exporting raw SQL for callers to
concatenate is accidental leakage.

Recommended direction:
Provide functions (listOrdersForDate, listOrdersWithOutlet, …) that own the SQL;
stop exporting ORDER_COLS.
```

### Finding: TC-007

```text
Components:
apps/web ↔ apps/api (single Docker image / process)

Type:
Deployment coupling

Severity:
Medium

Evidence:
- Dockerfile builds core, api, and web; CMD runs only apps/api/dist/index.js.
- server.ts serves apps/web/dist statically when present.
- architecture.md: one container for API + web; Postgres separate.

Why this is coupling:
Frontend and API cannot version or roll back independently in production.
Acceptable for a hackathon monolith; still a real deployment coupling if the
team later wants separate release cadences.

Independent change: Low (deploy) / Medium (dev with vite proxy)  
Independent testing: N/A for deploy

Necessary vs accidental:
Necessary for the stated “one image” product choice; not accidental debt unless
requirements change.

Recommended direction:
Keep as-is unless independent deploys are required; then split static hosting
from the API image.
```

### Finding: TC-008

```text
Components:
index startup sequence ↔ migrate, seed, clock, server

Type:
Temporal / call-order coupling

Severity:
Medium

Evidence:
- index.ts: waitForDb → migrate → seedIfEmpty → loadClock → buildServer → listen.
- cli.ts and walkthrough.test.ts must recreate similar order (migrate, seed,
  resetDay, loadClock) before buildServer.

Why this is coupling:
Services are not safe to use in arbitrary order. Omitting loadClock or migrate
yields subtle wrong time or missing schema rather than a clear “not initialised”
failure at the composition root only.

Independent change: Medium  
Independent testing: Low for API integration

Necessary vs accidental:
Some boot order is necessary; implicit reliance outside the composition root is
the accidental part.

Recommended direction:
Document and encapsulate boot in one `bootstrap()` used by index, cli, and tests;
assert clock loaded inside nowSync or first request hook.
```

### Finding: TC-009

```text
Components:
apps/api/test/walkthrough.test.ts → full API + PostgreSQL + all roles

Type:
Test coupling

Severity:
Medium

Evidence:
- beforeAll migrates, seeds, resetDay, loadClock, buildServer (walkthrough.test.ts
  L15–28); requires DATABASE_URL and ~60s budget.
- Single describe drives store → dispatcher → loader → driver → store receipt
  against real DB state left by previous steps (shared tripId, PLAN date).

Why this is coupling:
There are no focused service-level tests for plans/loader/driver. A failure mid-
walkthrough is hard to localise; simple business rules need the whole system.

Independent change: N/A  
Independent testing: Low for individual services

Necessary vs accidental:
An E2E walkthrough is valuable and partly necessary for the demo story.
Missing unit/integration seams around services is accidental.

Recommended direction:
Keep the walkthrough; add service tests with a transactional DB fixture or
in-memory fakes for clock/notify; keep core planner tests as the pure unit suite
(already good).
```

### Finding: TC-010

```text
Components:
@pathwise/core Role ↔ apps/web/src/lib/api.ts Role

Type:
Duplicated type / concrete contract coupling

Severity:
Medium

Evidence:
- packages/core/src/types.ts exports Role.
- apps/api/src/auth.ts imports Role from @pathwise/core.
- apps/web defines its own Role union and User interface (api.ts L24–25) and
  does not depend on @pathwise/core.

Why this is coupling:
Adding a role requires editing web and core/API separately; TypeScript will not
catch drift.

Independent change: Medium  
Independent testing: High

Necessary vs accidental:
Web avoiding a dependency on core may be intentional bundle hygiene; duplicated
string unions are still accidental drift risk.

Recommended direction:
Share a tiny `@pathwise/contracts` (or depend on core types only) for Role and
stable DTO interfaces.
```

### Finding: TC-011

```text
Components:
Web lib/clock dayLabel/hhmm/Asia/Colombo ↔ API clock dayLabel/timeZone config

Type:
Configuration / temporal formatting coupling

Severity:
Low

Evidence:
- Web hardcodes TZ = 'Asia/Colombo' (web clock.ts L36).
- API uses config.timeZone for dayLabel/localDate (api clock.ts L29–36).
- Both implement dayLabel with similar en-GB formatting.

Why this is coupling:
Timezone or label format changes can diverge between server-rendered labels
(planDateLabel) and client-only formatting.

Independent change: High  
Independent testing: High

Necessary vs accidental:
Local display helpers are fine; dual sources of TZ are mild accidental coupling.

Recommended direction:
Prefer server-provided labels where consistency matters; or share TZ constant.
```

---

### Evidence summary table

| Component A | Component B | Coupling Type | Severity | Evidence | Why It Matters |
| --- | --- | --- | --- | --- | --- |
| `routes` | PostgreSQL / `ORDER_COLS` | Cross-layer | Critical | SQL in `routes/index.ts` for orders, deferrals, vehicles, POD | Schema/API handler co-change |
| `clock` cache | API services | Shared mutable state | High | `let cache` + `nowSync()` | Wrong time if boot order skipped |
| Web pages | `planView` / `tripDetail` JSON | Data-structure | High | Deep `any` access in PlanBoard, Driver, Loader | UI breaks on payload reshape |
| `store.CATEGORIES` | `web/lib/categories` | Duplicated data | High | Identical tables, comment admits mirror | kg/m³ drift between UI and API |
| `plans` / `planView` | `views`, routes, core, db | Hub / high fan-in | High | overview calls full `planView` | Many reasons to change one module |
| `ORDER_COLS` | routes, views, store | Schema fragment leak | Medium | Exported SQL interpolated by callers | Column rename fans out |
| Docker image | api + web | Deployment | Medium | Single CMD serves both | Cannot deploy UI alone |
| `index` boot | migrate/seed/clock | Temporal | Medium | Fixed sequence in index/tests | Services unsafe out of order |
| walkthrough test | whole system + DB | Test | Medium | One E2E, no service unit tests | Hard to test pieces alone |
| web `Role` | core `Role` | Duplicated type | Medium | Parallel unions | Role drift |
| web clock TZ | api `config.timeZone` | Config | Low | Hardcoded vs config | Label mismatch risk |

---

## 4. Prioritised Refactoring Opportunities

Ordered by impact vs effort for *accidental* coupling. Do not split into microservices for these items.

| Priority | Finding | Smallest reasonable improvement |
| --- | --- | --- |
| P1 | TC-001 | Extract route SQL into service functions; routes only validate and delegate. |
| P2 | TC-004 | Move `CATEGORIES` into `@pathwise/core` (or expose via `/api/reference`); delete the web mirror. |
| P3 | TC-003 | Add Zod (or shared TS) types for `planView` and `tripDetail`; type the hottest screens first (PlanBoard, DriverApp). |
| P4 | TC-005 | Split plan commands from `planView`; replace `overview`’s `planView` call with a slim usage query. |
| P5 | TC-006 | Stop exporting `ORDER_COLS`; wrap queries in `network`/`orders` helpers. |
| P6 | TC-002 / TC-008 | Single `bootstrap()`; make unloaded clock fail loudly or inject clock into services. |
| P7 | TC-009 | Add 2–3 service-level tests (publish validation, loader release rules) beside the walkthrough. |
| P8 | TC-010 / TC-011 | Share `Role` and timezone constant; keep day labels server-authoritative where shown next to API data. |
| P9 | TC-007 | Leave monolith deploy unless product needs independent frontend releases. |

### Techniques mapped

| Technique | Apply to |
| --- | --- |
| Move SQL behind services / repository-style helpers | TC-001, TC-006 |
| Shared module / single source of truth | TC-004, TC-010, TC-011 |
| Typed contracts / facades | TC-003, TC-005 |
| Separate command vs query | TC-005 |
| Remove / encapsulate shared mutable state | TC-002 |
| Explicit composition root | TC-008 |
| Narrower test fixtures | TC-009 |
| Dependency inversion | Only if services need to swap clock/db in unit tests (TC-002, TC-009) |

---

## Appendix: Healthy boundaries (not reported as defects)

| Relationship | Why it is acceptable |
| --- | --- |
| API → `@pathwise/core` (`autoPlan`, `validatePlan`, `scheduleTrip`) | Pure domain library; implementation can change behind stable functions. Core unit tests run without DB. |
| loader/driver → `tripDetail` | Shared read model for the same trip entity; one-way dependency. |
| Web → `/api/*` via `lib/api.ts` | Normal client dependency on a public HTTP API. |
| Services → `pg` pool | Chosen architecture (plain SQL); problematic only when SQL escapes into routes (TC-001). |

---

*Generated for the Identify Tightly Coupled Components skill. Severity reflects independence of change/test/deploy, not overall code quality.*
