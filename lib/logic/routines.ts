// Daily study routines (PLAN_ROUTINES.md). Pure logic, framework-free.
import { addDaysStr } from '@/lib/logic/dates';

export interface RoutineItem {
  id: string;
  label: string;
  url: string | null;
  startDate: string; // 'YYYY-MM-DD'
  endDate: string | null;
  sort: number;
  /** 'count': record how many (e.g. problems solved) per day; done when count > 0. */
  kind?: 'check' | 'count';
  /** Count unit label, e.g. '문제'. */
  unit?: string | null;
}

export interface RoutineStatus {
  item: RoutineItem;
  done: boolean;
  /** Today's count, for kind 'count' only. */
  count?: number;
}

export const ROUTINE_ITEMS_META_KEY = 'routine:items';
export const ROUTINE_DONE_PREFIX = 'routine:done:';
export const routineDoneMetaKey = (date: string): string => `${ROUTINE_DONE_PREFIX}${date}`;
/** Per-day counts for kind 'count' routines: `{ [routineId]: number }`. */
export const ROUTINE_COUNT_PREFIX = 'routine:count:';
export const routineCountMetaKey = (date: string): string => `${ROUTINE_COUNT_PREFIX}${date}`;
export const MAX_ROUTINE_COUNT = 999;

export const isCountRoutine = (item: Pick<RoutineItem, 'kind'>): boolean => item.kind === 'count';

export type RoutineCountChange = { add: number } | { set: number } | { atLeast: number };

/** New count after `+n` (add), `=n` (set) or `^n` (raise to at least n — an automated
 * sync that never lowers a hand-entered count), clamped to 0..MAX_ROUTINE_COUNT. */
export function nextRoutineCount(prev: number, change: RoutineCountChange): number {
  const raw = 'set' in change ? change.set : 'atLeast' in change ? Math.max(prev, change.atLeast) : prev + change.add;
  return Math.max(0, Math.min(MAX_ROUTINE_COUNT, Math.round(raw)));
}

/** Done list after a count change: a count routine is done exactly when its count > 0. */
export function doneAfterCount(doneIds: string[], id: string, count: number): string[] {
  const rest = doneIds.filter((x) => x !== id);
  return count > 0 ? [...rest, id] : rest;
}

/** "12문제" / "12" */
export const formatRoutineCount = (item: Pick<RoutineItem, 'unit'>, count: number): string => `${count}${item.unit ?? ''}`;

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

export function routineStatus(
  items: RoutineItem[],
  doneIds: string[],
  date: string,
  counts: Record<string, number> = {}
): RoutineStatus[] {
  const done = new Set(doneIds);
  return activeRoutines(items, date).map((item) =>
    isCountRoutine(item)
      ? { item, done: done.has(item.id) || (counts[item.id] ?? 0) > 0, count: counts[item.id] ?? 0 }
      : { item, done: done.has(item.id) }
  );
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

/** `/done` argument split: "알렌 5" / "1 +5" / "알렌 =12" -> query + count change.
 * A lone number stays a query (an index), so "/done 2" still means routine #2. */
export function parseDoneArg(arg: string): { query: string; change: { add: number } | { set: number } | null } {
  const m = /^(.*\S)\s+([+=]?)(\d+)$/.exec(arg.trim());
  if (!m) return { query: arg.trim(), change: null };
  const n = Number(m[3]);
  return { query: m[1], change: m[2] === '=' ? { set: n } : { add: n } };
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
