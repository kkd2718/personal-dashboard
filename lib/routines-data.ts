// Repo access for routines (app_meta keys, no migration). Shared by the home page,
// digest, evening cron, /done and the server actions.
import {
  doneAfterCount,
  nextRoutineCount,
  type RoutineCountChange,
  routineCountMetaKey,
  ROUTINE_DONE_PREFIX,
  ROUTINE_ITEMS_META_KEY,
  SEED_ROUTINES,
  routineDoneMetaKey,
  type RoutineItem,
} from '@/lib/logic/routines';

interface MetaRepo {
  getMeta<T>(key: string): Promise<T | null>;
  setMeta(key: string, value: unknown): Promise<void>;
}

/** Routine definitions; seeds the two defaults when the meta has never been written. */
export async function loadRoutineItems(repo: MetaRepo): Promise<RoutineItem[]> {
  const items = await repo.getMeta<RoutineItem[]>(ROUTINE_ITEMS_META_KEY);
  if (items) return items;
  await repo.setMeta(ROUTINE_ITEMS_META_KEY, SEED_ROUTINES);
  return SEED_ROUTINES;
}

export async function loadRoutineDone(repo: Pick<MetaRepo, 'getMeta'>, date: string): Promise<string[]> {
  return (await repo.getMeta<string[]>(routineDoneMetaKey(date))) ?? [];
}

/** All recorded done days (for streaks), keyed by date. */
export async function loadRoutineDoneHistory(repo: {
  listMetaByPrefix(prefix: string): Promise<Record<string, unknown>>;
}): Promise<Record<string, string[]>> {
  const raw = await repo.listMetaByPrefix(ROUTINE_DONE_PREFIX);
  const out: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (Array.isArray(value)) out[key.slice(ROUTINE_DONE_PREFIX.length)] = value as string[];
  }
  return out;
}

export async function loadRoutineCounts(repo: Pick<MetaRepo, 'getMeta'>, date: string): Promise<Record<string, number>> {
  return (await repo.getMeta<Record<string, number>>(routineCountMetaKey(date))) ?? {};
}

/** Changes a count routine's tally for `date` and keeps the done list in sync (done when
 * count > 0, so streaks/evening reminders work unchanged). Returns the new count. */
export async function changeRoutineCount(
  repo: MetaRepo,
  id: string,
  date: string,
  change: RoutineCountChange
): Promise<number> {
  const [counts, doneIds] = await Promise.all([loadRoutineCounts(repo, date), loadRoutineDone(repo, date)]);
  const count = nextRoutineCount(counts[id] ?? 0, change);
  await repo.setMeta(routineCountMetaKey(date), { ...counts, [id]: count });
  await repo.setMeta(routineDoneMetaKey(date), doneAfterCount(doneIds, id, count));
  return count;
}
