import type { ReactNode } from 'react';

/** One-line empty state + one optional action, phrased as an invitation (§4.5). */
export function EmptyState({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-foreground/40">
      <span>{children}</span>
      {action}
    </div>
  );
}
