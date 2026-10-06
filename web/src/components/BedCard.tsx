import { useEffect, useMemo, useRef, useState } from 'react';
import { IvBag } from './IvBag';
import { SeverityIcon } from './Icons';
import { fmtClock, fmtLeft, pad } from '../lib/format';
import type { Bed, BedAction } from '../types';

interface BedCardProps {
  bed: Bed;
  now: number;
  onAction: (bedNumber: number, action: BedAction) => void;
}

/** Severity to the CSS token the prototype's stylesheet uses. */
const SEVERITY_CLASS: Record<Bed['severity'], 'crit' | 'warn' | 'ok'> = {
  critical: 'crit',
  attention: 'warn',
  normal: 'ok',
};

/** Pill wording follows the prototype: the reason, not just the band. */
function pillLabel(bed: Bed): string {
  if (bed.severity === 'critical') {
    if (bed.volumeMl === null) return 'No reading';
    if (bed.volumeMl <= 0) return 'Empty';
    if (bed.flowMlH === null || bed.flowMlH <= 0) return 'No flow';
    return 'Critical';
  }
  if (bed.severity === 'attention') return 'Attention';
  return 'Running';
}

export function BedCard({ bed, now, onAction }: BedCardProps) {
  const [armed, setArmed] = useState(false);
  const armTimer = useRef<number | undefined>(undefined);

  // "Bag replaced" needs a second press, so it cannot be hit by accident while
  // moving between beds. It re-arms itself after four seconds.
  useEffect(() => {
    if (!armed) return;
    armTimer.current = window.setTimeout(() => setArmed(false), 4000);
    return () => window.clearTimeout(armTimer.current);
  }, [armed]);

  useEffect(() => () => window.clearTimeout(armTimer.current), []);

  const percent = bed.percentLeft ?? 0;
  const flowing = (bed.flowMlH ?? 0) > 0 && (bed.volumeMl ?? 0) > 0;
  const empty = bed.volumeMl !== null && bed.volumeMl <= 0;

  /**
   * minutes_left arrives with each reading. Ageing it against the local clock
   * makes the countdown tick every second between readings, without inventing
   * a severity the server has not sent.
   */
  const agedMinutes = useMemo(() => {
    if (bed.minutesLeft === null || bed.lastReadingAt === null) return bed.minutesLeft;
    const elapsedMinutes = Math.max(0, now - bed.lastReadingAt) / 60_000;
    return Math.max(0, bed.minutesLeft - elapsedMinutes);
  }, [bed.minutesLeft, bed.lastReadingAt, now]);

  const endsAt = empty ? 'Ended' : bed.endTime !== null ? fmtClock(bed.endTime) : '—';
  const countdown = fmtLeft(agedMinutes, bed.volumeMl, flowing);
  const showRestore = bed.volumeMl !== null && bed.volumeMl > 0 && (bed.flowMlH ?? 0) <= 0;

  // A faster drip drips faster; the prototype clamps it to a readable range.
  const dripSpeed = flowing ? Math.min(6, Math.max(0.5, 3600 / ((bed.flowMlH ?? 120) * 20))).toFixed(2) : '1.6';

  const classes = [
    'bed',
    `s-${SEVERITY_CLASS[bed.severity]}`,
    bed.acknowledged && bed.severity !== 'normal' ? 'acked' : '',
    flowing ? '' : 'nodrip',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <article
      className={classes}
      style={{ ['--drip' as string]: `${dripSpeed}s` }}
      aria-label={`Bed ${pad(bed.bedNumber)}`}
      data-bed={bed.bedNumber}
      data-severity={bed.severity}
    >
      <div className="bed-head">
        <div className="bed-id">
          <span className="bed-no">Bed {pad(bed.bedNumber)}</span>
          <span className="pt">
            {bed.patientInitials} · {bed.patientAge} y
          </span>
        </div>
        <span className="pill">
          <SeverityIcon severity={bed.severity} /> {pillLabel(bed)}
        </span>
      </div>

      <div className="bed-body">
        <div className="bag">
          <IvBag percent={percent} id={`bed-${bed.bedNumber}`} />
        </div>
        <div className="bed-main">
          <div className="ends">
            <span className="k">Ends at</span>
            <span className="t">{endsAt}</span>
            <span className="in">{countdown}</span>
          </div>
          <dl className="rows">
            <div>
              <dt>Volume left</dt>
              <dd>
                <span>{bed.volumeMl === null ? '—' : Math.round(bed.volumeMl)}</span>
                <small>mL</small>
              </dd>
            </div>
            <div>
              <dt>Flow rate</dt>
              <dd>
                <span>{bed.flowMlH === null ? '—' : Math.round(bed.flowMlH)}</span>
                <small>mL/h</small>
              </dd>
            </div>
            <div>
              <dt>Remaining</dt>
              <dd>
                <span>{bed.volumeMl === null ? '—' : Math.round(percent)}</span>
                <small>%</small>
              </dd>
            </div>
          </dl>
          <div
            className="bar"
            role="progressbar"
            aria-label="Percentage left"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(percent)}
          >
            <i style={{ width: `${percent.toFixed(1)}%` }} />
          </div>
          <p className="fl">
            {bed.fluidName} · {bed.reportedBagMl ?? bed.bagMl} mL bag
          </p>
        </div>
      </div>

      <div className="bed-foot">
        {bed.offline && (
          <span className="offline-note">
            <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true">
              <circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" strokeWidth="1.7" />
              <path d="M8 4.5V8l2.4 1.5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
            </svg>
            Offline
          </span>
        )}
        <button
          className="btn primary"
          type="button"
          hidden={bed.severity === 'normal' || bed.acknowledged}
          onClick={() => onAction(bed.bedNumber, 'acknowledge')}
        >
          Acknowledge
        </button>
        <button className="btn" type="button" hidden={!showRestore} onClick={() => onAction(bed.bedNumber, 'flow-restored')}>
          Flow restored
        </button>
        <button
          className={`btn ${armed ? 'armed' : ''}`}
          type="button"
          onClick={() => {
            if (!armed) {
              setArmed(true);
              return;
            }
            window.clearTimeout(armTimer.current);
            setArmed(false);
            onAction(bed.bedNumber, 'bag-replaced');
          }}
        >
          {armed ? 'Confirm replaced' : 'Bag replaced'}
        </button>
        <p className="ack-note" hidden={!bed.acknowledged || bed.severity === 'normal'}>
          {bed.acknowledgedAt !== null
            ? `Acknowledged by ${bed.acknowledgedByName ?? 'a nurse'} at ${fmtClock(bed.acknowledgedAt)}`
            : ''}
        </p>
      </div>
    </article>
  );
}
