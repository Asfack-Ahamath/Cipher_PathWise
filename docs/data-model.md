# Data model

PostgreSQL 16. Schema in [`apps/api/src/migrations/001_init.sql`](../apps/api/src/migrations/001_init.sql), applied by the API on start (`schema_migrations` tracks what ran).

```mermaid
erDiagram
  OUTLETS ||--o{ ORDERS : places
  OUTLETS ||--o{ USERS : "store manager of"
  VEHICLES ||--o{ TRIPS : runs
  VEHICLES ||--o{ USERS : "driver of"
  VEHICLES ||--o| VEHICLE_PRESENCE : "last seen"
  ORDERS ||--o{ TRIP_ORDERS : "loaded as"
  TRIPS ||--o{ TRIP_ORDERS : carries
  ORDERS ||--o{ DEFERRALS : "moved by"
  PLANS ||--o{ DEFERRALS : "decided in"
  ORDERS ||--o| ORDERS : "remainder of"
  TRIPS ||--o{ STOP_MOVES : "from / to"
  ORDERS ||--o{ STOP_MOVES : moved
  TRIPS ||--o{ STOP_EVENTS : "phone records"
  STOP_EVENTS ||--o| PODS : "proof of"
  ORDERS ||--o{ RECEIPTS : "confirmed by store"
  TRIPS ||--o{ EXCEPTIONS : raises
  ORDERS ||--o{ EXCEPTIONS : about
  NOTIFICATIONS ||--o{ NOTIFICATION_READS : "read by"
  USERS ||--o{ AUDIT_LOG : did

  OUTLETS { text id PK "OUT001" text brand "Fresh|Style|Tech" text district text depot text dock "rear_dock|street|mall_bay" text parking bool van_only text open_time text close_time text mall_window }
  VEHICLES { text id PK "VEH001" text type "truck|van" text temp "reefer|ambient" text depot numeric weight_cap numeric volume_cap numeric km_per_l numeric fuel_quota_l numeric fuel_used_l text status "available|in_workshop" text driver_name }
  DISTRICT_TRAVEL { text depot PK text district PK int out_min int inter_min numeric out_km numeric inter_km text road_class }
  SERVICE_ALLOWANCE { text brand PK text dock PK int minutes }
  CALENDAR { date date PK bool is_operating text holiday bool is_payday numeric festival_ramp bool monsoon text iso_week }
  USERS { serial id PK text email text role "dispatcher|loader|driver|store_manager" text depot text outlet_id FK text vehicle_id FK text pin_hash }
  ORDERS { text id PK "ORD0093171" text outlet_id FK date delivery_date text temp "ambient|chilled" int units numeric kg numeric m3 jsonb lines text status bool after_cutoff bool deferred_yesterday int days_since_served text parent_order_id FK }
  PLANS { serial id PK date plan_date int version text status "draft|published|superseded" text source jsonb trips jsonb deferrals }
  TRIPS { serial id PK date plan_date text vehicle_id FK int trip_no text depart text status "planned|loading|released|in_progress|completed|blocked|cancelled" text swapped_from timestamptz changed_at int ack_version }
  TRIP_ORDERS { int trip_id PK text order_id PK int seq text load_status "pending|loaded|flagged|removed" int loaded_units text flag_reason timestamptz moved_at }
  STOP_MOVES { serial id PK text order_id FK text outlet_id int from_trip_id FK int to_trip_id FK timestamptz moved_at text reason }
  DEFERRALS { serial id PK text order_id FK date from_date date to_date text reason text kind "forced|chosen" text why int units bool escalated timestamptz notified_at timestamptz acknowledged_at }
  STOP_EVENTS { serial id PK uuid client_event_id UK int trip_id FK text outlet_id text type jsonb payload timestamptz device_time timestamptz received_at bool conflict }
  PODS { serial id PK int event_id FK text receiver text photo text signature timestamptz device_time }
  RECEIPTS { serial id PK text order_id FK jsonb lines text status "ok|issue" timestamptz confirmed_at }
  EXCEPTIONS { serial id PK text type text status "open|resolved" text severity int trip_id FK text order_id FK jsonb detail text decision }
  NOTIFICATIONS { serial id PK text audience "role:|depot:|outlet:|vehicle:|user:" text kind text title text body text link }
  AUDIT_LOG { serial id PK int user_id FK text action text entity jsonb data timestamptz at }
```

## Tables in plain words

| Table | Holds | Notes |
|---|---|---|
| `outlets`, `vehicles`, `district_travel`, `service_allowance`, `calendar` | The five datasets | Loaded from `data/*.csv` on first start. `vehicles.status` and `fuel_used_l` change during operation. |
| `users` | Seeded accounts | bcrypt password; loaders also have a hashed 4-digit dock PIN scoped to a depot. |
| `orders` | Every store order | `after_cutoff` orders roll to the next operating day. `deferred_yesterday` and `days_since_served` drive planning priority. A shortfall or failed delivery creates a child order (`parent_order_id`) for the next run. |
| `plans` | Drafts and published versions | Trips and proposed deferrals stored as JSON while drafting; one `published` row per day, older ones `superseded`. |
| `trips`, `trip_orders` | The live plan | Stable IDs across republishes. `trip_orders` is also the load list (`load_status`, `loaded_units`, `flag_reason`). |
| `stop_moves` | Stops moved between live trips | Kept so a late-syncing phone can be detected as a conflict instead of overwriting the move. |
| `deferrals` | Orders moved to another day | `reason` is one of 11 codes with a plain-language store text; `kind` = **forced** (no vehicle could take it) or **chosen** (capacity went to higher-priority orders). `units` set when only part of an order moves. |
| `stop_events` | Everything the driver's phone recorded | Append-only. `client_event_id` makes sync idempotent. `device_time` is when it happened; `received_at` is when it arrived. |
| `pods` | Proof of delivery | Receiver name, photo and signature (data URLs, compressed on the phone). |
| `receipts` | Store's line-by-line check | Any line not OK raises a `receipt_issue` exception. |
| `exceptions` | Things that need a dispatcher decision | `dock_shortfall`, `vehicle_fault`, `non_delivery`, `sync_conflict`, `receipt_issue`, `road_problem`. The decision and who made it are stored. |
| `notifications`, `notification_reads` | In-app messages | Addressed to an audience, read state per user. |
| `audit_log` | Who did what, when | Every write. |
| `vehicle_presence` | Last contact per vehicle | Drives "no signal" on live tracking and the store's estimated ETA. |
| `settings` | `clock`, `plan_date` | The business clock and the active delivery day. |
