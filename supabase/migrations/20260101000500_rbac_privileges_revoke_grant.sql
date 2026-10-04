-- =============================================================================
-- SMART IV MONITORING SYSTEM - RBAC STEP 5: TABLE / FUNCTION / COLUMN GRANTS
-- Academic Prototype - Not a Certified Medical Device
-- -----------------------------------------------------------------------------
-- ADDITIVE. Never edits previously applied migrations.
--
-- Fixes addressed here (audit gap numbers):
--   * Gap 14 - the project contained ZERO grant or revoke statements. Under
--              Supabase's default privileges, anon and authenticated hold
--              INSERT/UPDATE/DELETE on every table in public, so RLS was the
--              only boundary and any missing policy became a total bypass.
--              This migration makes the database privileges themselves match the
--              matrix, so RLS is the second wall rather than the only one.
--   * Gap 1  - reinforced at column level: REVOKE UPDATE (role, ward_id,
--              is_active) ON profiles FROM authenticated. Even if a policy were
--              ever mis-written, a nurse cannot write their own role.
--   * Gap 14 - ingest_telemetry_secure had EXECUTE granted to PUBLIC and no
--              pinned search_path, so any client could call the device ingest
--              path directly. Now restricted to service_role only.
--
-- Order matters: this runs after 00400 so the grants line up with the policies
-- that were just created.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. SCHEMA-LEVEL: stop object shadowing
-- -----------------------------------------------------------------------------
-- Without this, a client that can CREATE in public could define an operator or
-- a function that a SECURITY DEFINER body resolves in preference to the real
-- one, which is the classic search_path hijack. Supabase revokes this by
-- default; stating it explicitly keeps the database safe if it is ever rebuilt
-- or the defaults drift.

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM anon;
REVOKE CREATE ON SCHEMA public FROM authenticated;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 2. INTERNAL ARMOURED FLAGS ARE NOT CALLABLE BY CLIENTS
-- -----------------------------------------------------------------------------
-- These three helpers raise the transaction-local flags that the write guards
-- in 00100/00300 test. They must be callable only by SECURITY DEFINER code
-- owned by the migration role. Postgres grants EXECUTE on new functions to
-- PUBLIC by default, so this has to be undone explicitly or a client could
-- arm the flags itself.

REVOKE ALL ON FUNCTION public._arm_dba_bypass(BOOLEAN)  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._arm_admin_rpc()          FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._arm_ack_rpc()            FROM PUBLIC, anon, authenticated;

-- The predicates they feed are harmless to expose, but there is no reason for
-- anon to reach them at all.
REVOKE ALL ON FUNCTION public.is_service_role()          FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.dba_bypass_active()        FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_rpc_authorized()     FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ack_rpc_authorized()       FROM PUBLIC, anon;

-- -----------------------------------------------------------------------------
-- 3. INGEST PATH IS service_role ONLY
-- -----------------------------------------------------------------------------
-- The ESP32 does not hold a Supabase key. It posts to the ingest-telemetry Edge
-- Function, which holds the service-role key server-side and calls this RPC with
-- the per-device secret. Clients get EXECUTE revoked so they cannot reach the
-- writer path even if they somehow learn a device secret.

ALTER FUNCTION public.ingest_telemetry_secure(TEXT, TEXT, NUMERIC, INTEGER, INTEGER)
    SET search_path = public, pg_temp;

REVOKE ALL ON FUNCTION public.ingest_telemetry_secure(TEXT, TEXT, NUMERIC, INTEGER, INTEGER)
    FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.ingest_telemetry_secure(TEXT, TEXT, NUMERIC, INTEGER, INTEGER)
    TO service_role;

-- -----------------------------------------------------------------------------
-- 4. RPCs THE CLIENT IS ALLOWED TO CALL
-- -----------------------------------------------------------------------------

GRANT EXECUTE ON FUNCTION public.log_event(TEXT)            TO authenticated;
GRANT EXECUTE ON FUNCTION public.acknowledge_alert(UUID, TEXT) TO authenticated;  -- created in 00600
GRANT EXECUTE ON FUNCTION public.admin_manage_user(UUID, TEXT, TEXT, UUID, BOOLEAN)
    TO authenticated;                                                            -- created in 00600

-- Helper predicates. SECURITY DEFINER and STABLE, no side effects; policies call
-- them internally, and exposing them lets the client pre-flight a permission
-- check instead of guessing.
GRANT EXECUTE ON FUNCTION public.auth_role()                TO authenticated;
GRANT EXECUTE ON FUNCTION public.auth_ward_id()             TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin()                 TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_ward_sister()           TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_nurse()                 TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_active_user()           TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_assigned_to(UUID)       TO authenticated;
GRANT EXECUTE ON FUNCTION public.in_ward(UUID)              TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_access_patient(UUID)   TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_manage_patient(UUID)   TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_access_session(UUID)   TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_manage_session(UUID)   TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_access_alert(UUID)     TO authenticated;

REVOKE ALL ON FUNCTION public.effective_monitoring_parameters(UUID) FROM PUBLIC, anon;

-- -----------------------------------------------------------------------------
-- 5. ANON GETS NOTHING
-- -----------------------------------------------------------------------------

REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon;

-- -----------------------------------------------------------------------------
-- 6. SEQUENCES
-- -----------------------------------------------------------------------------
-- iv_telemetry.id is a BIGSERIAL and the only sequence that matters. Clients
-- never insert telemetry, so they get no sequence rights at all.

REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;

-- -----------------------------------------------------------------------------
-- 7. READ: broad SELECT grant, narrow RLS
-- -----------------------------------------------------------------------------
-- Granting SELECT broadly is safe and intentional: RLS decides which ROWS come
-- back, so a nurse's SELECT on audit_logs simply returns zero rows. This keeps
-- the client simple and the matrix expressed in exactly one place (00400).

GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;

-- -----------------------------------------------------------------------------
-- 8. WRITE: only where a policy exists
-- -----------------------------------------------------------------------------
-- Anything not listed here is not writable by any client role, regardless of
-- what a policy might say.

-- Writable, with RLS deciding who:
GRANT INSERT, UPDATE ON public.patients               TO authenticated;
GRANT INSERT, UPDATE ON public.iv_sessions            TO authenticated;
GRANT INSERT, UPDATE ON public.nurse_assignments      TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.wards          TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.devices         TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.monitoring_parameters TO authenticated;

-- Explicitly denied, even for authenticated. RLS already refuses these; the
-- REVOKE makes the guarantee independent of the policies.
REVOKE INSERT, UPDATE, DELETE ON public.iv_telemetry           FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.alerts                 FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.alert_acknowledgements FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.audit_logs             FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.profiles               FROM authenticated;

-- Immutable clinical history. Re-asserted individually so that a future blanket
-- GRANT cannot quietly reopen them.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.iv_telemetry           FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.alerts                 FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.alert_acknowledgements FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.audit_logs             FROM PUBLIC, anon, authenticated;

-- Nobody truncates. TRUNCATE is not subject to row-level policies at all, so it
-- has to be closed at the privilege level or it would bypass everything.
REVOKE TRUNCATE ON ALL TABLES IN SCHEMA public FROM PUBLIC, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 9. COLUMN-LEVEL PRIVILEGE ESCALATION PROTECTION
-- -----------------------------------------------------------------------------
-- The brief allows "a trigger or column-level privileges" for the rule that a
-- user can never change their own role, ward_id or is_active. Migration 00100
-- implements the trigger; this implements the column grant, so there are two
-- independent mechanisms and neither has to be perfect.
--
-- Effect: `UPDATE profiles SET role = 'ADMIN'` now fails with
-- "permission denied for table profiles" before the trigger is even reached.
-- Cosmetic self-service (full_name, phone_number) still works.
--
-- admin-manage_user() is SECURITY DEFINER and runs as the owner, so it is
-- unaffected by this REVOKE and remains the only way to change these columns.

REVOKE UPDATE (role, ward_id, is_active, badge_number, email) ON public.profiles FROM authenticated;

-- Re-grant the columns a user may legitimately change on their own row.
GRANT UPDATE (full_name, phone_number) ON public.profiles TO authenticated;

-- -----------------------------------------------------------------------------
-- 10. FUTURE OBJECTS
-- -----------------------------------------------------------------------------
-- New tables and functions should not inherit the permissive defaults. These
-- statements only affect objects created after they run, i.e. by later
-- migrations, which is exactly the intent.

ALTER DEFAULT PRIVILEGES IN SCHEMA public
    REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    REVOKE TRUNCATE ON TABLES FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.guard_profile_privileges()        TO authenticated;
GRANT EXECUTE ON FUNCTION public.guard_immutable_table()           TO authenticated;
GRANT EXECUTE ON FUNCTION public.guard_nurse_assignment()          TO authenticated;
GRANT EXECUTE ON FUNCTION public.guard_clinical_history_deletion() TO authenticated;
GRANT EXECUTE ON FUNCTION public.sync_alert_acknowledgement_flag() TO authenticated;
GRANT EXECUTE ON FUNCTION public.touch_updated_at()                TO authenticated;
GRANT EXECUTE ON FUNCTION public.trusted_writer()                  TO authenticated;
