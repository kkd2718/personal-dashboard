// Daily cap on Jev calls (owner: 200/day). The counter lives in app_meta and is bumped
// BEFORE the call; any storage error fails closed (caller falls back to a memo).
import { addDaysStr } from '@/lib/logic/dates';
import type { Repo } from '@/lib/repo';

export type MetaRepo = Pick<Repo, 'getMeta' | 'setMeta' | 'listMetaByPrefix' | 'deleteMeta'>;

export const JEV_DAILY_LIMIT_AX = 200;
const PREFIX = 'jev:count:';

/** Takes one unit of today's `bucket` budget; false when exhausted or on error. */
export async function takeJevBudget(
  repo: MetaRepo,
  bucket: 'ax' | 'mail',
  today: string,
  limit: number
): Promise<boolean> {
  const key = `${PREFIX}${bucket}:${today}`;
  let count: number;
  try {
    count = (await repo.getMeta<number>(key)) ?? 0;
    if (count >= limit) return false;
    await repo.setMeta(key, count + 1);
  } catch {
    return false;
  }
  if (count === 0) await prune(repo, today);
  return true;
}

/** Drops counters older than 7 days; best-effort, once per day per bucket. */
async function prune(repo: MetaRepo, today: string): Promise<void> {
  try {
    const cutoff = addDaysStr(today, -7);
    for (const key of Object.keys(await repo.listMetaByPrefix(PREFIX))) {
      if (key.slice(-10) < cutoff) await repo.deleteMeta(key);
    }
  } catch {
    // stale counters are harmless
  }
}
