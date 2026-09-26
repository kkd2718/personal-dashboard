import Link from 'next/link';
import type { ReactNode } from 'react';

/**
 * Shared four-lane chrome (PLAN_HOME2.md §Layout): sticky header (title, count,
 * optional "전체 →"), a scrollable body capped on desktop so lanes don't stretch
 * to match each other's height, and an optional footer (e.g. "+ 할 일").
 */
export function LaneCard({
  title,
  count,
  href,
  hrefLabel = '전체 →',
  footer,
  children,
}: {
  title: string;
  count?: number;
  href?: string;
  hrefLabel?: string;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex h-full flex-col gap-2 rounded-xl border border-border bg-surface p-3">
      <div className="flex shrink-0 items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold">
          {title}
          {count != null && (
            <span className="rounded-full bg-foreground/5 px-1.5 py-0.5 text-[11px] font-normal text-foreground/50">
              {count}
            </span>
          )}
        </h2>
        {href && (
          <Link href={href} className="shrink-0 text-xs text-foreground/50 hover:underline">
            {hrefLabel}
          </Link>
        )}
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto lg:max-h-[calc(100dvh-260px)]">
        {children}
      </div>
      {footer && <div className="shrink-0">{footer}</div>}
    </div>
  );
}
