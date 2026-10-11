interface TextShimmerWaveProps {
  children: React.ReactNode;
  /** Seconds per shimmer pass. */
  duration?: number;
  className?: string;
}

/**
 * A travelling sheen for text that is waiting on something, used behind
 * "Connecting to the ward" and "Signing in" states.
 *
 * The sheen is a gradient clipped to the glyphs and inherits currentColor,
 * so it adds no new colour and cannot be mistaken for a value. Animation is
 * switched off globally under prefers-reduced-motion in styles.css.
 */
export function TextShimmerWave({ children, duration = 1.6, className }: TextShimmerWaveProps) {
  return (
    <span
      className={className ? `shimmer ${className}` : 'shimmer'}
      style={{ ['--shimmer-duration' as string]: `${duration}s` }}
    >
      <span className="shimmer-base">{children}</span>
      <span className="shimmer-sheen" aria-hidden="true">
        {children}
      </span>
    </span>
  );
}
