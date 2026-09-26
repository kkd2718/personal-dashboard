/** Shimmering placeholder block for loading.tsx silhouettes (ux-advice.md §4.5). */
export function Skeleton({ className = '' }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-[var(--r-md)] bg-foreground/[0.06] motion-reduce:animate-none ${className}`}
    />
  );
}
