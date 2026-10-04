-- =============================================================================
-- SMART IV MONITORING SYSTEM - RBAC STEP 2: ASSIGNMENT + ACKNOWLEDGEMENT DATA
-- Academic Prototype - Not a Certified Medical Device
-- -----------------------------------------------------------------------------
-- ADDITIVE. Never edits previously applied migrations.
--
-- Fixes addressed here (audit gap numbers):
--   * Gap 7 - "assigned patients" did not exist as data. There was no
--              nurse_assignments table at all, so nurse visibility was
--              ward-wide. Created here, with public.is_assigned_to().
--   * Gap 8 - acknowledgement was denormalised onto alerts (three loose
--              columns). The spec requires a separate append-only
--              alert_acknowledgements row carrying user id, user name,
--              timestamp and status. Created here.
--   * alerts gains a real `status` column so acknowledge_alert() can set
--              'ACKNOWLEDGED' as the spec requires. is_acknowledged is kept
--              and maintained by trigger so the existing web UI, the realtime
--              publication and the old seed keep working unchanged.
--   * monitoring_parameters gives ADMIN the "Monitoring Parameters" surface.
--     Previously thresholds were hardcoded per iv_sessions row with no
--     hospital- or ward-level configuration at all.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. ENUMS
-- -----------------------------------------------------------------------------

DO $$ BEGIN
    CREATE TYPE alert_status AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE acknowledgement_status AS ENUM ('ACKNOWLEDGED', 'ESCALATED', 'RESOLVED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- -----------------------------------------------------------------------------
-- 2. nurse_assignments  -- "assigned patients" becomes real data
-- -----------------------------------------------------------------------------
-- A nurse may only ever see a patient through this table. Policies never
-- grant a nurse ward-wide access, so removing a row here immediately revokes
-- visibility at the database level.
--
-- ward_id is denormalised from the patient so the hot policy path is a single
-- index lookup. trg_nurse_assignments_ward_lock below guarantees it can never
-- drift from the patient's actual ward.

CREATE TABLE IF NOT EXISTS public.nurse_assignments (
    nurse_id     UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    patient_id   UUID NOT NULL REFERENCES public.patients(id)   ON DELETE CASCADE,
    ward_id      UUID NOT NULL REFERENCES public.wards(id)      ON DELETE CASCADE,
    assigned_by  UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    assigned_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at   TIMESTAMPTZ,
    revoked_by   UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    CONSTRAINT pk_nurse_assignments PRIMARY KEY (nurse_id, patient_id)
);

COMMENT ON TABLE public.nurse_assignments IS
    'Which nurse is responsible for which patient. The single source of truth for nurse-level read access; ward membership alone grants nothing.';

CREATE INDEX IF NOT EXISTS idx_nurse_assignments_patient
    ON public.nurse_assignments (patient_id);
CREATE INDEX IF NOT EXISTS idx_nurse_assignments_nurse_active
    ON public.nurse_assignments (nurse_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_nurse_assignments_ward
    ON public.nurse_assignments (ward_id);

-- Keep ward_id consistent with the patient's ward, and refuse to assign a
-- patient to somebody who is not an active NURSE in that same ward.
CREATE OR REPLACE FUNCTION public.guard_nurse_assignment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
    v_patient_ward UUID;
    v_nurse_ward   UUID;
    v_nurse_role   public.user_role;
    v_nurse_active BOOLEAN;
BEGIN
    SELECT p.ward_id INTO v_patient_ward
      FROM public.patients p WHERE p.id = NEW.patient_id;

    IF v_patient_ward IS NULL THEN
        RAISE EXCEPTION 'nurse_assignments: patient % does not exist', NEW.patient_id
            USING ERRCODE = '23503';
    END IF;

    -- A nurse cannot be assigned to a patient in another ward.
    IF v_patient_ward IS DISTINCT FROM NEW.ward_id THEN
        RAISE EXCEPTION
            'nurse_assignments: ward_id (%) must match the patient''s ward (%)',
            NEW.ward_id, v_patient_ward
            USING ERRCODE = '23514';
    END IF;

    SELECT p.ward_id, p.role, p.is_active
      INTO v_nurse_ward, v_nurse_role, v_nurse_active
      FROM public.profiles p WHERE p.id = NEW.nurse_id;

    IF v_nurse_role IS DISTINCT FROM 'NURSE' THEN
        RAISE EXCEPTION 'nurse_assignments: % is not a NURSE', NEW.nurse_id
            USING ERRCODE = '23514';
    END IF;

    IF NOT COALESCE(v_nurse_active, false) THEN
        RAISE EXCEPTION 'nurse_assignments: nurse % is deactivated', NEW.nurse_id
            USING ERRCODE = '23514';
    END IF;

    IF v_nurse_ward IS DISTINCT FROM v_patient_ward THEN
        RAISE EXCEPTION
            'nurse_assignments: nurse % is in ward % but the patient is in ward %',
            NEW.nurse_id, v_nurse_ward, v_patient_ward
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_nurse_assignments_guard ON public.nurse_assignments;
CREATE TRIGGER trg_nurse_assignments_guard
    BEFORE INSERT OR UPDATE ON public.nurse_assignments
    FOR EACH ROW
    EXECUTE FUNCTION public.guard_nurse_assignment();

-- -----------------------------------------------------------------------------
-- 3. alert_acknowledgements  -- append-only, one row per acknowledgement
-- -----------------------------------------------------------------------------
-- The alerts row is never deleted and never has its history rewritten. Each
-- acknowledgement is a new immutable row, so "who saw this alert and when"
-- survives any later state change on the alert itself.

CREATE TABLE IF NOT EXISTS public.alert_acknowledgements (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    alert_id        UUID NOT NULL REFERENCES public.alerts(id) ON DELETE RESTRICT,
    user_id         UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    -- Name is snapshotted so the trail stays readable even if the person is
    -- later deactivated or renamed.
    user_full_name  TEXT NOT NULL,
    user_role       public.user_role NOT NULL,
    ward_id         UUID NOT NULL REFERENCES public.wards(id) ON DELETE RESTRICT,
    status          acknowledgement_status NOT NULL DEFAULT 'ACKNOWLEDGED',
    notes           TEXT,
    acknowledged_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.alert_acknowledgements IS
    'Append-only acknowledgement trail. Rows are inserted only by acknowledge_alert(); no client role may insert, update or delete them.';

CREATE INDEX IF NOT EXISTS idx_alert_ack_alert_time
    ON public.alert_acknowledgements (alert_id, acknowledged_at DESC);
CREATE INDEX IF NOT EXISTS idx_alert_ack_user_time
    ON public.alert_acknowledgements (user_id, acknowledged_at DESC);
CREATE INDEX IF NOT EXISTS idx_alert_ack_ward_time
    ON public.alert_acknowledgements (ward_id, acknowledged_at DESC);

-- At most one row per (alert, user, status-change). Prevents double-tap spam
-- while still allowing a genuine escalation after an acknowledgement.
CREATE UNIQUE INDEX IF NOT EXISTS uq_alert_ack_alert_user
    ON public.alert_acknowledgements (alert_id, user_id);

-- -----------------------------------------------------------------------------
-- 4. alerts.status
-- -----------------------------------------------------------------------------
-- Added alongside the legacy is_acknowledged boolean rather than replacing it,
-- so the old seed, the web client and the realtime publication are unaffected.
-- A trigger in migration 00300 keeps the two columns in agreement.

ALTER TABLE public.alerts
    ADD COLUMN IF NOT EXISTS status alert_status NOT NULL DEFAULT 'OPEN';

UPDATE public.alerts
   SET status = CASE WHEN is_acknowledged THEN 'ACKNOWLEDGED'::alert_status
                     ELSE 'OPEN'::alert_status END
 WHERE status::TEXT <> CASE WHEN is_acknowledged THEN 'ACKNOWLEDGED' ELSE 'OPEN' END;

CREATE INDEX IF NOT EXISTS idx_alerts_ward_status
    ON public.alerts (ward_id, status, triggered_at DESC);

-- -----------------------------------------------------------------------------
-- 5. monitoring_parameters  -- ADMIN-owned configuration surface
-- -----------------------------------------------------------------------------
-- ward_id NULL means a hospital-wide default; a row with a ward_id overrides
-- it for that ward. iv_sessions keeps its own per-session threshold snapshot,
-- so changing a parameter never rewrites historical clinical records.

CREATE TABLE IF NOT EXISTS public.monitoring_parameters (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ward_id                 UUID REFERENCES public.wards(id) ON DELETE CASCADE,
    name                    TEXT NOT NULL,
    low_threshold_ml        NUMERIC(8, 2) NOT NULL DEFAULT 100.00
                                CHECK (low_threshold_ml >= 0),
    critical_threshold_ml   NUMERIC(8, 2) NOT NULL DEFAULT 30.00
                                CHECK (critical_threshold_ml >= 0),
    empty_threshold_ml      NUMERIC(8, 2) NOT NULL DEFAULT 5.00
                                CHECK (empty_threshold_ml >= 0),
    flow_stop_threshold_ml_hr NUMERIC(8, 2) NOT NULL DEFAULT 5.00
                                CHECK (flow_stop_threshold_ml_hr >= 0),
    flow_stop_window_minutes   INTEGER NOT NULL DEFAULT 5
                                CHECK (flow_stop_window_minutes > 0),
    alert_cooldown_minutes      INTEGER NOT NULL DEFAULT 10
                                CHECK (alert_cooldown_minutes >= 0),
    is_active               BOOLEAN NOT NULL DEFAULT TRUE,
    updated_by              UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Thresholds must be ordered, otherwise the ingest threshold cascade in
    -- ingest_telemetry_secure() can never fire the CRITICAL branch.
    CONSTRAINT chk_monitoring_parameters_ordering
        CHECK (empty_threshold_ml <= critical_threshold_ml
               AND critical_threshold_ml <= low_threshold_ml)
);

COMMENT ON TABLE public.monitoring_parameters IS
    'Alert threshold configuration. ward_id NULL = hospital-wide default. Readable and writable by ADMIN only; nurses and ward sisters are denied by RLS.';

-- One row per name per ward (or one global row per name).
CREATE UNIQUE INDEX IF NOT EXISTS uq_monitoring_parameters_scope
    ON public.monitoring_parameters (COALESCE(ward_id, '00000000-0000-0000-0000-000000000000'::uuid), name);

CREATE INDEX IF NOT EXISTS idx_monitoring_parameters_ward
    ON public.monitoring_parameters (ward_id);

DROP TRIGGER IF EXISTS trg_monitoring_parameters_updated_at ON public.monitoring_parameters;
CREATE TRIGGER trg_monitoring_parameters_updated_at
    BEFORE UPDATE ON public.monitoring_parameters
    FOR EACH ROW
    EXECUTE FUNCTION public.touch_updated_at();

-- Resolution helper: ward override first, hospital-wide default second.
CREATE OR REPLACE FUNCTION public.effective_monitoring_parameters(p_ward_id UUID)
RETURNS public.monitoring_parameters
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
    SELECT *
      FROM public.monitoring_parameters
     WHERE is_active
       AND (ward_id = p_ward_id OR ward_id IS NULL)
     ORDER BY (ward_id IS NOT NULL) DESC
     LIMIT 1;
$fn$;

-- -----------------------------------------------------------------------------
-- 6. THE FIFTH HELPER: is_assigned_to()
-- -----------------------------------------------------------------------------
-- Deferred from 00100 because it depends on nurse_assignments.
--
-- Returns true only when ALL of the following hold:
--   * the caller is an authenticated, active NURSE
--   * an unrevoked assignment row links them to that patient
--   * the assignment is in the caller's own ward
--   * the patient is still in that ward
--
-- SECURITY DEFINER + a pinned search_path means the subqueries below read
-- nurse_assignments and patients as the owner, so this cannot recurse back
-- into the RLS policies that call it.

CREATE OR REPLACE FUNCTION public.is_assigned_to(p_patient_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
    SELECT COALESCE(
        (
            SELECT (
                public.auth_role() = 'NURSE'
                AND na.ward_id IS NOT DISTINCT FROM public.auth_ward_id()
                AND na.ward_id IS NOT DISTINCT FROM pt.ward_id
            )
            FROM public.nurse_assignments na
            JOIN public.patients pt ON pt.id = na.patient_id
            WHERE na.nurse_id    = auth.uid()
              AND na.patient_id  = p_patient_id
              AND na.revoked_at IS NULL
            LIMIT 1
        ),
        false
    );
$fn$;

COMMENT ON FUNCTION public.is_assigned_to(UUID) IS
    'True only for an active NURSE with a live assignment to that patient in their own ward. Always false for WARD_SISTER and ADMIN, who are gated by ward instead.';

-- -----------------------------------------------------------------------------
-- 7. PATIENT-LEVEL ACCESS, IN ONE PLACE
-- -----------------------------------------------------------------------------
-- Every clinical policy in 00400 routes through these three functions so the
-- matrix can never drift between tables: a nurse who can read a patient must
-- be able to read that patient's sessions, readings and alerts, and no more.

-- Full patient visibility.
CREATE OR REPLACE FUNCTION public.can_access_patient(p_patient_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
    SELECT CASE
        WHEN NOT public.is_active_user()      THEN false
        WHEN public.auth_role() = 'ADMIN'     THEN EXISTS (
            SELECT 1 FROM public.patients p WHERE p.id = p_patient_id)
        WHEN public.auth_role() = 'WARD_SISTER' THEN EXISTS (
            SELECT 1 FROM public.patients p
             WHERE p.id = p_patient_id
               AND p.ward_id IS NOT DISTINCT FROM public.auth_ward_id())
        WHEN public.auth_role() = 'NURSE'     THEN public.is_assigned_to(p_patient_id)
        ELSE false
    END;
$fn$;

-- Patient visibility, but writes are WARD_SISTER-or-ADMIN only. Nurses get
-- false here even for their own patients, which is how the matrix's
-- "cannot start/modify sessions" rule is expressed once.
CREATE OR REPLACE FUNCTION public.can_manage_patient(p_patient_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $fn$
    SELECT public.is_active_user()
       AND public.auth_role() IN ('WARD_SISTER', 'ADMIN')
       AND public.can_access_patient(p_patient_id);
$fn$;

CREATE OR REPLACE FUNCTION public.can_access_session(p_session_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
    SELECT COALESCE(
        (SELECT public.can_access_patient(s.patient_id)
           FROM public.iv_sessions s WHERE s.id = p_session_id),
        false);
$fn$;

CREATE OR REPLACE FUNCTION public.can_manage_session(p_session_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
    SELECT COALESCE(
        (SELECT public.can_manage_patient(s.patient_id)
           FROM public.iv_sessions s WHERE s.id = p_session_id),
        false);
$fn$;

CREATE OR REPLACE FUNCTION public.can_access_alert(p_alert_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
    SELECT COALESCE(
        (SELECT public.can_access_patient(a.patient_id)
           FROM public.alerts a WHERE a.id = p_alert_id),
        false);
$fn$;

COMMENT ON FUNCTION public.can_access_patient(UUID) IS
    'Single source of truth for patient-level read access: ADMIN all, WARD_SISTER own ward, NURSE only live assignments in own ward, everyone else false.';

-- -----------------------------------------------------------------------------
-- 8. alert_history VIEW
-- -----------------------------------------------------------------------------
-- security_invoker = on (PostgreSQL 15+) makes the view run with the CALLER's
-- permissions, so RLS on the underlying tables applies. Without it the view
-- would run as its owner and quietly hand nurses every alert in the hospital.

CREATE OR REPLACE VIEW public.alert_history
WITH (security_invoker = on)
AS
SELECT
    a.id                AS alert_id,
    a.patient_id,
    a.ward_id,
    a.session_id,
    a.device_id,
    a.alert_type,
    a.severity,
    a.status            AS alert_status,
    a.message,
    a.current_volume_ml,
    a.triggered_at,
    a.status            AS current_status,
    a.is_acknowledged,
    ack.user_id         AS acknowledged_by_user_id,
    ack.user_full_name  AS acknowledged_by_name,
    ack.user_role       AS acknowledged_by_role,
    ack.status          AS acknowledgement_status,
    ack.notes           AS acknowledgement_notes,
    ack.acknowledged_at
FROM public.alerts a
LEFT JOIN public.alert_acknowledgements ack ON ack.alert_id = a.id;

COMMENT ON VIEW public.alert_history IS
    'Alert joined with its acknowledgement trail. security_invoker=on so RLS governs access; ADMIN and WARD_SISTER of the alert ward can read it.';

-- -----------------------------------------------------------------------------
-- 9. ROW LEVEL SECURITY FOR THE NEW TABLES
-- -----------------------------------------------------------------------------
-- Only the SELECT policies needed by clients are created here. The full policy
-- set for pre-existing tables lands in 00400.

ALTER TABLE public.nurse_assignments     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alert_acknowledgements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.monitoring_parameters ENABLE ROW LEVEL SECURITY;

-- A nurse sees only their own assignments - never a colleague's list.
CREATE POLICY "nurse reads own assignments"
    ON public.nurse_assignments FOR SELECT
    TO authenticated
    USING (
        public.is_active_user()
        AND (nurse_id = auth.uid() OR public.in_ward(ward_id))
    );

COMMENT ON POLICY "nurse reads own assignments" ON public.nurse_assignments IS
    'Nurse: own rows only. WARD_SISTER: her ward, so she can run the ward roster. ADMIN: all wards via in_ward().';

-- Ward sister and admin read the acknowledgement trail for their patients.
CREATE POLICY "read acknowledgements for accessible alerts"
    ON public.alert_acknowledgements FOR SELECT
    TO authenticated
    USING (
        public.is_active_user()
        AND (
            public.is_admin()
            OR (public.auth_role() = 'WARD_SISTER'
                AND ward_id IS NOT DISTINCT FROM public.auth_ward_id())
            OR user_id = auth.uid()
        )
    );

COMMENT ON POLICY "read acknowledgements for accessible alerts" ON public.alert_acknowledgements IS
    'Matches the alert read policy one-for-one: a nurse sees only acknowledgements they themselves made, which prevents them inferring a colleague''s workload.';

-- ADMIN only. Spec denies thresholds to NURSE and lists them under neither
-- WARD_SISTER read rights nor her "cannot" list, so the strict reading is
-- applied: configuration is ADMIN-only. Flagged in the report.
CREATE POLICY "admin reads monitoring parameters"
    ON public.monitoring_parameters FOR SELECT
    TO authenticated
    USING (public.is_active_user() AND public.is_admin());

CREATE POLICY "admin manages monitoring parameters"
    ON public.monitoring_parameters FOR ALL
    TO authenticated
    USING (public.is_active_user() AND public.is_admin())
    WITH CHECK (public.is_active_user() AND public.is_admin());
