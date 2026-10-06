import { describe, expect, it } from 'vitest';
import {
  calculateBedMetrics,
  calculateEndTime,
  calculateMinutesLeft,
  calculatePercent,
  calculateSeverity,
  compareByMinutesLeft,
  smoothFlowRate,
  DEFAULT_RULES,
  type AlertRuleValues,
  type ReadingValues,
} from '../src/domain/calculations.js';

const rules: AlertRuleValues = DEFAULT_RULES;

/** Builds a reading with a smoothed rate equal to the raw rate by default. */
function reading(overrides: Partial<ReadingValues> = {}): ReadingValues {
  const flowMlH = overrides.flowMlH ?? 120;
  return { bagMl: 500, volumeMl: 250, flowMlH, smoothedFlowMlH: flowMlH, ...overrides };
}

describe('calculatePercent', () => {
  it('divides volume by bag size and multiplies by 100', () => {
    expect(calculatePercent(250, 500)).toBe(50);
    expect(calculatePercent(182, 500)).toBeCloseTo(36.4, 5);
    expect(calculatePercent(640, 1000)).toBe(64);
  });

  it('clamps to the physical 0-100 range', () => {
    expect(calculatePercent(0, 500)).toBe(0);
    expect(calculatePercent(600, 500)).toBe(100);
    expect(calculatePercent(-5, 500)).toBe(0);
  });

  it('returns 0 for an unusable bag size instead of dividing by zero', () => {
    expect(calculatePercent(100, 0)).toBe(0);
    expect(calculatePercent(100, -500)).toBe(0);
    expect(calculatePercent(Number.NaN, 500)).toBe(0);
    expect(calculatePercent(100, Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe('calculateMinutesLeft', () => {
  it('is volume divided by the smoothed rate times 60', () => {
    // 250 mL at 125 mL/h = 2 h = 120 min.
    expect(calculateMinutesLeft(250, 125)).toBe(120);
    // 30 mL at 120 mL/h = 15 min.
    expect(calculateMinutesLeft(30, 120)).toBe(15);
  });

  it('returns 0 for an empty bag', () => {
    expect(calculateMinutesLeft(0, 120)).toBe(0);
    expect(calculateMinutesLeft(-5, 120)).toBe(0);
  });

  it('returns null when the flow has stopped, because there is no end time', () => {
    expect(calculateMinutesLeft(250, 0)).toBeNull();
    expect(calculateMinutesLeft(250, Number.NaN)).toBeNull();
  });
});

describe('calculateEndTime', () => {
  it('adds minutes_left to now', () => {
    const now = 1_700_000_000_000;
    expect(calculateEndTime(now, 15)).toBe(now + 15 * 60_000);
    expect(calculateEndTime(now, 120)).toBe(now + 2 * 60 * 60_000);
  });

  it('is null when the flow has stopped', () => {
    expect(calculateEndTime(1_700_000_000_000, null)).toBeNull();
  });
});

describe('calculateSeverity', () => {
  it('is critical for an empty bag', () => {
    expect(calculateSeverity(reading({ volumeMl: 0 }), rules)).toBe('critical');
  });

  it('is critical when the flow has stopped, whatever the volume', () => {
    expect(calculateSeverity(reading({ volumeMl: 480, flowMlH: 0, smoothedFlowMlH: 0 }), rules)).toBe('critical');
  });

  it('is critical at or under the 15 minute limit', () => {
    // 30 mL at 120 mL/h = exactly 15 min.
    expect(calculateSeverity(reading({ volumeMl: 30, flowMlH: 120 }), rules)).toBe('critical');
    expect(calculateSeverity(reading({ volumeMl: 29, flowMlH: 120 }), rules)).toBe('critical');
  });

  it('is critical at or under the 10% volume limit', () => {
    expect(calculateSeverity(reading({ volumeMl: 50 }), rules)).toBe('critical'); // exactly 10%
    expect(calculateSeverity(reading({ volumeMl: 51 }), rules)).not.toBe('critical'); // 10.2%
  });

  it('is attention at or under the 45 minute limit', () => {
    // 90 mL at 120 mL/h = 45 min.
    expect(calculateSeverity(reading({ volumeMl: 90, flowMlH: 120 }), rules)).toBe('attention');
  });

  it('is attention at or under the 25% volume limit', () => {
    expect(calculateSeverity(reading({ volumeMl: 125 }), rules)).toBe('attention'); // exactly 25%
    expect(calculateSeverity(reading({ volumeMl: 126 }), rules)).toBe('normal');
  });

  it('honours edited rules', () => {
    const strict: AlertRuleValues = { criticalMinutes: 60, criticalPercent: 40, attentionMinutes: 120, attentionPercent: 60 };
    // 300 mL at 120 mL/h = 150 min: attention under the edited rules.
    expect(calculateSeverity(reading({ volumeMl: 300, flowMlH: 120 }), strict)).toBe('attention');
    // 150 mL = 30% which is under the edited 40% critical limit.
    expect(calculateSeverity(reading({ volumeMl: 150, flowMlH: 120 }), strict)).toBe('critical');
  });

  it('is normal when every limit has room', () => {
    // 250 mL at 120 mL/h = 125 min, 50% full.
    expect(calculateSeverity(reading({ volumeMl: 250, flowMlH: 120 }), rules)).toBe('normal');
  });

  it('uses the smoothed rate for time but the raw rate for stopped flow', () => {
    // Raw rate is healthy, smoothed rate still draining from a previous stall.
    const values = reading({ volumeMl: 20, bagMl: 500, flowMlH: 120, smoothedFlowMlH: 10 });
    expect(calculateSeverity(values, rules)).toBe('critical');
  });
});

describe('calculateBedMetrics', () => {
  it('returns percentage, minutes, end time and severity together', () => {
    const now = 1_700_000_000_000;
    const metrics = calculateBedMetrics(reading({ bagMl: 500, volumeMl: 250, flowMlH: 125 }), rules, now);
    expect(metrics.percentLeft).toBe(50);
    expect(metrics.minutesLeft).toBe(120);
    expect(metrics.endTime).toBe(now + 120 * 60_000);
    expect(metrics.severity).toBe('normal');
  });
});

describe('smoothFlowRate', () => {
  it('returns the sample itself when there is no history', () => {
    expect(smoothFlowRate([], 120)).toBe(120);
  });

  it('averages the last window of samples', () => {
    expect(smoothFlowRate([100, 110], 130, 3)).toBeCloseTo(113.333, 3);
  });

  it('keeps a steady rate steady', () => {
    expect(smoothFlowRate([120, 120, 120, 120], 120, 5)).toBe(120);
  });

  it('only uses the most recent windowSize samples', () => {
    expect(smoothFlowRate([0, 0, 500, 500, 500], 500, 3)).toBe(500);
  });

  it('snaps straight to zero when the flow stops', () => {
    // Without this a stopped drip would keep reporting time left for minutes.
    expect(smoothFlowRate([120, 120, 120, 120], 0)).toBe(0);
  });

  it('ignores non-numeric history', () => {
    expect(smoothFlowRate([Number.NaN, 120], 120, 3)).toBeCloseTo(120, 6);
  });
});

describe('compareByMinutesLeft', () => {
  it('sorts soonest first', () => {
    const rows = [
      { minutesLeft: 90, bedNumber: 1 },
      { minutesLeft: 15, bedNumber: 2 },
      { minutesLeft: 45, bedNumber: 3 },
    ];
    expect(rows.sort(compareByMinutesLeft).map((row) => row.bedNumber)).toEqual([2, 3, 1]);
  });

  it('pushes stopped-flow beds to the end, then breaks ties on bed number', () => {
    const rows = [
      { minutesLeft: null, bedNumber: 7 },
      { minutesLeft: 30, bedNumber: 3 },
      { minutesLeft: 30, bedNumber: 2 },
    ];
    expect(rows.sort(compareByMinutesLeft).map((row) => row.bedNumber)).toEqual([2, 3, 7]);
  });
});
