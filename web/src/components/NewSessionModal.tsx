import React, { useState } from 'react';
import { X, Plus, Check } from 'lucide-react';
import type { Ward, Patient, Device } from '../types/database';
import type { ActiveIVSessionWithTelemetry } from '../lib/mockData';

interface NewSessionModalProps {
  isOpen: boolean;
  onClose: () => void;
  wards: Ward[];
  selectedWardId: string | null;
  patients: Patient[];
  devices: Device[];
  onStartSession: (session: ActiveIVSessionWithTelemetry) => void;
}

export const NewSessionModal: React.FC<NewSessionModalProps> = ({
  isOpen,
  onClose,
  wards,
  selectedWardId,
  patients,
  devices,
  onStartSession,
}) => {
  const [patientId, setPatientId] = useState<string>(patients[0]?.id || '');
  const [deviceId, setDeviceId] = useState<string>(devices[0]?.id || '');
  const [medication, setMedication] = useState<string>('0.9% Sodium Chloride (Normal Saline)');
  const [initialVolume, setInitialVolume] = useState<number>(1000);
  const [targetFlowRate, setTargetFlowRate] = useState<number>(125);
  const [fluidDensity, setFluidDensity] = useState<number>(1.0);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const patient = patients.find((p) => p.id === patientId) || patients[0];
    const device = devices.find((d) => d.id === deviceId) || devices[0];
    const ward = wards.find((w) => w.id === (selectedWardId || patient.ward_id)) || wards[0];

    const newSession: ActiveIVSessionWithTelemetry = {
      id: `s-custom-${Date.now()}`,
      patient_id: patient.id,
      device_id: device.id,
      ward_id: ward.id,
      medication_name: medication,
      initial_volume_ml: initialVolume,
      target_flow_rate_ml_hr: targetFlowRate,
      low_threshold_ml: Math.round(initialVolume * 0.15),
      critical_threshold_ml: Math.round(initialVolume * 0.05),
      empty_threshold_ml: 5,
      empty_bag_mass_g: 32,
      fluid_density_g_ml: fluidDensity,
      status: 'ACTIVE',
      started_at: new Date().toISOString(),
      completed_at: null,
      started_by_user_id: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      current_volume_ml: initialVolume,
      current_flow_rate_ml_hr: targetFlowRate,
      percentage_remaining: 100,
      time_remaining_minutes: Math.round((initialVolume / targetFlowRate) * 60),
      raw_mass_g: initialVolume * fluidDensity + 32,
      patient,
      device,
      ward,
      telemetry_history: [
        {
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }),
          volume: initialVolume,
          flow_rate: targetFlowRate,
        },
      ],
    };

    onStartSession(newSession);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-sm">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-lg p-6 shadow-2xl relative text-slate-100">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-slate-400 hover:text-slate-200 p-1 rounded-lg hover:bg-slate-800"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-xl bg-cyan-950 border border-cyan-700/60 flex items-center justify-center text-cyan-400">
            <Plus className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white">Start New IV Infusion</h2>
            <p className="text-xs text-slate-400">Assign Patient, IV Bag & ESP32 Pole</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">Select Patient</label>
            <select
              value={patientId}
              onChange={(e) => setPatientId(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2.5 text-sm text-slate-200 focus:ring-2 focus:ring-cyan-500"
            >
              {patients.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.bed_number} — {p.full_name} ({p.mrn})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">Assign Pole Unit (ESP32)</label>
            <select
              value={deviceId}
              onChange={(e) => setDeviceId(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2.5 text-sm text-slate-200 focus:ring-2 focus:ring-cyan-500"
            >
              {devices.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} ({d.device_identifier}) — Battery: {d.battery_level}%
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">Medication / Fluid Solution</label>
            <select
              value={medication}
              onChange={(e) => {
                setMedication(e.target.value);
                if (e.target.value.includes('D5W')) setFluidDensity(1.018);
                else if (e.target.value.includes('Ringer')) setFluidDensity(1.008);
                else setFluidDensity(1.0);
              }}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2.5 text-sm text-slate-200 focus:ring-2 focus:ring-cyan-500"
            >
              <option value="0.9% Sodium Chloride (Normal Saline)">0.9% Sodium Chloride (Normal Saline, 1.000 g/mL)</option>
              <option value="5% Dextrose Injection (D5W)">5% Dextrose Injection (D5W, 1.018 g/mL)</option>
              <option value="Ringer's Lactate Solution">Ringer's Lactate Solution (1.008 g/mL)</option>
              <option value="Potassium Chloride in 0.45% Saline">Potassium Chloride in 0.45% Saline (1.000 g/mL)</option>
              <option value="Ciprofloxacin Infusion">Ciprofloxacin Infusion (1.000 g/mL)</option>
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">Initial Volume (mL)</label>
              <input
                type="number"
                min="50"
                max="3000"
                step="50"
                value={initialVolume}
                onChange={(e) => setInitialVolume(Number(e.target.value))}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2.5 text-sm font-mono text-slate-200 focus:ring-2 focus:ring-cyan-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">Target Rate (mL/hr)</label>
              <input
                type="number"
                min="10"
                max="1000"
                step="5"
                value={targetFlowRate}
                onChange={(e) => setTargetFlowRate(Number(e.target.value))}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2.5 text-sm font-mono text-slate-200 focus:ring-2 focus:ring-cyan-500"
              />
            </div>
          </div>

          <button
            type="submit"
            className="w-full mt-3 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white py-2.5 rounded-xl font-semibold text-sm shadow-lg shadow-cyan-500/20 flex items-center justify-center gap-2 cursor-pointer transition-all"
          >
            <Check className="w-4 h-4" />
            <span>Launch Infusion Session</span>
          </button>
        </form>
      </div>
    </div>
  );
};
