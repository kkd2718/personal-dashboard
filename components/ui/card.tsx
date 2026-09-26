import type { HTMLAttributes } from 'react';

/** Flat card surface — no shadow in light mode, raised by surface color in dark
 * (ux-advice.md §3 elevation rules). */
export function Card({ className = '', ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`rounded-[var(--r-md)] border border-border bg-surface p-3 md:p-3 ${className}`}
      {...props}
    />
  );
}
