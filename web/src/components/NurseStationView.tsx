import React, { useState } from 'react';
import { 
  Activity, 
  AlertTriangle, 
  Clock, 
  Droplets, 
  Search, 
  Plus, 
  CheckCircle2, 
  Bell, 
  Check
} from 'lucide-react';
import type { ActiveIVSessionWithTelemetry } from '../lib/mockData';
import { IVCard } from './IVCard';
import type { Alert } from '../types/database';

interface NurseStationViewProps {
  sessions: ActiveIVSessionWithTelemetry[];
  alerts: Alert[];
  onSelectSession: (session: ActiveIVSessionWithTelemetry) => void;
  onOpenNewSession: () => void;
  onAcknowledgeAlert: (alertId: string) => void;
  onRefillBag: (sessionId: string, addedVolumeMl: number) => void;
  onTogglePause: (sessionId: string) => void;
  wardName: string;
}

export const NurseStationView: React.FC<NurseStationViewProps> = ({
  sessions,
  alerts,
  onSelectSession,
  onOpenNewSession,
  onAcknowledgeAlert,
  onRefillBag,
  onTogglePause,
  wardName,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'CRITICAL' | 'LOW' | 'NORMAL'>('ALL');

  // Compute stat counts
  const totalActive = sessions.filter((s) => s.status === 'ACTIVE').length;
  const criticalCount = sessions.filter(
    (s) => s.current_volume_ml <= s.critical_threshold_ml
  ).length;
  const lowCount = sessions.filter(
    (s) =>
      s.current_volume_ml > s.critical_threshold_ml &&
      s.current_volume_ml <= s.low_threshold_ml
  ).length;
  const normalCount = sessions.filter(
    (s) => s.current_volume_ml > s.low_threshold_ml
  ).length;

  const unacknowledgedAlerts = alerts.filter((a) => !a.is_acknowledged);

  // Filter sessions
  const filteredSessions = sessions.filter((s) => {
    // Ward search matching
    const matchSearch =
      (s.patient?.full_name?.toLowerCase().includes(searchQuery.toLowerCase()) || false) ||
      (s.patient?.bed_number?.toLowerCase().includes(searchQuery.toLowerCase()) || false) ||
      (s.medication_name?.toLowerCase().includes(searchQuery.toLowerCase()) || false);

    if (!matchSearch) return false;

    if (statusFilter === 'CRITICAL') {
      return s.current_volume_ml <= s.critical_threshold_ml;
    }
    if (statusFilter === 'LOW') {
      return (
        s.current_volume_ml > s.critical_threshold_ml &&
        s.current_volume_ml <= s.low_threshold_ml
      );
    }
    if (statusFilter === 'NORMAL') {
      return s.current_volume_ml > s.low_threshold_ml;
    }

    return true;
  });

  return (
    <div className="space-y-6">
      {/* Top Banner: Ward Name & Actions */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-white tracking-tight flex items-center gap-2">
            <span>{wardName}</span>
            <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-cyan-950 text-cyan-300 border border-cyan-800">
              Live Infusion Board
            </span>
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Load cell telemetry streaming at 1Hz from ESP32 pole nodes.
          </p>
        </div>

        <button
          onClick={onOpenNewSession}
          className="bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white px-4 py-2.5 rounded-xl font-semibold text-xs shadow-lg shadow-cyan-500/20 flex items-center gap-2 transition-all cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>Start New IV Infusion</span>
        </button>
      </div>

      {/* Critical Alarm Alert Bar if any unacknowledged */}
      {unacknowledgedAlerts.length > 0 && (
        <div className="bg-red-950/80 border border-red-500 rounded-2xl p-4 shadow-xl shadow-red-950/40 pulse-critical space-y-3">
          <div className="flex items-center gap-2 text-red-300 font-bold text-sm">
            <Bell className="w-4 h-4 text-red-400 animate-bounce" />
            <span>CRITICAL CLINICAL ALERTS ({unacknowledgedAlerts.length} UNACKNOWLEDGED)</span>
          </div>

          <div className="space-y-2">
            {unacknowledgedAlerts.map((alert) => (
              <div
                key={alert.id}
                className="bg-slate-900/90 border border-red-800/80 rounded-xl p-3 flex flex-wrap items-center justify-between gap-3"
              >
                <div className="flex items-center gap-2 text-xs text-slate-200">
                  <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0" />
                  <span>{alert.message}</span>
                </div>
                <button
                  onClick={() => onAcknowledgeAlert(alert.id)}
                  className="bg-red-600 hover:bg-red-500 text-white px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 shadow transition-all cursor-pointer"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>Acknowledge</span>
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* High-Level Ward Stats Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div
          onClick={() => setStatusFilter('ALL')}
          className={`p-4 rounded-2xl border transition-all cursor-pointer ${
            statusFilter === 'ALL'
              ? 'bg-slate-800/90 border-cyan-500 ring-1 ring-cyan-500'
              : 'bg-slate-900/80 border-slate-800 hover:border-slate-700'
          }`}
        >
          <div className="text-xs text-slate-400 font-medium flex items-center justify-between mb-1">
            <span>Active IV Poles</span>
            <Activity className="w-4 h-4 text-cyan-400" />
          </div>
          <div className="text-2xl font-bold font-mono text-white">{totalActive}</div>
          <div className="text-[11px] text-slate-500 mt-1">Total Monitored</div>
        </div>

        <div
          onClick={() => setStatusFilter('CRITICAL')}
          className={`p-4 rounded-2xl border transition-all cursor-pointer ${
            statusFilter === 'CRITICAL'
              ? 'bg-red-950/60 border-red-500 ring-1 ring-red-500'
              : 'bg-slate-900/80 border-slate-800 hover:border-slate-700'
          }`}
        >
          <div className="text-xs text-red-400 font-medium flex items-center justify-between mb-1">
            <span>Critical (≤50mL)</span>
            <AlertTriangle className="w-4 h-4 text-red-400" />
          </div>
          <div className="text-2xl font-bold font-mono text-red-400">{criticalCount}</div>
          <div className="text-[11px] text-slate-500 mt-1">Immediate Action Needed</div>
        </div>

        <div
          onClick={() => setStatusFilter('LOW')}
          className={`p-4 rounded-2xl border transition-all cursor-pointer ${
            statusFilter === 'LOW'
              ? 'bg-amber-950/60 border-amber-500 ring-1 ring-amber-500'
              : 'bg-slate-900/80 border-slate-800 hover:border-slate-700'
          }`}
        >
          <div className="text-xs text-amber-400 font-medium flex items-center justify-between mb-1">
            <span>Low Volume</span>
            <Clock className="w-4 h-4 text-amber-400" />
          </div>
          <div className="text-2xl font-bold font-mono text-amber-400">{lowCount}</div>
          <div className="text-[11px] text-slate-500 mt-1">Prepare Replacement</div>
        </div>

        <div
          onClick={() => setStatusFilter('NORMAL')}
          className={`p-4 rounded-2xl border transition-all cursor-pointer ${
            statusFilter === 'NORMAL'
              ? 'bg-emerald-950/60 border-emerald-500 ring-1 ring-emerald-500'
              : 'bg-slate-900/80 border-slate-800 hover:border-slate-700'
          }`}
        >
          <div className="text-xs text-emerald-400 font-medium flex items-center justify-between mb-1">
            <span>Normal Flow</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-2xl font-bold font-mono text-emerald-400">{normalCount}</div>
          <div className="text-[11px] text-slate-500 mt-1">Within Safe Parameters</div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-900/80 p-3 rounded-2xl border border-slate-800">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search bed (e.g. Bed 102), patient name, or medication..."
            className="w-full bg-slate-800/80 border border-slate-700 rounded-xl pl-9 pr-3 py-1.5 text-xs sm:text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500"
          />
        </div>

        {/* Filter Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto">
          {(['ALL', 'CRITICAL', 'LOW', 'NORMAL'] as const).map((filter) => (
            <button
              key={filter}
              onClick={() => setStatusFilter(filter)}
              className={`px-3 py-1 text-xs font-semibold rounded-lg border transition-all cursor-pointer ${
                statusFilter === filter
                  ? 'bg-cyan-600 border-cyan-400 text-white'
                  : 'bg-slate-800/60 border-slate-700 text-slate-400 hover:text-slate-200'
              }`}
            >
              {filter === 'ALL' ? 'All Beds' : filter}
            </button>
          ))}
        </div>
      </div>

      {/* IV Cards Grid */}
      {filteredSessions.length === 0 ? (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-12 text-center text-slate-400">
          <Droplets className="w-10 h-10 mx-auto text-slate-600 mb-3" />
          <h3 className="text-base font-semibold text-slate-200">No IV Sessions Match Filter</h3>
          <p className="text-xs text-slate-500 mt-1">
            Try adjusting your search query or status filter.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {filteredSessions.map((session) => (
            <IVCard
              key={session.id}
              session={session}
              onSelectSession={onSelectSession}
              onRefillBag={onRefillBag}
              onTogglePause={onTogglePause}
            />
          ))}
        </div>
      )}
    </div>
  );
};
