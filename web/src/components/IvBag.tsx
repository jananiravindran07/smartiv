/** Body outline of the bag, shared by the card and the login hero. */
const BODY = 'M17 14H63Q65 14 65 16V25Q67 28 67 33V108Q67 116 61 120H19Q13 116 13 108V33Q13 28 15 25V16Q15 14 17 14Z';

interface IvBagProps {
  /** Clamped 0-100. Drives the fluid rectangle and its surface line. */
  percent: number;
  /**
   * Unique per instance. Two bags on the same screen need separate clipPath
   * ids, otherwise they share a clip region and one clips the other.
   */
  id: string;
  className?: string;
}

/**
 * The live IV bag from the prototype. The fluid level tracks the reported
 * percentage: 100 fills to the neck, 0 empties the bag.
 */
export function IvBag({ percent, id, className }: IvBagProps) {
  const level = Math.max(0, Math.min(100, percent));
  // Bag interior runs from y=33 to y=122, so 100% sits at y=36.
  const surfaceY = 122 - (level / 100) * 86;

  return (
    <svg className={className ? `bag-svg ${className}` : 'bag-svg'} viewBox="0 0 80 176" role="img" aria-label={`IV bag ${Math.round(level)} percent full`}>
      <defs>
        <clipPath id={`cl-${id}`}>
          <path d={BODY} />
        </clipPath>
      </defs>
      <path className="glass-line" d="M40 0V6" />
      <circle className="glass-line" cx="40" cy="9" r="3" />
      <path className="glass" d={BODY} />
      <g clipPath={`url(#cl-${id})`}>
        <rect className="fluid" x="0" y={surfaceY} width="80" height={Math.max(0, 122 - surfaceY)} />
        <rect className="surf" x="0" y={surfaceY} width="80" height={level <= 0 ? 0 : 1.6} />
      </g>
      <path className="tick" d="M57 98.5h7M57 77h7M57 55.5h7" />
      <path className="glass-line" d={BODY} />
      <rect className="glass-line" x="35" y="17" width="10" height="4.5" rx="2.2" />
      <rect className="glass" x="27" y="120" width="6" height="7" rx="1.5" />
      <rect className="glass" x="25.5" y="127" width="9" height="7" rx="2.5" />
      <rect className="glass" x="47" y="120" width="6" height="6" rx="1.5" />
      <rect className="glass" x="43.5" y="126" width="13" height="26" rx="3.5" />
      <circle className="drop" cx="50" cy="131" r="1.9" />
      <path className="fluid" d="M45 148.5Q50 147 55 148.5V150Q50 152 45 150z" />
      <path className="glass-line" d="M50 152V176" style={{ strokeWidth: 2.2 }} />
      <rect className="glass" x="46" y="160" width="8" height="9" rx="2" />
    </svg>
  );
}
