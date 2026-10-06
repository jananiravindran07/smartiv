import { fmtClock } from '../lib/format';
import type { ActivityEntry } from '../types';

export function ActivityView({ entries }: { entries: ActivityEntry[] }) {
  return (
    <div className="view">
      <div className="intro">
        <h1>Activity</h1>
        <p>Sign-ins, acknowledgements, bag changes and rule edits, newest first.</p>
      </div>

      <div className="panel">
        {entries.length > 0 ? (
          <ul className="log">
            {entries.map((entry) => (
              <li key={entry.id}>
                <span className="num muted">{fmtClock(entry.createdAt)}</span>
                <span>
                  <b>{entry.actor}</b> · {entry.details}
                  <span className="muted">
                    {' '}
                    — {entry.staffId}
                    {entry.bedId !== null ? ` · Bed ${String(entry.bedId).padStart(2, '0')}` : ''}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">Nothing recorded yet.</p>
        )}
      </div>
    </div>
  );
}
