# Running PathWise on Supabase

PathWise uses Supabase **behind its own API**:

```
Browser / phone ──HTTPS──▶ PathWise API (Node, Docker) ──▶ Supabase Postgres   (all data, via DATABASE_URL)
                                                      ├──▶ Supabase Auth       (password checks, resets)
                                                      └──▶ Supabase Storage    (proof photos, private bucket)
```

- The browser never talks to Supabase and never holds a Supabase key. Business rules, roles and validation
  stay in one place (the API).
- The API connects to Postgres as the table owner, so it is not limited by row-level security; it enforces
  roles itself on every route.
- Migration `003_security.sql` still turns row-level security on for **every** table and adds read-only
  policies, so Supabase's public Data API (PostgREST) cannot be used to read or change data even if the anon key
  leaks: `anon` gets nothing; a signed-in Supabase user only reads their own rows; nobody can write.

Everything below is done once. Nothing in the code changes — only environment variables.

---

## 1. Create the project

1. <https://supabase.com/dashboard> → **New project**. Pick the region closest to Sri Lanka (e.g. *Mumbai* or *Singapore*).
2. Set a strong **database password** and keep it — it goes into `DATABASE_URL`.

## 2. Collect the values

| Where in Supabase | What | Environment variable |
|---|---|---|
| **Connect** (top bar) → *Session pooler* → URI | `postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres` | `DATABASE_URL` |
| Same string | TLS is required | `DATABASE_SSL=true` |
| **Project Settings → Data API** → Project URL | `https://<ref>.supabase.co` | `SUPABASE_URL` |
| **Project Settings → API Keys** → `anon` / publishable | public key | `SUPABASE_ANON_KEY` |
| **Project Settings → API Keys** → `service_role` / secret | **server-only secret** | `SUPABASE_SERVICE_ROLE_KEY` |

Use the **Session pooler** (port 5432), not the Transaction pooler (6543): the API holds a small connection pool
and uses transactions across statements. Replace `<password>` with your database password (URL-encode special
characters, e.g. `@` → `%40`).

## 3. Configure Auth

1. **Authentication → Sign In / Providers → Email**: enabled. Turn **off** "Allow new users to sign up" —
   PathWise accounts are created only by the seed and by administrators (Admin → People).
2. **Authentication → URL Configuration**: *Site URL* = your app URL (e.g. `https://pathwise.onrender.com`);
   add `https://<your-app>/login` to *Redirect URLs*. Password-reset links land there and the sign-in page
   finishes the reset.
3. Optional: **Authentication → Emails → SMTP** — set your own SMTP server; Supabase's built-in sender is
   rate-limited to a few emails an hour.

## 4. Storage

Nothing to do: on first start the API creates a **private** bucket `pathwise-proofs` (5 MB limit, JPEG/PNG/WebP
only). Photos are served only through the API, which checks who may see each one and then redirects to a
signed URL that expires after 5 minutes. Use `SUPABASE_STORAGE_BUCKET` for a different name.

## 5. Set the environment

In `.env` (local) or your host's settings:

```bash
DATABASE_URL=postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres
DATABASE_SSL=true
DATABASE_POOL_MAX=8

AUTH_PROVIDER=supabase
STORAGE_PROVIDER=supabase
SUPABASE_URL=https://<ref>.supabase.co
SUPABASE_ANON_KEY=<anon key>
SUPABASE_SERVICE_ROLE_KEY=<service_role key>

JWT_SECRET=<openssl rand -base64 48>
APP_URL=https://<your-app>
ADMIN_EMAIL=you@yourcompany.lk
ADMIN_PASSWORD=<10+ characters, a letter and a number>

DEMO_MODE=true          # judging: demo accounts, demo clock, reset. Use false for a real rollout.
TRUST_PROXY=true        # behind Render / Fly / Railway
```

## 6. Create the tables and load the data

Either let the app do it on its first start (`SEED_ON_START=true`, the default), or run it yourself from your laptop:

```bash
npm install
npm run db:migrate      # 001_init, 002_production, 003_security (row-level security)
npm run db:seed         # datasets, traffic/road conditions, demand history, accounts (+ demo day in demo mode)
```

With `AUTH_PROVIDER=supabase` the seed creates each account in Supabase Auth (or links an existing one with the
same email) and stores no password hash locally. Loaders' dock PINs stay in PathWise.

Check it worked:

- **Table editor**: `outlets` 120 rows, `vehicles` 60, `calendar` 910, `traffic_speed` 576.
- **Authentication → Users**: the administrator (and the 8 demo accounts in demo mode).
- **Database → Tables → RLS**: every table shows *RLS enabled*.
- Sign in as the administrator → **Admin → System health**: database, Supabase Auth and Storage all green.

## 7. Deploy the app

Any Docker host works. With Render: push to a **private** GitHub repo → Render → *New → Blueprint* → pick the
repo → paste the values `render.yaml` asks for → *Apply*. Health check: `GET /api/health`.

## Useful commands

| Task | Command |
|---|---|
| Reload the demo day (demo mode) | Admin → Data → *Reset demo day*, or `npm run db:reset-demo` |
| Reload traffic, road and demand tables | `npm run db:conditions` |
| Set a local password (break-glass, `AUTH_PROVIDER=local`) | `npm run admin:set-password -- admin@pathwise.lk 'NewPass2026x'` |

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `self-signed certificate` / `SSL required` on start | Set `DATABASE_SSL=true`. |
| `password authentication failed for user "postgres"` | Pooler user is `postgres.<project-ref>`, not `postgres`; check the password encoding. |
| `Configuration error: SUPABASE_SERVICE_ROLE_KEY is required` | A Supabase provider is on but the key is missing. |
| Sign-in says *Sign-in service is not reachable* | `SUPABASE_URL` / `SUPABASE_ANON_KEY` wrong, or the project is paused. |
| Reset emails never arrive | Built-in email sender rate limit — configure SMTP (step 3). |
| Photos fail to upload | Admin → System health → Storage; the service key must be the `service_role` key. |
