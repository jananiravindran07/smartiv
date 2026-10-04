import React from 'react';
import { 
  Droplets, 
  Clock, 
  Battery, 
  BatteryWarning,
  Wifi, 
  AlertTriangle, 
  CheckCircle2, 
  RefreshCw, 
  PauseCircle, 
  PlayCircle,
  Scale
} from 'lucide-react';
import type { ActiveIVSessionWithTelemetry } from '../lib/mockData';
import { STATUS_CONFIG } from '../types/iv';
import { formatTimeRemaining, formatMetric } from '../lib/utils';
import type { IVStatus } from '../types/database';

interface IVCardProps {
  session: ActiveIVSessionWithTelemetry;
  onSelectSession: (session: ActiveIVSessionWithTelemetry) => void;
  onRefillBag?: (sessionId: string, addedVolumeMl: number) => void;
  onTogglePause?: (sessionId: string) => void;
}

export const IVCard: React.FC<IVCardProps> = ({
  session,
  onSelectSession,
  onRefillBag,
  onTogglePause,
}) => {
  // Determine computed status
  let status: IVStatus = 'NORMAL';
  if (session.current_volume_ml <= session.empty_threshold_ml) {
    status = 'EMPTY';
  } else if (session.current_volume_ml <= session.critical_threshold_ml) {
    status = 'CRITICAL';
  } else if (session.current_volume_ml <= session.low_threshold_ml) {
    status = 'LOW';
  } else if (session.current_flow_rate_ml_hr < 5 && session.current_volume_ml > session.empty_threshold_ml) {
    status = 'FLOW_STOPPED';
  }

  const config = STATUS_CONFIG[status] || STATUS_CONFIG.NORMAL;
  const isCritical = status === 'CRITICAL' || status === 'EMPTY';
  const isLow = status === 'LOW';

  // Battery icon helper
  const batteryLevel = session.device?.battery_level ?? 100;
  const getBatteryIcon = () => {
    if (batteryLevel <= 20) return <BatteryWarning className="w-3.5 h-3.5 text-red-400" />;
    return <Battery className="w-3.5 h-3.5 text-slate-400" />;
  };

  return (
    <div
      onClick={() => onSelectSession(session)}
      className={`relative rounded-2xl border transition-all duration-200 cursor-pointer overflow-hidden p-5 flex flex-col justify-between ${
        isCritical
          ? 'bg-red-950/30 border-red-500/80 shadow-lg shadow-red-950/40 ring-1 ring-red-500/50 pulse-critical'
          : isLow
          ? 'bg-amber-950/20 border-amber-500/60 shadow-md shadow-amber-950/20'
          : 'bg-slate-900/80 border-slate-800 hover:border-slate-700 hover:bg-slate-850 shadow-md'
      }`}
    >
      {/* Top Header: Bed & Status Pill */}
      <div>
        <div className="flex items-start justify-between gap-2 mb-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-base font-bold text-white tracking-tight">
                {session.patient?.bed_number || 'Bed --'}
              </span>
              <span className="text-xs text-slate-400 font-medium">
                {session.patient?.mrn}
              </span>
            </div>
            <h3 className="text-sm font-semibold text-slate-200 truncate max-w-[200px]">
              {session.patient?.full_name || 'Unknown Patient'}
            </h3>
          </div>

          {/* Status Badge */}
          <div
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold uppercase tracking-wider border ${
              isCritical
                ? 'bg-red-950 border-red-600 text-red-300'
                : isLow
                ? 'bg-amber-950 border-amber-600 text-amber-300'
                : 'bg-emerald-950 border-emerald-700 text-emerald-300'
            }`}
          >
            {isCritical && <AlertTriangle className="w-3 h-3 text-red-400 animate-pulse" />}
            {isLow && <Clock className="w-3 h-3 text-amber-400" />}
            {status === 'NORMAL' && <CheckCircle2 className="w-3 h-3 text-emerald-400" />}
            <span>{config.label}</span>
          </div>
        </div>

        {/* Medication Info */}
        <div className="bg-slate-950/60 rounded-xl p-2.5 border border-slate-800/80 mb-4">
          <div className="text-[11px] text-slate-400 font-medium uppercase tracking-wider">Infusion Fluid</div>
          <div className="text-xs font-semibold text-cyan-300 truncate">
            {session.medication_name}
          </div>
        </div>

        {/* Core Fluid Level & Drop Animation Section */}
        <div className="grid grid-cols-2 gap-3 mb-4 items-center">
          {/* Visual Gauge Bar */}
          <div className="bg-slate-950/70 p-3 rounded-xl border border-slate-800/80">
            <div className="flex items-center justify-between text-xs text-slate-400 mb-1.5 font-medium">
              <span className="flex items-center gap-1">
                <Droplets className="w-3.5 h-3.5 text-cyan-400" /> Volume
              </span>
              <span className="font-mono text-slate-200 font-semibold">{session.percentage_remaining}%</span>
            </div>

            {/* Level Bar */}
            <div className="w-full h-3 bg-slate-800 rounded-full overflow-hidden p-0.5">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  isCritical
                    ? 'bg-gradient-to-r from-red-600 to-rose-500'
                    : isLow
                    ? 'bg-gradient-to-r from-amber-500 to-yellow-400'
                    : 'bg-gradient-to-r from-cyan-500 to-emerald-400'
                }`}
                style={{ width: `${Math.max(4, session.percentage_remaining)}%` }}
              />
            </div>

            <div className="flex items-baseline justify-between mt-2">
              <span className="text-lg font-bold text-white font-mono-numeric">
                {Math.round(session.current_volume_ml)} <span className="text-xs font-normal text-slate-400">mL</span>
              </span>
              <span className="text-[11px] text-slate-500 font-mono">
                / {session.initial_volume_ml} mL
              </span>
            </div>
          </div>

          {/* Time Remaining & Rate */}
          <div className="bg-slate-950/70 p-3 rounded-xl border border-slate-800/80">
            <div className="text-xs text-slate-400 mb-1 flex items-center justify-between font-medium">
              <span className="flex items-center gap-1">
                <Clock className="w-3.5 h-3.5 text-amber-400" /> Time Left
              </span>
              <span className="text-[10px] text-slate-500 uppercase">Est.</span>
            </div>
            <div className="text-lg font-bold text-white font-mono-numeric">
              {formatTimeRemaining(session.time_remaining_minutes)}
            </div>
            <div className="flex items-center justify-between mt-2 text-xs">
              <span className="text-slate-400">Rate:</span>
              <span className="font-mono font-semibold text-cyan-300">
                {formatMetric(session.current_flow_rate_ml_hr, 1, 'mL/h')}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Footer: Device Pole Telemetry & Quick Action Bar */}
      <div>
        <div className="flex items-center justify-between text-xs text-slate-400 pt-2 border-t border-slate-800 mb-3">
          <div className="flex items-center gap-3">
            <span className="font-mono text-[11px] text-slate-300 font-medium">
              {session.device?.name || session.device?.device_identifier}
            </span>
            <div className="flex items-center gap-1" title={`Battery: ${batteryLevel}%`}>
              {getBatteryIcon()}
              <span className="text-[11px] font-mono">{batteryLevel}%</span>
            </div>
            <div className="flex items-center gap-1" title={`WiFi RSSI: ${session.device?.wifi_rssi ?? -60} dBm`}>
              <Wifi className="w-3.5 h-3.5 text-slate-400" />
              <span className="text-[11px] font-mono">{session.device?.wifi_rssi ?? -60} dBm</span>
            </div>
          </div>

          <div className="flex items-center gap-1 text-[11px] text-slate-400 font-mono">
            <Scale className="w-3 h-3 text-slate-500" />
            <span>{formatMetric(session.raw_mass_g, 1, 'g')}</span>
          </div>
        </div>

        {/* Quick Action Buttons */}
        <div className="grid grid-cols-2 gap-2" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={() => onRefillBag?.(session.id, 500)}
            className="flex items-center justify-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold py-2 px-2.5 rounded-lg border border-slate-700 transition-colors cursor-pointer"
            title="Add/Replace IV Bag (+500 mL)"
          >
            <RefreshCw className="w-3.5 h-3.5 text-cyan-400" />
            <span>Refill (+500mL)</span>
          </button>

          <button
            onClick={() => onTogglePause?.(session.id)}
            className="flex items-center justify-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold py-2 px-2.5 rounded-lg border border-slate-700 transition-colors cursor-pointer"
          >
            {session.status === 'ACTIVE' ? (
              <>
                <PauseCircle className="w-3.5 h-3.5 text-amber-400" />
                <span>Pause</span>
              </>
            ) : (
              <>
                <PlayCircle className="w-3.5 h-3.5 text-emerald-400" />
                <span>Resume</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
