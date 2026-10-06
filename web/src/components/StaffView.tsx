import { pad } from '../lib/format';
import type { StaffMember } from '../types';

interface StaffViewProps {
  staff: StaffMember[];
  bedNumbers: number[];
  onAssign: (bedId: number, nurseId: string | null) => Promise<void>;
  busyBed: number | null;
}

export function StaffView({ staff, bedNumbers, onAssign, busyBed }: StaffViewProps) {
  const nurses = staff.filter((member) => member.role === 'nurse');
  const unassigned = bedNumbers.filter((bedNumber) => !nurses.some((nurse) => nurse.bedIds.includes(bedNumber)));

  return (
    <div className="view">
      <div className="intro">
        <h1>Staff and beds</h1>
        <p>Choose which beds each nurse sees. A bed belongs to one nurse at a time. Admins always see every bed.</p>
      </div>

      <div className="panel tbl-wrap">
        <table>
          <thead>
            <tr>
              <th>Nurse</th>
              <th>Assigned beds</th>
              <th className="r">Beds</th>
            </tr>
          </thead>
          <tbody>
            {nurses.map((nurse) => (
              <tr key={nurse.id}>
                <td>
                  <b>{nurse.name}</b>
                  <div className="muted num">{nurse.staffId}</div>
                </td>
                <td>
                  <div className="bedchips">
                    {bedNumbers.map((bedNumber) => {
                      const heldBy = nurses.find((other) => other.bedIds.includes(bedNumber));
                      const mine = heldBy?.id === nurse.id;
                      return (
                        <button
                          key={bedNumber}
                          type="button"
                          className={`bc ${heldBy && !mine ? 'other' : ''}`}
                          aria-pressed={mine}
                          disabled={busyBed === bedNumber}
                          title={heldBy && !mine ? `Now with ${heldBy.name}. Click to move to ${nurse.name}` : `Bed ${pad(bedNumber)}`}
                          onClick={() => void onAssign(bedNumber, mine ? null : nurse.id)}
                        >
                          {pad(bedNumber)}
                        </button>
                      );
                    })}
                  </div>
                </td>
                <td className="r num">{nurse.bedIds.length}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="muted">
        {unassigned.length > 0
          ? `Unassigned: ${unassigned.map(pad).join(', ')}. Only admins can see these beds.`
          : 'Every bed has a nurse.'}{' '}
        Faded numbers belong to another nurse.
      </p>
    </div>
  );
}
