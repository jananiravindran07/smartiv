-- =============================================================================
-- SMART IV MONITORING SYSTEM - RBAC STEP 4: THE PERMISSION MATRIX
-- Academic Prototype - Not a Certified Medical Device
-- -----------------------------------------------------------------------------
-- ADDITIVE. Never edits previously applied migrations. Every policy created by
-- 20260101000000_initial_schema.sql is dropped and replaced here.
--
-- This migration deletes ALL existing policies in the public schema first, so
-- no permissive policy can survive by being overlooked. It then rebuilds the
-- matrix from scratch using the helpers from 00100/00200.
--
-- NURSE
--   read   own profile; patients, iv_sessions, bag_readings, alerts and alert
--          history for ASSIGNED patients in her OWN ward only
--   write  acknowledge alerts for those patients, via acknowledge_alert() only
--   deny   other wards, other nurses' patient lists, devices, thresholds,
--          monitoring parameters, users, audit_logs, any direct write
-- WARD_SISTER
--   read   everything in her own ward, plus the nurses in her ward
--   write  patients, IV sessions, nurse allocations in her own ward
--   deny   other wards, users/roles/wards/devices/thresholds, audit_logs
-- ADMIN
--   read   everything, all wards, plus audit_logs
--   write  users/roles (via RPC only), wards, devices, monitoring parameters
--   deny   editing or deleting readings, alerts, acknowledgements, audit logs
--
-- Every read predicate begins with public.is_active_user(), so a deactivated
-- account is refused everywhere (spec: "Deactivated users get no access").
-- Every predicate uses the helpers rather than reading profiles directly, which
-- is what stops the profiles policies from recursing into themselves.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. REMOVE EVERY PRE-EXISTING POLICY
-- -----------------------------------------------------------------------------

DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT schemaname, tablename, policyname
          FROM pg_policies
         WHERE schemaname = 'public'
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I',
                       r.policyname, r.schemaname, r.tablename);
    END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- 2. wards
-- -----------------------------------------------------------------------------
-- Replaces "Authenticated users can view wards" USING (TRUE), which let every
-- logged-in user enumerate the whole hospital.

DROP POLICY IF EXISTS "admin manages wards" ON public.wards;

CREATE POLICY "wards readable within scope"
    ON public.wards FOR SELECT
    TO authenticated
    USING (
        public.is_active_user()
        AND (public.is_admin() OR id IS NOT DISTINCT FROM public.auth_ward_id())
    );

CREATE POLICY "admin manages wards"
    ON public.wards FOR ALL
    TO authenticated
    USING (public.is_active_user() AND public.is_admin())
    WITH CHECK (public.is_active_user() AND public.is_admin());

-- -----------------------------------------------------------------------------
-- 3. profiles
-- -----------------------------------------------------------------------------
-- Replaces three overlapping policies, one of which (Users can update own
-- profile, USING id = auth.uid()) was the privilege-escalation hole.

CREATE POLICY "profiles readable within scope"
    ON public.profiles FOR SELECT
    TO authenticated
    USING (
        public.is_active_user()
        AND (
            id = auth.uid()
            -- WARD_SISTER sees the nurses in her own ward, per the matrix.
            OR (public.is_ward_sister()
                AND ward_id IS NOT DISTINCT FROM public.auth_ward_id())
            OR public.is_admin()
        )
    );
-- A NURSE sees only herself. She cannot enumerate her colleagues or their
-- patient lists. See also the nurse_assignments policy in 00200.

-- Ordinary self-service edits only. The privileged columns are blocked twice:
-- by this policy's WITH CHECK, and by trg_guard_profile_privileges in 00100.
CREATE POLICY "users update own non-privileged profile fields"
    ON public.profiles FOR UPDATE
    TO authenticated
    USING (public.is_active_user() AND id = auth.uid())
    WITH CHECK (public.is_active_user() AND id = auth.uid());

-- ADMIN may edit other people's cosmetic fields. Role / ward_id / is_active
-- remain RPC-only: the 00100 guard raises a 42501 telling the caller to use
-- admin-manage-user, so an admin can never make an unaudited privilege change.
CREATE POLICY "admin updates profile cosmetic fields"
    ON public.profiles FOR UPDATE
    TO authenticated
    USING (public.is_active_user() AND public.is_admin())
    WITH CHECK (public.is_active_user() AND public.is_admin());

-- No INSERT policy: accounts are created only by the admin-create-user Edge
-- Function with the service-role key (trg_guard_profile_privileges enforces it).
-- No DELETE policy either. Accounts are deactivated, never deleted, so that
-- historic audit rows and acknowledgements keep their author.

-- -----------------------------------------------------------------------------
-- 4. patients
-- -----------------------------------------------------------------------------
-- Replaces the policy containing `OR public.get_auth_user_ward() IS NULL`,
-- which handed every ward-less profile the whole hospital.

CREATE POLICY "patients readable within scope"
    ON public.patients FOR SELECT
    TO authenticated
    USING (public.is_active_user() AND public.can_access_patient(id));

CREATE POLICY "ward sister and admin create patients"
    ON public.patients FOR INSERT
    TO authenticated
    WITH CHECK (
        public.is_active_user()
        AND public.auth_role() IN ('WARD_SISTER', 'ADMIN')
        AND (public.is_admin()
             OR ward_id IS NOT DISTINCT FROM public.auth_ward_id())
    );

CREATE POLICY "ward sister and admin update patients in scope"
    ON public.patients FOR UPDATE
    TO authenticated
    USING (public.is_active_user() AND public.can_manage_patient(id))
    WITH CHECK (public.is_active_user() AND public.can_manage_patient(id));

-- No DELETE policy. 00300's guard additionally refuses to delete a patient who
-- still has alerts or sessions, so history cannot vanish through a cascade.

-- -----------------------------------------------------------------------------
-- 5. nurse_assignments
-- -----------------------------------------------------------------------------
-- SELECT already exists from 00200. These are the allocation writes.
--
-- ASSUMPTION (flagged): the matrix does not say who allocates nurses to
-- patients. A WARD_SISTER is the person who actually does this on a shift, so
-- she may manage allocations inside her own ward only. A NURSE cannot allocate
-- work to herself or anybody else. Change this if you want ADMIN-only.

CREATE POLICY "ward sister and admin assign nurses"
    ON public.nurse_assignments FOR INSERT
    TO authenticated
    WITH CHECK (
        public.is_active_user()
        AND public.auth_role() IN ('WARD_SISTER', 'ADMIN')
        AND (public.is_admin() OR ward_id IS NOT DISTINCT FROM public.auth_ward_id())
    );

CREATE POLICY "ward sister and admin revise assignments"
    ON public.nurse_assignments FOR UPDATE
    TO authenticated
    USING (
        public.is_active_user()
        AND public.auth_role() IN ('WARD_SISTER', 'ADMIN')
        AND (public.is_admin() OR ward_id IS NOT DISTINCT FROM public.auth_ward_id())
    )
    WITH CHECK (
        public.is_active_user()
        AND public.auth_role() IN ('WARD_SISTER', 'ADMIN')
        AND (public.is_admin() OR ward_id IS NOT DISTINCT FROM public.auth_ward_id())
    );

CREATE POLICY "admin removes assignments"
    ON public.nurse_assignments FOR DELETE
    TO authenticated
    USING (public.is_active_user() AND public.is_admin());

-- -----------------------------------------------------------------------------
-- 6. devices
-- -----------------------------------------------------------------------------
-- Replaces "Ward Sister and Admin manage devices", which let a ward sister
-- INSERT, UPDATE and DELETE pole units including their secret material.

CREATE POLICY "admin reads all devices"
    ON public.devices FOR SELECT
    TO authenticated
    USING (public.is_active_user() AND public.is_admin());

-- ASSUMPTION (flagged): the matrix denies a WARD_SISTER "manage devices" but
-- does not explicitly deny her from reading them, and she cannot start a session
-- without choosing a device for it. So she may list the pole units in her own
-- ward. No configuration fields are writable by her.
--
-- A NURSE gets nothing. The matrix lists "devices config" under her deny list.
CREATE POLICY "ward sister reads devices in her ward"
    ON public.devices FOR SELECT
    TO authenticated
    USING (
        public.is_active_user()
        AND public.is_ward_sister()
        AND ward_id IS NOT DISTINCT FROM public.auth_ward_id()
    );

CREATE POLICY "admin manages devices"
    ON public.devices FOR ALL
    TO authenticated
    USING (public.is_active_user() AND public.is_admin())
    WITH CHECK (public.is_active_user() AND public.is_admin());

-- -----------------------------------------------------------------------------
-- 7. iv_sessions
-- -----------------------------------------------------------------------------
-- Replaces "Staff create/update sessions" FOR ALL, which let a NURSE insert,
-- update and DELETE sessions in her ward. Deleting a session cascaded into
-- iv_telemetry and alerts, silently destroying clinical history.

CREATE POLICY "sessions readable within scope"
    ON public.iv_sessions FOR SELECT
    TO authenticated
    USING (public.is_active_user() AND public.can_access_session(id));

CREATE POLICY "ward sister and admin start sessions"
    ON public.iv_sessions FOR INSERT
    TO authenticated
    WITH CHECK (
        public.is_active_user()
        AND public.auth_role() IN ('WARD_SISTER', 'ADMIN')
        AND (public.is_admin() OR ward_id IS NOT DISTINCT FROM public.auth_ward_id())
        -- the patient must be visible to the writer, and in the same ward
        AND public.can_access_patient(patient_id)
        -- the pole unit must belong to the same ward, so a session cannot be
        -- silently attached to another ward's hardware
        AND EXISTS (
            SELECT 1 FROM public.devices d
             WHERE d.id = device_id
               AND d.ward_id IS NOT DISTINCT FROM iv_sessions.ward_id
        )
    );

CREATE POLICY "ward sister and admin update sessions in scope"
    ON public.iv_sessions FOR UPDATE
    TO authenticated
    USING (public.is_active_user() AND public.can_manage_session(id))
    WITH CHECK (
        public.is_active_user()
        AND public.can_manage_patient(patient_id)
        AND (public.is_admin() OR ward_id IS NOT DISTINCT FROM public.auth_ward_id())
    );

-- No DELETE policy. Sessions are ended by setting status to COMPLETED/ABORTED,
-- which the 00300 audit trigger records as SESSION_ENDED. Nothing is removed.

-- -----------------------------------------------------------------------------
-- 8. bag_readings  (iv_telemetry)
-- -----------------------------------------------------------------------------
-- Replaces "Staff view telemetry for their ward", whose EXISTS subquery carried
-- the same `OR public.get_auth_user_ward() IS NULL` leak. A nurse's readings are
-- now reachable only through an assigned patient.

CREATE POLICY "readings readable within scope"
    ON public.iv_telemetry FOR SELECT
    TO authenticated
    USING (public.is_active_user() AND public.can_access_session(session_id));

-- No INSERT / UPDATE / DELETE policy. Writes come from the ingest-telemetry Edge
-- Function via a per-device secret, and trg_iv_telemetry_immutable (00300) plus
-- the REVOKEs in 00500 make that the only path even for ADMIN.

-- -----------------------------------------------------------------------------
-- 9. alerts
-- -----------------------------------------------------------------------------
-- Replaces "Staff view alerts for their ward" (same NULL-ward leak) and
-- "Staff acknowledge alerts with audit trail", which permitted a direct UPDATE
-- setting is_acknowledged = TRUE with no acknowledgement row and no audit entry.

CREATE POLICY "alerts readable within scope"
    ON public.alerts FOR SELECT
    TO authenticated
    USING (public.is_active_user() AND public.can_access_alert(id));

-- No UPDATE policy. Acknowledgement happens only inside acknowledge_alert(),
-- which inserts the alert_acknowledgements row, sets alerts.status and writes
-- the audit_logs row in one transaction (migration 00600).
-- No INSERT policy: only the ingest path creates alerts.
-- No DELETE policy, and 00300 additionally blocks a cascade from a deleted
-- session or patient, so an alert cannot be destroyed by any route.

-- -----------------------------------------------------------------------------
-- 10. alert_acknowledgements
-- -----------------------------------------------------------------------------
-- SELECT policy created in 00200. No INSERT / UPDATE / DELETE policy, and
-- trg_alert_ack_immutable refuses them at the trigger level as well.

-- -----------------------------------------------------------------------------
-- 11. audit_logs
-- -----------------------------------------------------------------------------
-- Replaces "Staff view relevant audit logs", which let a WARD_SISTER read the
-- whole hospital's audit trail, and "System and users insert audit logs", which
-- let any user forge rows.

CREATE POLICY "admin reads audit logs"
    ON public.audit_logs FOR SELECT
    TO authenticated
    USING (public.is_active_user() AND public.is_admin());

-- No INSERT policy. Rows come from SECURITY DEFINER triggers and RPCs, which
-- write as the table owner and therefore bypass RLS legitimately.
-- No UPDATE or DELETE policy, and trg_audit_logs_immutable blocks them for
-- trusted writers too, so the trail is append-only even against a DBA mistake.

-- -----------------------------------------------------------------------------
-- 12. Spec-named compatibility views
-- -----------------------------------------------------------------------------
-- The role model in the brief refers to bag_readings and iv_bags. This schema
-- calls the telemetry table iv_telemetry and has no separate bag table, so the
-- mapping is made explicit here instead of duplicating storage.
--
-- security_invoker = on (PostgreSQL 15+) makes each view run with the CALLER's
-- permissions, so the RLS policies above govern them. Without it a view runs as
-- its owner and would quietly bypass the entire matrix.

CREATE OR REPLACE VIEW public.bag_readings
WITH (security_invoker = on)
AS
SELECT
    t.id                AS id,
    t.session_id,
    s.patient_id,
    s.ward_id,
    t.device_id,
    t.raw_mass_g,
    t.calculated_volume_ml,
    t.current_flow_rate_ml_hr,
    t.status,
    t.battery_level,
    t.wifi_rssi,
    t.recorded_at
FROM public.iv_telemetry t
JOIN public.iv_sessions s ON s.id = t.session_id;

COMMENT ON VIEW public.bag_readings IS
    'Spec-named alias for iv_telemetry, carrying patient_id and ward_id so readings can be authorised per assigned patient. security_invoker=on: RLS applies. Client-writable by nobody.';

CREATE OR REPLACE VIEW public.iv_bags
WITH (security_invoker = on)
AS
SELECT
    s.id                    AS id,
    s.patient_id,
    s.ward_id,
    s.device_id,
    s.medication_name,
    s.initial_volume_ml,
    s.target_flow_rate_ml_hr,
    s.low_threshold_ml,
    s.critical_threshold_ml,
    s.empty_threshold_ml,
    s.empty_bag_mass_g,
    s.fluid_density_g_ml,
    s.status                AS session_status,
    s.started_at,
    s.completed_at,
    t.current_volume_ml     AS latest_volume_ml,
    t.status                AS latest_status,
    t.recorded_at           AS last_reading_at
FROM public.iv_sessions s
LEFT JOIN LATERAL (
    SELECT tt.calculated_volume_ml, tt.status, tt.recorded_at
      FROM public.iv_telemetry tt
     WHERE tt.session_id = s.id
     ORDER BY tt.recorded_at DESC
     LIMIT 1
) t ON TRUE;

COMMENT ON VIEW public.iv_bags IS
    'Spec-named alias for the bag carried by an IV session, with the latest reading attached. security_invoker=on: RLS applies. Write paths remain on iv_sessions.';

-- -----------------------------------------------------------------------------
-- 13. Documentation
-- -----------------------------------------------------------------------------

COMMENT ON TABLE public.iv_telemetry IS
    'Bag weight readings from the ESP32 pole unit. This is the table the brief calls bag_readings; see the bag_readings view. Insert-only via the ingest Edge Function.';

COMMENT ON TABLE public.alerts IS
    'Alert records. Rows are permanent: acknowledgement adds an alert_acknowledgements row and sets status, and nothing may delete or edit an alert afterwards.';
