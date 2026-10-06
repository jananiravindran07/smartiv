import { useEffect, useState } from 'react';
import type { AlertRules } from '../types';

interface RulesViewProps {
  rules: AlertRules;
  onSave: (rules: AlertRules) => Promise<void>;
  /** Live counts so an admin can see the effect of a change before saving. */
  preview: string;
}

export function RulesView({ rules, onSave, preview }: RulesViewProps) {
  const [draft, setDraft] = useState<AlertRules>(rules);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setDraft(rules);
    setDirty(false);
  }, [rules]);

  function update(key: keyof AlertRules, raw: string) {
    const max = key.endsWith('Minutes') ? 240 : 100;
    const value = Math.max(1, Math.min(max, Number.parseInt(raw, 10) || 1));
    setDraft((current) => ({ ...current, [key]: value }));
    setDirty(true);
  }

  // Attention must never be tighter than critical, or a bed could sit in both.
  function normalise() {
    setDraft((current) => ({
      ...current,
      attentionMinutes: Math.max(current.attentionMinutes, current.criticalMinutes),
      attentionPercent: Math.max(current.attentionPercent, current.criticalPercent),
    }));
  }

  return (
    <div className="view">
      <div className="intro">
        <h1>Alert rules</h1>
        <p>A bed turns critical or attention when either limit is reached. Empty bags and stopped flow are always critical.</p>
      </div>

      <div className="rule-grid">
        <div className="panel">
          <h3>Critical</h3>
          <p className="muted">Pins the bed to the top and sounds the alarm.</p>
          <div className="two">
            <div className="field">
              <label htmlFor="r-critMin">Time left (min)</label>
              <input
                className="num"
                id="r-critMin"
                type="number"
                min={1}
                max={240}
                value={draft.criticalMinutes}
                onChange={(event) => update('criticalMinutes', event.target.value)}
                onBlur={normalise}
              />
            </div>
            <div className="field">
              <label htmlFor="r-critPct">Volume left (%)</label>
              <input
                className="num"
                id="r-critPct"
                type="number"
                min={1}
                max={100}
                value={draft.criticalPercent}
                onChange={(event) => update('criticalPercent', event.target.value)}
                onBlur={normalise}
              />
            </div>
          </div>
        </div>

        <div className="panel">
          <h3>Attention</h3>
          <p className="muted">Moves the bed above the running beds.</p>
          <div className="two">
            <div className="field">
              <label htmlFor="r-warnMin">Time left (min)</label>
              <input
                className="num"
                id="r-warnMin"
                type="number"
                min={1}
                max={240}
                value={draft.attentionMinutes}
                onChange={(event) => update('attentionMinutes', event.target.value)}
                onBlur={normalise}
              />
            </div>
            <div className="field">
              <label htmlFor="r-warnPct">Volume left (%)</label>
              <input
                className="num"
                id="r-warnPct"
                type="number"
                min={1}
                max={100}
                value={draft.attentionPercent}
                onChange={(event) => update('attentionPercent', event.target.value)}
                onBlur={normalise}
              />
            </div>
          </div>
        </div>
      </div>

      <p className="muted">{preview}</p>

      <div>
        <button
          className="btn primary"
          type="button"
          disabled={!dirty}
          onClick={() => {
            normalise();
            void onSave(draft);
          }}
        >
          {dirty ? 'Save alert rules' : 'Saved'}
        </button>
      </div>
    </div>
  );
}
