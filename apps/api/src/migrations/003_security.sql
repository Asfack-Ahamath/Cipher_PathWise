-- PathWise 003 — row-level security
--
-- Who talks to the database?
--   • The PathWise API, as the table owner (DATABASE_URL). Table owners are not subject to RLS,
--     so the API keeps full access and enforces roles itself (see apps/api/src/auth.ts).
--   • On Supabase, the public schema is also exposed through the Data API (PostgREST) to the
--     `anon` and `authenticated` roles. PathWise's browser app never uses that path, so this
--     migration closes it: RLS is on for every table, `anon` gets nothing, and `authenticated`
--     users only get read access to rows that belong to them (their own outlet, vehicle, depot).
--     Nothing can be written through the Data API.
--
-- On plain PostgreSQL (docker compose) the Supabase roles do not exist; the policies are skipped
-- and only "RLS enabled" applies, which does not affect the owner connection.

DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'schema_migrations' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

DO $$
DECLARE t text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') OR to_regprocedure('auth.uid()') IS NULL THEN
    RAISE NOTICE 'Supabase roles/auth schema not found — skipping Data API policies (plain PostgreSQL).';
    RETURN;
  END IF;

  -- No anonymous access at all; authenticated users read only, through the policies below.
  EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon';
  EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon';
  EXECUTE 'REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public FROM authenticated';
  EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon';
  EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLES FROM authenticated';

  -- The signed-in person's PathWise profile (users.auth_user_id = auth.uid())
  EXECUTE $f$
    CREATE OR REPLACE FUNCTION public.pw_me() RETURNS public.users
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
    'SELECT u.* FROM public.users u WHERE u.auth_user_id = auth.uid() AND u.is_active LIMIT 1'
  $f$;
  EXECUTE 'REVOKE ALL ON FUNCTION public.pw_me() FROM PUBLIC, anon';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.pw_me() TO authenticated';
  EXECUTE $f$
    CREATE OR REPLACE FUNCTION public.pw_role() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
    'SELECT role FROM public.users WHERE auth_user_id = auth.uid() AND is_active LIMIT 1'
  $f$;
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.pw_role() TO authenticated';

  -- Reference data: readable by any signed-in PathWise user
  FOREACH t IN ARRAY ARRAY['outlets','vehicles','district_travel','service_allowance','calendar','traffic_speed','road_conditions'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS pw_read ON public.%I', t);
    EXECUTE format('CREATE POLICY pw_read ON public.%I FOR SELECT TO authenticated USING (public.pw_role() IS NOT NULL)', t);
  END LOOP;

  -- Own profile
  EXECUTE 'DROP POLICY IF EXISTS pw_self ON public.users';
  EXECUTE 'CREATE POLICY pw_self ON public.users FOR SELECT TO authenticated USING (auth_user_id = auth.uid() OR public.pw_role() IN (''admin'',''dispatcher''))';

  -- Orders: store managers see their outlet; office roles see all
  EXECUTE 'DROP POLICY IF EXISTS pw_orders ON public.orders';
  EXECUTE 'CREATE POLICY pw_orders ON public.orders FOR SELECT TO authenticated USING (public.pw_role() IN (''admin'',''dispatcher'',''loader'') OR outlet_id = (public.pw_me()).outlet_id)';

  -- Deferrals and receipts follow the order
  EXECUTE 'DROP POLICY IF EXISTS pw_deferrals ON public.deferrals';
  EXECUTE 'CREATE POLICY pw_deferrals ON public.deferrals FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.orders o WHERE o.id = order_id))';
  EXECUTE 'DROP POLICY IF EXISTS pw_receipts ON public.receipts';
  EXECUTE 'CREATE POLICY pw_receipts ON public.receipts FOR SELECT TO authenticated USING (public.pw_role() IN (''admin'',''dispatcher'') OR outlet_id = (public.pw_me()).outlet_id)';

  -- Trips: office roles; loaders for their depot; drivers for their vehicle
  EXECUTE 'DROP POLICY IF EXISTS pw_trips ON public.trips';
  EXECUTE 'CREATE POLICY pw_trips ON public.trips FOR SELECT TO authenticated USING (
      public.pw_role() IN (''admin'',''dispatcher'')
      OR (public.pw_role() = ''loader'' AND EXISTS (SELECT 1 FROM public.vehicles v WHERE v.id = vehicle_id AND v.depot = (public.pw_me()).depot))
      OR (public.pw_role() = ''driver'' AND vehicle_id = (public.pw_me()).vehicle_id))';
  EXECUTE 'DROP POLICY IF EXISTS pw_trip_orders ON public.trip_orders';
  EXECUTE 'CREATE POLICY pw_trip_orders ON public.trip_orders FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.trips x WHERE x.id = trip_id))';

  -- Notifications addressed to the person
  EXECUTE 'DROP POLICY IF EXISTS pw_notifications ON public.notifications';
  EXECUTE 'CREATE POLICY pw_notifications ON public.notifications FOR SELECT TO authenticated USING (
      audience = ''role:'' || public.pw_role()
      OR audience = ''user:'' || (public.pw_me()).id
      OR audience = ''outlet:'' || coalesce((public.pw_me()).outlet_id, ''-'')
      OR audience = ''vehicle:'' || coalesce((public.pw_me()).vehicle_id, ''-'')
      OR audience = ''depot:'' || coalesce((public.pw_me()).depot, ''-''))';

  -- Operational and security tables: office roles only (audit log: admin only)
  FOREACH t IN ARRAY ARRAY['plans','stop_moves','stop_events','pods','exceptions','demand_weekly','vehicle_presence','loading_sessions'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS pw_office ON public.%I', t);
    EXECUTE format('CREATE POLICY pw_office ON public.%I FOR SELECT TO authenticated USING (public.pw_role() IN (''admin'',''dispatcher''))', t);
  END LOOP;
  EXECUTE 'DROP POLICY IF EXISTS pw_admin ON public.audit_log';
  EXECUTE 'CREATE POLICY pw_admin ON public.audit_log FOR SELECT TO authenticated USING (public.pw_role() = ''admin'')';
  -- attachments, settings, notification_reads: no Data API access (served only through the API)
END $$;
