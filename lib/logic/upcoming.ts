import type { Deadline, DeadlineKind, ReviewJob } from '@/lib/types';
import { dday } from '@/lib/logic/dates';

export interface UpcomingItem {
  id: string;
  title: string;
  dueDate: string;
  dueTime: string | null;
  kind: DeadlineKind | 'review';
  dday: number;
  origin: 'deadline' | 'review';
  originId: string;
}

function sortByDue(a: UpcomingItem, b: UpcomingItem): number {
  if (a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? -1 : 1;
  const at = a.dueTime ?? '';
  const bt = b.dueTime ?? '';
  if (at !== bt) return at < bt ? -1 : 1;
  return 0;
}

/** Merge open Deadlines + pending ReviewJobs due within horizonDays (overdue always included). */
export function upcoming(
  deadlines: Deadline[],
  reviews: ReviewJob[],
  today: string,
  horizonDays = 30
): UpcomingItem[] {
  const items: UpcomingItem[] = [];

  for (const d of deadlines) {
    if (d.done) continue;
    const n = dday(d.dueDate, today);
    if (n > horizonDays) continue;
    items.push({
      id: `deadline:${d.id}`,
      title: d.title,
      dueDate: d.dueDate,
      dueTime: d.dueTime,
      kind: d.kind,
      dday: n,
      origin: 'deadline',
      originId: d.id,
    });
  }

  for (const r of reviews) {
    if (r.status !== 'invited' && r.status !== 'accepted') continue;
    if (!r.dueDate) continue;
    const n = dday(r.dueDate, today);
    if (n > horizonDays) continue;
    items.push({
      id: `review:${r.id}`,
      title: r.title ?? `${r.journal} 리뷰`,
      dueDate: r.dueDate,
      dueTime: null,
      kind: 'review',
      dday: n,
      origin: 'review',
      originId: r.id,
    });
  }

  return items.sort(sortByDue);
}

/** Deadlines whose D-day is overdue, today, or hits one of the deadline's remindDays. */
export function dueReminders(deadlines: Deadline[], today: string): UpcomingItem[] {
  const items: UpcomingItem[] = [];
  for (const d of deadlines) {
    if (d.done) continue;
    const n = dday(d.dueDate, today);
    if (n < 0 || n === 0 || d.remindDays.includes(n)) {
      items.push({
        id: `deadline:${d.id}`,
        title: d.title,
        dueDate: d.dueDate,
        dueTime: d.dueTime,
        kind: d.kind,
        dday: n,
        origin: 'deadline',
        originId: d.id,
      });
    }
  }
  return items.sort(sortByDue);
}
