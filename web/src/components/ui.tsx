// =============================================================================
// SMART IV MONITORING SYSTEM - SMALL SHARED UI PIECES
// Academic Prototype - Not a Certified Medical Device
// =============================================================================

import type { ReactNode } from 'react';
import { AlertCircle, Inbox, Loader2 } from 'lucide-react';

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
      <div>
        <h1 className="text-lg font-bold text-white">{title}</h1>
        {subtitle && <p className="text-xs text-slate-400 mt-0.5">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({
  title,
  children,
  className = '',
}: {
  title?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`bg-slate-900 border border-slate-800 rounded-xl overflow-hidden ${className}`}>
      {title && (
        <header className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">{title}</h2>
        </header>
      )}
      {children}
    </section>
  );
}

export function Loading({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center py-12 gap-2 text-sm text-slate-500">
      <Loader2 className="w-4 h-4 animate-spin" />
      {label}
    </div>
  );
}

export function EmptyState({ message, hint }: { message: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-6 text-center">
      <Inbox className="w-7 h-7 text-slate-700" />
      <p className="mt-3 text-sm text-slate-400">{message}</p>
      {hint && <p className="mt-1 text-xs text-slate-600 max-w-sm">{hint}</p>}
    </div>
  );
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 p-3 bg-red-950/60 border border-red-800/70 text-red-300 text-xs rounded-lg">
      <AlertCircle className="w-4 h-4 shrink-0 mt-px" />
      <span>{message}</span>
    </div>
  );
}

/**
 * Explains an empty result in terms of RLS rather than looking like a bug.
 *
 * Worth being explicit about in this project: an empty list is frequently the
 * access control working, not a failed query.
 */
export function RlsEmptyNote({ children }: { children: ReactNode }) {
  return (
    <p className="px-4 pb-4 text-[11px] text-slate-600 leading-relaxed border-t border-slate-800/60 pt-3">
      {children}
    </p>
  );
}

const BADGE_TONES: Record<string, string> = {
  NURSE: 'bg-cyan-950 text-cyan-300 border-cyan-800/60',
  WARD_SISTER: 'bg-purple-950 text-purple-300 border-purple-800/60',
  ADMIN: 'bg-amber-950 text-amber-300 border-amber-800/60',
  OPEN: 'bg-red-950 text-red-300 border-red-800/60',
  ACKNOWLEDGED: 'bg-emerald-950 text-emerald-300 border-emerald-800/60',
  RESOLVED: 'bg-slate-800 text-slate-300 border-slate-700',
  ACTIVE: 'bg-emerald-950 text-emerald-300 border-emerald-800/60',
  PAUSED: 'bg-amber-950 text-amber-300 border-amber-800/60',
  COMPLETED: 'bg-slate-800 text-slate-300 border-slate-700',
  ABORTED: 'bg-slate-800 text-slate-400 border-slate-700',
  CRITICAL: 'bg-red-950 text-red-300 border-red-800/60',
  HIGH: 'bg-orange-950 text-orange-300 border-orange-800/60',
  LOW: 'bg-yellow-950 text-yellow-300 border-yellow-800/60',
  NORMAL: 'bg-emerald-950 text-emerald-300 border-emerald-800/60',
};

export function Badge({ value, children }: { value: string; children?: ReactNode }) {
  return (
    <span
      className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
        BADGE_TONES[value] ?? 'bg-slate-800 text-slate-300 border-slate-700'
      }`}
    >
      {children ?? value}
    </span>
  );
}

export function PrimaryButton({
  children,
  onClick,
  disabled,
  type = 'button',
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  type?: 'button' | 'submit';
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className="bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed text-white px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer"
    >
      {children}
    </button>
  );
}

export function GhostButton({
  children,
  onClick,
  disabled,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="bg-slate-800 hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed text-slate-200 border border-slate-700 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer"
    >
      {children}
    </button>
  );
}

export function DataTable({
  columns,
  children,
}: {
  columns: string[];
  children: ReactNode;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs">
        <thead>
          <tr className="border-b border-slate-800">
            {columns.map((c) => (
              <th key={c} className="px-4 py-2.5 font-semibold uppercase tracking-wider text-slate-500">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800/60">{children}</tbody>
      </table>
    </div>
  );
}

export function StatTile({ label, value, tone }: { label: string; value: ReactNode; tone?: string }) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
      <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">{label}</p>
      <p className={`mt-1.5 text-2xl font-bold ${tone ?? 'text-white'}`}>{value}</p>
    </div>
  );
}
