-- =============================================================================
-- SMART IV MONITORING SYSTEM - SEED DATA
-- Academic Prototype - Not a Certified Medical Device
-- =============================================================================

-- 1. Insert Wards
INSERT INTO public.wards (id, name, code, floor, capacity) VALUES
('a0000000-0000-0000-0000-000000000001', 'General Medicine Ward A', 'GEN-A', 2, 24),
('a0000000-0000-0000-0000-000000000002', 'Intensive Care Unit (ICU)', 'ICU-1', 3, 12),
('a0000000-0000-0000-0000-000000000003', 'Pediatric Care Ward', 'PED-B', 1, 16)
ON CONFLICT (code) DO NOTHING;

-- 2. Insert Devices (ESP32 Units)
-- Device Secrets (SHA256 of 'secret_esp32_001', etc.)
-- echo -n "secret_esp32_001" | sha256sum -> b4dc...
INSERT INTO public.devices (
    id, device_identifier, name, ward_id, secret_hash, is_active, 
    last_seen_at, hx711_calibration_factor, default_empty_bag_mass_g, default_fluid_density_g_ml, battery_level, wifi_rssi
) VALUES
(
    'd0000000-0000-0000-0000-000000000001', 'ESP32-IV-001', 'Pole Unit A1', 
    'a0000000-0000-0000-0000-000000000001', 
    encode(digest('secret_esp32_001', 'sha256'), 'hex'), 
    TRUE, NOW(), 420.50, 32.0, 1.000, 94, -58
),
(
    'd0000000-0000-0000-0000-000000000002', 'ESP32-IV-002', 'Pole Unit A2', 
    'a0000000-0000-0000-0000-000000000001', 
    encode(digest('secret_esp32_002', 'sha256'), 'hex'), 
    TRUE, NOW(), 418.20, 30.0, 1.000, 82, -64
),
(
    'd0000000-0000-0000-0000-000000000003', 'ESP32-IV-003', 'Pole Unit ICU-1', 
    'a0000000-0000-0000-0000-000000000002', 
    encode(digest('secret_esp32_003', 'sha256'), 'hex'), 
    TRUE, NOW(), 422.10, 32.0, 1.025, 68, -72
),
(
    'd0000000-0000-0000-0000-000000000004', 'ESP32-IV-004', 'Pole Unit ICU-2', 
    'a0000000-0000-0000-0000-000000000002', 
    encode(digest('secret_esp32_004', 'sha256'), 'hex'), 
    TRUE, NOW() - INTERVAL '25 minutes', 420.00, 32.0, 1.000, 15, -88
)
ON CONFLICT (device_identifier) DO NOTHING;

-- 3. Insert Patients
INSERT INTO public.patients (id, ward_id, mrn, full_name, bed_number, date_of_birth, notes) VALUES
(
    'p0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001',
    'MRN-849201', 'Eleanor Vance', 'Bed 102-A', '1968-04-12', 'Post-op hydration protocol'
),
(
    'p0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001',
    'MRN-849202', 'Marcus Chen', 'Bed 104-B', '1982-11-23', 'Antibiotic infusion (Cefazolin in D5W)'
),
(
    'p0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000002',
    'MRN-993108', 'Sophia Rodriguez', 'Bed ICU-03', '1954-07-30', 'Electrolyte replacement protocol (Ringer''s Lactate)'
)
ON CONFLICT (mrn) DO NOTHING;

-- 4. Insert Active IV Sessions
INSERT INTO public.iv_sessions (
    id, patient_id, device_id, ward_id, medication_name, initial_volume_ml,
    target_flow_rate_ml_hr, low_threshold_ml, critical_threshold_ml, empty_threshold_ml,
    empty_bag_mass_g, fluid_density_g_ml, status, started_at
) VALUES
(
    's0000000-0000-0000-0000-000000000001',
    'p0000000-0000-0000-0000-000000000001',
    'd0000000-0000-0000-0000-000000000001',
    'a0000000-0000-0000-0000-000000000001',
    '0.9% Sodium Chloride (Normal Saline)',
    1000.00, 125.00, 150.00, 50.00, 5.00, 32.00, 1.0000,
    'ACTIVE', NOW() - INTERVAL '3 hours'
),
(
    's0000000-0000-0000-0000-000000000002',
    'p0000000-0000-0000-0000-000000000002',
    'd0000000-0000-0000-0000-000000000002',
    'a0000000-0000-0000-0000-000000000001',
    '5% Dextrose Injection (D5W)',
    500.00, 100.00, 100.00, 30.00, 5.00, 30.00, 1.0180,
    'ACTIVE', NOW() - INTERVAL '4 hours 20 minutes'
),
(
    's0000000-0000-0000-0000-000000000003',
    'p0000000-0000-0000-0000-000000000003',
    'd0000000-0000-0000-0000-000000000003',
    'a0000000-0000-0000-0000-000000000002',
    'Ringer''s Lactate Solution',
    500.00, 80.00, 100.00, 30.00, 5.00, 32.00, 1.0080,
    'ACTIVE', NOW() - INTERVAL '5 hours 45 minutes'
)
ON CONFLICT (id) DO NOTHING;

-- 5. Insert Recent Telemetry Data Points
-- Session 1: Healthy normal infusion (approx 625 mL remaining out of 1000 mL)
INSERT INTO public.iv_telemetry (
    session_id, device_id, raw_mass_g, calculated_volume_ml,
    current_flow_rate_ml_hr, status, battery_level, wifi_rssi, recorded_at
) VALUES
('s0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 657.0, 625.0, 124.5, 'NORMAL', 94, -58, NOW() - INTERVAL '2 minutes'),
('s0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 655.0, 623.0, 125.0, 'NORMAL', 94, -58, NOW());

-- Session 2: Low Volume Alert state (approx 78 mL remaining out of 500 mL)
-- fluid_mass = (109.4 - 30.0) = 79.4 g -> volume = 79.4 / 1.018 = 78.0 mL
INSERT INTO public.iv_telemetry (
    session_id, device_id, raw_mass_g, calculated_volume_ml,
    current_flow_rate_ml_hr, status, battery_level, wifi_rssi, recorded_at
) VALUES
('s0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000002', 111.4, 80.0, 99.0, 'LOW', 82, -64, NOW() - INTERVAL '2 minutes'),
('s0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000002', 109.4, 78.0, 100.0, 'LOW', 82, -64, NOW());

-- Session 3: Critical State (approx 24 mL remaining out of 500 mL)
-- fluid_mass = (56.2 - 32.0) = 24.2 g -> volume = 24.2 / 1.008 = 24.0 mL
INSERT INTO public.iv_telemetry (
    session_id, device_id, raw_mass_g, calculated_volume_ml,
    current_flow_rate_ml_hr, status, battery_level, wifi_rssi, recorded_at
) VALUES
('s0000000-0000-0000-0000-000000000003', 'd0000000-0000-0000-0000-000000000003', 58.2, 26.0, 79.0, 'CRITICAL', 68, -72, NOW() - INTERVAL '2 minutes'),
('s0000000-0000-0000-0000-000000000003', 'd0000000-0000-0000-0000-000000000003', 56.2, 24.0, 78.5, 'CRITICAL', 68, -72, NOW());

-- 6. Insert Alerts
INSERT INTO public.alerts (
    id, session_id, patient_id, ward_id, device_id,
    alert_type, severity, message, current_volume_ml, flow_rate_ml_hr,
    is_acknowledged, triggered_at
) VALUES
(
    'e0000000-0000-0000-0000-000000000001',
    's0000000-0000-0000-0000-000000000003',
    'p0000000-0000-0000-0000-000000000003',
    'a0000000-0000-0000-0000-000000000002',
    'd0000000-0000-0000-0000-000000000003',
    'CRITICAL', 'CRITICAL',
    'IV volume is CRITICAL (24.0 mL remaining). Immediate attention required.',
    24.00, 78.50, FALSE, NOW() - INTERVAL '3 minutes'
),
(
    'e0000000-0000-0000-0000-000000000002',
    's0000000-0000-0000-0000-000000000002',
    'p0000000-0000-0000-0000-000000000002',
    'a0000000-0000-0000-0000-000000000001',
    'd0000000-0000-0000-0000-000000000002',
    'LOW', 'HIGH',
    'IV volume is LOW (78.0 mL remaining). Prepare next bag.',
    78.00, 100.00, FALSE, NOW() - INTERVAL '7 minutes'
)
ON CONFLICT (id) DO NOTHING;
