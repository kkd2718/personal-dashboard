import type { StatusItem } from '@/lib/status/types';

/** Critical items in `next` whose id wasn't already critical in `prev` — used to fire
 * immediate alerts only on newly-critical status, never repeating hourly (phase 2b). */
export function newCriticalItems(prev: StatusItem[], next: StatusItem[]): StatusItem[] {
  const prevCriticalIds = new Set(prev.filter((i) => i.severity === 'critical').map((i) => i.id));
  return next.filter((i) => i.severity === 'critical' && !prevCriticalIds.has(i.id));
}
