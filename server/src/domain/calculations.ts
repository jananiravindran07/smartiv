export type BedSeverity = 'critical' | 'attention' | 'normal';

export const SEVERITY_RANK: Record<BedSeverity, number> = { normal: 0, attention: 1, critical: 2 };

export const DEFAULT_RULES: AlertRuleValues = {
  criticalMinutes: 15,
  criticalPercent: 10,
  attentionMinutes: 45,
  attentionPercent: 25,
};

export interface AlertRuleValues {
  criticalMinutes: number;
  criticalPercent: number;
  attentionMinutes: number;
  attentionPercent: number;
}

export interface ReadingValues {
  bagMl: number;
  volumeMl: number;
  flowMlH: number;
  smoothedFlowMlH: number;
}

export interface BedMetrics {
  percentLeft: number;
  /** Minutes until the bag is empty, or null when the flow has stopped. */
  minutesLeft: number | null;
  endTime: number | null;
  severity: BedSeverity;
}

function isUsableNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** percentage = volume_left / bag_size * 100, clamped to the physical 0-100 range. */
export function calculatePercent(volumeMl: number, bagMl: number): number {
  if (!isUsableNumber(volumeMl) || !isUsableNumber(bagMl) || bagMl <= 0) return 0;
  return Math.max(0, Math.min(100, (volumeMl / bagMl) * 100));
}

/**
 * minutes_left = volume_left / smoothed_flow_rate * 60.
 * Returns 0 for an empty bag and null when no fluid is moving, because
 * "no flow" has no meaningful end time.
 */
export function calculateMinutesLeft(volumeMl: number, smoothedFlowMlH: number): number | null {
  if (!isUsableNumber(volumeMl) || volumeMl <= 0) return 0;
  if (!isUsableNumber(smoothedFlowMlH) || smoothedFlowMlH <= 0) return null;
  return (volumeMl / smoothedFlowMlH) * 60;
}

/** end_time = now + minutes_left, as an epoch milliseconds value. */
export function calculateEndTime(now: number, minutesLeft: number | null): number | null {
  return minutesLeft === null ? null : now + minutesLeft * 60_000;
}

/**
 * Critical when the bag is empty, the flow has stopped, either critical limit
 * is reached. Attention when either attention limit is reached.
 */
export function calculateSeverity(reading: ReadingValues, rules: AlertRuleValues): BedSeverity {
  const percentLeft = calculatePercent(reading.volumeMl, reading.bagMl);
  const minutesLeft = calculateMinutesLeft(reading.volumeMl, reading.smoothedFlowMlH);
  if (reading.volumeMl <= 0) return 'critical';
  if (reading.flowMlH <= 0) return 'critical';
  if (percentLeft <= rules.criticalPercent) return 'critical';
  if (minutesLeft !== null && minutesLeft <= rules.criticalMinutes) return 'critical';
  if (percentLeft <= rules.attentionPercent) return 'attention';
  if (minutesLeft !== null && minutesLeft <= rules.attentionMinutes) return 'attention';
  return 'normal';
}

export function calculateBedMetrics(
  reading: ReadingValues,
  rules: AlertRuleValues,
  now = Date.now(),
): BedMetrics {
  const percentLeft = calculatePercent(reading.volumeMl, reading.bagMl);
  const minutesLeft = calculateMinutesLeft(reading.volumeMl, reading.smoothedFlowMlH);
  return {
    percentLeft,
    minutesLeft,
    endTime: calculateEndTime(now, minutesLeft),
    severity: calculateSeverity(reading, rules),
  };
}

/**
 * Moving average over the last `windowSize` flow samples, used so a single
 * noisy load-cell reading cannot swing the end time on the dashboard.
 * A stopped flow drops straight to 0 instead of decaying through the average,
 * otherwise a stopped drip would keep reporting hours remaining.
 */
export function smoothFlowRate(
  previousSamples: readonly number[],
  nextSample: number,
  windowSize = 5,
): number {
  if (!isUsableNumber(nextSample)) return 0;
  if (nextSample <= 0) return 0;
  const usable = previousSamples.filter(isUsableNumber).filter((value) => value > 0);
  const window = [...usable.slice(-(windowSize - 1)), nextSample];
  return window.reduce((sum, value) => sum + value, 0) / window.length;
}

/** Index used to order beds: soonest first, with no-flow beds pushed last. */
export function compareByMinutesLeft(
  a: { minutesLeft: number | null; bedNumber: number },
  b: { minutesLeft: number | null; bedNumber: number },
): number {
  const rank = (value: number | null) => (value === null ? Number.POSITIVE_INFINITY : value);
  return rank(a.minutesLeft) - rank(b.minutesLeft) || a.bedNumber - b.bedNumber;
}
