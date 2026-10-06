import { useMemo } from 'react';
import { BedCard } from './BedCard';
import { compareMinutesLeft } from '../lib/format';
import type { AlertRules, Bed, BedAction } from '../types';

interface DashboardProps {
  beds: Bed[];
  rules: AlertRules | null;
  now: number;
  title: string;
  note: string;
  simulate: boolean;
  speed: number;
  onSpeed: (speed: number) => void;
  onAction: (bedNumber: number, action: BedAction) => void;
}

const BANDS = [
  { id: 'critical' as const, key: 'crit' as const, title: 'Critical', empty: 'No critical beds. Every infusion is inside your limits.' },
  { id: 'attention' as const, key: 'warn' as const, title: 'Attention soon', empty: 'Nothing is ending soon.' },
  { id: 'normal' as const, key: 'ok' as const, title: 'Running normally', empty: 'No beds are running normally right now.' },
];

export function Dashboard({ beds, rules, now, title, note, simulate, speed, onSpeed, onAction }: DashboardProps) {
  // Bands top to bottom, each sorted by time left, soonest first.
  const grouped = useMemo(() => {
    const bySeverity: Record<Bed['severity'], Bed[]> = { critical: [], attention: [], normal: [] };
    for (const bed of beds) bySeverity[bed.severity].push(bed);
    for (const list of Object.values(bySeverity)) list.sort(compareMinutesLeft);
    return bySeverity;
  }, [beds]);

  const counts = {
    crit: grouped.critical.length,
    warn: grouped.attention.length,
    ok: grouped.normal.length,
  };

  return (
    <div className="view">
      <div className="intro">
        <div>
          <h1>{title}</h1>
          <p>{note}</p>
        </div>
        {simulate && (
          <div className="speed">
            <span>Demo speed</span>
            <div className="seg" role="group" aria-label="Demo speed">
              {[1, 10, 60].map((value) => (
                <button key={value} type="button" aria-pressed={speed === value} onClick={() => onSpeed(value)}>
                  {value}&times;
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="stats">
        <a className={`stat crit ${counts.crit > 0 ? 'on' : ''}`} href="#band-crit">
          <span className="n num">{counts.crit}</span>
          <span className="l">
            <strong>Critical</strong>
            <br />
            <span>needs a nurse now</span>
          </span>
        </a>
        <a className={`stat warn ${counts.warn > 0 ? 'on' : ''}`} href="#band-warn">
          <span className="n num">{counts.warn}</span>
          <span className="l">
            <strong>Attention</strong>
            <br />
            <span>ending soon</span>
          </span>
        </a>
        <a className="stat ok" href="#band-ok">
          <span className="n num">{counts.ok}</span>
          <span className="l">
            <strong>Running</strong>
            <br />
            <span>inside limits</span>
          </span>
        </a>
      </div>

      {BANDS.map((band) => {
        const list = grouped[band.id];
        return (
          <section className={`band ${band.key}`} id={`band-${band.key}`} key={band.id}>
            <h2>
              {band.id === 'critical' && <span className="pulse-dot" />}
              {band.title} <span className="cnt">{list.length}</span>
              {bandSub(band.id, grouped.critical.length, rules)}
            </h2>
            <div className="grid">
              {list.map((bed) => (
                <BedCard key={bed.bedNumber} bed={bed} now={now} onAction={onAction} />
              ))}
            </div>
            <p className="empty">{band.empty}</p>
          </section>
        );
      })}
    </div>
  );
}

function bandSub(id: string, criticalCount: number, rules: AlertRules | null) {
  if (id === 'critical' && criticalCount > 0) return <span className="sub">Sorted by time left. Acknowledge to silence the pulse.</span>;
  if (id === 'attention' && rules) {
    return (
      <span className="sub">
        Ending inside {rules.attentionMinutes} min or under {rules.attentionPercent}%
      </span>
    );
  }
  return null;
}
