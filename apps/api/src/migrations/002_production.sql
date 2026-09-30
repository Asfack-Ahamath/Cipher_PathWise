-- PathWise 002 — production hardening
-- Adds: admin role and account security, reference tables for traffic and road conditions,
-- demand history, attachments (photos / signatures in the DB or Supabase Storage),
-- loading sessions, plan change logs, extra constraints, indexes and updated_at triggers.

-- ── helper: keep updated_at current ───────────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

-- ── users: admin role, account state, Supabase Auth link ───────────────────
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('admin','dispatcher','loader','driver','store_manager'));
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;              -- Supabase Auth users keep no local hash
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_logins int NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_user_id uuid UNIQUE;     -- auth.users.id when AUTH_PROVIDER=supabase
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version int NOT NULL DEFAULT 0; -- bump to sign a user out everywhere
ALTER TABLE users ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE users ADD CONSTRAINT users_email_format CHECK (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$');
ALTER TABLE users ADD CONSTRAINT users_depot_check CHECK (depot IS NULL OR depot IN ('Peliyagoda','Kandy'));
ALTER TABLE users ADD CONSTRAINT users_scope_check CHECK (
  (role <> 'store_manager' OR outlet_id IS NOT NULL) AND
  (role <> 'driver' OR vehicle_id IS NOT NULL) AND
  (role <> 'loader' OR depot IS NOT NULL));
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_idx ON users (lower(email));
CREATE INDEX IF NOT EXISTS users_outlet_idx ON users (outlet_id);
CREATE INDEX IF NOT EXISTS users_vehicle_idx ON users (vehicle_id);
CREATE TRIGGER users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── reference data: formats and admin edits ────────────────────────────────
ALTER TABLE outlets ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
ALTER TABLE outlets ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE outlets ADD CONSTRAINT outlets_open_fmt CHECK (open_time ~ '^[0-2][0-9]:[0-5][0-9]$');
ALTER TABLE outlets ADD CONSTRAINT outlets_close_fmt CHECK (close_time ~ '^[0-2][0-9]:[0-5][0-9]$');
ALTER TABLE outlets ADD CONSTRAINT outlets_window_order CHECK (open_time < close_time);
CREATE INDEX IF NOT EXISTS outlets_depot_district_idx ON outlets (depot, district);
CREATE TRIGGER outlets_updated_at BEFORE UPDATE ON outlets FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS fuel_type text NOT NULL DEFAULT 'diesel';
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE vehicles ADD CONSTRAINT vehicles_depot_check CHECK (depot IN ('Peliyagoda','Kandy'));
ALTER TABLE vehicles ADD CONSTRAINT vehicles_caps_positive CHECK (weight_cap > 0 AND volume_cap > 0 AND km_per_l > 0 AND fuel_quota_l > 0 AND fuel_used_l >= 0);
CREATE INDEX IF NOT EXISTS vehicles_depot_idx ON vehicles (depot, status);
CREATE TRIGGER vehicles_updated_at BEFORE UPDATE ON vehicles FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE calendar ADD COLUMN IF NOT EXISTS is_holiday boolean NOT NULL DEFAULT false;
ALTER TABLE calendar ADD COLUMN IF NOT EXISTS festival text;
ALTER TABLE calendar ADD COLUMN IF NOT EXISTS iso_year int;
ALTER TABLE calendar ADD COLUMN IF NOT EXISTS dow int;
ALTER TABLE calendar ALTER COLUMN iso_week TYPE int USING nullif(regexp_replace(iso_week, '\D', '', 'g'), '')::int;
ALTER TABLE calendar ADD CONSTRAINT calendar_ramp_range CHECK (festival_ramp BETWEEN 0 AND 1);

-- traffic_speed.csv — typical congestion by district and hour
CREATE TABLE IF NOT EXISTS traffic_speed (
  district    text NOT NULL,
  hour        int  NOT NULL CHECK (hour BETWEEN 0 AND 23),
  monsoon     boolean NOT NULL,
  speed_index numeric NOT NULL CHECK (speed_index > 0 AND speed_index <= 150),
  PRIMARY KEY (district, hour, monsoon)
);
-- road_conditions.csv — date-specific district disruption (100 = clear)
CREATE TABLE IF NOT EXISTS road_conditions (
  district         text NOT NULL,
  date             date NOT NULL,
  disruption_index numeric NOT NULL CHECK (disruption_index > 0 AND disruption_index <= 100),
  PRIMARY KEY (district, date)
);
-- Weekly order volume by depot and brand (history from deliveries_train + task1 inputs; or Datathon forecasts)
CREATE TABLE IF NOT EXISTS demand_weekly (
  depot      text NOT NULL CHECK (depot IN ('Peliyagoda','Kandy')),
  brand      text NOT NULL CHECK (brand IN ('Fresh','Style','Tech')),
  iso_year   int  NOT NULL,
  iso_week   int  NOT NULL CHECK (iso_week BETWEEN 1 AND 53),
  source     text NOT NULL CHECK (source IN ('history','forecast_import')),
  total_m3   numeric NOT NULL CHECK (total_m3 >= 0),
  chilled_m3 numeric NOT NULL DEFAULT 0 CHECK (chilled_m3 >= 0 AND chilled_m3 <= total_m3 + 0.001),
  orders     int,
  imported_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (depot, brand, iso_year, iso_week, source)
);

-- ── orders: edits and cancellation ─────────────────────────────────────────
ALTER TABLE orders ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancelled_by int REFERENCES users(id);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancel_reason text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS note text;
ALTER TABLE orders ADD CONSTRAINT orders_size_sane CHECK (units <= 100000 AND kg <= 100000 AND m3 <= 1000);
CREATE INDEX IF NOT EXISTS orders_status_idx ON orders (status);
CREATE INDEX IF NOT EXISTS orders_parent_idx ON orders (parent_order_id);
CREATE INDEX IF NOT EXISTS orders_outlet_date_idx ON orders (outlet_id, delivery_date);
CREATE TRIGGER orders_updated_at BEFORE UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── plans and trips ────────────────────────────────────────────────────────
ALTER TABLE plans ADD COLUMN IF NOT EXISTS changes jsonb NOT NULL DEFAULT '[]';   -- what changed vs the previous version
ALTER TABLE plans ADD COLUMN IF NOT EXISTS stats jsonb NOT NULL DEFAULT '{}';
CREATE UNIQUE INDEX IF NOT EXISTS plans_one_published ON plans (plan_date) WHERE status = 'published';
CREATE UNIQUE INDEX IF NOT EXISTS plans_one_draft ON plans (plan_date) WHERE status = 'draft';
ALTER TABLE trips ADD CONSTRAINT trips_trip_no_range CHECK (trip_no BETWEEN 1 AND 3);
ALTER TABLE trips ADD CONSTRAINT trips_depart_fmt CHECK (depart ~ '^[0-2][0-9]:[0-5][0-9]$');
CREATE INDEX IF NOT EXISTS trips_date_idx ON trips (plan_date, status);
CREATE INDEX IF NOT EXISTS trips_vehicle_idx ON trips (vehicle_id, plan_date);
ALTER TABLE trip_orders ADD COLUMN IF NOT EXISTS actual_kg numeric;   -- loader: physical size differs from the order
ALTER TABLE trip_orders ADD COLUMN IF NOT EXISTS actual_m3 numeric;
CREATE INDEX IF NOT EXISTS trip_orders_order_idx ON trip_orders (order_id);
CREATE INDEX IF NOT EXISTS stop_moves_from_idx ON stop_moves (from_trip_id, outlet_id);
CREATE INDEX IF NOT EXISTS stop_moves_to_idx ON stop_moves (to_trip_id);

-- who is loading a trip on which dock device (shared tablets)
CREATE TABLE IF NOT EXISTS loading_sessions (
  trip_id      int PRIMARY KEY REFERENCES trips(id) ON DELETE CASCADE,
  user_id      int NOT NULL REFERENCES users(id),
  device       text,
  claimed_at   timestamptz NOT NULL,
  heartbeat_at timestamptz NOT NULL
);

-- ── deferrals, events, receipts, exceptions ───────────────────────────────
CREATE INDEX IF NOT EXISTS deferrals_order_idx ON deferrals (order_id);
CREATE INDEX IF NOT EXISTS deferrals_from_idx ON deferrals (from_date);
CREATE INDEX IF NOT EXISTS deferrals_to_idx ON deferrals (to_date);
ALTER TABLE stop_events DROP CONSTRAINT IF EXISTS stop_events_type_check;
ALTER TABLE stop_events ADD CONSTRAINT stop_events_type_check CHECK (type IN ('trip_started','arrived','delivered','problem','trip_closed','conflict_answer','route_ack'));
CREATE INDEX IF NOT EXISTS stop_events_outlet_idx ON stop_events (trip_id, outlet_id, type);
CREATE INDEX IF NOT EXISTS pods_trip_outlet_idx ON pods (trip_id, outlet_id);
CREATE INDEX IF NOT EXISTS receipts_order_idx ON receipts (order_id);
ALTER TABLE receipts ADD COLUMN IF NOT EXISTS attachment_ids jsonb NOT NULL DEFAULT '[]';
ALTER TABLE exceptions DROP CONSTRAINT IF EXISTS exceptions_type_check;
ALTER TABLE exceptions ADD CONSTRAINT exceptions_type_check CHECK (type IN ('dock_shortfall','vehicle_fault','non_delivery','sync_conflict','receipt_issue','road_problem','size_divergence'));
ALTER TABLE exceptions ADD CONSTRAINT exceptions_severity_check CHECK (severity IN ('low','medium','high'));
CREATE INDEX IF NOT EXISTS exceptions_status_idx ON exceptions (status, plan_date);
CREATE INDEX IF NOT EXISTS exceptions_trip_idx ON exceptions (trip_id);
CREATE INDEX IF NOT EXISTS notifications_created_idx ON notifications (audience, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_at_idx ON audit_log (at DESC);
CREATE INDEX IF NOT EXISTS audit_log_user_idx ON audit_log (user_id, at DESC);
CREATE INDEX IF NOT EXISTS audit_log_action_idx ON audit_log (action);

-- ── attachments: proof photos, signatures, receipt photos ──────────────────
-- storage = 'db'        → the bytes live in `data` (base64) — default, works everywhere
-- storage = 'supabase'  → the bytes live in Supabase Storage at `path`; `data` is NULL
CREATE TABLE IF NOT EXISTS attachments (
  id          uuid PRIMARY KEY,
  kind        text NOT NULL CHECK (kind IN ('pod_photo','pod_signature','receipt_photo','problem_photo')),
  storage     text NOT NULL CHECK (storage IN ('db','supabase')),
  path        text,
  mime        text NOT NULL CHECK (mime IN ('image/jpeg','image/png','image/webp')),
  bytes       int  NOT NULL CHECK (bytes > 0 AND bytes <= 5242880),
  data        text,
  outlet_id   text REFERENCES outlets(id),
  trip_id     int REFERENCES trips(id) ON DELETE SET NULL,
  created_by  int REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK ((storage = 'db' AND data IS NOT NULL) OR (storage = 'supabase' AND path IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS attachments_outlet_idx ON attachments (outlet_id);
ALTER TABLE pods ADD COLUMN IF NOT EXISTS photo_id uuid REFERENCES attachments(id);
ALTER TABLE pods ADD COLUMN IF NOT EXISTS signature_id uuid REFERENCES attachments(id);
ALTER TABLE pods ADD COLUMN IF NOT EXISTS delivered_units jsonb NOT NULL DEFAULT '{}'; -- driver's count per order

-- ── settings: typed defaults (editable by an admin) ────────────────────────
INSERT INTO settings (key, value) VALUES
  ('rules', '{"freshBudgetMin":270,"styleTechBudgetMin":480,"maxTripsPerVehicle":2,"freshDepart":"03:30","reloadMin":20,"lateRiskSlackMin":15}'),
  ('operations', '{"cutoffTime":"16:00","offlineAfterMin":10,"receiptConfirmHours":4,"sessionHours":12,"driverSessionHours":24,"loaderClaimMinutes":3,"useTrafficForEta":true}')
ON CONFLICT (key) DO NOTHING;
