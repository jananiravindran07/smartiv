import React, { useState } from 'react';
import { 
  Shield, 
  Cpu, 
  FileText, 
  AlertTriangle, 
  Pause, 
  RefreshCw,
  Zap,
  Users,
  CheckCircle2,
  XCircle
} from 'lucide-react';
import type { Device, Patient, AuditLog } from '../types/database';

interface AdminConsoleViewProps {
  devices: Device[];
  patients: Patient[];
  auditLogs: AuditLog[];
  onTriggerSimulation: (type: 'TRIGGER_CRITICAL' | 'TRIGGER_LOW' | 'STOP_FLOW' | 'OFFLINE_DEVICE' | 'RESET_ALL') => void;
  onUpdateCalibration: (deviceId: string, factor: number) => void;
}

export const AdminConsoleView: React.FC<AdminConsoleViewProps> = ({
  devices,
  patients,
  auditLogs,
  onTriggerSimulation,
  onUpdateCalibration,
}) => {
  const [activeTab, setActiveTab] = useState<'hardware' | 'audit' | 'simulator' | 'patients'>('simulator');
  const [editingDevice, setEditingDevice] = useState<Device | null>(null);
  const [calibInput, setCalibInput] = useState<number>(420);

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-850 to-slate-900 border border-slate-800 rounded-2xl p-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="p-1.5 rounded-lg bg-amber-950 border border-amber-800/80 text-amber-400">
              <Shield className="w-5 h-5" />
            </span>
            <h1 className="text-xl font-bold text-white tracking-tight">
              Hospital Admin & Bio-Med Engineering Console
            </h1>
          </div>
          <p className="text-xs text-slate-400">
            Hardware load cell diagnostics, RLS audit trails, ESP32 calibration, and telemetry stress testing.
          </p>
        </div>

        {/* Console Tabs */}
        <div className="flex items-center bg-slate-800/80 p-1 rounded-xl border border-slate-700/60">
          <button
            onClick={() => setActiveTab('simulator')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all ${
              activeTab === 'simulator'
                ? 'bg-cyan-600 text-white shadow'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Zap className="w-3.5 h-3.5" />
            <span>Interactive Simulator</span>
          </button>
          <button
            onClick={() => setActiveTab('hardware')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all ${
              activeTab === 'hardware'
                ? 'bg-cyan-600 text-white shadow'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Cpu className="w-3.5 h-3.5" />
            <span>ESP32 Hardware ({devices.length})</span>
          </button>
          <button
            onClick={() => setActiveTab('audit')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all ${
              activeTab === 'audit'
                ? 'bg-cyan-600 text-white shadow'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            <span>Audit Trail ({auditLogs.length})</span>
          </button>
          <button
            onClick={() => setActiveTab('patients')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all ${
              activeTab === 'patients'
                ? 'bg-cyan-600 text-white shadow'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            <span>Census ({patients.length})</span>
          </button>
        </div>
      </div>

      {/* Tab 1: Interactive Telemetry Simulator */}
      {activeTab === 'simulator' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-6">
          <div className="border-b border-slate-800 pb-4">
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <Zap className="w-4 h-4 text-cyan-400" />
              Live Telemetry & Clinical Alarm Simulator
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              Trigger real-time edge conditions on the IV poles to test nurse station acoustic alarms, visual alerts, and flow calculations.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-slate-950/70 border border-red-900/50 rounded-xl p-4 flex flex-col justify-between">
              <div>
                <div className="text-xs font-bold text-red-400 uppercase tracking-wider mb-1 flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4" /> Trigger Critical Level
                </div>
                <p className="text-xs text-slate-400 mb-4">
                  Simulate load cell dropping to 18 mL on Bed 108-C (David Kowalski). Triggers 2-tone alarm chime.
                </p>
              </div>
              <button
                onClick={() => onTriggerSimulation('TRIGGER_CRITICAL')}
                className="w-full bg-red-600 hover:bg-red-500 text-white py-2 rounded-lg text-xs font-bold shadow-md shadow-red-950/50 transition-all cursor-pointer"
              >
                Inject Critical Event
              </button>
            </div>

            <div className="bg-slate-950/70 border border-amber-900/50 rounded-xl p-4 flex flex-col justify-between">
              <div>
                <div className="text-xs font-bold text-amber-400 uppercase tracking-wider mb-1 flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4" /> Trigger Low IV Warning
                </div>
                <p className="text-xs text-slate-400 mb-4">
                  Simulate Bed 106-A (Sarah Jenkins) reaching 75 mL threshold. Triggers amber notification.
                </p>
              </div>
              <button
                onClick={() => onTriggerSimulation('TRIGGER_LOW')}
                className="w-full bg-amber-600 hover:bg-amber-500 text-white py-2 rounded-lg text-xs font-bold shadow-md shadow-amber-950/50 transition-all cursor-pointer"
              >
                Inject Low Warning
              </button>
            </div>

            <div className="bg-slate-950/70 border border-orange-900/50 rounded-xl p-4 flex flex-col justify-between">
              <div>
                <div className="text-xs font-bold text-orange-400 uppercase tracking-wider mb-1 flex items-center gap-1.5">
                  <Pause className="w-4 h-4" /> Simulate Line Occlusion
                </div>
                <p className="text-xs text-slate-400 mb-4">
                  Drop flow rate to 0 mL/hr while fluid remains in bag to trigger Flow Stopped / Occlusion alert.
                </p>
              </div>
              <button
                onClick={() => onTriggerSimulation('STOP_FLOW')}
                className="w-full bg-orange-600 hover:bg-orange-500 text-white py-2 rounded-lg text-xs font-bold shadow-md shadow-orange-950/50 transition-all cursor-pointer"
              >
                Simulate Occlusion
              </button>
            </div>

            <div className="bg-slate-950/70 border border-slate-700/60 rounded-xl p-4 flex flex-col justify-between">
              <div>
                <div className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-1 flex items-center gap-1.5">
                  <RefreshCw className="w-4 h-4" /> Reset All Telemetry
                </div>
                <p className="text-xs text-slate-400 mb-4">
                  Restore all IV sessions, bags, and ESP32 nodes back to clean baseline state.
                </p>
              </div>
              <button
                onClick={() => onTriggerSimulation('RESET_ALL')}
                className="w-full bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer"
              >
                Reset All Poles
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tab 2: Hardware Devices & Calibration */}
      {activeTab === 'hardware' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-lg">
          <div className="p-4 border-b border-slate-800 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-white">ESP32 Pole Units & HX711 Load Cell Calibration</h3>
              <p className="text-xs text-slate-400">Manage device keys, tare weights, and calibration constants</p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="bg-slate-950/80 uppercase text-[11px] font-semibold text-slate-400 border-b border-slate-800">
                <tr>
                  <th className="px-4 py-3">Device Node</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">HX711 Factor</th>
                  <th className="px-4 py-3">Tare Mass</th>
                  <th className="px-4 py-3">Battery</th>
                  <th className="px-4 py-3">WiFi RSSI</th>
                  <th className="px-4 py-3">Last Seen</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono">
                {devices.map((d) => (
                  <tr key={d.id} className="hover:bg-slate-800/40">
                    <td className="px-4 py-3">
                      <div className="font-bold text-slate-200 font-sans">{d.name}</div>
                      <div className="text-[11px] text-cyan-400">{d.device_identifier}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase ${
                          d.is_active
                            ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                            : 'bg-slate-800 text-slate-400 border border-slate-700'
                        }`}
                      >
                        {d.is_active ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                        {d.is_active ? 'Online' : 'Offline'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-200">{d.hx711_calibration_factor}</td>
                    <td className="px-4 py-3">{d.default_empty_bag_mass_g} g</td>
                    <td className="px-4 py-3">{d.battery_level ?? '--'}%</td>
                    <td className="px-4 py-3">{d.wifi_rssi ?? '--'} dBm</td>
                    <td className="px-4 py-3 text-[11px] text-slate-400">
                      {d.last_seen_at ? new Date(d.last_seen_at).toLocaleTimeString() : '--'}
                    </td>
                    <td className="px-4 py-3 text-right font-sans">
                      <button
                        onClick={() => {
                          setEditingDevice(d);
                          setCalibInput(d.hx711_calibration_factor);
                        }}
                        className="bg-slate-800 hover:bg-slate-700 text-slate-200 px-2.5 py-1 rounded-md text-xs font-medium border border-slate-700"
                      >
                        Calibrate
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 3: Tamper-Evident Audit Trail */}
      {activeTab === 'audit' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-lg">
          <div className="p-4 border-b border-slate-800">
            <h3 className="text-sm font-bold text-white">Immutable Security & Clinical Audit Trail</h3>
            <p className="text-xs text-slate-400">Postgres RLS audit logging for alert acknowledgments and infusion changes</p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="bg-slate-950/80 uppercase text-[11px] font-semibold text-slate-400 border-b border-slate-800">
                <tr>
                  <th className="px-4 py-3">Timestamp</th>
                  <th className="px-4 py-3">Action Type</th>
                  <th className="px-4 py-3">Entity</th>
                  <th className="px-4 py-3">Metadata</th>
                  <th className="px-4 py-3">IP Address</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono text-[11px]">
                {auditLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-800/40">
                    <td className="px-4 py-3 text-slate-400">
                      {new Date(log.created_at).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 font-bold text-cyan-400 font-sans">
                      {log.action}
                    </td>
                    <td className="px-4 py-3 text-slate-300">{log.entity_type}</td>
                    <td className="px-4 py-3 font-sans text-slate-300">
                      {JSON.stringify(log.metadata)}
                    </td>
                    <td className="px-4 py-3 text-slate-400">{log.ip_address}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 4: Patient Census */}
      {activeTab === 'patients' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-lg">
          <div className="p-4 border-b border-slate-800">
            <h3 className="text-sm font-bold text-white">Ward Patient Census & Bed Roster</h3>
            <p className="text-xs text-slate-400">Active admissions, medical record numbers, and clinical infusion notes</p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="bg-slate-950/80 uppercase text-[11px] font-semibold text-slate-400 border-b border-slate-800">
                <tr>
                  <th className="px-4 py-3">Bed</th>
                  <th className="px-4 py-3">Patient Name</th>
                  <th className="px-4 py-3">MRN</th>
                  <th className="px-4 py-3">DOB</th>
                  <th className="px-4 py-3">Clinical Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {patients.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-800/40">
                    <td className="px-4 py-3 font-bold text-slate-200">{p.bed_number}</td>
                    <td className="px-4 py-3 font-semibold text-cyan-300">{p.full_name}</td>
                    <td className="px-4 py-3 font-mono text-slate-400">{p.mrn}</td>
                    <td className="px-4 py-3 font-mono text-slate-400">{p.date_of_birth || '--'}</td>
                    <td className="px-4 py-3 text-slate-300">{p.notes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Calibration Modal */}
      {editingDevice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 w-full max-w-sm text-slate-100 shadow-2xl">
            <h3 className="text-base font-bold text-white mb-1">
              Calibrate Load Cell ({editingDevice.name})
            </h3>
            <p className="text-xs text-slate-400 mb-4">
              Enter the new calibration factor for {editingDevice.device_identifier} (HX711 24-bit ADC):
            </p>

            <div className="mb-4">
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Calibration Factor (counts/gram)
              </label>
              <input
                type="number"
                step="0.1"
                value={calibInput}
                onChange={(e) => setCalibInput(Number(e.target.value))}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2.5 text-sm font-mono text-slate-100 focus:ring-2 focus:ring-cyan-500"
              />
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => setEditingDevice(null)}
                className="w-1/2 bg-slate-800 hover:bg-slate-700 text-slate-300 py-2 rounded-xl text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  onUpdateCalibration(editingDevice.id, calibInput);
                  setEditingDevice(null);
                }}
                className="w-1/2 bg-cyan-600 hover:bg-cyan-500 text-white py-2 rounded-xl text-xs font-semibold"
              >
                Save Factor
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
