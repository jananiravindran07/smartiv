-- =============================================================================
-- SMART IV MONITORING SYSTEM - RBAC STEP 6: THE TWO PRIVILEGED RPCs
-- Academic Prototype - Not a Certified Medical Device
-- -----------------------------------------------------------------------------
-- ADDITIVE. Never edits previously applied migrations.
--
--   acknowledge_alert(alert_id, notes)
--       The single legal way to acknowledge an alert. Checks the caller's role
--       AND ward/assignment, inserts alert_acknowledgements, sets
--       alerts.status = 'ACKNOWLEDGED', and writes an audit_logs row, all in one
--       transaction. The original alert row is never deleted.
--
--   admin_manage_user(user_id, role, full_name, ward_id, is_active)
--       The single legal way to change anybody's role, ward or active status.
--       ADMIN only, cannot be used on the caller's own account, refuses to
--       remove the last active admin, and always writes an audit_logs row.
--
-- Both are SECURITY DEFINER with a pinned search_path, which is precisely why
-- they re-implement the authorisation check in their own body: running as the
-- owner means RLS cannot do it for them.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. acknowledge_alert
-- -----------------------------------------------------------------------------
-- Role behaviour:
--   NURSE       - only a patient she is currently assigned to, in her own ward
--   WARD_SISTER - only an alert in her own ward
--   ADMIN       - any alert
--   deactivated - refused by is_active_user()

CREATE OR REPLACE FUNCTION public.acknowledge_alert(
    p_alert_id UUID,
    p_notes    TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
    v_alert        public.alerts%ROWTYPE;
    v_actor        UUID := auth.uid();
    v_actor_name   TEXT;
    v_actor_role   public.user_role;
    v_permitted    BOOLEAN := false;
    v_ack_id       UUID;
    v_audit_id     UUID;
    v_acknowledged TIMESTAMPTZ := NOW();
BEGIN
    ------------------------------------------------------------------ caller
    IF NOT public.is_active_user() THEN
        RAISE EXCEPTION 'acknowledge_alert: no active profile for this session (insufficient_privilege)'
            USING ERRCODE = '42501';
    END IF;

    v_actor_role := public.auth_role();

    IF v_actor_role IS NULL OR v_actor_role NOT IN ('NURSE', 'WARD_SISTER', 'ADMIN') THEN
        RAISE EXCEPTION 'acknowledge_alert: role % may not acknowledge alerts (insufficient_privilege)',
                        v_actor_role
            USING ERRCODE = '42501';
    END IF;

    SELECT p.full_name INTO v_actor_name
      FROM public.profiles p WHERE p.id = v_actor;

    ------------------------------------------------------------------ alert
    SELECT * INTO v_alert FROM public.alerts WHERE id = p_alert_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'acknowledge_alert: alert % does not exist', p_alert_id
            USING ERRCODE = 'P0002';
    END IF;

    -- Explicitly re-checked rather than trusting can_access_alert(), so the
    -- denial message can say which rule failed.
    IF v_actor_role = 'ADMIN' THEN
        v_permitted := true;

    ELSIF v_actor_role = 'WARD_SISTER' THEN
        IF v_alert.ward_id IS NOT DISTINCT FROM public.auth_ward_id() THEN
            v_permitted := true;
        ELSE
            RAISE EXCEPTION
                'acknowledge_alert: alert belongs to ward % but you are the ward sister of % (insufficient_privilege)',
                v_alert.ward_id, public.auth_ward_id()
                USING ERRCODE = '42501';
        END IF;

    ELSE  -- NURSE
        IF NOT public.is_assigned_to(v_alert.patient_id) THEN
            RAISE EXCEPTION
                'acknowledge_alert: you are not assigned to patient % (insufficient_privilege)',
                v_alert.patient_id
                USING ERRCODE = '42501',
                      HINT = 'A nurse may acknowledge alerts only for her assigned patients.';
        END IF;

        -- Belt and braces: the assignment must also be in her own ward.
        IF v_alert.ward_id IS NOT DISTINCT FROM public.auth_ward_id() THEN
            v_permitted := true;
        ELSE
            RAISE EXCEPTION
                'acknowledge_alert: alert is outside your ward (insufficient_privilege)'
                USING ERRCODE = '42501';
        END IF;
    END IF;

    IF NOT v_permitted THEN
        RAISE EXCEPTION 'acknowledge_alert: not permitted (insufficient_privilege)'
            USING ERRCODE = '42501';
    END IF;

    ------------------------------------------------------------ idempotency
    IF v_alert.status IN ('ACKNOWLEDGED', 'RESOLVED') THEN
        RAISE EXCEPTION
            'acknowledge_alert: alert % was already acknowledged at % (insufficient_privilege)',
            p_alert_id, v_alert.acknowledged_at
            USING ERRCODE = '23505',
                  HINT = 'The alert history is permanent; it cannot be acknowledged twice.';
    END IF;

    ------------------------------------------------------------------ write
    -- From here on the guards in 00300 admit this transaction and nothing else.
    PERFORM public._arm_ack_rpc();
    PERFORM public._arm_audit_write();

    INSERT INTO public.alert_acknowledgements (
        alert_id, user_id, user_full_name, user_role, ward_id, status, notes, acknowledged_at
    )
    VALUES (
        p_alert_id, v_actor, v_actor_name, v_actor_role, v_alert.ward_id,
        'ACKNOWLEDGED', NULLIF(BTRIM(COALESCE(p_notes, '')), ''), v_acknowledged
    )
    RETURNING id INTO v_ack_id;

    -- The alert row is updated in place, never deleted. status drives
    -- is_acknowledged / acknowledged_at via trg_alerts_sync_ack.
    UPDATE public.alerts
       SET status                = 'ACKNOWLEDGED',
           acknowledged_by_user_id = v_actor,
           resolution_notes       = NULLIF(BTRIM(COALESCE(p_notes, '')), ''),
           updated_at             := v_acknowledged
     WHERE id = p_alert_id;

    INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, metadata)
    VALUES (
        v_actor,
        'ALERT_ACKNOWLEDGED',
        'ALERT',
        p_alert_id,
        jsonb_build_object(
            'source',            'rpc',
            'acknowledged_by',   v_actor_name,
            'acknowledged_role', v_actor_role,
            'ward_id',           v_alert.ward_id,
            'patient_id',        v_alert.patient_id,
            'alert_type',        v_alert.alert_type,
            'severity',          v_alert.severity,
            'notes',             NULLIF(BTRIM(COALESCE(p_notes, '')), '')
        )
    )
    RETURNING id INTO v_audit_id;

    RETURN jsonb_build_object(
        'success',          true,
        'alert_id',         p_alert_id,
        'acknowledgement_id', v_ack_id,
        'audit_id',         v_audit_id,
        'acknowledged_by',  v_actor_name,
        'acknowledged_at',  v_acknowledged,
        'alert_status',     'ACKNOWLEDGED'
    );
END;
$fn$;

COMMENT ON FUNCTION public.acknowledge_alert(UUID, TEXT) IS
    'The only way to acknowledge an alert. Verifies role plus ward/assignment, appends an alert_acknowledgements row, sets alerts.status, and audits, in one transaction. The alert row is never deleted.';

-- -----------------------------------------------------------------------------
-- 2. admin_manage_user
-- -----------------------------------------------------------------------------
-- NULL means "leave unchanged", which lets the admin UI send one shape of
-- payload for a role change, a ward move, a rename and a deactivation.
--
-- Refusals, all deliberate:
--   * non-ADMIN caller
--   * caller acting on their own account (the brief's escalation rule, applied
--     to ADMIN as well: it also stops an admin locking themselves out)
--   * deactivating or demoting the last remaining active ADMIN
--   * granting a non-ADMIN role with no ward, which chk_profiles_ward_required
--     forbids anyway
--
-- The UPDATE is authorised by trg_guard_profile_privileges (00100), which only
-- admits privileged column changes when _arm_admin_rpc() has been raised. So this
-- RPC is the single writer, and the trigger is what guarantees it.

CREATE OR REPLACE FUNCTION public.admin_manage_user(
    p_user_id    UUID,
    p_role       TEXT      DEFAULT NULL,
    p_full_name  TEXT      DEFAULT NULL,
    p_ward_id    UUID      DEFAULT NULL,
    p_is_active  BOOLEAN   DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
    v_actor      UUID := auth.uid();
    v_target     public.profiles%ROWTYPE;
    v_new_role   public.user_role;
    v_new_ward   UUID;
    v_new_active BOOLEAN;
    v_action     TEXT;
    v_audit_id   UUID;
    v_active_admins BIGINT;
BEGIN
    ------------------------------------------------------------------ caller
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'admin_manage_user: only an ADMIN may manage users (insufficient_privilege)'
            USING ERRCODE = '42501';
    END IF;

    IF p_user_id IS NULL THEN
        RAISE EXCEPTION 'admin_manage_user: p_user_id is required'
            USING ERRCODE = '22023';
    END IF;

    IF p_user_id = v_actor THEN
        RAISE EXCEPTION
            'admin_manage_user: you cannot change your own role, ward or active status (insufficient_privilege)'
            USING ERRCODE = '42501',
                  HINT = 'Ask another administrator to make this change.';
    END IF;

    ------------------------------------------------------------------ target
    SELECT * INTO v_target FROM public.profiles WHERE id = p_user_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'admin_manage_user: profile % does not exist', p_user_id
            USING ERRCODE = 'P0002';
    END IF;

    v_new_role   := COALESCE(p_role::public.user_role,   v_target.role);
    v_new_ward   := COALESCE(p_ward_id,                  v_target.ward_id);
    v_new_active := COALESCE(p_is_active,                v_target.is_active);

    ------------------------------------------------------------- validation
    IF v_new_ward IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.wards w WHERE w.id = v_new_ward
    ) THEN
        RAISE EXCEPTION 'admin_manage_user: ward % does not exist', v_new_ward
            USING ERRCODE = '23503';
    END IF;

    -- Mirrors chk_profiles_ward_required so the caller gets a clear message
    -- instead of a bare constraint violation.
    IF v_new_role <> 'ADMIN' AND v_new_ward IS NULL THEN
        RAISE EXCEPTION
            'admin_manage_user: role % requires a ward_id', v_new_role
            USING ERRCODE = '23514';
    END IF;

    -- Never remove the last way back in.
    IF v_target.role = 'ADMIN' AND v_target.is_active
       AND (v_new_role <> 'ADMIN' OR NOT v_new_active) THEN

        SELECT COUNT(*) INTO v_active_admins
          FROM public.profiles
         WHERE role = 'ADMIN' AND is_active AND id <> p_user_id;

        IF v_active_admins = 0 THEN
            RAISE EXCEPTION
                'admin_manage_user: % is the last active ADMIN; promote somebody else first',
                p_user_id
                USING ERRCODE = '23514';
        END IF;
    END IF;

    ------------------------------------------------------------------ write
    PERFORM public._arm_admin_rpc();
    PERFORM public._arm_audit_write();

    UPDATE public.profiles
       SET role       = v_new_role,
           ward_id    = v_new_ward,
           is_active  = v_new_active,
           full_name  = COALESCE(NULLIF(BTRIM(COALESCE(p_full_name, '')), ''), full_name)
     WHERE id = p_user_id;

    ----------------------------------------------------------------- audit
    IF v_new_active = false AND v_target.is_active THEN
        v_action := 'USER_DEACTIVATED';
    ELSIF v_new_role IS DISTINCT FROM v_target.role THEN
        v_action := 'ROLE_CHANGED';
    ELSIF v_new_ward IS DISTINCT FROM v_target.ward_id THEN
        v_action := 'WARD_CHANGED';
    ELSIF v_new_active IS DISTINCT FROM v_target.is_active THEN
        v_action := 'USER_REACTIVATED';
    ELSE
        v_action := 'PROFILE_UPDATED';
    END IF;

    INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, metadata)
    VALUES (
        v_actor,
        v_action,
        'PROFILE',
        p_user_id,
        jsonb_build_object(
            'source',   'rpc',
            'target_name', v_target.full_name,
            'role_change', CASE WHEN v_new_role IS DISTINCT FROM v_target.role
                                THEN jsonb_build_object('from', v_target.role, 'to', v_new_role)
                                ELSE NULL END,
            'ward_change', CASE WHEN v_new_ward IS DISTINCT FROM v_target.ward_id
                                THEN jsonb_build_object('from', v_target.ward_id, 'to', v_new_ward)
                                ELSE NULL END,
            'active_change', CASE WHEN v_new_active IS DISTINCT FROM v_target.is_active
                                  THEN jsonb_build_object('from', v_target.is_active, 'to', v_new_active)
                                  ELSE NULL END
        )
    )
    RETURNING id INTO v_audit_id;

    RETURN jsonb_build_object(
        'success',    true,
        'user_id',    p_user_id,
        'role',       v_new_role,
        'ward_id',    v_new_ward,
        'is_active',  v_new_active,
        'action',     v_action,
        'audit_id',   v_audit_id
    );
END;
$fn$;

COMMENT ON FUNCTION public.admin_manage_user(UUID, TEXT, TEXT, UUID, BOOLEAN) IS
    'ADMIN-only, audited, single writer for role / ward_id / is_active. NULL arguments leave a column unchanged. Refuses self-targeting and refuses to remove the last active admin.';

-- -----------------------------------------------------------------------------
-- 3. Surface the deactivation side effect explicitly
-- -----------------------------------------------------------------------------
-- Deactivating somebody must also end their nurse assignments, otherwise the
-- assignments linger and the ward roster shows a nurse who can no longer log
-- in. Doing it in the RPC keeps it inside the audited transaction.
--
-- Reassignment is preferred in a real deployment; this only makes the
-- invariant "a deactivated nurse holds no assignments" true.

CREATE OR REPLACE FUNCTION public.admin_deactivate_user(p_user_id UUID, p_notes TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
    v_result JSONB;
    v_revoked INTEGER;
BEGIN
    v_result := public.admin_manage_user(p_user_id, NULL, NULL, NULL, false);

    PERFORM public._arm_audit_write();

    UPDATE public.nurse_assignments
       SET revoked_at = NOW(),
           revoked_by = auth.uid()
     WHERE nurse_id = p_user_id
       AND revoked_at IS NULL;

    GET DIAGNOSTICS v_revoked = ROW_COUNT;

    IF v_revoked > 0 THEN
        INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, metadata)
        VALUES (auth.uid(), 'NURSE_ASSIGNMENTS_REVOKED', 'PROFILE', p_user_id,
                jsonb_build_object('source', 'rpc', 'assignments_revoked', v_revoked,
                                   'notes', p_notes));
    END IF;

    RETURN v_result || jsonb_build_object('assignments_revoked', v_revoked);
END;
$fn$;

COMMENT ON FUNCTION public.admin_deactivate_user(UUID, TEXT) IS
    'Deactivates a user and revokes their live nurse assignments in the same audited transaction. Wraps admin_manage_user().';
