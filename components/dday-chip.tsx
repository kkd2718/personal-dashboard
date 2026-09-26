import { ddayLabel, urgency } from '@/lib/logic/dates';

// Dark mode never fills a solid color slab (ux-advice.md §3): a 3px left border +
// tinted text on the surface color instead of the light pill's solid background.
const COLORS: Record<ReturnType<typeof urgency>, string> = {
  overdue: 'bg-red-100 text-red-700 dark:rounded-md dark:border-l-[3px] dark:border-danger dark:bg-danger-soft dark:text-danger',
  today: 'bg-orange-100 text-orange-700 dark:rounded-md dark:border-l-[3px] dark:border-warn dark:bg-warn-soft dark:text-warn',
  soon: 'bg-amber-100 text-amber-700 dark:rounded-md dark:border-l-[3px] dark:border-warn dark:bg-warn-soft dark:text-warn',
  later: 'bg-slate-100 text-slate-600 dark:bg-surface-2 dark:text-fg-3',
};

/** Colored D-day chip. `n` is the pre-computed day diff (see lib/logic/dates). Renders
 * "오늘" for n === 0 (ux-advice.md §6) instead of the raw "D-DAY" label. */
export function DdayChip({ n }: { n: number }) {
  return (
    <span
      className={`tnum inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium ${COLORS[urgency(n)]}`}
    >
      {n === 0 ? '오늘' : ddayLabel(n)}
    </span>
  );
}
