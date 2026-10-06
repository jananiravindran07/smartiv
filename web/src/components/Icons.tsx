import type { BedSeverity } from '../types';

type IconProps = { className?: string };

/** Severity icons, matching the prototype's inline SVGs. */
export const SeverityIcon = ({ severity }: { severity: BedSeverity }) => {
  if (severity === 'critical') {
    return (
      <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M8 1.5 15 14H1z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
        <path d="M8 6v4M8 11.8v.4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
    );
  }
  if (severity === 'attention') {
    return (
      <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" strokeWidth="1.7" />
        <path d="M8 4.5V8l2.4 1.5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <path d="m5.2 8.2 2 2 3.6-4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
};

export const BellIcon = ({ off }: { off?: boolean }) =>
  off ? (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M3.5 11.5h9l-1.2-1.8V7a3.3 3.3 0 0 0-6.6 0v2.7zM6.6 13.5h2.8M2 2l12 12"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ) : (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M3.5 11.5h9l-1.2-1.8V7a3.3 3.3 0 0 0-6.6 0v2.7zM6.6 13.5h2.8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );

export const ThemeIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
    <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" />
    <path d="M8 2a6 6 0 0 0 0 12z" fill="currentColor" />
  </svg>
);

/** The SmartIV lockup mark used in the login panel and the header. */
export const Logo = ({ className }: IconProps) => (
  <svg viewBox="0 0 32 32" aria-hidden="true" className={className}>
    <circle cx="16" cy="16" r="14.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
    <path d="M16 7c3.2 4.2 5.5 7 5.5 10a5.5 5.5 0 0 1-11 0c0-3 2.3-5.8 5.5-10z" fill="currentColor" />
  </svg>
);
