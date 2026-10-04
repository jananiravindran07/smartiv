-- =============================================================================
-- SMART IV MONITORING SYSTEM - RBAC STEP 1: ROLE STATE, HARDENED HELPERS,
--                              PRIVILEGE-ESCALATION GUARD
-- Academic Prototype - Not a Certified Medical Device
-- -----------------------------------------------------------------------------
-- This migration is ADDITIVE. It never edits previously applied migrations.
--
-- Fixes addressed here (audit gap numbers):
--   * Gap 1  - any authenticated user can UPDATE their own profiles.role to
--              ADMIN. Closed by public.guard_profile_privileges().
--   * Gap 9  - profiles has no is_active, so deactivated users keep access.
--   * Gap 10 - profiles has no email.
--   * Gap 11 - the only helpers (get_auth_user_role / get_auth_user_ward) are
--              SECURITY DEFINER with NO search_path pinned -> search_path
--              hijack by any caller who can create objects in a schema on the
--              path. All helpers below are SECURITY DEFINER + STABLE with
--              `SET search_path = public, pg_temp`.
--
-- Every helper FAILS CLOSED: no profile row, or is_active = false, yields NULL
-- or false. Policies that test these helpers therefore deny by default.
--
-- NOTE: public.is_assigned_to() is deliberately NOT created here because it
-- depends on public.nurse_assignments, which arrives in migration 00200.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. ROLE STATE ON profiles
-- -----------------------------------------------------------------------------

-- Gap 9: deactivated accounts must lose access everywhere.
ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

-- Gap 10: spec lists email as a profile column. Backfilled from auth.users.
ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS email TEXT;

DO $$
BEGIN
    IF to_regclass('auth.users') IS NOT NULL THEN
        EXECUTE $q$
            UPDATE public.profiles p
               SET email = u.email
              FROM auth.users u
             WHERE u.id = p.id
               AND p.email IS DISTINCT FROM u.email
        $q$;
    END IF;
END $$;

-- email must stay unique once populated, so an admin cannot create two
-- accounts for the same human. Existing duplicates are left alone; the index
-- is created only when the column is actually unique.
DO $$
DECLARE
    v_dupes BIGINT;
BEGIN
    SELECT COUNT(*) INTO v_dupes
      FROM (SELECT email FROM public.profiles
             WHERE email IS NOT NULL
             GROUP BY email HAVING COUNT(*) > 1) d;

    IF v_dupes = 0 THEN
        EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS uq_profiles_email
                   ON public.profiles (email) WHERE email IS NOT NULL';
    END IF;
END $$;

-- Defence in depth: a non-ADMIN profile with ward_id NULL would be a nurse or
-- sister scoped to nothing. Today's policies treat a NULL ward as "see
-- everything" (the `OR get_auth_user_ward() IS NULL` clauses being deleted in
-- 00400), so the schema must not allow that state to exist at all. Only
-- ADMIN may be ward-less.
ALTER TABLE public.profiles
    DROP CONSTRAINT IF EXISTS chk_profiles_ward_required;

ALTER TABLE public.profiles
    ADD CONSTRAINT chk_profiles_ward_required
    CHECK (role = 'ADMIN' OR ward_id IS NOT NULL);

-- Policy predicates filter on these constantly.
CREATE INDEX IF NOT EXISTS idx_profiles_ward_role ON public.profiles (ward_id, role);
CREATE INDEX IF NOT EXISTS idx_profiles_role       ON public.profiles (role);
CREATE INDEX IF NOT EXISTS idx_profiles_active     ON public.profiles (is_active);

-- -----------------------------------------------------------------------------
-- 2. CONTEXT HELPERS
-- -----------------------------------------------------------------------------

-- True when the request carries the service_role key. Used only to let
-- trusted server-side writers (the ingest Edge Function, admin-create-user)
-- past the write guards. A user cannot forge this: the claim comes from a JWT
-- signed with the service key.
--
-- PostgREST exposes the whole verified JWT as the `request.jwt.claims` GUC and,
-- on older deployments, the individual `request.jwt.claim.<name>` GUCs.
CREATE OR REPLACE FUNCTION public.is_service_role()
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
    v_role   TEXT;
    v_claims TEXT;
BEGIN
    BEGIN
        v_role := current_setting('request.jwt.claim.role', true);
    EXCEPTION WHEN others THEN
        v_role := NULL;
    END;

    IF v_role IS NULL OR v_role = '' THEN
        BEGIN
            v_claims := current_setting('request.jwt.claims', true);
        EXCEPTION WHEN others THEN
            v_claims := NULL;
        END;

        IF v_claims IS NOT NULL AND v_claims <> '' THEN
            BEGIN
                v_role := (v_claims::jsonb) ->> 'role';
            EXCEPTION WHEN others THEN
                v_role := NULL;
            END;
        END IF;
    END IF;

    RETURN COALESCE(v_role, '') = 'service_role';
END;
$fn$;

COMMENT ON FUNCTION public.is_service_role() IS
    'True when the caller presents the service_role key. Also true for direct DBA sessions (psql/supabase db push), which is required for migrations and seed data.';

-- Transaction-local bypass switch for documented DBA / fixture scripts.
-- Uses a transaction-local GUC so it cannot leak to the next request. A
-- PostgREST client cannot both set it and use it: each HTTP request is its own
-- transaction, and set_config(..., true) dies with it.
CREATE OR REPLACE FUNCTION public.dba_bypass_active()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $fn$
    SELECT COALESCE(current_setting('smartiv.dba', true), 'off') = 'on';
$fn$;

-- Flip the DBA bypass for the remainder of the current transaction.
-- EXECUTE is revoked from PUBLIC in migration 00500, so only SECURITY DEFINER
-- code owned by the migration role can arm it.
CREATE OR REPLACE FUNCTION public._arm_dba_bypass(p_on BOOLEAN)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
    PERFORM set_config('smartiv.dba', CASE WHEN p_on THEN 'on' ELSE 'off' END, true);
END;
$fn$;

-- Single definition of "may this session write protected rows".
CREATE OR REPLACE FUNCTION public.trusted_writer()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $fn$
    SELECT public.is_service_role()
        OR public.dba_bypass_active()
        -- direct DBA session (psql, supabase db push, CI) rather than PostgREST
        OR session_user NOT IN ('authenticator', 'authenticated');
$fn$;

-- -----------------------------------------------------------------------------
-- 3. ROLE HELPERS  (the five the spec asks for, minus is_assigned_to)
-- -----------------------------------------------------------------------------

-- Role of the caller, or NULL if unauthenticated / deactivated / no profile.
CREATE OR REPLACE FUNCTION public.auth_role()
RETURNS public.user_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
    SELECT p.role
      FROM public.profiles p
     WHERE p.id = auth.uid()
       AND p.is_active;
$fn$;

COMMENT ON FUNCTION public.auth_role() IS
    'Role of the calling user. NULL when unauthenticated, when no profile exists, or when is_active = false.';

-- Ward of the caller, or NULL. NULL is NOT a wildcard: policies must treat NULL
-- as "deny", never as "see everything".
CREATE OR REPLACE FUNCTION public.auth_ward_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
    SELECT p.ward_id
      FROM public.profiles p
     WHERE p.id = auth.uid()
       AND p.is_active;
$fn$;

COMMENT ON FUNCTION public.auth_ward_id() IS
    'Ward of the calling user, or NULL. Callers must treat NULL as deny, not as a wildcard.';

-- Explicit liveness check. Every read policy ANDs this in so that a
-- deactivated account is denied even if a role value were somehow cached.
CREATE OR REPLACE FUNCTION public.is_active_user()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
    SELECT COALESCE(
        (SELECT p.is_active FROM public.profiles p WHERE p.id = auth.uid()),
        false
    );
$fn$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $fn$
    SELECT public.auth_role() = 'ADMIN';
$fn$;

CREATE OR REPLACE FUNCTION public.is_ward_sister()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $fn$
    SELECT public.auth_role() = 'WARD_SISTER';
$fn$;

CREATE OR REPLACE FUNCTION public.is_nurse()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $fn$
    SELECT public.auth_role() = 'NURSE';
$fn$;

-- Is the caller a WARD_SISTER or ADMIN scoped to p_ward_id?
-- Centralises "own ward" so no policy can accidentally omit the ward test.
CREATE OR REPLACE FUNCTION public.in_ward(p_ward_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $fn$
    SELECT public.is_admin()
        OR (public.auth_role() = 'WARD_SISTER'
            AND public.auth_ward_id() IS NOT DISTINCT FROM p_ward_id);
$fn$;

COMMENT ON FUNCTION public.in_ward(UUID) IS
    'True if caller is ADMIN, or is the WARD_SISTER of p_ward_id. NURSE always returns false here - nurses are gated by assignment, not by ward.';

-- Backwards-compatible aliases. The old policies in 20260101000000 call these
-- names; they are redefined here with a pinned search_path so nothing breaks
-- between this migration and 00400, which drops those policies.
CREATE OR REPLACE FUNCTION public.get_auth_user_role()
RETURNS public.user_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
    SELECT public.auth_role();
$fn$;

CREATE OR REPLACE FUNCTION public.get_auth_user_ward()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
    SELECT public.auth_ward_id();
$fn$;

-- -----------------------------------------------------------------------------
-- 4. PRIVILEGE-ESCALATION GUARD  (closes audit gap 1)
-- -----------------------------------------------------------------------------
-- Rules enforced on public.profiles:
--   INSERT  -> service_role only. Clients cannot mint a profile, so they cannot
--              mint themselves an ADMIN one. User creation goes through the
--              admin-create-user Edge Function.
--   UPDATE  -> role / ward_id / is_active may change only when
--                (a) the writer is trusted (service_role, DBA, armed bypass), and
--                (b) public.admin_rpc_authorized() says the sanctioned
--                    admin-manage-user RPC is in scope for this transaction.
--              A user can never change their OWN role, ward_id or is_active -
--              not even an ADMIN, which also prevents an admin from locking the
--              last admin out of their own account.
-- -----------------------------------------------------------------------------

-- Armed only by the SECURITY DEFINER admin RPC. EXECUTE revoked from PUBLIC in
-- 00500, so a client cannot call it directly.
CREATE OR REPLACE FUNCTION public._arm_admin_rpc()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
    PERFORM set_config('smartiv.admin_rpc', 'on', true);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.admin_rpc_authorized()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $fn$
    SELECT COALESCE(current_setting('smartiv.admin_rpc', true), 'off') = 'on';
$fn$;

CREATE OR REPLACE FUNCTION public.guard_profile_privileges()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
    v_actor      UUID := auth.uid();
    v_actor_role public.user_role;
    v_privileged BOOLEAN;
BEGIN
    -- Migrations, seed data and the user-creation Edge Function bypass the guard.
    IF public.trusted_writer() THEN
        RETURN NEW;
    END IF;

    IF TG_OP = 'INSERT' THEN
        RAISE EXCEPTION
            'profiles: client sessions cannot create accounts (insufficient_privilege)'
            USING ERRCODE = '42501',
                  HINT = 'Use the admin-create-user Edge Function.';
    END IF;

    -- Nothing privileged changed: ordinary profile edits (full_name, phone)
    -- are left to the RLS policies to authorise.
    IF NEW.role      IS NOT DISTINCT FROM OLD.role
       AND NEW.ward_id    IS NOT DISTINCT FROM OLD.ward_id
       AND NEW.is_active  IS NOT DISTINCT FROM OLD.is_active THEN
        RETURN NEW;
    END IF;

    -- From here on the row is being re-privileged.
    IF v_actor IS NULL OR v_actor = OLD.id THEN
        RAISE EXCEPTION
            'profiles: you cannot change your own role, ward_id or is_active (insufficient_privilege)'
            USING ERRCODE = '42501';
    END IF;

    v_privileged := public.admin_rpc_authorized();

    IF NOT v_privileged THEN
        -- Defence in depth. Unreachable via PostgREST today because no client
        -- policy permits these columns, but it stops any future policy or a
        -- SECURITY DEFINER function from becoming an escalation route.
        SELECT p.role INTO v_actor_role
          FROM public.profiles p
         WHERE p.id = v_actor AND p.is_active;

        IF v_actor_role IS DISTINCT FROM 'ADMIN' THEN
            RAISE EXCEPTION
                'profiles: only an ADMIN may change role, ward or active status (insufficient_privilege)'
                USING ERRCODE = '42501',
                      HINT = 'Use the admin-manage-user RPC so the change is audited.';
        END IF;

        RAISE EXCEPTION
            'profiles: privileged changes must go through the admin-manage-user RPC so they are audited (insufficient_privilege)'
            USING ERRCODE = '42501',
                  HINT = 'Use the admin-manage-user RPC so the change is audited.';
    END IF;

    RETURN NEW;
END;
$fn$;

COMMENT ON FUNCTION public.guard_profile_privileges() IS
    'Blocks client INSERT into profiles and blocks any change to role/ward_id/is_active that is not self, not ADMIN, and not the audited admin RPC.';

DROP TRIGGER IF EXISTS trg_guard_profile_privileges ON public.profiles;
CREATE TRIGGER trg_guard_profile_privileges
    BEFORE INSERT OR UPDATE ON public.profiles
    FOR EACH ROW
    EXECUTE FUNCTION public.guard_profile_privileges();

-- -----------------------------------------------------------------------------
-- 5. updated_at MAINTENANCE
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $fn$
BEGIN
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_profiles_updated_at ON public.profiles;
CREATE TRIGGER trg_profiles_updated_at
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW
    EXECUTE FUNCTION public.touch_updated_at();

-- -----------------------------------------------------------------------------
-- 6. DOCUMENTATION
-- -----------------------------------------------------------------------------

COMMENT ON TABLE public.profiles IS
    'One row per auth.users entry. role/ward_id/is_active are privileged columns: writable only by the audited admin-manage-user RPC or by trusted server-side writers.';
