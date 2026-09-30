// Daily study routines (PLAN_ROUTINES.md). Pure logic, framework-free.
import { addDaysStr } from '@/lib/logic/dates';

export interface RoutineItem {
  id: string;
  label: string;
  url: string | null;
  startDate: string; // 'YYYY-MM-DD'
  endDate: string | null;
  sort: number;
}

export interface RoutineStatus {
  item: RoutineItem;
  done: boolean;
}

export const ROUTINE_ITEMS_META_KEY = 'routine:items';
export const ROUTINE_DONE_PREFIX = 'routine:done:';
export const routineDoneMetaKey = (date: string): string => `${ROUTINE_DONE_PREFIX}${date}`;

export const SEED_ROUTINES: RoutineItem[] = [
  { id: 'allen-daily', label: '알렌의 서재 오늘의 문제', url: null, startDate: '2026-10-01', endDate: null, sort: 0 },
  { id: 'amgi-daily', label: '암기 오늘의 공부', url: null, startDate: '2026-10-01', endDate: null, sort: 1 },
];

/** Routines in effect on `date` (startDate <= date <= endDate), ordered by `sort`. */
export function activeRoutines(items: RoutineItem[], date: string): RoutineItem[] {
  return items
    .filter((r) => r.startDate <= date && (r.endDate === null || r.endDate >= date))
    .sort((a, b) => a.sort - b.sort);
}

export function routineStatus(items: RoutineItem[], doneIds: string[], date: string): RoutineStatus[] {
  const done = new Set(doneIds);
  return activeRoutines(items, date).map((item) => ({ item, done: done.has(item.id) }));
}

/** `/done` argument -> routine: 1-based index into `items`, or a case-insensitive label
 * substring. `null` when not found or ambiguous. `items` must be the ordered active list. */
export function matchRoutine(items: RoutineItem[], query: string): RoutineItem | null {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  if (/^\d+$/.test(q)) return items[Number(q) - 1] ?? null;
  const hits = items.filter((r) => r.label.toLowerCase().includes(q));
  return hits.length === 1 ? hits[0] : null;
}

/** Consecutive done days ending today, or yesterday when today is not done yet. */
export function routineStreak(doneByDate: Record<string, string[]>, id: string, today: string): number {
  let day = doneByDate[today]?.includes(id) ? today : addDaysStr(today, -1);
  let n = 0;
  while (doneByDate[day]?.includes(id)) {
    n++;
    day = addDaysStr(day, -1);
  }
  return n;
}
