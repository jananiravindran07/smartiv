-- =============================================================================
-- SMART IV MONITORING SYSTEM - SCHEMA & POLICIES (Supabase PostgreSQL)
-- Academic Prototype - Not a Certified Medical Device
-- =============================================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- -----------------------------------------------------------------------------
-- 1. ENUMS & DOMAINS
-- -----------------------------------------------------------------------------
DO $$ BEGIN
    CREATE TYPE user_role AS ENUM ('NURSE', 'WARD_SISTER', 'ADMIN');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE iv_status AS ENUM (
        'NORMAL', 
        'LOW', 
        'CRITICAL', 
        'EMPTY', 
        'FLOW_STOPPED', 
        'DEVICE_OFFLINE', 
        'SENSOR_ERROR'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE alert_severity AS ENUM ('LOW', 'HIGH', 'CRITICAL');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE session_status AS ENUM ('ACTIVE', 'PAUSED', 'COMPLETED', 'ABORTED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- -----------------------------------------------------------------------------
-- 2. CORE TABLES
-- -----------------------------------------------------------------------------

-- Wards
CREATE TABLE IF NOT EXISTS public.wards (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    code TEXT NOT NULL UNIQUE,
    floor INTEGER NOT NULL DEFAULT 1,
    capacity INTEGER NOT NULL DEFAULT 20,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Profiles (linked to auth.users)
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    full_name TEXT NOT NULL,
    badge_number TEXT UNIQUE,
    role user_role NOT NULL DEFAULT 'NURSE',
    ward_id UUID REFERENCES public.wards(id) ON DELETE SET NULL,
    phone_number TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Patients
CREATE TABLE IF NOT EXISTS public.patients (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ward_id UUID NOT NULL REFERENCES public.wards(id) ON DELETE RESTRICT,
    mrn TEXT NOT NULL UNIQUE, -- Medical Record Number
    full_name TEXT NOT NULL,
    bed_number TEXT NOT NULL,
    date_of_birth DATE,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Devices (ESP32 Pole Units)
CREATE TABLE IF NOT EXISTS public.devices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_identifier TEXT NOT NULL UNIQUE, -- e.g. "ESP32-IV-001"
    name TEXT NOT NULL,
    ward_id UUID REFERENCES public.wards(id) ON DELETE SET NULL,
    secret_hash TEXT NOT NULL, -- SHA256 hashed device API token
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    last_seen_at TIMESTAMPTZ,
    hx711_calibration_factor NUMERIC(10, 4) NOT NULL DEFAULT 420.0000,
    default_empty_bag_mass_g NUMERIC(8, 2) NOT NULL DEFAULT 32.00,
    default_fluid_density_g_ml NUMERIC(6, 4) NOT NULL DEFAULT 1.0000,
    battery_level INTEGER CHECK (battery_level BETWEEN 0 AND 100),
    wifi_rssi INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- IV Infusion Sessions
CREATE TABLE IF NOT EXISTS public.iv_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE RESTRICT,
    device_id UUID NOT NULL REFERENCES public.devices(id) ON DELETE RESTRICT,
    ward_id UUID NOT NULL REFERENCES public.wards(id) ON DELETE RESTRICT,
    medication_name TEXT NOT NULL DEFAULT 'Normal Saline 0.9%',
    initial_volume_ml NUMERIC(8, 2) NOT NULL DEFAULT 500.00,
    target_flow_rate_ml_hr NUMERIC(8, 2) NOT NULL DEFAULT 125.00,
    
    -- Prototype Configurable Thresholds
    low_threshold_ml NUMERIC(8, 2) NOT NULL DEFAULT 100.00,
    critical_threshold_ml NUMERIC(8, 2) NOT NULL DEFAULT 30.00,
    empty_threshold_ml NUMERIC(8, 2) NOT NULL DEFAULT 5.00,
    
    -- Fluid physics parameters
    empty_bag_mass_g NUMERIC(8, 2) NOT NULL DEFAULT 32.00,
    fluid_density_g_ml NUMERIC(6, 4) NOT NULL DEFAULT 1.0000,
    
    status session_status NOT NULL DEFAULT 'ACTIVE',
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    started_by_user_id UUID REFERENCES public.profiles(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- IV Telemetry (High-resolution measurements from ESP32)
CREATE TABLE IF NOT EXISTS public.iv_telemetry (
    id BIGSERIAL PRIMARY KEY,
    session_id UUID NOT NULL REFERENCES public.iv_sessions(id) ON DELETE CASCADE,
    device_id UUID NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
    raw_mass_g NUMERIC(10, 2) NOT NULL,
    calculated_volume_ml NUMERIC(10, 2) NOT NULL,
    current_flow_rate_ml_hr NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    status iv_status NOT NULL DEFAULT 'NORMAL',
    battery_level INTEGER,
    wifi_rssi INTEGER,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create index on iv_telemetry for rapid time-series dashboard queries
CREATE INDEX IF NOT EXISTS idx_telemetry_session_time ON public.iv_telemetry (session_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_telemetry_device_time ON public.iv_telemetry (device_id, recorded_at DESC);

-- Alerts (Permanent record; acknowledged alerts are NEVER deleted)
CREATE TABLE IF NOT EXISTS public.alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES public.iv_sessions(id) ON DELETE CASCADE,
    patient_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
    ward_id UUID NOT NULL REFERENCES public.wards(id) ON DELETE CASCADE,
    device_id UUID NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
    alert_type iv_status NOT NULL,
    severity alert_severity NOT NULL DEFAULT 'HIGH',
    message TEXT NOT NULL,
    current_volume_ml NUMERIC(10, 2),
    flow_rate_ml_hr NUMERIC(10, 2),
    is_acknowledged BOOLEAN NOT NULL DEFAULT FALSE,
    triggered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    acknowledged_at TIMESTAMPTZ,
    acknowledged_by_user_id UUID REFERENCES public.profiles(id),
    resolution_notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alerts_ward_unack ON public.alerts (ward_id, is_acknowledged, triggered_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_session ON public.alerts (session_id, triggered_at DESC);

-- Audit Logs (Tamper-evident record of actions)
CREATE TABLE IF NOT EXISTS public.audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.profiles(id),
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id UUID,
    metadata JSONB DEFAULT '{}'::jsonb,
    ip_address TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_user_time ON public.audit_logs (user_id, created_at DESC);

-- -----------------------------------------------------------------------------
-- 3. COMPUTATION & TELEMETRY PROCESSING FUNCTIONS
-- -----------------------------------------------------------------------------

-- Helper function: get user role
CREATE OR REPLACE FUNCTION public.get_auth_user_role()
RETURNS user_role AS $$
    SELECT role FROM public.profiles WHERE id = auth.uid();
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- Helper function: get user ward_id
CREATE OR REPLACE FUNCTION public.get_auth_user_ward()
RETURNS UUID AS $$
    SELECT ward_id FROM public.profiles WHERE id = auth.uid();
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- Secure Ingestion RPC: Called by Edge Function or ESP32 with Device Secret Token
CREATE OR REPLACE FUNCTION public.ingest_telemetry_secure(
    p_device_identifier TEXT,
    p_device_secret TEXT,
    p_raw_mass_g NUMERIC,
    p_battery_level INTEGER DEFAULT NULL,
    p_wifi_rssi INTEGER DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_device RECORD;
    v_session RECORD;
    v_fluid_mass NUMERIC;
    v_calculated_volume NUMERIC;
    v_last_telemetry RECORD;
    v_flow_rate NUMERIC := 0;
    v_time_diff_hours NUMERIC;
    v_status iv_status := 'NORMAL';
    v_alert_severity alert_severity := 'LOW';
    v_alert_msg TEXT;
    v_telemetry_id BIGINT;
BEGIN
    -- 1. Validate device credentials
    SELECT * INTO v_device 
    FROM public.devices 
    WHERE device_identifier = p_device_identifier AND is_active = TRUE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Invalid device identifier or inactive device');
    END IF;

    -- Verify SHA256 hashed secret
    IF v_device.secret_hash != encode(digest(p_device_secret, 'sha256'), 'hex') THEN
        RETURN jsonb_build_object('success', false, 'error', 'Invalid device credentials');
    END IF;

    -- 2. Update device heartbeat & telemetry status
    UPDATE public.devices
    SET last_seen_at = NOW(),
        battery_level = COALESCE(p_battery_level, battery_level),
        wifi_rssi = COALESCE(p_wifi_rssi, wifi_rssi),
        updated_at = NOW()
    WHERE id = v_device.id;

    -- 3. Check for active IV session on this device
    SELECT * INTO v_session
    FROM public.iv_sessions
    WHERE device_id = v_device.id AND status = 'ACTIVE'
    ORDER BY started_at DESC
    LIMIT 1;

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'success', true, 
            'message', 'Device heartbeat recorded; no active session assigned',
            'device_id', v_device.id
        );
    END IF;

    -- 4. Calculate fluid mass and volume using density formula:
    -- fluid_mass = raw_mass_g - empty_bag_mass_g
    -- volume = fluid_mass / fluid_density_g_ml
    v_fluid_mass := GREATEST(0, p_raw_mass_g - v_session.empty_bag_mass_g);
    v_calculated_volume := ROUND((v_fluid_mass / NULLIF(v_session.fluid_density_g_ml, 0))::NUMERIC, 2);

    -- 5. Calculate flow rate based on previous telemetry entry (rolling differential)
    SELECT * INTO v_last_telemetry
    FROM public.iv_telemetry
    WHERE session_id = v_session.id
    ORDER BY recorded_at DESC
    LIMIT 1;

    IF FOUND THEN
        v_time_diff_hours := EXTRACT(EPOCH FROM (NOW() - v_last_telemetry.recorded_at)) / 3600.0;
        IF v_time_diff_hours > 0.001 AND v_time_diff_hours < 0.5 THEN
            -- Flow rate in mL/hr: delta volume / delta time
            v_flow_rate := GREATEST(0, ROUND(((v_last_telemetry.calculated_volume_ml - v_calculated_volume) / v_time_diff_hours)::NUMERIC, 2));
        ELSE
            v_flow_rate := v_last_telemetry.current_flow_rate_ml_hr;
        END IF;
    END IF;

    -- 6. Evaluate prototype threshold conditions
    IF v_calculated_volume <= v_session.empty_threshold_ml THEN
        v_status := 'EMPTY';
        v_alert_severity := 'CRITICAL';
        v_alert_msg := 'IV Bag is empty (< ' || v_session.empty_threshold_ml || ' mL). Immediate replacement needed.';
    ELSIF v_calculated_volume <= v_session.critical_threshold_ml THEN
        v_status := 'CRITICAL';
        v_alert_severity := 'CRITICAL';
        v_alert_msg := 'IV volume is CRITICAL (' || v_calculated_volume || ' mL remaining).';
    ELSIF v_calculated_volume <= v_session.low_threshold_ml THEN
        v_status := 'LOW';
        v_alert_severity := 'HIGH';
        v_alert_msg := 'IV volume is LOW (' || v_calculated_volume || ' mL remaining). Prepare next bag.';
    ELSIF v_calculated_volume > 20 AND v_flow_rate < 5.0 AND (NOW() - v_session.started_at) > INTERVAL '5 minutes' THEN
        v_status := 'FLOW_STOPPED';
        v_alert_severity := 'HIGH';
        v_alert_msg := 'Flow rate is near zero (' || v_flow_rate || ' mL/hr). Possible line occlusion or closed roller clamp.';
    ELSE
        v_status := 'NORMAL';
    END IF;

    -- 7. Insert telemetry data point
    INSERT INTO public.iv_telemetry (
        session_id, device_id, raw_mass_g, calculated_volume_ml, 
        current_flow_rate_ml_hr, status, battery_level, wifi_rssi, recorded_at
    )
    VALUES (
        v_session.id, v_device.id, p_raw_mass_g, v_calculated_volume,
        v_flow_rate, v_status, p_battery_level, p_wifi_rssi, NOW()
    )
    RETURNING id INTO v_telemetry_id;

    -- 8. Trigger alert if non-normal status and no unacknowledged alert of same type within 10 minutes
    IF v_status NOT IN ('NORMAL') THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.alerts
            WHERE session_id = v_session.id 
              AND alert_type = v_status 
              AND is_acknowledged = FALSE 
              AND triggered_at > NOW() - INTERVAL '10 minutes'
        ) THEN
            INSERT INTO public.alerts (
                session_id, patient_id, ward_id, device_id,
                alert_type, severity, message, current_volume_ml,
                flow_rate_ml_hr, is_acknowledged, triggered_at
            )
            VALUES (
                v_session.id, v_session.patient_id, v_session.ward_id, v_device.id,
                v_status, v_alert_severity, v_alert_msg, v_calculated_volume,
                v_flow_rate, FALSE, NOW()
            );
        END IF;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'telemetry_id', v_telemetry_id,
        'volume_ml', v_calculated_volume,
        'flow_rate_ml_hr', v_flow_rate,
        'status', v_status
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- -----------------------------------------------------------------------------
-- 4. ROW LEVEL SECURITY (RLS) POLICIES
-- -----------------------------------------------------------------------------

-- Enable RLS on all tables
ALTER TABLE public.wards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.iv_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.iv_telemetry ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Profiles Policies
CREATE POLICY "Users can read own profile"
    ON public.profiles FOR SELECT
    TO authenticated
    USING (id = auth.uid() OR public.get_auth_user_role() IN ('WARD_SISTER', 'ADMIN'));

CREATE POLICY "Users can update own profile"
    ON public.profiles FOR UPDATE
    TO authenticated
    USING (id = auth.uid())
    WITH CHECK (id = auth.uid());

CREATE POLICY "Admins manage all profiles"
    ON public.profiles FOR ALL
    TO authenticated
    USING (public.get_auth_user_role() = 'ADMIN');

-- Wards Policies
CREATE POLICY "Authenticated users can view wards"
    ON public.wards FOR SELECT
    TO authenticated
    USING (TRUE);

CREATE POLICY "Admins can manage wards"
    ON public.wards FOR ALL
    TO authenticated
    USING (public.get_auth_user_role() = 'ADMIN');

-- Patients Policies
CREATE POLICY "Staff view patients in assigned ward or admin all"
    ON public.patients FOR SELECT
    TO authenticated
    USING (
        public.get_auth_user_role() = 'ADMIN' 
        OR ward_id = public.get_auth_user_ward()
        OR public.get_auth_user_ward() IS NULL
    );

CREATE POLICY "Ward Sister and Admin manage patients"
    ON public.patients FOR ALL
    TO authenticated
    USING (
        public.get_auth_user_role() = 'ADMIN'
        OR (public.get_auth_user_role() = 'WARD_SISTER' AND ward_id = public.get_auth_user_ward())
    );

-- Devices Policies
CREATE POLICY "Staff view devices in their ward"
    ON public.devices FOR SELECT
    TO authenticated
    USING (
        public.get_auth_user_role() = 'ADMIN'
        OR ward_id = public.get_auth_user_ward()
        OR ward_id IS NULL
    );

CREATE POLICY "Ward Sister and Admin manage devices"
    ON public.devices FOR ALL
    TO authenticated
    USING (public.get_auth_user_role() IN ('WARD_SISTER', 'ADMIN'));

-- IV Sessions Policies
CREATE POLICY "Staff view sessions in their ward"
    ON public.iv_sessions FOR SELECT
    TO authenticated
    USING (
        public.get_auth_user_role() = 'ADMIN'
        OR ward_id = public.get_auth_user_ward()
        OR public.get_auth_user_ward() IS NULL
    );

CREATE POLICY "Staff create/update sessions"
    ON public.iv_sessions FOR ALL
    TO authenticated
    USING (
        public.get_auth_user_role() = 'ADMIN'
        OR ward_id = public.get_auth_user_ward()
    );

-- IV Telemetry Policies
CREATE POLICY "Staff view telemetry for their ward"
    ON public.iv_telemetry FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.iv_sessions s
            WHERE s.id = iv_telemetry.session_id
              AND (public.get_auth_user_role() = 'ADMIN' OR s.ward_id = public.get_auth_user_ward() OR public.get_auth_user_ward() IS NULL)
        )
    );

-- Alerts Policies
CREATE POLICY "Staff view alerts for their ward"
    ON public.alerts FOR SELECT
    TO authenticated
    USING (
        public.get_auth_user_role() = 'ADMIN'
        OR ward_id = public.get_auth_user_ward()
        OR public.get_auth_user_ward() IS NULL
    );

CREATE POLICY "Staff acknowledge alerts with audit trail"
    ON public.alerts FOR UPDATE
    TO authenticated
    USING (
        public.get_auth_user_role() = 'ADMIN'
        OR ward_id = public.get_auth_user_ward()
        OR public.get_auth_user_ward() IS NULL
    )
    WITH CHECK (
        -- Acknowledged alerts cannot be un-acknowledged or deleted
        is_acknowledged = TRUE
    );

-- Audit Logs Policies (Append-only)
CREATE POLICY "Staff view relevant audit logs"
    ON public.audit_logs FOR SELECT
    TO authenticated
    USING (public.get_auth_user_role() IN ('WARD_SISTER', 'ADMIN'));

CREATE POLICY "System and users insert audit logs"
    ON public.audit_logs FOR INSERT
    TO authenticated
    WITH CHECK (user_id = auth.uid());

-- -----------------------------------------------------------------------------
-- 5. REALTIME REPLICATION CONFIGURATION
-- -----------------------------------------------------------------------------
-- Enable Realtime for live dashboards
ALTER PUBLICATION supabase_realtime ADD TABLE public.iv_telemetry;
ALTER PUBLICATION supabase_realtime ADD TABLE public.alerts;
ALTER PUBLICATION supabase_realtime ADD TABLE public.devices;
ALTER PUBLICATION supabase_realtime ADD TABLE public.iv_sessions;
