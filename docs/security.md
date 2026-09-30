# Security

## Accounts and roles

| Role | Reaches | Scope |
|---|---|---|
| Administrator | `/a` admin area + everything a dispatcher can do | all |
| Dispatcher | `/d` planning, tracking, exceptions, forecast, peak-day lab | both depots |
| Loader | `/l` dock queue and loading | own depot only |
| Driver | `/r` own run and sync | own vehicle (and a trip it took over after a swap) |
| Store manager | `/s` orders, deliveries, receipts | own outlet only |

Every API route declares the role(s) it needs (`routes/util.ts → guard`), and every service re-checks scope
(a store manager asking for another outlet's order gets *not found*; a driver syncing another vehicle's trip is rejected).
The web app's route guards only mirror this — the API is the authority.

## Sign-in

- **Passwords**: bcrypt (cost 12) in `users` with `AUTH_PROVIDER=local`, or Supabase Auth with `AUTH_PROVIDER=supabase`.
  Policy: at least 10 characters with a letter and a number.
- **Dock PINs** (shared loader tablets): 4–6 digits, bcrypt-hashed, unique per depot, always checked by PathWise.
- **Lockout**: 5 wrong passwords lock the account for 15 minutes (admins can unlock). Unknown emails take the
  same time to answer as known ones, and the reset form answers identically for both (no account discovery).
- **Rate limits**: 30 sign-in attempts a minute per address; 600 API requests a minute per signed-in person.
- **Temporary passwords**: accounts created or reset by an admin must choose their own password first; every other
  API call answers `403 password_change_required` until they do.

## Sessions

- The API issues its own HS256 token (`JWT_SECRET`) with the user id, role and a **token version**; 12 h for office
  roles, 24 h for drivers (configurable in Admin → Settings).
- Every request re-reads the user (cached 20 s): disabling an account, changing a role or scope, resetting a password
  or pressing *Sign out everywhere* bumps the token version and ends every session within seconds.
- Live updates use a separate 60-second ticket that cannot be used as a session token.
- Production refuses to start without a random `JWT_SECRET` (32+ characters) when `DEMO_MODE=false`.

## Data protection

- **Row-level security** is on for every table (`003_security.sql`). On Supabase, `anon` has no access and signed-in
  Supabase users can only read their own rows; nobody can write through the Data API. The browser never receives a
  Supabase key.
- **Files**: photos and signatures are checked on upload (JPEG/PNG/WebP by magic number, ≤ 5 MB) and served only through
  `/api/files/:id` after an access check (office roles; the outlet's store manager; the trip's driver; loaders of that depot).
  In Supabase Storage the bucket is private and links are signed for 5 minutes.
- **Audit log**: every sign-in, failed sign-in, change and decision, with who and when. Passwords, PINs, tokens and
  image data are redacted before writing. Reset demo day never deletes it.
- **Headers**: Helmet with a strict Content-Security-Policy (only this origin, the map tiles, Google Fonts and the
  Supabase project), `frame-ancestors 'none'`, `nosniff`, HSTS in production. CORS is same-origin unless `CORS_ORIGINS` lists more.
- **Input**: every body, query and path parameter is validated with zod; SQL is parameterised everywhere.
- **Errors**: clients get a sentence and a code; stack traces stay in the server log. Authorization headers and
  tickets are redacted from logs.

## Secrets checklist

| Secret | Where it lives | Never |
|---|---|---|
| `JWT_SECRET` | host environment | in git, in the web app |
| `SUPABASE_SERVICE_ROLE_KEY` | host environment | in git, in the web app, in logs |
| Database password (in `DATABASE_URL`) | host environment | in git |
| `ADMIN_PASSWORD` | host environment, first start only | reused elsewhere |

The competition datasets are confidential: the repository must stay private (see `data/README.md`).
