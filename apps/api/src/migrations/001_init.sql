-- PathWise schema. One database for all four roles.

-- ── Reference data (from the challenge datasets) ─────────────────────────
CREATE TABLE outlets (
  id            text PRIMARY KEY,
  name          text NOT NULL,
  brand         text NOT NULL CHECK (brand IN ('Fresh','Style','Tech')),
  district      text NOT NULL,
  depot         text NOT NULL CHECK (depot IN ('Peliyagoda','Kandy')),
  dock          text NOT NULL CHECK (dock IN ('rear_dock','street','mall_bay')),
  parking       text NOT NULL CHECK (parking IN ('normal','van_only','mall_dock')),
  open_time     text NOT NULL,
  close_time    text NOT NULL,
  mall_window   text,
  van_only      boolean NOT NULL DEFAULT false,
  lat           double precision,
  lng           double precision
);

CREATE TABLE vehicles (
  id            text PRIMARY KEY,
  type          text NOT NULL CHECK (type IN ('truck','van')),
  temp          text NOT NULL CHECK (temp IN ('reefer','ambient')),
  depot         text NOT NULL,
  weight_cap    numeric NOT NULL,
  volume_cap    numeric NOT NULL,
  km_per_l      numeric NOT NULL,
  fuel_quota_l  numeric NOT NULL,
  fuel_used_l   numeric NOT NULL DEFAULT 0,       -- this week, before the plan date
  status        text NOT NULL DEFAULT 'available' CHECK (status IN ('available','in_workshop')),
  status_note   text,
  driver_name   text
);

CREATE TABLE district_travel (
  depot      text NOT NULL,
  district   text NOT NULL,
  out_min    int NOT NULL,
  inter_min  int NOT NULL,
  out_km     numeric NOT NULL,
  inter_km   numeric NOT NULL,
  road_class text NOT NULL,
  PRIMARY KEY (depot, district)
);

CREATE TABLE service_allowance (
  brand   text NOT NULL,
  dock    text NOT NULL,
  minutes int NOT NULL,
  PRIMARY KEY (brand, dock)
);

CREATE TABLE calendar (
  date          date PRIMARY KEY,
  is_operating  boolean NOT NULL,
  is_payday     boolean NOT NULL DEFAULT false,
  holiday       text,
  festival_ramp numeric NOT NULL DEFAULT 0,
  monsoon       boolean NOT NULL DEFAULT false,
  iso_week      text NOT NULL
);

-- ── People ───────────────────────────────────────────────────────────────
CREATE TABLE users (
  id            serial PRIMARY KEY,
  email         text UNIQUE NOT NULL,
  name          text NOT NULL,
  role          text NOT NULL CHECK (role IN ('dispatcher','loader','driver','store_manager')),
  password_hash text NOT NULL,
  pin_hash      text,
  depot         text,                              -- loader / dispatcher scope
  outlet_id     text REFERENCES outlets(id),       -- store manager
  vehicle_id    text REFERENCES vehicles(id)       -- driver
);

-- ── Orders ───────────────────────────────────────────────────────────────
CREATE TABLE orders (
  id                 text PRIMARY KEY,
  outlet_id          text NOT NULL REFERENCES outlets(id),
  delivery_date      date NOT NULL,
  temp               text NOT NULL CHECK (temp IN ('chilled','ambient')),
  units              int NOT NULL CHECK (units > 0),
  kg                 numeric NOT NULL CHECK (kg > 0),
  m3                 numeric NOT NULL CHECK (m3 > 0),
  description        text,
  lines              jsonb NOT NULL DEFAULT '[]',
  source             text NOT NULL DEFAULT 'app' CHECK (source IN ('app','phone')),
  status             text NOT NULL DEFAULT 'confirmed'
                     CHECK (status IN ('confirmed','planned','deferred','loaded','out_for_delivery','delivered','partial','failed','received','disputed','cancelled')),
  submitted_at       timestamptz NOT NULL DEFAULT now(),
  after_cutoff       boolean NOT NULL DEFAULT false,
  deferred_yesterday boolean NOT NULL DEFAULT false,
  days_since_served  int NOT NULL DEFAULT 1,
  parent_order_id    text REFERENCES orders(id),   -- remainder of a partial / shortfall
  created_by         int REFERENCES users(id)
);
CREATE INDEX orders_date_idx ON orders (delivery_date);
CREATE SEQUENCE order_number START 94000;
CREATE INDEX orders_outlet_idx ON orders (outlet_id);

-- ── Plans: every publish is a new version; drafts are editable ───────────
CREATE TABLE plans (
  id            serial PRIMARY KEY,
  plan_date     date NOT NULL,
  version       int NOT NULL,
  status        text NOT NULL CHECK (status IN ('draft','published','superseded')),
  source        text NOT NULL DEFAULT 'manual',   -- auto | manual | republish
  trips         jsonb NOT NULL DEFAULT '[]',       -- the plan itself: [{vehicleId, trip, depart, orderIds}]
  deferrals     jsonb NOT NULL DEFAULT '[]',       -- reasons for unassigned orders
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    int REFERENCES users(id),
  published_at  timestamptz,
  published_by  int REFERENCES users(id),
  note          text,
  UNIQUE (plan_date, version)
);

-- Live trips of a delivery day. Publishing a new version updates these rows in place,
-- so a driver's offline records always point at the same trip.
CREATE TABLE trips (
  id           serial PRIMARY KEY,
  plan_date    date NOT NULL,
  version      int NOT NULL,                       -- plan version that last changed this trip
  vehicle_id   text NOT NULL REFERENCES vehicles(id),
  trip_no      int NOT NULL,
  depart       text NOT NULL,
  status       text NOT NULL DEFAULT 'planned'
               CHECK (status IN ('planned','loading','released','in_progress','completed','cancelled','blocked')),
  swapped_from text,                               -- vehicle it replaced after a fault
  released_at  timestamptz,
  released_by  int REFERENCES users(id),
  started_at   timestamptz,
  closed_at    timestamptz,
  ack_version  int,                                -- plan version the loader acknowledged
  changed_at   timestamptz,                        -- last change after publishing
  change_note  text,
  UNIQUE (plan_date, vehicle_id, trip_no)
);

CREATE TABLE trip_orders (
  trip_id      int NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  order_id     text NOT NULL REFERENCES orders(id),
  seq          int NOT NULL,
  load_status  text NOT NULL DEFAULT 'pending' CHECK (load_status IN ('pending','loaded','flagged','removed')),
  loaded_units int,
  flag_reason  text,
  flag_note    text,
  loaded_at    timestamptz,
  loaded_by    int REFERENCES users(id),
  moved_at     timestamptz,                        -- set when a dispatcher moves this stop off the trip
  PRIMARY KEY (trip_id, order_id)
);

-- Stops moved between trips after publishing (used to detect offline conflicts)
CREATE TABLE stop_moves (
  id           serial PRIMARY KEY,
  order_id     text NOT NULL REFERENCES orders(id),
  outlet_id    text NOT NULL,
  from_trip_id int NOT NULL REFERENCES trips(id),
  to_trip_id   int NOT NULL REFERENCES trips(id),
  moved_at     timestamptz NOT NULL,
  moved_by     int REFERENCES users(id),
  reason       text
);

CREATE TABLE deferrals (
  id              serial PRIMARY KEY,
  order_id        text NOT NULL REFERENCES orders(id),
  from_date       date NOT NULL,
  to_date         date NOT NULL,
  reason          text NOT NULL,
  kind            text NOT NULL CHECK (kind IN ('forced','chosen')),
  why             text NOT NULL,
  units           int,                             -- partial deferral (e.g. dock shortfall)
  plan_id         int REFERENCES plans(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      int REFERENCES users(id),
  notified_at     timestamptz,
  acknowledged_at timestamptz,
  escalated       boolean NOT NULL DEFAULT false
);

-- ── Delivery records (written by the driver's phone, possibly hours later) ─
CREATE TABLE stop_events (
  id              serial PRIMARY KEY,
  client_event_id uuid UNIQUE NOT NULL,            -- idempotent sync
  trip_id         int NOT NULL REFERENCES trips(id),
  outlet_id       text,
  type            text NOT NULL CHECK (type IN ('trip_started','arrived','delivered','problem','trip_closed','conflict_answer')),
  payload         jsonb NOT NULL DEFAULT '{}',
  device_time     timestamptz NOT NULL,
  received_at     timestamptz NOT NULL DEFAULT now(),
  user_id         int REFERENCES users(id),
  conflict        boolean NOT NULL DEFAULT false
);
CREATE INDEX stop_events_trip_idx ON stop_events (trip_id);

CREATE TABLE pods (
  id           serial PRIMARY KEY,
  event_id     int NOT NULL REFERENCES stop_events(id) ON DELETE CASCADE,
  trip_id      int NOT NULL REFERENCES trips(id),
  outlet_id    text NOT NULL,
  receiver     text,
  photo        text,                               -- compressed JPEG data URL
  signature    text,                               -- PNG data URL
  device_time  timestamptz NOT NULL
);

CREATE TABLE receipts (
  id           serial PRIMARY KEY,
  order_id     text NOT NULL REFERENCES orders(id),
  outlet_id    text NOT NULL,
  lines        jsonb NOT NULL,
  status       text NOT NULL CHECK (status IN ('ok','issue')),
  confirmed_by int REFERENCES users(id),
  confirmed_at timestamptz NOT NULL DEFAULT now()
);

-- ── Exceptions: everything that needs a dispatcher decision ───────────────
CREATE TABLE exceptions (
  id          serial PRIMARY KEY,
  type        text NOT NULL CHECK (type IN ('dock_shortfall','vehicle_fault','non_delivery','sync_conflict','receipt_issue','road_problem')),
  status      text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  severity    text NOT NULL DEFAULT 'high',
  plan_date   date,
  trip_id     int REFERENCES trips(id),
  order_id    text REFERENCES orders(id),
  outlet_id   text,
  title       text NOT NULL,
  detail      jsonb NOT NULL DEFAULT '{}',
  raised_by   int REFERENCES users(id),
  raised_at   timestamptz NOT NULL DEFAULT now(),
  decision    text,
  decision_note text,
  resolved_by int REFERENCES users(id),
  resolved_at timestamptz
);

CREATE TABLE notifications (
  id         serial PRIMARY KEY,
  audience   text NOT NULL,          -- role:dispatcher | depot:Kandy | outlet:OUT116 | user:3 | vehicle:VEH041
  kind       text NOT NULL,
  tone       text NOT NULL DEFAULT 'blue',
  title      text NOT NULL,
  body       text NOT NULL DEFAULT '',
  link       text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_audience_idx ON notifications (audience);
CREATE TABLE notification_reads (
  notification_id int NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  user_id         int NOT NULL REFERENCES users(id),
  read_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (notification_id, user_id)
);

CREATE TABLE audit_log (
  id      serial PRIMARY KEY,
  at      timestamptz NOT NULL DEFAULT now(),
  user_id int REFERENCES users(id),
  action  text NOT NULL,
  entity  text,
  data    jsonb NOT NULL DEFAULT '{}'
);

CREATE TABLE vehicle_presence (
  vehicle_id text PRIMARY KEY REFERENCES vehicles(id),
  last_seen  timestamptz NOT NULL,                 -- business time of the last contact from the driver's phone
  last_lat   double precision,
  last_lng   double precision
);

CREATE TABLE settings (
  key   text PRIMARY KEY,
  value jsonb NOT NULL
);
