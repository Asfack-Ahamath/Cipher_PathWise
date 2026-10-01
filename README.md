# PathWise — Team Cipher

**Delivery planning for Waypoint Group, from the 16:00 order cutoff to the store's receipt.**
One responsive web app for five roles — Administrator, Dispatcher, Loader, Driver and Store Manager — built on the Day 5 PathWise design, running on PostgreSQL or Supabase.

> Tech-Triathlon 2026 · Hackathon · Team **Cipher** · Solution **PathWise**

| | |
|---|---|
| Live demo | `https://<your-deployment>` — see [Deploy](#deploy) (replace this line with your URL) |
| Demo video | `<link>` |
| Docs | [Architecture](docs/architecture.md) · [Supabase setup](docs/supabase.md) · [Security](docs/security.md) · [Data model](docs/data-model.md) · [Planning engine](docs/planning-engine.md) · [When things go wrong](docs/degradation.md) · [API](docs/api.md) · [AI disclosure](docs/ai-disclosure.md) |

---

## What it does

- **Plans a real day.** 143 confirmed orders, 60 vehicles, 120 outlets, two depots. Auto-plan builds trips that respect every constraint — weight and volume, chilled on reefers, van-only outlets, one brand and district per trip, delivery and mall windows, the Fresh 270-minute and Style/Tech 480-minute budgets (booklet formula: outbound + inter-stop × (orders − 1) + service allowance per order), two trips per vehicle, weekly fuel quotas, vehicles in the workshop.
- **Defers honestly.** When demand is higher than capacity, every order that doesn't fit gets a reason code, *forced* or *chosen*, the sentence the store will read, and a new date that skips holidays (Vesak on Fri 1 May). An outlet skipped yesterday is served first today.
- **Checks every change.** Manual moves are re-validated on the spot; publishing is blocked while any rule is broken; every published version is kept with what changed.
- **Runs the dock.** Load lists in reverse stop order, one tablet per trip, shortfall and real-size flags that need a dispatcher decision, trip 2 locked until the truck is back, release only when everything is resolved.
- **Predicts arrivals honestly.** Expected times use `traffic_speed.csv`, `road_conditions.csv`, what was actually delivered so far and any delay the driver reports ("Road closed · 2 h"). A stop is moved only when the *expected* time misses the window — never just because a phone has no signal.
- **Works with no signal.** The driver's phone keeps the run and records every stop, photo and signature offline with the phone's time, then syncs exactly once. If a stop was moved meanwhile, the delivery is kept and turned into a decision — never a silent overwrite.
- **Closes the loop.** The store sees every delivery with an honest ETA, edits or cancels orders before the cutoff, reads deferral notices, and confirms receipt line by line (with photos) against the driver's own count and proof.
- **Datathon-ready.** The Task 2B peak day (S1) is allocated by the same engine and checked with the official feasibility rules, with a one-click submission CSV. The capacity forecast shows actual history and a baseline forecast, and takes the Task 2A submission file as an upload.
- **Production features.** Administration (people, roles and scopes, fleet, outlets, rules and settings, data imports, audit log, system health), password policy and lockout, temporary passwords, sign-out everywhere, email password reset (Supabase), live updates, rate limits, strict security headers, row-level security, private photo storage.

---

## Run it

### With Docker (recommended for judging)

```bash
git clone https://github.com/<you>/Cipher_PathWise.git
cd Cipher_PathWise
docker compose up --build
```

Open **http://localhost:8080**. The first start creates the tables and loads the datasets and the demo day (≈ 10 s). No `.env` is needed. To start again from a clean database: `docker compose down -v && docker compose up --build`.

Official dataset CSVs: unzip the official pack into [`data/`](data/README.md) (either the files directly or the `General Data/` folder) before the first start. Without them the seed uses the copy bundled in `packages/core`.

### With Supabase

Nothing in the code changes — set the environment variables and start the app. Step by step (project, keys, Auth, Storage, migrate, seed, deploy): **[docs/supabase.md](docs/supabase.md)**. The short version is the [checklist below](#what-you-need-to-configure).

### On a laptop with only Node.js (no Docker, no PostgreSQL install)

Needs **Node.js 20 or newer**.

```bash
npm install                 # also downloads a private PostgreSQL for your OS
npm run local               # builds, starts the database from ./.pgdata, serves on http://localhost:8080
```

`npm run local:start` skips the build next time; delete `.pgdata` to start from scratch; `npm run local:dev` runs with hot reload on http://localhost:5173.

### Development with your own PostgreSQL or Supabase

```bash
npm install
cp .env.example .env          # set DATABASE_URL (and the Supabase values if you use it)
npm run db:migrate            # 001_init → 002_production → 003_security
npm run db:seed               # datasets, conditions, accounts (+ demo day in demo mode)
npm run dev                   # API on :8080, web on http://localhost:5173
```

| Script | What |
|---|---|
| `npm test` | planning engine (18) + API tests on a real PostgreSQL (29: walkthrough, security and admin, Supabase Auth/Storage/RLS against a mock) |
| `npm run typecheck` · `npm run build` · `npm start` | checks · production build · serve API + built web on :8080 |
| `npm run db:reset-demo` · `npm run db:conditions` | reload the demo day · reload traffic/road/demand tables |
| `npm run admin:set-password -- <email> <password>` | break-glass local password |

---

## Seeded accounts (demo mode)

Password for every account: **`PathWise@2026`**. The sign-in page has one-tap tiles.

| Role | Sign in with | Who / where | Best on |
|---|---|---|---|
| Administrator | `admin@pathwise.lk` | People, settings, data, audit, health — and everything a dispatcher can do | Desktop |
| Dispatcher | `dispatcher@pathwise.lk` | Nimal Perera · both depots | Desktop |
| Loader | Dock PIN **2468** (Kandy) — or `loader@pathwise.lk` | Kasun Jayasinghe · Kandy DC | Tablet or phone |
| Driver | `driver@pathwise.lk` | Ruwan Bandara · VEH041, reefer truck, Kandy | Phone |
| Store manager | `store@pathwise.lk` | Sanduni Fernando · Waypoint Fresh Kegalle (OUT116) | Phone or PC |

Extra: `loader.peliyagoda@pathwise.lk` (PIN **1357**), `driver.veh039@pathwise.lk`, `store.style@pathwise.lk` (OUT089), `store.tech@pathwise.lk` (OUT024).

**The demo day** is Thursday 30 April 2026. The business clock starts at **02:30** and runs in real time; the dispatcher moves it from the clock chip in the top bar (presets for each step). Use separate browser windows (or private windows) per role; phone-sized windows show the field apps as they look on a phone. Screens update live across windows.

---

## Judge walkthrough

About 15 minutes. Each step names the account, what to press, and what you should see.

**1. Store manager places tomorrow's order** — `store@pathwise.lk`, phone-sized window
1. **Today** shows the confirmed orders for Thu 30 Apr. The chilled dairy order says *carried over, goes first* — this outlet was deferred yesterday.
2. **Order** → next delivery **Sat 2 May** (Fri 1 May is Vesak) with the time left to the cutoff. Add Dairy units → **Place order**. Back on **Today**, *Coming up* lets you **Change** or **Cancel** it until the cutoff.

**2. Dispatcher plans a day where demand is higher than capacity** — `dispatcher@pathwise.lk`, desktop
1. **Overview**: 143 confirmed orders, 56 of 60 vehicles ready, payday, Vesak tomorrow, monsoon.
2. **Plan board → Auto-plan**: 135 of 143 orders, 0 violations. The left column lists the 8 orders it could not fit, each with a reason and the planner's sentence.
3. Break a rule: open **VEH041**, use **⋮** on **OUT116** and move it to a **VEH044** dry truck → *Refrigerated vehicle required*, **Publish** disabled.
4. **Auto-plan** again → **Publish plan → Publish and notify**. **Versions** shows v1 with trips, orders and kg.
5. **Deferrals**: each deferred order with its reason and the exact text the store reads; repeat-skip protection for OUT116, OUT030, OUT079.

**3. Loader loads VEH041 and finds a shortfall** — dock PIN **2468**, tablet
1. Open **VEH041 · Trip 1** (the trip is now claimed by this tablet). Trip 2 trucks show *Truck on Trip 1* and cannot be ticked.
2. Tick every line **except** the dairy line for OUT116 → **Flag** → *Missing*, 10 of 12, *yoghurt cases* → **Send flag**. Release stays locked. (The ⚖ button records goods bigger than ordered.)

**4. Dispatcher decides** — **Exceptions → Short at the dock** → **Send partial** → **Confirm**. Within a second the loader sees the decision → **Release vehicle to driver**.

**5. Driver starts, then reports a delay** — `driver@pathwise.lk`, phone-sized window
1. Dispatcher: clock → **04:55**. Driver: **Start trip**; stop 1 (**OUT116**) → **I've arrived** → **Record delivery** → *Delivered in full* → receiver name, signature → **Save and send**.
2. Dispatcher: clock → **05:35**. Driver: **Report a problem** → *Road closed or blocked* → **2 h** → *Landslide near Kadugannawa* → **Send**. The run now shows the hold, arrival times include it, and the stores down the line are told.
3. Tick **No signal**. Deliver stop 2 — *Saved on phone · waiting to sync* (survives a reload).

**6. Dispatcher decides whether to move a stop** — dispatcher, clock → **05:55**
1. **Live tracking → VEH041**: the road-closure card, *No signal since …*, and expected times — OUT119 now **~08:26 against an 08:00 close**.
2. OUT119 → **Move stop**. The first row is **Keep on VEH041** with that expected time and the reason. Pick a vehicle that arrives in time → **Move to …**. The Kandy loaders are told to load OUT119 on it; the store gets the new ETA. (On a trip with no reported delay whose phone is just out of signal, the same dialog says there is no reason to move the stop.)

**7. The driver delivers it anyway, then gets signal back** — driver
1. Still offline, deliver OUT119 (the road reopened; the phone doesn't know about the move).
2. Untick **No signal** → *Back online*, **Your route changed** (→ **Got it**) and *Check one stop* → **Goods handed to the store**.

**8. Dispatcher resolves the sync conflict** — **Exceptions → VEH041 synced a delivery at OUT119 that was moved**: delivery time, receiver, move time and the driver's answer → **Keep VEH041's delivery**. Driver: **All stops done · close trip** (a stop without an outcome would need a reason).

**9. Store confirms receipt** — store, clock → **08:30**
1. **Today**: *Delivered*, receiver and vehicle. **Notices**: *2 units … move to Sat 2 May* → **Got it**.
2. **Receive**: *See the driver's proof* (signature, photo, the driver's count). Mark dairy **Short** by one, add a photo if you like → **Send receipt with 1 issue**. Dispatcher: **Exceptions → OUT116 reported short on receipt** → **Replace on the next run** or **Credit**.

**10. Look ahead** — dispatcher: **Capacity forecast** (actual history and forecast weeks against usable reefer capacity, per depot) and **Peak-day lab** (Task 2B S1: 70 of 85 served, feasible under every official rule, **Download submission CSV**).

**11. Administration** — `admin@pathwise.lk`
1. **People → Add person** (e.g. a store manager for OUT001) → a temporary password is shown once; signing in with it forces a new password. **Manage** → temporary password, new dock PIN, unlock, sign out everywhere, disable.
2. **Rules & settings** (cutoff, offline threshold, receipt deadline, session lengths, planning budgets) · **Data & imports** (upload `submission_task2a.csv`; the forecast marks those weeks *Datathon forecast*) · **Audit log** (every action above) · **System health** (database, migrations, row-level security, Supabase).

Clock → **Reset demo day** puts everything back to 02:30 (people, settings and the audit log are kept).

---

## What you need to configure

Everything is implemented; these are the values only you can provide. Full detail: [docs/supabase.md](docs/supabase.md).

**Supabase**
- [ ] Create a project (region near Sri Lanka) and keep the database password.
- [ ] Authentication → Email provider on, **new sign-ups off**; URL configuration: Site URL = your app URL, Redirect URL = `https://<app>/login`.
- [ ] Optional: your own SMTP for reset emails.
- [ ] Storage: nothing — the API creates the private `pathwise-proofs` bucket.

**Environment variables** (host settings or `.env`, never in git)
- [ ] `DATABASE_URL` = Supabase *Session pooler* URI (port 5432) and `DATABASE_SSL=true`
- [ ] `AUTH_PROVIDER=supabase`, `STORAGE_PROVIDER=supabase`
- [ ] `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (server only)
- [ ] `JWT_SECRET` = `openssl rand -base64 48`
- [ ] `APP_URL` = public URL; `TRUST_PROXY=true` behind Render/Fly/Railway; `CORS_ORIGINS` only if the web app is on another domain
- [ ] `ADMIN_EMAIL`, `ADMIN_PASSWORD` (10+ chars, a letter and a number)
- [ ] `DEMO_MODE=true` for judging (demo accounts, clock, reset) — `false` for real use

**Database**
- [ ] `npm run db:migrate && npm run db:seed` from your laptop with the Supabase `DATABASE_URL`, or just start the app once (`SEED_ON_START=true`).
- [ ] Check: Table editor (outlets 120, vehicles 60, calendar 910), Authentication → Users, RLS enabled on every table, Admin → System health all green.

**Deploy**
- [ ] Private GitHub repo; add the judges. Keep `data/` CSVs out of git (already ignored).
- [ ] Render → New → Blueprint → paste the `sync: false` values from `render.yaml` (or any Docker host: port 8080, health `GET /api/health`).
- [ ] Put the live URL and the video link at the top of this README.

---

## Repository

```
Cipher_PathWise/
├─ packages/core/        Planning engine (pure TypeScript): schedule, validate, autoPlan, ETA, forecast, peak-day checker · unit tests
├─ apps/api/             Fastify API: migrations, seed, services, routes, Supabase Auth/Storage adapters · API tests
├─ apps/web/             React 19 + Vite + Tailwind PWA: admin (/a), dispatcher (/d), loader (/l), driver (/r), store (/s)
├─ data/                 Drop the official dataset CSVs here (git-ignored)
├─ docs/                 Architecture, Supabase, security, data model, planning engine, degradation, API, AI disclosure
├─ scripts/              Laptop runner (embedded PostgreSQL), dataset bundler
├─ Dockerfile            One image: API + built web app
├─ docker-compose.yml    PostgreSQL + app, migrations and seed on start
├─ render.yaml           Deploy on Render against Supabase
└─ .github/workflows/    CI: build, typecheck, engine tests, API tests on Postgres, docker compose smoke test
```

## Engineering notes

- **One language, one rulebook.** TypeScript end to end; `packages/core` is shared by the planner, the validator, the ETA model, the forecast and the peak-day checker, so they cannot disagree.
- **Plain SQL, versioned, constrained.** Three migrations with check constraints, indexes, triggers and row-level security; transactions around every multi-row change; append-only `stop_events` and `audit_log`.
- **Validation at the edge.** Every body, query and parameter is parsed with zod; business-rule failures return `409` with a sentence a person can act on and a machine code.
- **Security.** See [security.md](docs/security.md): roles and scopes on every route, bcrypt or Supabase Auth, lockout, token-version revocation, rate limits, CSP, private files with access checks, redacted audit log.
- **Live.** Server-Sent Events tell each screen what changed; polling stays as the fallback.
- **Offline.** Service worker for the app shell, IndexedDB for the run and the outbox, idempotent batch sync. See [degradation.md](docs/degradation.md).
- **Tests.** 47 automated tests plus a browser run of this walkthrough on desktop, tablet and phone sizes.

## Deploy

**Render + Supabase:** push to a private GitHub repo → Render → *New → Blueprint* → paste the values `render.yaml` asks for. The app migrates, prepares the bucket and seeds itself on first start.

**Any Docker host (Railway, Fly.io, a VM):** build the `Dockerfile`, set the variables above, expose port 8080. Health check: `GET /api/health`.

---

## Departures from the Day 5 design

We kept the Day 5 layouts, components, colours and flows. Where the working product differs, it is on purpose:

| Day 5 design | Built product | Why |
|---|---|---|
| A scripted story (VEH041 with four fixed stops, VEH042 failing its pre-trip check, a fixed "plan v2") | The planning engine decides the trips; the vehicle fault is triggered by the judge (loader → *Report a vehicle fault*). | Judges should see the engine plan, not a replay. |
| Move a stop because the truck is offline | Move a stop because the **expected** arrival misses the window (traffic, road conditions and the driver's delay report). Offline alone shows "no reason to move". | A phone without signal still delivers; moving on silence alone would be wrong. |
| Prototype controls (jump to scenario, device frames) | Real routes per role and a **demo clock** with presets and **Reset demo day**; a **No signal** switch on the driver phone. | Same moments, real data and state. |
| Late-risk and service time from the Datathon ML models | Late risk from expected times (traffic + road conditions + reported holds); service time from `service_allowance.csv`; the forecast accepts the Task 2A file. | The Datathon model plugs in through the import. |
| Map with exact outlet positions and road routes | Leaflet + OpenStreetMap; outlets placed around their district centre; straight lines between stops. | The datasets have no coordinates. |
| SMS / push notifications | In-app notifications with a bell for every role, updated live. | No messaging provider in scope. |

## Known limitations

- The planner is greedy with a repair pass: explainable and fast, not guaranteed optimal.
- There is no GPS; "last contact" comes from the phone's sync.
- Live updates run in one app instance (scale-out would move them to Postgres LISTEN/NOTIFY).
- The Inter font and map tiles load from the internet; offline the app falls back to the system font and cached tiles.

## Data and privacy

The competition datasets must not be shared with any third party. CSVs under `data/` are git-ignored; derived rows are bundled in `packages/core/src/dataset.ts` and `datasetExtra.ts` so the app always starts. **Keep this repository private** and add only the judges, or remove those files before making anything public.

---

Team Cipher · Tech-Triathlon 2026 · See [docs/ai-disclosure.md](docs/ai-disclosure.md) for how AI tools were used.
