# PathWise — Team Cipher

**Delivery planning for Waypoint Group, from the 16:00 order cutoff to the store's receipt.**
One responsive web app for four roles — Dispatcher, Loader, Driver and Store Manager — built on the Day 5 PathWise design.

> Tech-Triathlon 2026 · Hackathon · Team **Cipher** · Solution **PathWise**

| | |
|---|---|
| Live demo | [PathWise on Render](https://pathwise.onrender.com) — see [Deploy](#deploy) |
| Documentation | [Architecture](docs/architecture.md) · [Data model](docs/data-model.md) · [Planning engine](docs/planning-engine.md) · [When things go wrong](docs/degradation.md) · [API](docs/api.md) · [AI disclosure](docs/ai-disclosure.md) |
| License | [MIT](LICENSE) |
| Contributing | [Guidelines](CONTRIBUTING.md) |

---

## What it does

- **Plans a real day.** 143 confirmed orders, 60 vehicles, 120 outlets, two depots. Auto-plan builds trips that respect every constraint — weight and volume, chilled on reefers, van-only outlets, one brand and district per trip, delivery and mall windows, the Fresh 270-minute and Style/Tech 480-minute budgets, two trips per vehicle, weekly fuel quotas, vehicles in the workshop.
- **Defers honestly.** When demand is higher than capacity (it is: chilled demand is 124 m³ and the working reefers can carry 106 m³ that morning), every order that doesn't fit gets a reason code, *forced* or *chosen*, the sentence the store will read, and a new date that skips holidays (Vesak on Fri 1 May). An outlet skipped yesterday is served first today.
- **Checks every change.** Move an order by hand and the plan is re-validated on the spot; publishing is blocked while any rule is broken.
- **Runs the dock.** The loader gets the load list in reverse stop order, ticks lines, flags shortfalls for a dispatcher decision, and cannot release until everything is resolved.
- **Works with no signal.** The driver's phone keeps the run and records every stop, photo and signature offline with the phone's time, then syncs exactly once. If the dispatcher moved a stop meanwhile, the delivery is kept and turned into a decision — never a silent overwrite.
- **Closes the loop.** The store sees an honest ETA (marked *estimated* when the driver is offline), reads deferral notices, and confirms receipt line by line against the driver's proof; problems become exceptions.

---

## Run it

### With Docker (recommended)

```bash
git clone https://github.com/<you>/Cipher_PathWise.git
cd Cipher_PathWise
docker compose up --build
```

Open **http://localhost:8080**. The first start creates the tables and seeds the datasets and the demo day (≈ 10 s). No `.env` is needed; copy `.env.example` to `.env` to change ports, passwords or the demo clock.

Official dataset CSVs: drop `outlets.csv`, `vehicles.csv`, `district_travel.csv`, `service_allowance.csv` and `calendar.csv` into [`data/`](data/README.md) before the first start. Without them the seed uses the copy bundled in `packages/core`.

To start again from a clean database: `docker compose down -v && docker compose up --build`. To reset just the demo day, use **Reset demo day** in the dispatcher's clock menu.

### On a laptop with only Node.js (no Docker, no PostgreSQL install)

Needs **Node.js 20 or newer** (https://nodejs.org, LTS). Windows, macOS and Linux.

```bash
cd Cipher_PathWise          # the folder that has package.json, not apps/
npm install                 # also downloads a private PostgreSQL for your OS
npm run local               # builds, starts the database from ./.pgdata, serves on http://localhost:8080
```

The first start sets up and seeds the database (about a minute including the build). Stop with **Ctrl+C**; next time use `npm run local:start` to skip the build (your data is kept in `.pgdata`). Delete the `.pgdata` folder to start from scratch. `npm run local:dev` runs the same database with hot reload on http://localhost:5173. If port 8080 or 5499 is taken, set `PORT` or `LOCAL_PG_PORT`.

### Without Docker, with your own PostgreSQL (development)

Needs Node 20+ and PostgreSQL 14+.

```bash
npm install
cp .env.example .env            # set DATABASE_URL to your Postgres
createdb pathwise               # or use any empty database
npm run dev                     # API on :8080 (migrates + seeds), web on http://localhost:5173
```

Other scripts: `npm run build`, `npm test` (planning engine + API walkthrough against `DATABASE_URL`), `npm run typecheck`, `npm run db:seed`, `npm start` (serves API + built web on :8080).

---

## Seeded accounts

Password for every account: **`PathWise@2026`**. The sign-in page has one-tap tiles for the four main accounts.

| Role | Sign in with | Who / where | Best on |
|---|---|---|---|
| Dispatcher | `dispatcher@pathwise.lk` | Nimal Perera · both depots | Desktop |
| Loader | Dock PIN **2468** (Kandy) — or `loader@pathwise.lk` | Kasun Jayasinghe · Kandy DC | Tablet or phone |
| Driver | `driver@pathwise.lk` | Ruwan Bandara · VEH041, reefer truck, Kandy | Phone |
| Store manager | `store@pathwise.lk` | Sanduni Fernando · Waypoint Fresh Kegalle (OUT116) | Phone or PC |

Extra accounts for exploring: `loader.peliyagoda@pathwise.lk` (PIN **1357**, Peliyagoda), `driver.veh039@pathwise.lk` (VEH039), `store.style@pathwise.lk` (OUT089, Style), `store.tech@pathwise.lk` (OUT024, Tech).

**The demo day** is Thursday 30 April 2026. The business clock starts at **02:30** and runs in real time; the dispatcher can move it from the clock chip in the top bar (presets for each step below). Use separate browser windows (or a private window) for each role so they stay signed in side by side; phone-sized windows show the field apps as they would look on a phone.

---

## Judge walkthrough

About 15 minutes. Each step names the account, what to press, and what you should see.

**1. Store manager places tomorrow's order** — `store@pathwise.lk`, phone-sized window
1. **Today** shows two confirmed orders for Thu 30 Apr. The chilled dairy order says *carried over, goes first* — this outlet was deferred yesterday.
2. **Order** → the order window says the next delivery is **Sat 2 May** (Fri 1 May is Vesak) with the time left to the 16:00 cutoff. Add a few Dairy units → **Place order**. A confirmation shows the delivery day, weight and volume.

**2. Dispatcher plans a day where demand is higher than capacity** — `dispatcher@pathwise.lk`, desktop
1. **Overview**: 143 confirmed orders, 56 of 60 vehicles ready (4 in the workshop), payday, Vesak tomorrow, monsoon.
2. **Plan board → Auto-plan**. About a second later: **135 of 143 orders on 37 trips, 0 violations**. The left column lists the 8 orders it could not fit, each with a reason (*No refrigerated capacity · chosen*) and the planner's sentence.
3. Break a rule on purpose: open **VEH041** (Kegalle), use the **⋮** menu on **OUT116** and move it to a **VEH044** dry truck. The validation panel opens with *Refrigerated vehicle required* in red, and **Publish** is disabled.
4. Press **Auto-plan** again (or **Discard draft** and re-run) → 0 violations → **Publish plan → Publish and notify**.
5. **Deferrals**: each deferred order with its reason, forced/chosen, and a preview of exactly what the store manager reads. The green box shows repeat-skip protection: OUT116, OUT030 and OUT079 (deferred yesterday) are served today.

**3. Loader loads VEH041 and finds a shortfall** — dock PIN **2468**, tablet or phone
1. The dock queue lists Kandy trips by departure. Open **VEH041 · Trip 1**.
2. Lines are in reverse stop order (last stop first, first stop at the door). Tick every line **except** *Dairy — 6 yoghurt cases + dairy* (OUT116).
3. On that line press **Flag** → *Missing*, units loaded **10** of 12, *yoghurt cases* → **Send flag**. The release button stays locked: *Waiting for the dispatcher's decision*.

**4. Dispatcher decides** — dispatcher
1. The bell and **Exceptions** show *Short at the dock — VEH041 Trip 1*. Choose **Send partial · defer 2 yoghurt cases to the next run** → **Confirm decision**.
2. On the loader's screen (within ~5 s) the decision appears and the line turns green. Press **Release vehicle to driver**.

**5. Driver starts the run and loses signal** — `driver@pathwise.lk`, phone-sized window
1. Dispatcher: clock chip → **04:55 · On the road** → **Set clock** (so the phone's times look like the real morning).
2. Driver: **Start trip** (it was locked until the loader released). The first stop shows *Short from depot: OUT116 gets 10 of 12. The store knows.*
3. Open stop 1 (**OUT116**) → **I've arrived** → **Record delivery** → *Delivered in full* → type a receiver name, sign with the mouse or finger → **Save and send**.
4. Tick **No signal** in the grey bar (or switch the phone to airplane mode / DevTools → Offline). The header turns grey.
5. Deliver stop 2 the same way. It shows **Saved on phone · waiting to sync** and the bar counts the records waiting. You can even reload the page — the run and the saved records are still there.

**6. Dispatcher moves a stop while the driver is offline** — dispatcher
1. Clock → **05:55 · Move a stop**.
2. **Live tracking** → **VEH041**: *No signal since …*, last contact, and a dashed marker where the plan says the truck is.
3. On the last stop (OUT119) press **Move stop**. Every option is checked against the rules with its ETA; pick a valid one → **Move stop**. Both drivers and the store are notified, and the new ETA is shown to the store.

**7. The driver delivers it anyway, then gets signal back** — driver
1. Still offline, deliver the last stop (the phone doesn't know it was moved). *Saved on phone.*
2. Untick **No signal**. **Back online · n records synced**, and a card: *Check one stop — you recorded a delivery offline for a stop the dispatcher had moved.* Answer **Goods handed to the store**.

**8. Dispatcher resolves the sync conflict** — dispatcher
1. **Exceptions → VEH041 synced a delivery at OUT119 that was moved**: the delivery time, receiver, when you moved it and the driver's answer. Nothing was overwritten.
2. **Keep VEH041's delivery** → **Confirm decision**. The other vehicle is told to skip the stop.
3. Driver: the stop is back in the run as delivered → **All stops done · close trip → Close trip**.

**9. Store manager confirms receipt and reports a problem** — store
1. **Today**: *Delivered hh:mm*, receiver and vehicle. **Notices**: *2 units of your chilled order move to Sat 2 May* with the plain reason → **Got it**.
2. **Receive**: *See the driver's proof* shows the photo and signature. Mark the dairy line **Short** with one unit fewer → **Send receipt with 1 issue**.
3. Dispatcher: **Exceptions → OUT116 reported short on receipt** → **Replace on the next run** (a replacement order is created for Sat 2 May) or **Credit the store**.

**10. Look ahead** — dispatcher: **Capacity forecast** shows chilled demand against usable reefer capacity week by week from `calendar.csv` (paydays, festival ramp, Poya days, monsoon). Clock → **Reset demo day** puts everything back to 02:30.

Also worth trying: the loader's **Report a vehicle fault → Cannot leave** and the dispatcher's **Swap to another vehicle**; a driver outcome of *Outlet closed* (photo + recommendation → exception); **Add phone order** on the order queue; the depot filter in the top bar.

---

## Repository

```
Cipher_PathWise/
├─ packages/core/        Planning engine (pure TypeScript): schedule, validate, autoPlan, datasets, demo day · unit tests
├─ apps/api/             Fastify API + PostgreSQL: migrations, seed, services, routes · end-to-end walkthrough test
├─ apps/web/             React 19 + Vite + Tailwind PWA: dispatcher (/d), loader (/l), driver (/r), store (/s)
├─ data/                 Drop the official dataset CSVs here (git-ignored)
├─ docs/                 Architecture, data model, planning engine, degradation, API, AI disclosure
├─ Dockerfile            One image: API + built web app
├─ docker-compose.yml    PostgreSQL + app, migrations and seed on start
├─ render.yaml           One-click deploy on Render
└─ .github/workflows/    CI: build, typecheck, engine tests, API tests on Postgres, docker compose smoke test
```

## Engineering notes

- **Monorepo, one language.** TypeScript end to end with npm workspaces; strict mode everywhere.
- **Rules live in one place.** `packages/core` is pure and shared by the planner, the validator, the API and the forecast, so they cannot disagree. See [planning-engine.md](docs/planning-engine.md).
- **Plain SQL, versioned.** Migrations in `apps/api/src/migrations`, applied on start. Transactions around every multi-row change. Append-only `stop_events` and `audit_log`.
- **Validation at the edge.** Every request body is parsed with zod; business rule failures return `409` with a sentence a person can act on.
- **Security.** bcrypt passwords and dock PINs, JWT (HS256) with a secret from the environment, role guards on every route, loaders scoped to their depot, store managers to their outlet, drivers to their vehicle.
- **Tests.** `packages/core/test` (planner on the seeded day) and `apps/api/test/walkthrough.test.ts` (this walkthrough, end to end, on a real PostgreSQL). CI runs both plus a `docker compose up` smoke test.
- **Offline.** Service worker for the app shell (vite-plugin-pwa / Workbox), IndexedDB for the run and the outbox, idempotent batch sync. See [degradation.md](docs/degradation.md).

## Deploy

**Render (free tier):** push the repo to GitHub → Render → *New → Blueprint* → select the repo. `render.yaml` creates the PostgreSQL database and the Docker web service; the app migrates and seeds itself on first start. Add the URL at the top of this README.

**Any Docker host (Railway, Fly.io, a VM):** build the `Dockerfile`, set `DATABASE_URL` and `JWT_SECRET` (and `DATABASE_SSL=true` if your managed Postgres requires TLS), expose port 8080. Health check: `GET /api/health`.

---

## Departures from the Day 5 design

We kept the Day 5 layouts, components, colours and flows. Where the working product differs, it is on purpose:

| Day 5 design | Built product | Why |
|---|---|---|
| A scripted story: VEH041 with four stops (OUT117, OUT118, OUT116, OUT119), VEH042 failing its pre-trip check, a fixed "plan v2" | The planning engine decides the trips. On the seeded day the Kegalle outlets are split by the engine (VEH041 carries OUT116, OUT117, OUT119). The pre-trip failure is something the judge triggers (loader → *Report a vehicle fault*) rather than pre-baked. | Judges should see the engine plan, not a replay. |
| Prototype controls ("jump to scenario", device frames, prototype phase bar) | Real routes per role and a **demo clock** in the dispatcher's top bar with presets and **Reset demo day**. The driver has a **No signal** switch. | The same moments are reachable with real data and real state. |
| Late-risk and service time from the Datathon ML models | Late risk = under 15 minutes of slack in the schedule; service time from `service_allowance.csv`; the forecast uses calendar multipliers. The hooks (`lateRisk`, forecast endpoint) are where the Datathon model plugs in. | The Datathon model is not part of this submission. |
| Map with exact outlet positions and road routes | Leaflet + OpenStreetMap; outlets at stable positions around their district centre; straight lines between stops. | The datasets have no coordinates. |
| Plan versions (v1 → v2) with a full diff screen | Republishing marks each changed trip with what moved; the loader acknowledges before release and drivers/stores get a notification. | Same guarantee (no silent swaps) with less UI. |
| Loader: concurrent-session banner, per-line physical-size flag, overload hard block at the dock | Live weight/volume bars on the load screen; overloads are prevented at planning time by the validator. | Time; the validator already makes an overloaded trip impossible to publish. |
| SMS / push notifications | In-app notifications with a bell for every role. | No messaging provider in scope. |
| Proof photos in object storage | Photos are compressed on the phone (≤ 800 px JPEG) and stored in PostgreSQL. | One fewer service to run for the judges. |

## Known limitations

- The planner is greedy with a repair pass: explainable and fast, not guaranteed optimal.
- Times are district-level averages from the dataset; there is no live GPS (last contact comes from the phone's sync).
- The Inter font loads from Google Fonts; with no connection the app falls back to the system font.

## Data and privacy

The competition datasets must not be shared with third parties. The CSVs in `data/` are git-ignored, but a copy of the rows is bundled in `packages/core/src/dataset.ts` so the app always starts. **Keep this repository private** and add the judges as collaborators, or remove that file before making anything public.

---

Team Cipher · Tech-Triathlon 2026 · See [docs/ai-disclosure.md](docs/ai-disclosure.md) for how AI tools were used.
