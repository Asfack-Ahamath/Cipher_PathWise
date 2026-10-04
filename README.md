<p align="center">
  <img src="apps/web/public/icon-192.png" width="88" alt="PathWise logo">
</p>

<h1 align="center">PathWise</h1>

<p align="center">
  <b>Delivery planning for Waypoint Group, from the 16:00 order cutoff to the store's receipt.</b><br>
  One responsive web app for the four roles in the brief, plus an Administrator console.<br>
  Built by <b>Team Cipher</b> for the Tech-Triathlon 2026 Hackathon, on our Day 5 PathWise design.
</p>

<p align="center">
  <a href="https://github.com/Asfack-Ahamath/Cipher_PathWise/actions/workflows/ci.yml"><img src="https://github.com/Asfack-Ahamath/Cipher_PathWise/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI status"></a>
  <img src="https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white" alt="TypeScript 5">
  <img src="https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black" alt="React 19">
  <img src="https://img.shields.io/badge/Fastify-5-000000?logo=fastify&logoColor=white" alt="Fastify 5">
  <img src="https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white" alt="PostgreSQL 16">
  <img src="https://img.shields.io/badge/PWA-installable-5A0FC8" alt="Installable PWA">
  <img src="https://img.shields.io/badge/license-MIT-2EA44F" alt="MIT licence">
</p>

<p align="center">
  <a href="https://cipher-pathwise.up.railway.app"><b>Live demo</b></a> ·
  <a href="#judge-walkthrough">Judge walkthrough</a> ·
  <a href="docs/architecture.md">Architecture</a> ·
  <a href="#documentation">Documentation</a> ·
  <a href="docs/ai-disclosure.md">AI disclosure</a>
</p>

---

## For judges: start here

**Live demo: <https://cipher-pathwise.up.railway.app>**. Sign in with a one-tap tile on the sign-in page, or with any account below. The password for every account is **`PathWise@2026`**.

| Role | Sign in with | Best on |
|---|---|---|
| Dispatcher | `dispatcher@pathwise.lk` | Desktop |
| Loader | Dock PIN **2468** (Kandy), or `loader@pathwise.lk` | Phone-sized window or tablet |
| Driver | `driver@pathwise.lk` | Phone-sized window |
| Store manager | `store@pathwise.lk` | Phone-sized window or PC |
| Administrator | `admin@pathwise.lk` | Desktop |

1. **Open the live demo** and follow the [15-minute judge walkthrough](#judge-walkthrough).
2. **Or run it yourself** with one command: `docker compose up --build`, then open <http://localhost:8080> (details in [Setup & configuration](#setup--configuration)).
3. **Read how it is built** in the [architecture document](docs/architecture.md): 23 figures, including a use-case diagram, deployment views and a data architecture.

> **Tips.** Use a separate browser window (or a private window) per role. In the browser's device toolbar choose a phone size (for example 390 × 844) to see the loader and driver screens as they look on a phone. Screens update live across windows. The demo day is **Thursday 30 April 2026**; the business clock starts at **02:30** and runs in real time, and the dispatcher moves it from the clock chip in the top bar.

---

## PathWise in one minute

Waypoint's three brands compete for one delivery network of 120 outlets, 60 vehicles and two depots, and on most days the fleet cannot serve everyone. PathWise connects ordering, planning, loading, delivery and receipt so that every decision is validated, explained and visible to the next person in the chain.

```mermaid
%%{init: {'flowchart': {'wrappingWidth': 170, 'nodeSpacing': 22, 'rankSpacing': 34}}}%%
flowchart LR
  classDef store fill:#DBEAFE,stroke:#2563EB,stroke-width:1.5px,color:#0B1B3A
  classDef office fill:#CCFBF1,stroke:#0F766E,stroke-width:1.5px,color:#042F2E
  classDef field fill:#E0E7FF,stroke:#4F46E5,stroke-width:1.5px,color:#1E1B4B

  A["<b>1 · Order</b><br/>Store manager<br/>until the 16:00 cutoff"]:::store
  B["<b>2 · Plan</b><br/>Dispatcher<br/>auto-plan, validate, publish"]:::office
  C["<b>3 · Load</b><br/>Loader<br/>stop order, shortfall flags"]:::field
  D["<b>4 · Deliver</b><br/>Driver<br/>proof, works offline"]:::field
  E["<b>5 · Receive</b><br/>Store manager<br/>confirm line by line"]:::store
  F["<b>6 · Look ahead</b><br/>Dispatcher<br/>capacity forecast"]:::office

  A --> B --> C --> D --> E --> F
  E -. "issues and deferrals feed the next plan" .-> B
```

- **Plans a real day.** 143 confirmed orders, 60 vehicles, 120 outlets, two depots. Auto-plan builds trips that respect every constraint in the brief: weight and volume, chilled goods on refrigerated vehicles, van-only outlets, one brand and district per trip, delivery and mall windows, the Fresh 270-minute and Style/Tech 480-minute budgets, two trips per vehicle, weekly fuel quotas and vehicles in the workshop.
- **Defers honestly.** When demand exceeds capacity, every order that does not fit gets a reason code (*forced* or *chosen*), the sentence the store will read, and a new date that skips holidays (Vesak on Fri 1 May). An outlet skipped yesterday is served first today.
- **Checks every change.** Manual moves are re-validated on the spot, publishing is blocked while any rule is broken, and every published version is kept.
- **Runs the dock.** Load lists in reverse stop order, one tablet per trip, shortfall and wrong-size flags that need a dispatcher decision, and a release that stays locked until everything is resolved.
- **Predicts arrivals honestly.** Expected times use traffic and road conditions, what was actually delivered and any delay the driver reports. A stop is moved only when the *expected* time misses the window, never just because a phone has no signal.
- **Works with no signal.** The driver's phone keeps the run and records every stop, photo and signature offline with the phone's time, then syncs exactly once. If a stop was moved meanwhile, the delivery is kept and turned into a decision, never a silent overwrite.
- **Closes the loop.** The store sees an honest arrival time, edits or cancels orders before the cutoff, reads deferral notices and confirms receipt line by line against the driver's own count and proof.

## Product tour

<table>
  <tr>
    <td width="50%" valign="top"><img src="docs/assets/screenshots/dispatcher-plan-board.png" alt="Dispatcher plan board after auto-plan: 135 orders on trips, 0 violations, and 8 deferred orders each with a reason"><br><sub><b>Dispatcher · Plan board.</b> 135 of 143 orders on trips, 0 violations; the 8 that did not fit each carry a reason and the planner's sentence.</sub></td>
    <td width="50%" valign="top"><img src="docs/assets/screenshots/dispatcher-move-stop.png" alt="Live tracking with the keep it or move it dialog for a stop held by a road closure"><br><sub><b>Dispatcher · Live tracking.</b> A road closure holds VEH041; the dialog shows the expected time against the window and only offers valid vehicles.</sub></td>
  </tr>
</table>

<table>
  <tr>
    <td width="25%" valign="top"><img src="docs/assets/screenshots/loader-dock.png" alt="Loader phone screen with a dock shortfall banner and stops in reverse order"><br><sub><b>Loader · Dock.</b> Reverse stop order, a shortfall sent to the dispatcher.</sub></td>
    <td width="25%" valign="top"><img src="docs/assets/screenshots/driver-offline.png" alt="Driver phone screen with no signal and a delivery saved on the phone waiting to sync"><br><sub><b>Driver · No signal.</b> The delivery is saved on the phone and syncs later.</sub></td>
    <td width="25%" valign="top"><img src="docs/assets/screenshots/store-today.png" alt="Store manager phone screen showing today's orders and the cutoff for the next order"><br><sub><b>Store · Today.</b> Orders, the cutoff clock and the carried-over order.</sub></td>
    <td width="25%" valign="top"><img src="docs/assets/screenshots/store-receive.png" alt="Store manager receipt screen with the driver's proof of delivery and a short line"><br><sub><b>Store · Receive.</b> The driver's proof, and both counts are kept.</sub></td>
  </tr>
</table>

<table>
  <tr>
    <td width="50%" valign="top"><img src="docs/assets/screenshots/dispatcher-forecast.png" alt="Capacity forecast: chilled demand per week against usable refrigerated capacity"><br><sub><b>Dispatcher · Capacity forecast.</b> Actual and forecast chilled demand against usable reefer capacity.</sub></td>
    <td width="50%" valign="top"><img src="docs/assets/screenshots/admin-overview.png" alt="Administrator overview with sign-in activity, vehicles available and system health"><br><sub><b>Administrator · Overview.</b> People, fleet, rules, data imports, audit and system health.</sub></td>
  </tr>
</table>

## How PathWise answers the brief

The brief lists seven problems a solution must address. Each maps to a feature and to the walkthrough step where you can see it.

| Problem in the brief | How PathWise addresses it | See |
|---|---|---|
| Planning is fragmented | One queue of confirmed orders per day; auto-plan or manual planning with validation; every published version kept | Step 2 |
| Delivery progress is hard to track | Live tracking with expected times, holds and last contact; exceptions raised as they happen | Steps 5, 6 |
| Deferrals lack a clear record | Reason-coded deferrals (forced or chosen) with the store's sentence, repeat-skip protection and escalation | Steps 2, 9 |
| Communication does not support feedback | Load lists in stop order, shortfall flags with decisions, proof of delivery (photo, signature, count), line-by-line receipt | Steps 3, 4, 5, 9 |
| Demand is hard to anticipate | Capacity forecast (history and baseline, with a Task 2A import) and a peak-day lab | Step 10 |
| Service time and lateness are not predicted | Expected arrival times from traffic and road conditions plus reported holds; late-risk flags. On the training routes this halves the arrival-time error against free flow (mean absolute error 16.6 to 8.3 minutes) | Step 6 |
| Field connectivity is unreliable | Offline-first driver app, an outbox with the phone's time, idempotent sync, conflicts become decisions | Steps 5, 7, 8 |

## Hackathon deliverables

| Requirement in the brief | Where to find it |
|---|---|
| Responsive web app across all four roles; loader and driver on phone-sized screens | [Live demo](https://cipher-pathwise.up.railway.app); role areas `/d`, `/l`, `/r`, `/s` (and `/a`) |
| Plans respect capacity, temperature, access, windows and fuel quotas; a day with demand above capacity is handled and deferrals are identified | [Planning engine](docs/planning-engine.md), [traceability table](docs/architecture.md#10-quality-scenarios-and-traceability), [walkthrough step 2](#2--dispatcher-plans-a-day-where-demand-is-higher-than-capacity) |
| Numbered judge walkthrough on a seeded, realistic delivery day | [Judge walkthrough](#judge-walkthrough) |
| Public URL and seeded credentials, one account per role | [For judges: start here](#for-judges-start-here) |
| README with setup and configuration, seeded accounts, the walkthrough and departures from the Day 5 design | [Setup & configuration](#setup--configuration) · [Seeded accounts](#seeded-accounts) · [Judge walkthrough](#judge-walkthrough) · [Departures](#departures-from-the-day-5-design) |
| GitHub monorepo named `TeamName_SolutionName` | `Cipher_PathWise` (npm workspaces) |
| `docker compose up` starts the full stack with database and seed data; `.env.example` at the root | [docker-compose.yml](docker-compose.yml), [.env.example](.env.example); the CI job `docker` smoke-tests it on every push |
| `docs/` with an architecture diagram and the data model | [architecture.md](docs/architecture.md) · [data-model.md](docs/data-model.md) |
| AI tool disclosure in `docs/` | [ai-disclosure.md](docs/ai-disclosure.md) |

## Architecture at a glance

One language (TypeScript), one planning rulebook, one PostgreSQL database, one container.

```mermaid
%%{init: {'flowchart': {'wrappingWidth': 260, 'nodeSpacing': 40, 'rankSpacing': 70}}}%%
flowchart LR
  classDef browser fill:#E0E7FF,stroke:#4F46E5,stroke-width:1.5px,color:#1E1B4B
  classDef server fill:#CCFBF1,stroke:#0F766E,stroke-width:1.5px,color:#042F2E
  classDef core fill:#D1FAE5,stroke:#047857,stroke-width:1.5px,color:#022C22
  classDef data fill:#FEF3C7,stroke:#B45309,stroke-width:1.5px,color:#451A03

  B["<b>Browser</b><br/>React 19 PWA, five role areas<br/>offline outbox for the driver"]:::browser
  subgraph C["One container · Node 22 · port 8080"]
    API["<b>Fastify API</b><br/>REST and live events<br/>also serves the web app"]:::server
    CORE["<b>Planning engine</b><br/>pure TypeScript, no I/O"]:::core
  end
  DB[("<b>PostgreSQL 16</b><br/>Docker container or Supabase")]:::data

  B <-- "HTTPS JSON and live events" --> API
  API --> CORE
  API --> DB

  style C fill:#F0FDFA,stroke:#5EEAD4,color:#115E59
```

| Layer | Path | Stack and role |
|---|---|---|
| Planning engine | [`packages/core`](packages/core) | Pure TypeScript, zero dependencies: trip-time formula, `validatePlan`, `autoPlan` with deferral reasons, expected arrival times, capacity forecast, Task 2B checker, deterministic demo day |
| API | [`apps/api`](apps/api) | Fastify 5, `pg`, zod; JWT and bcrypt, or Supabase Auth; plain SQL migrations (`001` to `003`); server-sent events; serves the built web app |
| Web | [`apps/web`](apps/web) | React 19, Vite 6, Tailwind 4, TanStack Query, React Router, Leaflet; installable PWA with an IndexedDB outbox for the driver |
| Data | PostgreSQL 16 (Docker, laptop or Supabase) | 26 tables with row-level security, append-only `stop_events` and `audit_log`, optional private Supabase Storage for proof photos |

Role areas in one app: `/a` administrator · `/d` dispatcher · `/l` loader · `/r` driver · `/s` store manager. The full picture, with the use-case diagram, data architecture and deployment views, is in [docs/architecture.md](docs/architecture.md).

---

## Setup & configuration

### With Docker (recommended for judging)

```bash
git clone https://github.com/Asfack-Ahamath/Cipher_PathWise.git
cd Cipher_PathWise
docker compose up --build
```

Open **<http://localhost:8080>** (change the port with `APP_PORT`). On the first start the app creates the tables and loads the datasets and the demo day. No `.env` file is needed. To start again from a clean database: `docker compose down -v && docker compose up --build`.

Official dataset CSVs are optional: unzip the official pack into [`data/`](data/README.md) (either the files directly or the `General Data/` folder) before the first start. Without them the seed uses the copy bundled in `packages/core`.

### On a laptop with only Node.js (no Docker, no PostgreSQL install)

Needs **Node.js 20 or newer**.

```bash
npm install        # also downloads a private PostgreSQL for your operating system
npm run local      # builds, starts the database from ./.pgdata and serves on http://localhost:8080
```

`npm run local:start` skips the build next time; delete `.pgdata` to start from scratch.

### Development with your own PostgreSQL or Supabase

```bash
npm install
cp .env.example .env     # set DATABASE_URL (and the Supabase values if you use Supabase)
npm run db:migrate       # 001_init, 002_production, 003_security
npm run db:seed          # datasets, conditions, accounts (and the demo day in demo mode)
npm run dev              # API on :3000 (PORT in .env.example), web on http://localhost:5173
```

The `db:*` and `admin:set-password` scripts build `@pathwise/core` first, so a fresh `npm install` does not fail with a missing `packages/core/dist`.

### Ports by run mode

| Mode | App | Web dev server | Database |
|---|---|---|---|
| `docker compose up` | **8080** (`APP_PORT`) | n/a | PostgreSQL container |
| `npm run local` | **8080** (`PORT`) | n/a | Embedded PostgreSQL on 5499 |
| `npm run dev` with `.env` from `.env.example` | API on **3000** | **5173**, proxying `/api` to 3000 | Yours |
| Production (Railway) | **8080** inside the container, HTTPS at the platform edge | n/a | Supabase |

### Scripts

| Script | What it does |
|---|---|
| `npm test` | Planning engine (**29** Vitest cases) and API tests on real PostgreSQL (**39**: the judge walkthrough, security and admin, mocked Supabase Auth, Storage and RLS, unit tests): **68** in total |
| `npm run typecheck` · `npm run build` · `npm start` | Type checks · production build · serve API and built web on :8080 |
| `npm run db:reset-demo` · `npm run db:conditions` | Reload the demo day · reload traffic, road and demand tables |
| `npm run admin:set-password -- <email> <password>` | Break-glass local password |

CI ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)): build, type check, engine tests, API tests against PostgreSQL 16, and a `docker compose` health and login smoke test.

### Configuration reference

Every value has a safe default for the local demo ([`.env.example`](.env.example)). Environment variables are read from the host or from `.env` and never belong in git.

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | `postgres://pathwise:pathwise@localhost:5432/pathwise` | Where data lives. For Supabase use the **Session pooler** URI (port 5432) |
| `DATABASE_SSL` | `false` | `true` for managed databases such as Supabase |
| `JWT_SECRET` | placeholder (warns) | Signs sessions. Random 32+ characters, required when `DEMO_MODE=false`: `openssl rand -base64 48` |
| `AUTH_PROVIDER` | `local` | `local` checks bcrypt hashes in `users`; `supabase` checks passwords in Supabase Auth |
| `STORAGE_PROVIDER` | `db` | `db` stores photos in PostgreSQL; `supabase` uses a private bucket with signed URLs |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_STORAGE_BUCKET` | empty, bucket `pathwise-proofs` | Supabase project values. The service-role key is server-only |
| `DEMO_MODE` | `true` | Seeded demo accounts, the business clock and *Reset demo day*. Use `false` for a real rollout |
| `SEED_ON_START` | `true` | Create tables and load data when the database is empty |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | `admin@pathwise.lk`, empty | First administrator. Empty password uses `DEMO_PASSWORD` in demo mode |
| `DEMO_CLOCK_START`, `DEMO_PASSWORD` | `2026-04-30T02:30:00+05:30`, `PathWise@2026` | Demo clock start and the demo password |
| `APP_URL`, `CORS_ORIGINS`, `TRUST_PROXY` | empty, empty, `false` (`true` in production) | Public URL for reset emails; extra browser origins; trust `X-Forwarded-For` behind a platform proxy |
| `PORT`, `HOST`, `LOG_LEVEL`, `DATA_DIR` | `8080`, `0.0.0.0`, `info`, `./data` | Server settings |

### Supabase and deployment

The code is identical everywhere; only environment variables change. Step by step (project, keys, Auth, Storage, migrate, seed, deploy): **[docs/supabase.md](docs/supabase.md)**.

- **Live demo:** a Docker image built from the `Dockerfile` on **Railway**, against a **Supabase** project (`AUTH_PROVIDER=supabase`, `STORAGE_PROVIDER=supabase`, `DATABASE_SSL=true`, `TRUST_PROXY=true`). The container health check is `GET /api/health`.
- **Render:** `render.yaml` is a Blueprint for the same image; paste the values it marks `sync: false`.
- **Any Docker host** (Fly.io, a VM): build the `Dockerfile`, set the variables above and expose port 8080.
- On Supabase: Authentication, Email provider on and **new sign-ups off**; Site URL and redirect URL set to the app's URL; the API creates the private `pathwise-proofs` bucket. Check afterwards that the table editor shows outlets 120, vehicles 60 and calendar 910, and that *Administration, System health* is green.

## Seeded accounts

Password for every account: **`PathWise@2026`**. The sign-in page has one-tap tiles.

| Role | Sign in with | Who and where |
|---|---|---|
| Administrator | `admin@pathwise.lk` | People, settings, data, audit, health, and everything a dispatcher can do |
| Dispatcher | `dispatcher@pathwise.lk` | Nimal Perera, both depots |
| Loader | Dock PIN **2468** (Kandy), or `loader@pathwise.lk` | Kasun Jayasinghe, Kandy DC |
| Driver | `driver@pathwise.lk` | Ruwan Bandara, VEH041, reefer truck, Kandy |
| Store manager | `store@pathwise.lk` | Sanduni Fernando, Waypoint Fresh Kegalle (OUT116) |

More accounts: `loader.peliyagoda@pathwise.lk` (PIN **1357**), `driver.veh039@pathwise.lk`, `store.style@pathwise.lk` (OUT089), `store.tech@pathwise.lk` (OUT024).

**The demo day** is Thursday 30 April 2026. The business clock starts at **02:30** and runs in real time; the dispatcher moves it from the clock chip in the top bar, which has a preset for each step of the walkthrough. *Reset demo day* puts everything back to 02:30 (people, settings and the audit log are kept).

---

## Judge walkthrough

About 15 minutes. Each step names the account, what to press and what you should see. Use one window per role; the loader and driver in a phone-sized window.

| Step | Role | What happens |
|---|---|---|
| [1](#1--store-manager-places-tomorrows-order) | Store manager | Sees a carried-over order, places the next one |
| [2](#2--dispatcher-plans-a-day-where-demand-is-higher-than-capacity) | Dispatcher | Auto-plans 143 orders, a broken rule is caught, publishes, reads the deferrals |
| [3](#3--loader-loads-veh041-and-finds-a-shortfall) | Loader | Loads in stop order and flags a shortfall |
| [4](#4--dispatcher-decides) | Dispatcher | Decides; the loader releases the vehicle |
| [5](#5--driver-starts-then-reports-a-delay) | Driver | Starts, delivers, reports a road closure, goes offline |
| [6](#6--dispatcher-decides-whether-to-move-a-stop) | Dispatcher | Sees the hold and decides whether to move a stop |
| [7](#7--the-driver-delivers-it-anyway-then-gets-signal-back) | Driver | Delivers the moved stop offline, then syncs |
| [8](#8--dispatcher-resolves-the-sync-conflict) | Dispatcher | Resolves the conflict; the driver closes the trip |
| [9](#9--store-confirms-receipt) | Store manager | Reads the notice and confirms receipt with an issue |
| [10](#10--look-ahead) | Dispatcher | Capacity forecast and the peak-day lab |
| [11](#11--administration) | Administrator | People, rules, data, audit, health |

### 1 · Store manager places tomorrow's order

`store@pathwise.lk` · phone-sized window

1. **Today** shows the confirmed orders for Thu 30 Apr. The chilled dairy order says *carried over, goes first*: this outlet was deferred yesterday.
2. **Order**: the next delivery is **Sat 2 May** (Fri 1 May is Vesak), with the time left to the 16:00 cutoff. Add Dairy units, then **Place order**. Back on **Today**, *Coming up* lets you edit or cancel it until the cutoff.

### 2 · Dispatcher plans a day where demand is higher than capacity

`dispatcher@pathwise.lk` · desktop

1. **Overview**: 143 confirmed orders, 56 of 60 vehicles ready, payday, Vesak tomorrow, monsoon.
2. **Plan board**, then **Auto-plan**: 135 of 143 orders on trips, 0 violations. The left column lists the 8 orders it could not fit, each with a reason and the planner's sentence.
3. Break a rule: open **VEH041**, use **⋮** on **OUT116** and move it to the **VEH044** dry truck. You get *Refrigerated vehicle required* and **Publish plan** is disabled.
4. **Auto-plan** again, then **Publish plan**, then **Publish and notify**. **Versions** shows v1 with its trips, orders and kilograms.
5. **Deferrals**: each deferred order with its reason and the exact text the store reads; repeat-skip protection serves OUT116, OUT030 and OUT079.

### 3 · Loader loads VEH041 and finds a shortfall

Dock PIN **2468** (Kandy) · phone or tablet

1. Open **VEH041 · Trip 1**; this tablet now holds the trip. Trip 2 trucks show *Truck on Trip 1* and cannot be ticked.
2. Tick every line **except** the dairy line for OUT116, then **Flag**, *Missing*, 10 of 12, *yoghurt cases*, **Send flag**. Release stays locked. (The scale button records goods bigger than ordered.)

### 4 · Dispatcher decides

Dispatcher · desktop

**Exceptions**, then *Short at the dock — VEH041 Trip 1*, then **Send partial**, and confirm. Within a second the loader sees the decision and can press **Release vehicle to driver**.

### 5 · Driver starts, then reports a delay

`driver@pathwise.lk` · phone-sized window

1. Dispatcher: clock to **04:55**. Driver: **Start trip**. Open stop 1 (**OUT116**): **I've arrived**, **Record delivery**, *Delivered in full*, **Next: proof of delivery**, enter the receiver's name and a signature, **Save and send**.
2. Dispatcher: clock to **05:35**. Driver: **Report a problem**, *Road closed or blocked*, **2 h**, the note *Landslide near Kadugannawa*, **Send to dispatcher**. The run now shows the hold, arrival times include it, and the stores down the line are told.
3. Tick **No signal**. Deliver stop 2 the same way; the button now reads **Save on this phone** and the stop shows *Saved on phone · waiting to sync*. It survives a reload.

### 6 · Dispatcher decides whether to move a stop

Dispatcher · clock to **05:55**

1. **Live tracking**, then **VEH041**: the road-closure card, *No signal since …* with its explanation, and expected times. **OUT117** is now about **08:09 against a 07:45 close** and **OUT119** about **09:19 against an 08:00 close**.
2. **OUT119**, then **Move stop**. The first row is **Keep on VEH041** with that expected time and the reason. Pick a vehicle that arrives in time (for example **VEH043 · new Trip 2**, ETA 07:08) and **Move to …**. The Kandy loaders are told to load OUT119 on it and the store gets the new ETA. (On a trip with no reported delay whose phone is simply out of signal, the same dialog says there is no reason to move the stop.)

### 7 · The driver delivers it anyway, then gets signal back

Driver · phone-sized window

1. Still offline, deliver OUT119 (the road reopened; the phone does not know about the move).
2. Untick **No signal**: *Back online*, **Your route changed** (then **Got it**) and *Check one stop*, then **Goods handed to the store**.

### 8 · Dispatcher resolves the sync conflict

Dispatcher · desktop

**Exceptions**, then *VEH041 synced a delivery at OUT119 that was moved*: the delivery time, the receiver, the move time and the driver's answer. Choose **Keep VEH041's delivery**. Driver: **All stops done · close trip** (a stop without an outcome would need a reason).

### 9 · Store confirms receipt

Store manager · phone-sized window · clock to **08:30**

1. **Today** shows *Delivered*, the receiver and the vehicle. **Notices** shows *2 units of your chilled order deferred, rescheduled for Sat 2 May*; press **Acknowledge**.
2. **Receive**: the driver's proof of delivery is on the card (receiver, times, signature, the driver's count). Under *Check each line*, mark the chilled line **Short** (enter the count you actually received; the driver's count and yours are both kept) and the ambient line **OK**, then **Confirm with issue**. Dispatcher: **Exceptions**, then *OUT116 reported short on receipt*, then **Replace on the next run** or credit the store.

### 10 · Look ahead

Dispatcher · desktop

**Capacity forecast** shows actual history and forecast weeks against usable reefer capacity, per depot. **Peak-day lab** is Task 2B scenario S1: **70 of 85 orders served**, feasible under every official rule, with **Download submission CSV**.

### 11 · Administration

`admin@pathwise.lk` · desktop

1. **People & access**, then **Add person** (for example a store manager for OUT001): a temporary password is shown once, and signing in with it forces a new password. **Manage** offers a temporary password, a new dock PIN, unlock, sign out everywhere and disable.
2. **Rules & settings** (cutoff, offline threshold, receipt deadline, session lengths, planning budgets), **Data & imports** (upload `submission_task2a.csv`; the forecast marks those weeks *Datathon forecast*), **Audit log** (every action above) and **System health** (database, migrations, row-level security, Supabase).

Clock, then **Reset demo day**, puts everything back to 02:30.

---

## Departures from the Day 5 design

We kept the Day 5 layouts, components, colours and flows. Where the working product differs, it is on purpose.

| Day 5 design | Built product | Why |
|---|---|---|
| A scripted story (VEH041 with four fixed stops, VEH042 failing its pre-trip check, a fixed "plan v2") | The planning engine decides the trips; the vehicle fault is triggered by the judge (loader, *Report a vehicle fault*) | Judges should see the engine plan, not a replay |
| Move a stop because the truck is offline | Move a stop because the **expected** arrival misses the window (traffic, road conditions and the driver's delay report). Offline alone shows "no reason to move" | A phone without signal still delivers; moving on silence alone would be wrong |
| Prototype controls (jump to scenario, device frames) | Real routes per role, a **demo clock** with presets and **Reset demo day**, and a **No signal** switch on the driver phone | The same moments, with real data and state |
| Late-risk and service time from the Datathon ML models | Late risk from expected times (traffic, road conditions and reported holds); service time from `service_allowance.csv`; the forecast accepts the Task 2A file | The Datathon model plugs in through the import |
| Map with exact outlet positions and road routes | Leaflet and OpenStreetMap; outlets placed around their district centre; straight lines between stops | The datasets have no coordinates |
| SMS and push notifications | In-app notifications with a bell for every role, updated live | No messaging provider in scope |

**Beyond the brief:** an Administrator console (people and access, fleet, outlets, rules and settings, data imports, audit log, system health) with password policy and lockout, temporary passwords, sign-out everywhere and email password reset through Supabase.

## Engineering quality

| | Evidence |
|---|---|
| **One rulebook** | `packages/core` is shared by the planner, validator, arrival-time model, forecast and peak-day checker, so they cannot disagree. See the [traceability table](docs/architecture.md#10-quality-scenarios-and-traceability) from each booklet rule to its code and test |
| **Tests** | **68** automated tests: 29 engine tests (including a golden snapshot of every planning decision on the seeded day) and 39 API tests on real PostgreSQL, including the whole judge walkthrough. CI runs them on every push, plus a `docker compose` smoke test |
| **Types and validation** | Strict TypeScript across all three workspaces; every body, query and path parameter parsed with zod; business-rule failures return `409` with a sentence a person can act on and a machine code |
| **Data** | Three versioned SQL migrations, 26 tables with check constraints, indexes and triggers, transactions around every multi-row change, row-level security on every application table, append-only `stop_events` and `audit_log` ([data model](docs/data-model.md)) |
| **Security** | Role and scope checks on every route, bcrypt or Supabase Auth, lockout, token-version revocation, rate limits, a strict CSP, private files behind an access check, a redacted audit log; the browser never holds the Supabase service-role key ([security](docs/security.md)) |
| **Live and offline** | Server-sent events tell each screen what changed, with polling as the fallback. Service worker for the app shell, IndexedDB for the run and the outbox, idempotent batch sync ([when things go wrong](docs/degradation.md)) |

## Repository

```
Cipher_PathWise/
├─ packages/core/       Planning engine, bundled dataset tables, Vitest (29)
├─ apps/api/            Fastify API, SQL migrations, seed, services, routes, Vitest (39)
├─ apps/web/            React PWA: /a admin · /d dispatcher · /l loader · /r driver · /s store
├─ data/                Drop the official dataset CSVs here (git-ignored)
├─ docs/                Architecture, data model, planning, degradation, security, API, Supabase, AI disclosure
├─ scripts/             Laptop runner (embedded PostgreSQL), dataset bundler
├─ Dockerfile           One image: Node 22, API and built web, health on :8080
├─ docker-compose.yml   PostgreSQL 16 and the app; migrates and seeds on start
├─ render.yaml          Render Blueprint for the same image against Supabase
└─ .github/workflows/   CI: build, type check, engine and API tests, compose smoke test
```

## Documentation

| Document | What you will find |
|---|---|
| [Architecture](docs/architecture.md) | Context, use cases, containers, components, data architecture, runtime sequences, deployment, security, decisions and traceability (23 figures) |
| [Data model](docs/data-model.md) | The four domain views of the 26 tables, lifecycles and integrity rules |
| [Planning engine](docs/planning-engine.md) | Trip-time formula, every validation rule, the auto-planner, expected arrival times, forecast |
| [When things go wrong](docs/degradation.md) | Fifteen failure scenarios (A to O) and how the system behaves |
| [Security](docs/security.md) | Accounts and roles, sign-in, sessions, data protection, secrets |
| [API](docs/api.md) | Every endpoint by role |
| [Supabase setup](docs/supabase.md) | Project, keys, Auth, Storage, migrate, seed, deploy |
| [AI disclosure](docs/ai-disclosure.md) | Which work was AI-assisted, which was not, and how the tools were used |
| [User stories](docs/user_stories) | The Designathon user stories for the four roles |
| [Docs index](docs/README.md) | The same list by audience |

## Known limitations

- The planner is greedy with a repair pass: explainable and fast, not guaranteed optimal.
- There is no GPS; "last contact" comes from the phone's sync.
- Live updates run in one app instance (scale-out would move them to PostgreSQL `LISTEN/NOTIFY`).
- The Inter font and map tiles load from the internet; offline, the app falls back to the system font and cached tiles.
- There are no automated UI tests; the judge walkthrough is the acceptance test for the web app.

## Data and privacy

All data is synthetic and was supplied by the Tech-Triathlon organisers for this competition. The raw competition files are not committed: every CSV, ZIP and spreadsheet under `data/` is git-ignored. So that the app starts on any machine, compact tables derived from the reference data are bundled in `packages/core/src/dataset.ts` and `datasetExtra.ts`.

## Credits and licence

Map tiles © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, rendered with [Leaflet](https://leafletjs.com). Typeface: Inter. Icons: [Lucide](https://lucide.dev). Released under the [MIT licence](LICENSE).

**Team Cipher** · Tech-Triathlon 2026 · How AI tools were used: [docs/ai-disclosure.md](docs/ai-disclosure.md)
