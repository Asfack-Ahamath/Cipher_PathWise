# Architecture

PathWise is one TypeScript monorepo with three parts and one database.

```mermaid
flowchart LR
  subgraph Clients["Browsers (one responsive web app, five roles)"]
    AD["Administrator<br/>desktop"]
    D["Dispatcher<br/>desktop"]
    L["Loader<br/>dock tablet / phone"]
    R["Driver<br/>phone · installable PWA<br/>offline outbox"]
    S["Store manager<br/>counter PC / phone"]
  end

  subgraph App["app container (Node 22)"]
    W["Static web app<br/>apps/web/dist · service worker"]
    A["REST API · Fastify<br/>apps/api"]
    C["Planning engine<br/>packages/core<br/>(pure functions)"]
    A --> C
  end

  DB[("PostgreSQL 16 / Supabase Postgres<br/>reference data · orders · plans<br/>trips · events · audit · RLS")]
  SB["Supabase Auth + Storage<br/>(optional, server-side only)"]

  AD & D & L & S -- "HTTPS /api (JWT)" --> A
  R -- "GET /api/driver/run<br/>POST /api/driver/sync (batched, idempotent)" --> A
  AD & D & L & R & S -. "load app shell" .-> W
  A --> DB
  A -. "AUTH_PROVIDER / STORAGE_PROVIDER = supabase" .-> SB
  A -- "Server-Sent Events /api/events" --> AD & D & L & S
  CSV["data/*.csv<br/>(competition datasets)"] -. "seed on first start" .-> A
```

| Part | Path | What it does |
|---|---|---|
| Planning engine | `packages/core` | Pure, dependency-free domain logic: trip time formula, validation of every rule, the auto-planner and its deferral explanations, the deterministic demo day. Unit-tested without a database. |
| API | `apps/api` | Fastify 5 + `pg` (plain SQL, versioned migrations). Auth (JWT, bcrypt, dock PIN), role guards, business clock, plan drafts and publishing, loading, driver sync, exceptions and decisions, notifications, audit log. Serves the built web app in production. |
| Web | `apps/web` | React 19 + Vite 6 + Tailwind v4, TanStack Query, React Router, Leaflet. One app, five role areas (`/a`, `/d`, `/l`, `/r`, `/s`). The driver area is offline-first (service worker + IndexedDB outbox). |
| Database | PostgreSQL 16 or Supabase | Reference data from the CSVs, operational data, append-only `stop_events` and `audit_log`, row-level security on every table. See [data-model.md](data-model.md) and [supabase.md](supabase.md). |
| Admin | `apps/web/src/pages/admin`, `apps/api/src/services/admin.ts` | People and access, fleet, outlets, planning rules and operating settings, data imports (Datathon forecast), audit log, system health. |

## Request flow for the core loop

```mermaid
sequenceDiagram
  autonumber
  participant SM as Store manager
  participant DI as Dispatcher
  participant API
  participant ENG as core.autoPlan / validatePlan
  participant LO as Loader
  participant DR as Driver phone

  SM->>API: POST /store/orders (before 16:00)
  DI->>API: POST /plans/:date/auto
  API->>ENG: orders + network (vehicles, outlets, travel, allowances)
  ENG-->>API: trips + deferrals (reason, forced/chosen, why)
  API-->>DI: draft plan view (usage, issues, proposals)
  DI->>API: POST /plans/:date/move (manual change)
  API->>ENG: validatePlan (every change re-checked)
  DI->>API: POST /plans/:date/publish (blocked while any rule is broken)
  API-->>LO: notification · load list in reverse stop order
  API-->>SM: notification · ETA or deferral with reason + new date
  LO->>API: tick lines · flag shortfall → exception
  DI->>API: resolve exception (send partial / substitute / hold)
  LO->>API: release (409 until every line is done and decisions are made)
  DR->>API: GET /driver/run (saved on the phone)
  Note over DR: no signal — records go to the outbox with device time
  DR->>API: POST /driver/sync [events] (idempotent by clientEventId)
  API-->>DI: sync_conflict exception if a stop was moved meanwhile
  SM->>API: POST /store/receipts (short / damaged / warm → exception)
```

## Key design decisions

**Planning engine is a pure library.** `packages/core` takes a `Network` object and a list of orders and returns trips and explained deferrals. The API, the tests and the capacity forecast all call the same functions, so the rules can never drift between what the planner produces, what the validator checks and what the dispatcher sees. See [planning-engine.md](planning-engine.md).

**Drafts and published plans.** A draft is a JSON document on the `plans` row; it can be edited, re-planned and discarded freely. Publishing validates it again on the server, then applies it to the `trips` / `trip_orders` tables in place so trip IDs stay stable for loaders and drivers. A republish marks changed trips (`changed_at`, `change_note`) and the loader must acknowledge before release. Trips already released or on the road are locked from re-planning.

**Business clock.** The demo day is Thu 30 Apr 2026. A settings row stores `{base, setAt}`; "now" is `base + (wall-clock − setAt)`, so time moves in real time from 02:30 and the dispatcher can jump it (e.g. to 05:55) for the walkthrough. Every client keeps the offset, so phones stamp offline records with business time.

**Offline driver.** The run is cached in IndexedDB on every successful fetch. Every action (start, arrive, deliver with photo and signature, problem, close) is written to an outbox first with a UUID and the device time, then sent in batches. The server applies each record exactly once (`stop_events.client_event_id` is unique), orders by device time, and never throws away a record: if the stop was moved while the phone was offline, the delivery is kept and flagged as a conflict for the dispatcher to decide. See [degradation.md](degradation.md).

**Notifications by audience.** A notification is addressed to `role:`, `depot:`, `outlet:`, `vehicle:` or `user:` and each user reads the union of their audiences. That keeps "tell the Kandy loaders" or "tell whoever drives VEH041" one insert, and it survives vehicle swaps.

**Supabase behind the API.** Supabase provides the database, password checks (Auth) and photo storage, but the browser only talks to the PathWise API. The API keeps the business rules in one place, issues its own short sessions (so a Supabase outage does not sign anyone out), and holds the service-role key. Providers are switched with environment variables; `docker compose up` still runs a local PostgreSQL. See [supabase.md](supabase.md) and [security.md](security.md).

**Live updates.** Every write is audited, and the audit action decides which screens are stale. Browsers keep a Server-Sent Events stream and refetch only those queries, so a dispatcher's decision reaches the dock tablet within a second; polling remains as the fallback.

**Expected arrival times.** The plan uses the booklet's free-flow times. Live tracking, the driver's run and the store's ETA use *expected* times: each leg scaled by the traffic speed index for that district and hour (monsoon or not) and the day's road disruption, plus any hold the driver reported ("Road closed · 2 h"), plus actual delivery times so far. On the training data this halves the arrival-time error against free-flow (MAE 16.6 → 8.3 min).

**Audit.** Every write (plan moves, publish, loading, flags, releases, decisions, deliveries, receipts, clock changes) goes to `audit_log` with who and when.

## Deployment

One image (`Dockerfile`) builds the core, the API and the web app, and runs `node apps/api/dist/index.js`. On start it checks its configuration, waits for the database, applies migrations, prepares the Supabase bucket if used, seeds if the database is empty, and serves both `/api/*` and the web app with security headers and rate limits. `docker-compose.yml` adds PostgreSQL 16 with a health check; `render.yaml` deploys the same image against a Supabase project.
