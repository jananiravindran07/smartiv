import type { IVStatus } from './database';

export interface FluidPhysicsParams {
  raw_mass_g: number;
  empty_bag_mass_g: number;
  fluid_density_g_ml: number;
}

export interface CalculatedFluidState {
  fluid_mass_g: number;
  calculated_volume_ml: number;
  percentage_remaining: number;
  estimated_time_remaining_minutes: number | null;
  status: IVStatus;
  status_label: string;
}

export interface StatusConfig {
  label: string;
  badgeBg: string;
  badgeText: string;
  badgeBorder: string;
  tileBg: string;
  iconColor: string;
  pulse?: boolean;
}

export const STATUS_CONFIG: Record<IVStatus, StatusConfig> = {
  NORMAL: {
    label: 'Normal Flow',
    badgeBg: 'bg-emerald-50 dark:bg-emerald-950/40',
    badgeText: 'text-emerald-700 dark:text-emerald-300',
    badgeBorder: 'border-emerald-200 dark:border-emerald-800/60',
    tileBg: 'bg-emerald-100/80 dark:bg-emerald-900/30',
    iconColor: 'text-emerald-600 dark:text-emerald-400',
  },
  LOW: {
    label: 'Low Volume',
    badgeBg: 'bg-amber-50 dark:bg-amber-950/40',
    badgeText: 'text-amber-700 dark:text-amber-300',
    badgeBorder: 'border-amber-200 dark:border-amber-800/60',
    tileBg: 'bg-amber-100/80 dark:bg-amber-900/30',
    iconColor: 'text-amber-600 dark:text-amber-400',
  },
  CRITICAL: {
    label: 'Critical Level',
    badgeBg: 'bg-red-50 dark:bg-red-950/40',
    badgeText: 'text-red-700 dark:text-red-300',
    badgeBorder: 'border-red-200 dark:border-red-800/60',
    tileBg: 'bg-red-100/80 dark:bg-red-900/30',
    iconColor: 'text-red-600 dark:text-red-400',
    pulse: true,
  },
  EMPTY: {
    label: 'Bag Empty',
    badgeBg: 'bg-rose-100 dark:bg-rose-950/60',
    badgeText: 'text-rose-900 dark:text-rose-200 font-bold',
    badgeBorder: 'border-rose-300 dark:border-rose-800',
    tileBg: 'bg-rose-200/80 dark:bg-rose-900/50',
    iconColor: 'text-rose-700 dark:text-rose-300',
    pulse: true,
  },
  FLOW_STOPPED: {
    label: 'Flow Stopped',
    badgeBg: 'bg-orange-50 dark:bg-orange-950/40',
    badgeText: 'text-orange-700 dark:text-orange-300',
    badgeBorder: 'border-orange-200 dark:border-orange-800/60',
    tileBg: 'bg-orange-100/80 dark:bg-orange-900/30',
    iconColor: 'text-orange-600 dark:text-orange-400',
  },
  DEVICE_OFFLINE: {
    label: 'Device Offline',
    badgeBg: 'bg-slate-100 dark:bg-slate-800/60',
    badgeText: 'text-slate-600 dark:text-slate-300',
    badgeBorder: 'border-slate-200 dark:border-slate-700',
    tileBg: 'bg-slate-200/70 dark:bg-slate-800',
    iconColor: 'text-slate-500 dark:text-slate-400',
  },
  SENSOR_ERROR: {
    label: 'Sensor Fault',
    badgeBg: 'bg-purple-50 dark:bg-purple-950/40',
    badgeText: 'text-purple-700 dark:text-purple-300',
    badgeBorder: 'border-purple-200 dark:border-purple-800/60',
    tileBg: 'bg-purple-100/80 dark:bg-purple-900/30',
    iconColor: 'text-purple-600 dark:text-purple-400',
  },
};
