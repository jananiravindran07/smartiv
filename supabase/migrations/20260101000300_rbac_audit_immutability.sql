-- =============================================================================
-- SMART IV MONITORING SYSTEM - RBAC STEP 3: IMMUTABILITY + AUDIT TRAIL
-- Academic Prototype - Not a Certified Medical Device
-- -----------------------------------------------------------------------------
-- ADDITIVE. Never edits previously applied migrations.
--
-- Fixes addressed here (audit gap numbers):
--   * Gap 3  - audit_logs INSERT was granted to `authenticated` with the check
--              `user_id = auth.uid()`, so any user could forge an audit row
--              with an arbitrary action/entity/metadata. That policy is dropped
--              in 00400 and INSERT is revoked in 00500. From here on audit_logs
--              is written ONLY by SECURITY DEFINER triggers and RPCs.
--   * Gap 4  - alerts could be destroyed by deleting the parent iv_sessions or
--              patients row (ON DELETE CASCADE). Clients can no longer delete
--              either parent, and alerts itself is now mutation-locked.
--   * Gap 5  - alerts could be flipped to is_acknowledged by a direct UPDATE
--              with no acknowledgement row and no audit entry. The only writer
--              is now acknowledge_alert() (migration 00600).
--   * Gap 15 - nothing was audited at all. Patient create/update, session
--              start/end, device change, threshold change, role change and
--              login/logout now all write audit_logs rows.
--
-- Every guard below is a trigger rather than only an RLS policy, on purpose:
-- RLS protects table access, but a SECURITY DEFINER function or a future
-- policy could otherwise become a back door. Triggers fire for every writer.
--
-- NOTE ON bag_readings: this schema names the telemetry table iv_telemetry.
-- bag_readings and iv_telemetry are the same thing; the mapping is documented
-- in 00400 which adds the spec-named bag_readings view over it.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. RPC ARMOURED FLAGS
-- -----------------------------------------------------------------------------
-- A SECURITY DEFINER RPC runs as its owner, so RLS and the guards below cannot
-- tell it apart from a DBA session. Each sanctioned write path therefore arms a
-- transaction-local flag from a helper whose EXECUTE is revoked from PUBLIC in
-- migration 00500, so only owner-level code can raise it. A PostgREST client
-- cannot abuse this: one HTTP request is one transaction, and a
-- transaction-local set_config dies at the end of it.

CREATE OR REPLACE FUNCTION public._arm_ack_rpc()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
    PERFORM set_config('smartiv.ack_rpc', 'on', true);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.ack_rpc_authorized()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $fn$
    SELECT COALESCE(current_setting('smartiv.ack_rpc', true), 'off') = 'on';
$fn$;

-- Third flag: "an audited write is in progress".
--
-- audit_logs itself is guarded below, so the sanctioned writers have to declare
-- themselves. This one is raised by the audit triggers themselves and by the
-- RPCs that perform a clinical or administrative action, so that
-- "write an audit row" and "perform the action" are always the same
-- transaction. Without it the trail could not record itself.
CREATE OR REPLACE FUNCTION public._arm_audit_write()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
    PERFORM set_config('smartiv.audit_write', 'on', true);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.audit_write_authorized()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $fn$
    SELECT COALESCE(current_setting('smartiv.audit_write', true), 'off') = 'on';
$fn$;

-- -----------------------------------------------------------------------------
-- 2. IMMUTABILITY GUARD
-- -----------------------------------------------------------------------------
-- Locks, for every role including ADMIN:
--   iv_telemetry  (= bag_readings) : INSERT/UPDATE/DELETE -> trusted writers only
--   alerts                          : UPDATE/DELETE        -> acknowledge_alert() only
--                                     INSERT              -> ingest path only
--   alert_acknowledgements          : INSERT/UPDATE/DELETE-> acknowledge_alert() only
--   audit_logs                      : INSERT/UPDATE/DELETE-> trusted writers only
--
-- "No client role" is enforced literally: a NURSE, a WARD_SISTER and an ADMIN
-- are all refused, because the spec's ADMIN row says an admin must not be able
-- to silently edit or delete readings, alerts, acknowledgements or audit logs.

CREATE OR REPLACE FUNCTION public.guard_immutable_table()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
    v_table TEXT := TG_TABLE_NAME;
BEGIN
    -- Service-role Edge Functions, ingest, migrations and seed data.
    IF public.trusted_writer() THEN
        RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
    END IF;

    -- audit_logs: append-only, and writable only by the audit triggers and the
    -- sanctioned RPCs while they arm the audit-write flag. UPDATE and DELETE are
    -- refused even to those, so the trail can be written but never rewritten.
    IF v_table = 'audit_logs' THEN
        IF TG_OP = 'INSERT' AND public.audit_write_authorized() THEN
            RETURN NEW;
        END IF;

        RAISE EXCEPTION
            'audit_logs is append-only and writable only by system triggers/RPCs (insufficient_privilege)'
            USING ERRCODE = '42501',
                  HINT = 'Use log_event() or the RPC that performs the action.';
    END IF;

    -- alert_acknowledgements: written only inside acknowledge_alert().
    IF v_table = 'alert_acknowledgements' THEN
        IF public.ack_rpc_authorized() AND TG_OP = 'INSERT' THEN
            RETURN NEW;
        END IF;

        RAISE EXCEPTION
            'alert_acknowledgements may only be appended by acknowledge_alert() (insufficient_privilege)'
            USING ERRCODE = '42501';
    END IF;

    -- alerts: acknowledgement is the single legal mutation, and it must go
    -- through the RPC so the acknowledgement row and the audit row are written
    -- in the same transaction.
    IF v_table = 'alerts' THEN
        IF TG_OP = 'INSERT' THEN
            RAISE EXCEPTION
                'alerts rows are created only by the telemetry ingest path (insufficient_privilege)'
                USING ERRCODE = '42501',
                      HINT = 'ESP32 telemetry must arrive through the ingest-telemetry Edge Function.';
        END IF;

        IF public.ack_rpc_authorized() AND TG_OP = 'UPDATE' THEN
            RETURN NEW;
        END IF;

        RAISE EXCEPTION
            'alerts rows cannot be modified or deleted by any client role (insufficient_privilege)'
            USING ERRCODE = '42501',
                  HINT = 'Use acknowledge_alert(); the alert row itself is never deleted.';
    END IF;

    -- iv_telemetry / bag_readings: the ingest path only.
    IF v_table = 'iv_telemetry' THEN
        RAISE EXCEPTION
            'bag_readings (iv_telemetry) is written only by the telemetry ingest path (insufficient_privilege)'
            USING ERRCODE = '42501',
                  HINT = 'ESP32 telemetry must arrive through the ingest-telemetry Edge Function.';
    END IF;

    RAISE EXCEPTION '% is not client-writable (insufficient_privilege)', v_table
        USING ERRCODE = '42501';
END;
$fn$;

COMMENT ON FUNCTION public.guard_immutable_table() IS
    'Refuses every client INSERT/UPDATE/DELETE on readings, alerts, acknowledgements and audit logs. The only exceptions are trusted server-side writers and acknowledge_alert().';

DROP TRIGGER IF EXISTS trg_iv_telemetry_immutable ON public.iv_telemetry;
CREATE TRIGGER trg_iv_telemetry_immutable
    BEFORE INSERT OR UPDATE OR DELETE ON public.iv_telemetry
    FOR EACH ROW EXECUTE FUNCTION public.guard_immutable_table();

DROP TRIGGER IF EXISTS trg_alerts_immutable ON public.alerts;
CREATE TRIGGER trg_alerts_immutable
    BEFORE INSERT OR UPDATE OR DELETE ON public.alerts
    FOR EACH ROW EXECUTE FUNCTION public.guard_immutable_table();

DROP TRIGGER IF EXISTS trg_alert_ack_immutable ON public.alert_acknowledgements;
CREATE TRIGGER trg_alert_ack_immutable
    BEFORE INSERT OR UPDATE OR DELETE ON public.alert_acknowledgements
    FOR EACH ROW EXECUTE FUNCTION public.guard_immutable_table();

DROP TRIGGER IF EXISTS trg_audit_logs_immutable ON public.audit_logs;
CREATE TRIGGER trg_audit_logs_immutable
    BEFORE INSERT OR UPDATE OR DELETE ON public.audit_logs
    FOR EACH ROW EXECUTE FUNCTION public.guard_immutable_table();

-- -----------------------------------------------------------------------------
-- 3. KEEP alerts.is_acknowledged IN SYNC WITH alerts.status
-- -----------------------------------------------------------------------------
-- The legacy boolean is retained for the existing web client and the realtime
-- publication. Because alerts are otherwise mutation-locked, this trigger is
-- the only thing that can move the two columns together.

CREATE OR REPLACE FUNCTION public.sync_alert_acknowledgement_flag()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $fn$
BEGIN
    IF TG_OP = 'INSERT' THEN
        NEW.is_acknowledged := (NEW.status IN ('ACKNOWLEDGED', 'RESOLVED'));
        NEW.acknowledged_at := CASE
            WHEN NEW.status IN ('ACKNOWLEDGED', 'RESOLVED') AND NEW.acknowledged_at IS NULL
                THEN NOW()
            ELSE NEW.acknowledged_at
        END;
    ELSE
        IF NEW.status IS DISTINCT FROM OLD.status THEN
            IF NEW.status IN ('ACKNOWLEDGED', 'RESOLVED') THEN
                NEW.is_acknowledged := TRUE;
                IF NEW.acknowledged_at IS NULL THEN
                    NEW.acknowledged_at := NOW();
                END IF;
            ELSE
                -- Re-opening is only meaningful while still inside the
                -- acknowledge_alert() transaction; nothing else may do it.
                IF NOT public.ack_rpc_authorized() THEN
                    RAISE EXCEPTION
                        'alerts.status may not be reset without acknowledge_alert() (insufficient_privilege)'
                        USING ERRCODE = '42501';
                END IF;
                NEW.is_acknowledged := FALSE;
            END IF;
        END IF;
    END IF;

    RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_alerts_sync_ack ON public.alerts;
CREATE TRIGGER trg_alerts_sync_ack
    BEFORE INSERT OR UPDATE ON public.alerts
    FOR EACH ROW EXECUTE FUNCTION public.sync_alert_acknowledgement_flag();

-- -----------------------------------------------------------------------------
-- 4. AUDIT TRAIL
-- -----------------------------------------------------------------------------
-- One generic AFTER-row trigger drives the whole trail. It runs as SECURITY
-- DEFINER, so it can write audit_logs even though no client role is granted
-- INSERT there any more.
--
-- Arguments: entity_type, insert_action, update_action, [delete_action]

CREATE OR REPLACE FUNCTION public.audit_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
    v_entity_type TEXT := TG_ARGV[0];
    v_action      TEXT;
    v_entity_id   UUID;
    v_row         JSONB;
    v_meta        JSONB := '{}'::jsonb;
BEGIN
    PERFORM public._arm_audit_write();

    IF TG_OP = 'INSERT' THEN
        v_action    := TG_ARGV[1];
        v_entity_id := COALESCE((to_jsonb(NEW) ->> 'id')::UUID, NEW.nurse_id);
        v_row       := to_jsonb(NEW);
    ELSIF TG_OP = 'UPDATE' THEN
        v_action    := TG_ARGV[2];
        v_entity_id := COALESCE((to_jsonb(NEW) ->> 'id')::UUID, NEW.nurse_id);
        v_row       := jsonb_build_object('before', to_jsonb(OLD), 'after', to_jsonb(NEW));
    ELSE
        v_action    := COALESCE(TG_ARGV[3], TG_ARGV[2]);
        v_entity_id := COALESCE((to_jsonb(OLD) ->> 'id')::UUID, OLD.nurse_id);
        v_row       := to_jsonb(OLD);
    END IF;

    IF v_action IS NULL OR v_action = '' THEN
        RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
    END IF;

    v_meta := v_meta || jsonb_build_object(
        'source', 'trigger',
        'entity', v_entity_type
    );

    -- Surface the fields an auditor actually reads, without making them dig
    -- through the whole row snapshot.
    IF TG_OP = 'UPDATE' THEN
        IF v_entity_type = 'PROFILE' THEN
            IF NEW.role IS DISTINCT FROM OLD.role THEN
                v_meta := v_meta || jsonb_build_object('role_change',
                    jsonb_build_object('from', OLD.role, 'to', NEW.role));
            END IF;
            IF NEW.ward_id IS DISTINCT FROM OLD.ward_id THEN
                v_meta := v_meta || jsonb_build_object('ward_change',
                    jsonb_build_object('from', OLD.ward_id, 'to', NEW.ward_id));
            END IF;
            IF NEW.is_active IS DISTINCT FROM OLD.is_active THEN
                v_meta := v_meta || jsonb_build_object('active_change',
                    jsonb_build_object('from', OLD.is_active, 'to', NEW.is_active));
            END IF;
        ELSIF v_entity_type = 'IV_SESSION' THEN
            IF NEW.status IS DISTINCT FROM OLD.status THEN
                v_meta := v_meta || jsonb_build_object('session_status',
                    jsonb_build_object('from', OLD.status, 'to', NEW.status));
            END IF;
        END IF;
    END IF;

    INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, metadata)
    VALUES (auth.uid(), v_action, v_entity_type, v_entity_id, v_meta || jsonb_build_object('row', v_row));

    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$fn$;

COMMENT ON FUNCTION public.audit_change() IS
    'Generic AFTER INSERT/UPDATE/DELETE audit writer. SECURITY DEFINER so it can still write audit_logs after client INSERT is revoked.';

-- Patients: create + update (sister in her ward, or admin)
DROP TRIGGER IF EXISTS trg_audit_patients ON public.patients;
CREATE TRIGGER trg_audit_patients
    AFTER INSERT OR UPDATE ON public.patients
    FOR EACH ROW EXECUTE FUNCTION public.audit_change(
        'PATIENT', 'PATIENT_CREATED', 'PATIENT_UPDATED');

-- IV sessions: start, modify, end. A status change to a terminal value is
-- reported as SESSION_ENDED so the trail answers "when was this stopped".
DROP TRIGGER IF EXISTS trg_audit_iv_sessions ON public.iv_sessions;
CREATE TRIGGER trg_audit_iv_sessions
    AFTER INSERT OR UPDATE ON public.iv_sessions
    FOR EACH ROW EXECUTE FUNCTION public.audit_change(
        'IV_SESSION', 'SESSION_STARTED', 'SESSION_UPDATED');

CREATE OR REPLACE FUNCTION public.audit_session_end()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
    PERFORM public._arm_audit_write();

    IF NEW.status IS DISTINCT FROM OLD.status
       AND NEW.status IN ('COMPLETED', 'ABORTED') THEN
        INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, metadata)
        VALUES (auth.uid(), 'SESSION_ENDED', 'IV_SESSION', NEW.id,
                jsonb_build_object(
                    'source', 'trigger',
                    'from', OLD.status,
                    'to',   NEW.status,
                    'row',  jsonb_build_object('before', to_jsonb(OLD), 'after', to_jsonb(NEW))));
    END IF;
    RETURN NULL;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_audit_session_end ON public.iv_sessions;
CREATE TRIGGER trg_audit_session_end
    AFTER UPDATE ON public.iv_sessions
    FOR EACH ROW EXECUTE FUNCTION public.audit_session_end();

-- Devices: create, change, deactivate
DROP TRIGGER IF EXISTS trg_audit_devices ON public.devices;
CREATE TRIGGER trg_audit_devices
    AFTER INSERT OR UPDATE ON public.devices
    FOR EACH ROW EXECUTE FUNCTION public.audit_change(
        'DEVICE', 'DEVICE_CREATED', 'DEVICE_CHANGED');

-- Wards: create, change
DROP TRIGGER IF EXISTS trg_audit_wards ON public.wards;
CREATE TRIGGER trg_audit_wards
    AFTER INSERT OR UPDATE ON public.wards
    FOR EACH ROW EXECUTE FUNCTION public.audit_change(
        'WARD', 'WARD_CREATED', 'WARD_CHANGED');

-- Monitoring parameters: the spec's "threshold change"
DROP TRIGGER IF EXISTS trg_audit_monitoring_parameters ON public.monitoring_parameters;
CREATE TRIGGER trg_audit_monitoring_parameters
    AFTER INSERT OR UPDATE ON public.monitoring_parameters
    FOR EACH ROW EXECUTE FUNCTION public.audit_change(
        'MONITORING_PARAMETERS', 'THRESHOLD_CREATED', 'THRESHOLD_CHANGED');

-- Nurse assignments: allocation changes are clinically significant
DROP TRIGGER IF EXISTS trg_audit_nurse_assignments ON public.nurse_assignments;
CREATE TRIGGER trg_audit_nurse_assignments
    AFTER INSERT OR UPDATE ON public.nurse_assignments
    FOR EACH ROW EXECUTE FUNCTION public.audit_change(
        'NURSE_ASSIGNMENT', 'NURSE_ASSIGNED', 'NURSE_ASSIGNMENT_CHANGED');

-- Role / ward / activation changes. This is the "role change" audit entry the
-- spec requires for every privilege change, including deactivation.
DROP TRIGGER IF EXISTS trg_audit_profiles ON public.profiles;
CREATE TRIGGER trg_audit_profiles
    AFTER UPDATE ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION public.audit_change(
        'PROFILE', NULL, 'PROFILE_UPDATED');

-- -----------------------------------------------------------------------------
-- 5. log_event() RPC  --  LOGIN / LOGOUT
-- -----------------------------------------------------------------------------
-- Deliberately narrow. The spec requires clients to report LOGIN and LOGOUT,
-- but a general-purpose log_event(p_action) callable by any user would reopen
-- audit forgery (gap 3): a nurse could log 'PATIENT_CREATED' or invent an
-- entity_id. So the action is checked against a fixed allow-list and the row is
-- always attributed to auth.uid() with entity_type 'SESSION'.
--
-- Returning the new audit id lets the client correlate the call with a failure.

CREATE OR REPLACE FUNCTION public.log_event(p_action TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
    v_id UUID;
BEGIN
    PERFORM public._arm_audit_write();

    IF NOT public.is_active_user() THEN
        RAISE EXCEPTION 'log_event: no active profile for this session (insufficient_privilege)'
            USING ERRCODE = '42501';
    END IF;

    IF p_action IS NULL OR p_action NOT IN ('LOGIN', 'LOGOUT', 'SESSION_EXPIRED') THEN
        RAISE EXCEPTION 'log_event: action % is not permitted', p_action
            USING ERRCODE = '22023',
                  HINT = 'Only LOGIN, LOGOUT and SESSION_EXPIRED may be self-reported.';
    END IF;

    INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, metadata)
    VALUES (
        auth.uid(),
        upper(p_action),
        'SESSION',
        auth.uid(),
        jsonb_build_object(
            'source',   'rpc',
            'role',     public.auth_role(),
            'ward_id',  public.auth_ward_id(),
            'user_name', (SELECT p.full_name FROM public.profiles p WHERE p.id = auth.uid())
        )
    )
    RETURNING id INTO v_id;

    RETURN v_id;
END;
$fn$;

COMMENT ON FUNCTION public.log_event(TEXT) IS
    'Client-callable audit hook, restricted to LOGIN / LOGOUT / SESSION_EXPIRED and always attributed to the caller. All other audit rows come from triggers or admin RPCs.';

-- -----------------------------------------------------------------------------
-- 6. Halt cascade deletion of clinical history
-- -----------------------------------------------------------------------------
-- alerts, iv_telemetry and alert_acknowledgements hang off iv_sessions and
-- patients with ON DELETE CASCADE. Client DELETE on those parents is removed in
-- 00400, but a cascade is a silent, unaudited way to destroy an alert, so the
-- parents themselves now refuse to be deleted while clinical history exists.
-- Wards and devices keep their existing cascade behaviour, which is correct:
-- removing a ward or a pole unit should not orphan live monitoring data, and
-- only ADMIN can do it (00400).

CREATE OR REPLACE FUNCTION public.guard_clinical_history_deletion()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
    v_sessions BIGINT;
    v_alerts   BIGINT;
BEGIN
    IF public.trusted_writer() THEN
        RETURN OLD;
    END IF;

    IF TG_TABLE_NAME = 'patients' THEN
        SELECT COUNT(*) INTO v_alerts FROM public.alerts    WHERE patient_id = OLD.id;
        IF v_alerts > 0 THEN
            RAISE EXCEPTION
                'patients: cannot delete a patient with % alert record(s); clinical history is permanent',
                v_alerts USING ERRCODE = '23503';
        END IF;
        SELECT COUNT(*) INTO v_sessions FROM public.iv_sessions WHERE patient_id = OLD.id;
        IF v_sessions > 0 THEN
            RAISE EXCEPTION
                'patients: cannot delete a patient with % IV session(s); end the sessions first',
                v_sessions USING ERRCODE = '23503';
        END IF;
    ELSIF TG_TABLE_NAME = 'iv_sessions' THEN
        SELECT COUNT(*) INTO v_alerts FROM public.alerts WHERE session_id = OLD.id;
        IF v_alerts > 0 THEN
            RAISE EXCEPTION
                'iv_sessions: cannot delete a session with % alert record(s); clinical history is permanent',
                v_alerts USING ERRCODE = '23503';
        END IF;
        SELECT COUNT(*) INTO v_sessions FROM public.iv_telemetry WHERE session_id = OLD.id;
        IF v_sessions > 0 THEN
            RAISE EXCEPTION
                'iv_sessions: cannot delete a session with % reading(s)', v_sessions
                USING ERRCODE = '23503';
        END IF;
    END IF;

    RETURN OLD;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_patients_no_history_delete ON public.patients;
CREATE TRIGGER trg_patients_no_history_delete
    BEFORE DELETE ON public.patients
    FOR EACH ROW EXECUTE FUNCTION public.guard_clinical_history_deletion();

DROP TRIGGER IF EXISTS trg_iv_sessions_no_history_delete ON public.iv_sessions;
CREATE TRIGGER trg_iv_sessions_no_history_delete
    BEFORE DELETE ON public.iv_sessions
    FOR EACH ROW EXECUTE FUNCTION public.guard_clinical_history_deletion();
