import React, { useState } from 'react';
import { Shield, User, KeyRound, Lock, X, Check, ArrowRight } from 'lucide-react';
import type { Profile, UserRole } from '../types/database';
import { INITIAL_PROFILES } from '../lib/mockData';

interface LoginModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: Profile;
  onSelectUser: (profile: Profile) => void;
}

export const LoginModal: React.FC<LoginModalProps> = ({
  isOpen,
  onClose,
  currentUser,
  onSelectUser,
}) => {
  const [nurseIdInput, setNurseIdInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [roleSelect, setRoleSelect] = useState<UserRole>('NURSE');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleCustomLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (!nurseIdInput.trim()) {
      setErrorMsg('Please enter a Nurse / Staff ID');
      return;
    }

    // Check if matches an existing profile or create custom session
    const match = INITIAL_PROFILES.find(
      (p) => p.badge_number?.toLowerCase() === nurseIdInput.trim().toLowerCase()
    );

    if (match) {
      onSelectUser(match);
      onClose();
    } else {
      // Create session for entered custom ID
      const customProfile: Profile = {
        id: `u-custom-${Date.now()}`,
        full_name: roleSelect === 'ADMIN' ? `Admin (${nurseIdInput.toUpperCase()})` : `Nurse (${nurseIdInput.toUpperCase()})`,
        badge_number: nurseIdInput.toUpperCase(),
        role: roleSelect,
        ward_id: roleSelect === 'ADMIN' ? null : 'a0000000-0000-0000-0000-000000000001',
        email: null,
        is_active: true,
        phone_number: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      onSelectUser(customProfile);
      onClose();
    }
  };

  const handleQuickSelect = (profile: Profile) => {
    onSelectUser(profile);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
      <div className="bg-slate-900 border border-slate-700/80 rounded-2xl w-full max-w-md p-6 shadow-2xl relative text-slate-100">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-slate-400 hover:text-slate-200 p-1 rounded-lg hover:bg-slate-800"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-xl bg-cyan-950 border border-cyan-700/60 flex items-center justify-center text-cyan-400">
            <Lock className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white">Staff Authentication</h2>
            <p className="text-xs text-slate-400">Access Control & Role Switching</p>
          </div>
        </div>

        {/* Quick Persona Switcher */}
        <div className="mb-6">
          <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider block mb-2">
            Quick Persona Switcher (Demo Mode)
          </label>
          <div className="space-y-2">
            {INITIAL_PROFILES.map((profile) => {
              const isSelected = currentUser.id === profile.id;
              return (
                <button
                  key={profile.id}
                  onClick={() => handleQuickSelect(profile)}
                  className={`w-full flex items-center justify-between p-3 rounded-xl border text-left transition-all ${
                    isSelected
                      ? 'bg-cyan-950/60 border-cyan-500/80 text-white ring-1 ring-cyan-500'
                      : 'bg-slate-800/60 border-slate-700/60 hover:bg-slate-800 hover:border-slate-600 text-slate-300'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                        profile.role === 'ADMIN'
                          ? 'bg-amber-950/80 text-amber-400 border border-amber-800/60'
                          : profile.role === 'WARD_SISTER'
                          ? 'bg-purple-950/80 text-purple-400 border border-purple-800/60'
                          : 'bg-cyan-950/80 text-cyan-400 border border-cyan-800/60'
                      }`}
                    >
                      {profile.role === 'ADMIN' ? (
                        <Shield className="w-4 h-4" />
                      ) : (
                        <User className="w-4 h-4" />
                      )}
                    </div>
                    <div>
                      <div className="text-sm font-semibold leading-tight">{profile.full_name}</div>
                      <div className="text-xs text-slate-400">
                        Badge ID: <span className="font-mono text-cyan-300">{profile.badge_number}</span> • {profile.role}
                      </div>
                    </div>
                  </div>
                  {isSelected && <Check className="w-4 h-4 text-cyan-400" />}
                </button>
              );
            })}
          </div>
        </div>

        <div className="relative flex py-2 items-center">
          <div className="flex-grow border-t border-slate-800"></div>
          <span className="flex-shrink mx-4 text-[11px] text-slate-500 uppercase tracking-widest">or login with credentials</span>
          <div className="flex-grow border-t border-slate-800"></div>
        </div>

        {/* Credentials Form */}
        <form onSubmit={handleCustomLogin} className="space-y-4 mt-2">
          {errorMsg && (
            <div className="p-2.5 bg-red-950/80 border border-red-800/80 text-red-300 text-xs rounded-lg">
              {errorMsg}
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">
              Nurse / Staff ID (Badge Number)
            </label>
            <div className="relative">
              <User className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                value={nurseIdInput}
                onChange={(e) => setNurseIdInput(e.target.value)}
                placeholder="e.g. NR-8492 or ADM-001"
                className="w-full bg-slate-800 border border-slate-700 rounded-lg pl-9 pr-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500 font-mono"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">
              Password / Pin
            </label>
            <div className="relative">
              <KeyRound className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="password"
                value={passwordInput}
                onChange={(e) => setPasswordInput(e.target.value)}
                placeholder="••••••••"
                className="w-full bg-slate-800 border border-slate-700 rounded-lg pl-9 pr-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 pt-1">
            {(['NURSE', 'WARD_SISTER', 'ADMIN'] as UserRole[]).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRoleSelect(r)}
                className={`py-1.5 px-2 text-xs font-semibold rounded-lg border text-center transition-all cursor-pointer ${
                  roleSelect === r
                    ? 'bg-cyan-600 border-cyan-400 text-white'
                    : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200'
                }`}
              >
                {r === 'WARD_SISTER' ? 'Sister' : r}
              </button>
            ))}
          </div>

          <button
            type="submit"
            className="w-full mt-2 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white py-2.5 rounded-xl font-semibold text-sm shadow-lg shadow-cyan-500/20 flex items-center justify-center gap-2 transition-all cursor-pointer"
          >
            <span>Sign In to Station</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </form>
      </div>
    </div>
  );
};
