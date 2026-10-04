import React from 'react';
import { X, Activity, Droplets, Clock, Shield } from 'lucide-react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import type { ActiveIVSessionWithTelemetry } from '../lib/mockData';
import { formatMetric, formatTimeRemaining } from '../lib/utils';

interface TelemetryChartModalProps {
  session: ActiveIVSessionWithTelemetry | null;
  onClose: () => void;
  onRefill: (sessionId: string, volume: number) => void;
  onAcknowledgeAlert?: (sessionId: string) => void;
}

export const TelemetryChartModal: React.FC<TelemetryChartModalProps> = ({
  session,
  onClose,
  onRefill,
}) => {
  if (!session) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-sm">
      <div className="bg-slate-900 border border-slate-700/80 rounded-2xl w-full max-w-3xl p-6 shadow-2xl relative text-slate-100 max-h-[90vh] overflow-y-auto">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-slate-400 hover:text-slate-200 p-1 rounded-lg hover:bg-slate-800 cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Modal Header */}
        <div className="flex flex-wrap items-start justify-between gap-4 mb-6 border-b border-slate-800 pb-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xl font-bold text-white">
                {session.patient?.bed_number} — {session.patient?.full_name}
              </span>
              <span className="text-xs bg-slate-800 text-slate-300 font-mono px-2 py-0.5 rounded-md">
                {session.patient?.mrn}
              </span>
            </div>
            <p className="text-sm text-cyan-400 font-medium mt-0.5">
              {session.medication_name}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                onRefill(session.id, 500);
                onClose();
              }}
              className="bg-cyan-600 hover:bg-cyan-500 text-white px-3 py-1.5 rounded-lg text-xs font-semibold shadow transition-colors cursor-pointer"
            >
              Replace IV Bag (+500 mL)
            </button>
          </div>
        </div>

        {/* Live Metrics Quad */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <div className="bg-slate-950/70 p-3 rounded-xl border border-slate-800">
            <div className="text-xs text-slate-400 flex items-center gap-1 mb-1">
              <Droplets className="w-3.5 h-3.5 text-cyan-400" /> Remaining
            </div>
            <div className="text-xl font-bold font-mono text-white">
              {Math.round(session.current_volume_ml)} <span className="text-xs font-normal text-slate-400">mL</span>
            </div>
            <div className="text-[11px] text-slate-400 mt-1">
              {session.percentage_remaining}% of {session.initial_volume_ml} mL
            </div>
          </div>

          <div className="bg-slate-950/70 p-3 rounded-xl border border-slate-800">
            <div className="text-xs text-slate-400 flex items-center gap-1 mb-1">
              <Activity className="w-3.5 h-3.5 text-emerald-400" /> Flow Rate
            </div>
            <div className="text-xl font-bold font-mono text-white">
              {formatMetric(session.current_flow_rate_ml_hr, 1)} <span className="text-xs font-normal text-slate-400">mL/h</span>
            </div>
            <div className="text-[11px] text-slate-400 mt-1">
              Target: {session.target_flow_rate_ml_hr} mL/h
            </div>
          </div>

          <div className="bg-slate-950/70 p-3 rounded-xl border border-slate-800">
            <div className="text-xs text-slate-400 flex items-center gap-1 mb-1">
              <Clock className="w-3.5 h-3.5 text-amber-400" /> Time to Empty
            </div>
            <div className="text-xl font-bold font-mono text-white">
              {formatTimeRemaining(session.time_remaining_minutes)}
            </div>
            <div className="text-[11px] text-slate-400 mt-1">Estimated</div>
          </div>

          <div className="bg-slate-950/70 p-3 rounded-xl border border-slate-800">
            <div className="text-xs text-slate-400 flex items-center gap-1 mb-1">
              <Shield className="w-3.5 h-3.5 text-purple-400" /> Pole Unit
            </div>
            <div className="text-sm font-bold font-mono text-slate-200 truncate">
              {session.device?.device_identifier}
            </div>
            <div className="text-[11px] text-slate-400 mt-1">
              HX711: {session.device?.hx711_calibration_factor}
            </div>
          </div>
        </div>

        {/* Real-time Telemetry Trend Graph */}
        <div className="bg-slate-950/70 p-4 rounded-xl border border-slate-800 mb-6">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-300">
              Fluid Volume Depletion Curve (mL)
            </h4>
            <span className="text-xs text-slate-500 font-mono">Load Cell Live Stream</span>
          </div>

          <div className="h-60 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={session.telemetry_history}>
                <defs>
                  <linearGradient id="volGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#06b6d4" stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="time" stroke="#94a3b8" fontSize={11} />
                <YAxis stroke="#94a3b8" fontSize={11} domain={[0, 'auto']} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#0f172a',
                    borderColor: '#334155',
                    borderRadius: '8px',
                    color: '#f8fafc',
                    fontSize: '12px',
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="volume"
                  name="Volume (mL)"
                  stroke="#06b6d4"
                  strokeWidth={2}
                  fillOpacity={1}
                  fill="url(#volGrad)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Patient Notes & Prescription Details */}
        <div className="bg-slate-950/60 p-4 rounded-xl border border-slate-800 text-xs space-y-2">
          <div className="font-semibold text-slate-300">Clinical Protocol Notes:</div>
          <p className="text-slate-400">
            {session.patient?.notes || 'No specific clinical restrictions noted.'}
          </p>
          <div className="flex flex-wrap gap-4 pt-2 text-[11px] text-slate-400 font-mono">
            <span>Density: {session.fluid_density_g_ml} g/mL</span>
            <span>Tare Mass: {session.empty_bag_mass_g} g</span>
            <span>Critical Alarm Threshold: ≤{session.critical_threshold_ml} mL</span>
          </div>
        </div>
      </div>
    </div>
  );
};
