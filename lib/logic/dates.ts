// KST calendar-day date math. Dates are plain 'YYYY-MM-DD' strings (no time
// component), so diffs are computed on UTC-anchored Date objects to avoid
// any local-timezone off-by-one — the calendar day itself is already the
// KST day by construction (see todayKST).

export type Urgency = 'overdue' | 'today' | 'soon' | 'later';

function toUtcDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** Calendar-day diff dueDate - today. Negative = overdue. */
export function dday(dueDate: string, today: string): number {
  const ms = toUtcDate(dueDate).getTime() - toUtcDate(today).getTime();
  return Math.round(ms / 86_400_000);
}

/** 'D-3', 'D-DAY', 'D+2'. */
export function ddayLabel(n: number): string {
  if (n === 0) return 'D-DAY';
  if (n > 0) return `D-${n}`;
  return `D+${-n}`;
}

/** soon = due in 1..7 days. */
export function urgency(n: number): Urgency {
  if (n < 0) return 'overdue';
  if (n === 0) return 'today';
  if (n <= 7) return 'soon';
  return 'later';
}

/** Today's date in Asia/Seoul as 'YYYY-MM-DD'. */
export function todayKST(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}
