import React, { useState, useEffect } from 'react';
import { 
  Activity, 
  Volume2, 
  VolumeX, 
  Shield, 
  User, 
  Bell, 
  Building2,
  ChevronDown
} from 'lucide-react';
import type { Profile, Ward } from '../types/database';

interface NavbarProps {
  currentUser: Profile;
  wards: Ward[];
  selectedWardId: string | null;
  onSelectWard: (wardId: string | null) => void;
  onOpenLogin: () => void;
  isAudioMuted: boolean;
  onToggleAudio: () => void;
  activeAlertsCount: number;
  activeView: 'nurse' | 'admin' | 'devices';
  onChangeView: (view: 'nurse' | 'admin' | 'devices') => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  currentUser,
  wards,
  selectedWardId,
  onSelectWard,
  onOpenLogin,
  isAudioMuted,
  onToggleAudio,
  activeAlertsCount,
  activeView,
  onChangeView,
}) => {
  const [timeStr, setTimeStr] = useState<string>('');

  useEffect(() => {
    const updateTime = () => {
      const d = new Date();
      setTimeStr(d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }));
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <header className="sticky top-0 z-40 bg-slate-900/95 backdrop-blur-md border-b border-slate-800 px-4 lg:px-8 py-3">
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
        {/* Logo & Brand */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-cyan-500 to-blue-600 flex items-center justify-center shadow-lg shadow-cyan-500/20 text-white">
            <Activity className="w-6 h-6 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-lg text-white tracking-tight">SmartIV</span>
              <span className="text-[10px] uppercase tracking-wider font-semibold bg-cyan-950 text-cyan-300 border border-cyan-800/60 px-2 py-0.5 rounded-full">
                Telemetry Station
              </span>
            </div>
            <p className="text-xs text-slate-400 hidden sm:block">
              Clinical IV Bag Weight & Flow Rate Monitoring System
            </p>
          </div>
        </div>

        {/* Center: Ward Selector & View Navigation */}
        <div className="flex items-center gap-2">
          {/* Ward Switcher */}
          <div className="relative flex items-center">
            <Building2 className="w-4 h-4 text-slate-400 absolute left-3 pointer-events-none" />
            <select
              value={selectedWardId ?? 'ALL'}
              onChange={(e) => onSelectWard(e.target.value === 'ALL' ? null : e.target.value)}
              className="bg-slate-800 border border-slate-700 text-slate-200 text-xs sm:text-sm rounded-lg pl-9 pr-8 py-1.5 focus:outline-none focus:ring-2 focus:ring-cyan-500 appearance-none font-medium cursor-pointer"
            >
              {currentUser.role === 'ADMIN' && (
                <option value="ALL">🏥 All Wards (Hospital Overview)</option>
              )}
              {wards.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name} ({w.code})
                </option>
              ))}
            </select>
            <ChevronDown className="w-4 h-4 text-slate-400 absolute right-2.5 pointer-events-none" />
          </div>

          {/* Role Navigation Buttons */}
          <div className="hidden md:flex bg-slate-800/80 p-1 rounded-lg border border-slate-700/60">
            <button
              onClick={() => onChangeView('nurse')}
              className={`px-3 py-1 text-xs font-semibold rounded-md transition-all cursor-pointer ${
                activeView === 'nurse'
                  ? 'bg-cyan-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Nurse Grid
            </button>
            {(currentUser.role === 'ADMIN' || currentUser.role === 'WARD_SISTER') && (
              <button
                onClick={() => onChangeView('admin')}
                className={`px-3 py-1 text-xs font-semibold rounded-md transition-all cursor-pointer ${
                  activeView === 'admin'
                    ? 'bg-cyan-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Admin & Audit
              </button>
            )}
            {currentUser.role === 'ADMIN' && (
              <button
                onClick={() => onChangeView('devices')}
                className={`px-3 py-1 text-xs font-semibold rounded-md transition-all cursor-pointer ${
                  activeView === 'devices'
                    ? 'bg-cyan-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                ESP32 Hardware
              </button>
            )}
          </div>
        </div>

        {/* Right: Time, Audio Alarm Toggle, User Badge */}
        <div className="flex items-center gap-3">
          {/* Live Station Clock */}
          <div className="hidden xl:flex items-center gap-1.5 bg-slate-800/60 border border-slate-700/50 px-3 py-1.5 rounded-lg text-slate-300 text-xs font-mono font-numeric">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
            <span>LIVE {timeStr}</span>
          </div>

          {/* Audio Chime Mute Button */}
          <button
            onClick={onToggleAudio}
            title={isAudioMuted ? 'Alarms Muted (Click to Unmute)' : 'Audio Alarms Active'}
            className={`p-2 rounded-lg border transition-all cursor-pointer ${
              isAudioMuted
                ? 'bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200'
                : 'bg-emerald-950/40 border-emerald-800/60 text-emerald-400 hover:bg-emerald-900/40'
            }`}
          >
            {isAudioMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </button>

          {/* Active Alerts Pill */}
          {activeAlertsCount > 0 && (
            <div className="flex items-center gap-1.5 bg-red-950/80 border border-red-700/80 text-red-300 px-2.5 py-1 rounded-lg text-xs font-semibold pulse-critical">
              <Bell className="w-3.5 h-3.5 text-red-400 animate-bounce" />
              <span>{activeAlertsCount} Alert{activeAlertsCount > 1 ? 's' : ''}</span>
            </div>
          )}

          {/* User Profile / Role Badge */}
          <div className="flex items-center gap-2 pl-2 border-l border-slate-800">
            <div className="text-right hidden sm:block">
              <div className="text-xs font-medium text-slate-200 leading-tight flex items-center justify-end gap-1">
                {currentUser.full_name}
                {currentUser.role === 'ADMIN' && <Shield className="w-3 h-3 text-amber-400" />}
              </div>
              <div className="text-[11px] text-slate-400 font-mono">
                ID: {currentUser.badge_number ?? 'STF-000'} • {currentUser.role}
              </div>
            </div>

            <button
              onClick={onOpenLogin}
              title="Switch Staff Persona / Login"
              className="flex items-center gap-1 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer"
            >
              <User className="w-3.5 h-3.5 text-cyan-400" />
              <span className="hidden lg:inline">Switch Role</span>
            </button>
          </div>
        </div>
      </div>
    </header>
  );
};
