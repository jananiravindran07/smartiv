import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';

interface MorphingPopoverProps {
  trigger: ReactNode;
  children: ReactNode;
  className?: string;
  align?: 'start' | 'end';
  label: string;
}

/**
 * A small popover whose panel springs open from the trigger instead of
 * appearing. Used for the per-bed "why is this alerting" explanation, so a
 * nurse gets the rule that fired without a modal breaking up the wall view.
 *
 * Closes on Escape and on an outside click. Under prefers-reduced-motion the
 * spring becomes an instant swap, because the motion carries no information
 * here.
 */
export function MorphingPopover({ trigger, children, className, align = 'start', label }: MorphingPopoverProps) {
  const [open, setOpen] = useState(false);
  const reduced = useReducedMotion();
  const panelId = useId();
  const rootRef = useRef<HTMLSpanElement>(null);

  function toggle() {
    setOpen((current) => !current);
  }

  // Escape and outside clicks are bound to the document rather than to the
  // wrapper, so the panel still closes when focus has moved to a bed card
  // button. Only bound while open.
  useEffect(() => {
    if (!open) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }

    function onPointerDown(event: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    }

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open]);

  const spring = reduced
    ? { duration: 0 }
    : { type: 'spring' as const, stiffness: 520, damping: 34, mass: 0.7 };

  return (
    <span className="mpop" ref={rootRef}>
      <button
        type="button"
        className="mpop-trigger"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={label}
        onClick={toggle}
      >
        {trigger}
      </button>

      <AnimatePresence>
        {open && (
          <motion.span
            id={panelId}
            role="dialog"
            aria-label={label}
            className={className ? `mpop-panel ${className}` : 'mpop-panel'}
            data-align={align}
            initial={{ opacity: 0, scale: 0.92, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: -2 }}
            transition={spring}
            // Scale from the trigger edge so the panel appears to grow out of it.
            style={{ transformOrigin: align === 'end' ? 'top right' : 'top left' }}
          >
            {children}
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}
