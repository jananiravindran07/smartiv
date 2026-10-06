export const pad = (value: number): string => String(value).padStart(2, '0');

export const fmtClock = (ms: number): string =>
  new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });

export const fmtDate = (ms: number): string =>
  new Date(ms).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

export const fmtStamp = (ms: number): string =>
  new Date(ms).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/**
 * Countdown wording from the prototype. Under ten minutes it counts seconds so
 * a bed about to run out visibly moves; longer spans read in hours and minutes.
 */
export function fmtLeft(minutesLeft: number | null, volumeMl: number | null, flowing: boolean): string {
  if (volumeMl === null) return 'No reading yet';
  if (volumeMl <= 0) return 'Bag empty';
  if (!flowing) return 'Flow stopped';
  if (minutesLeft === null) return 'Flow stopped';
  if (minutesLeft < 10) {
    const m = Math.floor(minutesLeft);
    const s = Math.floor((minutesLeft - m) * 60);
    return `in ${m} min ${pad(s)} s`;
  }
  const total = Math.round(minutesLeft);
  if (total < 60) return `in ${total} min`;
  return `in ${Math.floor(total / 60)} h ${pad(total % 60)} min`;
}

/** Orders beds inside a band: soonest end first, stopped flow pushed last. */
export function compareMinutesLeft(
  a: { minutesLeft: number | null; bedNumber: number },
  b: { minutesLeft: number | null; bedNumber: number },
): number {
  const rank = (value: number | null) => (value === null ? Number.POSITIVE_INFINITY : value);
  return rank(a.minutesLeft) - rank(b.minutesLeft) || a.bedNumber - b.bedNumber;
}
