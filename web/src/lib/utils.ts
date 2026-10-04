import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type { FluidPhysicsParams, CalculatedFluidState } from '../types/iv';
import type { IVStatus } from '../types/database';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Calculates fluid mass, volume, and percentage remaining.
 * Never assumes 1g = 1mL.
 * fluid_mass = raw_mass - empty_bag_mass
 * volume = fluid_mass / fluid_density
 */
export function calculateFluidState(
  params: FluidPhysicsParams,
  initialVolumeMl: number,
  currentFlowRateMlHr: number,
  lowThresholdMl: number,
  criticalThresholdMl: number,
  emptyThresholdMl: number
): CalculatedFluidState {
  const { raw_mass_g, empty_bag_mass_g, fluid_density_g_ml } = params;
  
  const fluidMassG = Math.max(0, raw_mass_g - empty_bag_mass_g);
  const density = fluid_density_g_ml > 0 ? fluid_density_g_ml : 1.0;
  const calculatedVolumeMl = Math.round((fluidMassG / density) * 10) / 10;
  
  const percentageRemaining = Math.min(100, Math.max(0, Math.round((calculatedVolumeMl / initialVolumeMl) * 100)));

  let estimatedTimeRemainingMinutes: number | null = null;
  if (currentFlowRateMlHr > 0) {
    estimatedTimeRemainingMinutes = Math.round((calculatedVolumeMl / currentFlowRateMlHr) * 60);
  }

  let status: IVStatus = 'NORMAL';
  let status_label = 'Normal Flow';

  if (calculatedVolumeMl <= emptyThresholdMl) {
    status = 'EMPTY';
    status_label = 'Bag Empty';
  } else if (calculatedVolumeMl <= criticalThresholdMl) {
    status = 'CRITICAL';
    status_label = 'Critical Level';
  } else if (calculatedVolumeMl <= lowThresholdMl) {
    status = 'LOW';
    status_label = 'Low Volume';
  } else if (currentFlowRateMlHr < 5 && calculatedVolumeMl > emptyThresholdMl) {
    status = 'FLOW_STOPPED';
    status_label = 'Flow Stopped';
  }

  return {
    fluid_mass_g: fluidMassG,
    calculated_volume_ml: calculatedVolumeMl,
    percentage_remaining: percentageRemaining,
    estimated_time_remaining_minutes: estimatedTimeRemainingMinutes,
    status,
    status_label,
  };
}

/**
 * Format remaining minutes into human-readable tabular string (e.g. "2h 15m")
 */
export function formatTimeRemaining(minutes: number | null): string {
  if (minutes === null || minutes <= 0) return '--';
  const hrs = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hrs === 0) return `${mins}m`;
  return `${hrs}h ${mins}m`;
}

/**
 * Formats a metric number with fixed tabular precision
 */
export function formatMetric(val: number | null | undefined, decimals = 1, unit = ''): string {
  if (val === null || val === undefined || isNaN(val)) return `-- ${unit}`.trim();
  return `${val.toFixed(decimals)} ${unit}`.trim();
}
