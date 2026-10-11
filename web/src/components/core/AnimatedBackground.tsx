import { motion, useReducedMotion } from 'motion/react';
import type { ReactNode } from 'react';

interface AnimatedBackgroundProps {
  children: ReactNode;
  className?: string;
  /** Soft brand blobs drifting behind the content. */
  enableHover?: boolean;
}

/**
 * Slow-drifting brand blobs behind a panel.
 *
 * Colours come from the SmartIV tokens rather than hardcoded Tailwind zinc, so
 * it follows light and dark automatically. Two blobs, low opacity, a long
 * cycle: on a ward screen this has to stay well under the threshold where it
 * competes with the bed cards for attention.
 *
 * Under prefers-reduced-motion the drift is dropped and the panel renders a
 * static tint. The children are never transformed, so nothing inside is
 * affected.
 */
export function AnimatedBackground({ children, className, enableHover = false }: AnimatedBackgroundProps) {
  const reduced = useReducedMotion();

  return (
    <div className={className ? `anim-bg ${className}` : 'anim-bg'}>
      {!reduced && (
        <>
          <motion.span
            className="anim-blob anim-blob-a"
            aria-hidden="true"
            animate={{ x: ['-6%', '8%', '-6%'], y: ['0%', '10%', '0%'], scale: [1, 1.14, 1] }}
            transition={{ duration: 26, repeat: Infinity, ease: 'easeInOut' }}
          />
          <motion.span
            className="anim-blob anim-blob-b"
            aria-hidden="true"
            animate={{ x: ['8%', '-7%', '8%'], y: ['6%', '-8%', '6%'], scale: [1.1, 1, 1.1] }}
            transition={{ duration: 34, repeat: Infinity, ease: 'easeInOut' }}
          />
        </>
      )}
      {reduced && <span className="anim-blob anim-blob-static" aria-hidden="true" />}
      <div className="anim-content" data-hover={enableHover ? 'true' : undefined}>
        {children}
      </div>
    </div>
  );
}
