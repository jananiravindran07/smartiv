import { fmtClock, pad } from '../lib/format';
import type { Bed, DevicesResponse } from '../types';

interface DevicesViewProps {
  data: DevicesResponse | null;
  beds: Bed[];
  now: number;
}

const SINGLE_PAYLOAD = '{\n  "bed": 7,\n  "bag_ml": 500,\n  "volume_ml": 182,\n  "flow_ml_h": 120\n}';

const BATCH_PAYLOAD =
  '{\n  "bags": [\n' +
  '    { "channel": 1, "bed": 7, "bag_ml": 500, "volume_ml": 182, "flow_ml_h": 120 },\n' +
  '    { "channel": 2, "bed": 8, "bag_ml": 100, "volume_ml": 22,  "flow_ml_h": 100 }\n' +
  '  ]\n}';

/** Reads as "12 s ago" / "4 min ago", which reads faster than a wall clock. */
function relative(ms: number | null, now: number): string {
  if (ms === null) return 'No readings';
  const seconds = Math.max(0, Math.round((now - ms) / 1000));
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds} s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  return `${Math.round(minutes / 60)} h ago`;
}

export function DevicesView({ data, beds, now }: DevicesViewProps) {
  const fluidFor = new Map(beds.map((bed) => [bed.bedNumber, bed]));
  const simulated = data?.source === 'simulated';

  return (
    <div className="view">
      <div className="intro">
        <h1>Devices</h1>
        <p>
          One unit covers two beds: each load cell weighs one IV bag. The dashboard works out percentage, time left and end time itself, so
          each unit only sends volume and flow.
        </p>
      </div>

      <div className="panel tbl-wrap">
        <table>
          <thead>
            <tr>
              <th>Bed</th>
              <th>Channel</th>
              <th>Unit</th>
              <th>Fluid</th>
              <th className="r">Bag</th>
              <th>Last reading</th>
              <th>Link</th>
            </tr>
          </thead>
          <tbody>
            {data?.devices.flatMap((device) =>
              device.channels.map((channel) => {
                const bed = fluidFor.get(channel.bedId);
                return (
                  <tr key={`${device.id}-${channel.channel}`}>
                    <td>
                      <b>Bed {pad(channel.bedId)}</b>
                    </td>
                    <td className="num">{channel.channel}</td>
                    <td className="num">{device.unit}</td>
                    <td>{bed?.fluidName ?? channel.fluidName ?? '—'}</td>
                    <td className="r num">{channel.bagMl ?? bed?.bagMl ?? '—'} mL</td>
                    <td className="num" title={device.lastReadingAt ? fmtClock(device.lastReadingAt) : undefined}>
                      {relative(device.lastReadingAt, now)}
                    </td>
                    <td>
                      <span className="tag">{simulated ? 'Simulated' : 'Live'}</span>
                    </td>
                  </tr>
                );
              }),
            ) ?? (
              <tr>
                <td colSpan={7} className="muted">
                  Loading units…
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {beds.filter((bed) => !bed.hasDevice).length > 0 && (
        <p className="muted">
          Demo beds with no unit attached: {beds.filter((bed) => !bed.hasDevice).map((bed) => pad(bed.bedNumber)).join(', ')}. Register a
          unit to put them on live hardware.
        </p>
      )}

      <div className="rule-grid">
        <div className="panel">
          <h3>Data source</h3>
          <div className="seg" role="group" aria-label="Data source">
            <button type="button" aria-pressed={simulated}>
              Simulated
            </button>
            <button type="button" aria-pressed={!simulated}>
              Arduino
            </button>
          </div>
          <p className="muted">
            {simulated
              ? 'The simulator is producing readings in the hardware format. Set SIMULATE=false on the server and register a unit to switch to real hardware. The front end needs no change.'
              : 'Readings are coming from the registered units over Wi-Fi. A unit that has not reported within the offline window shows Offline on its cards.'}
          </p>
        </div>

        <div className="panel">
          <h3>Reading format</h3>
          <p className="muted">Send one reading per load cell every 2 seconds.</p>
          <pre>{SINGLE_PAYLOAD}</pre>
          <p className="muted">Both bags from one unit in a single request:</p>
          <pre>{BATCH_PAYLOAD}</pre>
          <div>
            <button
              className="btn"
              type="button"
              onClick={() => void navigator.clipboard?.writeText(BATCH_PAYLOAD).catch(() => undefined)}
            >
              Copy reading format
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
