import { ddayLabel, urgency } from '@/lib/logic/dates';

const COLORS: Record<ReturnType<typeof urgency>, string> = {
  overdue: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300',
  today: 'bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300',
  soon: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
  later: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
};

/** Colored D-day chip. `n` is the pre-computed day diff (see lib/logic/dates). */
export function DdayChip({ n }: { n: number }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium ${COLORS[urgency(n)]}`}
    >
      {ddayLabel(n)}
    </span>
  );
}
