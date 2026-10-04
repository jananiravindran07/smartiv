-- =============================================================================
-- SMART IV MONITORING SYSTEM - BOOTSTRAP THE FIRST ADMINISTRATOR
-- Academic Prototype - Not a Certified Medical Device
-- -----------------------------------------------------------------------------
-- WHY THIS FILE EXISTS
-- There is no public sign-up (config.toml -> [auth] enable_signup = false) and no
-- role picker at login. Accounts are created only by an authenticated ADMIN
-- through the admin-create-user Edge Function. That leaves a chicken-and-egg
-- problem: the first ADMIN cannot be created by an ADMIN.
--
-- This is the documented seed step that breaks the cycle. It runs once, by an
-- operator, and it is the ONLY place in the project where a profile row is
-- created outside the Edge Function.
--
-- HOW TO RUN IT
--
--   Local development
--     1. Create the first user through Supabase Auth (Dashboard or your local
--        Supabase Auth UI) with the email configured below.
--     2. Run this file with psql, or include it in your local seed process.
--        It links that existing Auth user to the ADMIN profile.
--
--   Hosted project
--     1. Dashboard -> Authentication -> Users -> "Add user"
--        (create the account with your admin email and a password)
--     2. Dashboard -> SQL Editor, then run this file. It finds the Auth user's
--        UUID by email and creates the ADMIN profile.
--
-- SECURITY NOTES
--   * This script never creates an Auth user or stores a password. Create the
--     account through Supabase Auth and set a strong, unique password there.
--   * This script must only be run by a trusted database operator; it grants
--     ADMIN to the Auth user matching c_admin_email.
--   * It writes a BOOTSTRAP_ADMIN_CREATED audit row, so the very first
--     administrator is on the record from the moment the system exists.
--   * After running it, create all further accounts through the
--     admin-create-user Edge Function.
-- =============================================================================

DO $$
DECLARE
    c_admin_id   UUID;
    c_admin_email TEXT       := 'admin@smartiv.local';
    c_admin_name  TEXT        := 'System Administrator';
    v_audit_id    UUID;
BEGIN
    ------------------------------------------------------------------ STEP 1
    -- Find an existing Auth account. Never insert directly into auth.users:
    -- Supabase Auth must manage account creation and password storage.
    SELECT id INTO c_admin_id
    FROM auth.users
    WHERE lower(email) = lower(c_admin_email)
    LIMIT 1;

    IF c_admin_id IS NULL THEN
        RAISE EXCEPTION 'Create the Supabase Auth user for % first, then rerun this script.', c_admin_email;
    END IF;

    ------------------------------------------------------------------ STEP 2
    -- Create the profile. This is the row every RLS policy reads, so it is the
    -- row that actually grants ADMIN.
    --
    -- ward_id is NULL, which chk_profiles_ward_required permits only for ADMIN:
    -- an administrator is hospital-wide and belongs to no single ward.
    --
    INSERT INTO public.profiles (
        id, full_name, email, role, ward_id, is_active
    )
    VALUES (
        c_admin_id, c_admin_name, c_admin_email, 'ADMIN', NULL, TRUE
    )
    ON CONFLICT (id) DO UPDATE
        SET role      = 'ADMIN',
            is_active = TRUE,
            email     = EXCLUDED.email;

    ------------------------------------------------------------------ STEP 3
    -- Put the very first administrator on the record.
    INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, metadata)
    VALUES (
        c_admin_id,
        'BOOTSTRAP_ADMIN_CREATED',
        'PROFILE',
        c_admin_id,
        jsonb_build_object(
            'source',      'seed',
            'email',       c_admin_email,
            'note',        'First administrator created by the documented bootstrap step. No account exists before this, which is why it cannot be created through the admin-create-user Edge Function.'
        )
    )
    RETURNING id INTO v_audit_id;

    RAISE NOTICE 'Bootstrap admin ready: % (%)', c_admin_name, c_admin_email;
    RAISE NOTICE 'Sign in with the password configured in Supabase Auth.';
    RAISE NOTICE 'Create every other account via the admin-create-user Edge Function.';
END;
$$;
