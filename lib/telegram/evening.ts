// Evening routine reminder (PLAN_ROUTINES.md §4), extracted from app/api/cron/evening
// so it can be unit-tested with a fake repo + fake sender.
import { routineStatus } from '@/lib/logic/routines';
import { loadRoutineDone, loadRoutineItems } from '@/lib/routines-data';
import { formatEvening } from '@/lib/telegram/format';
import type { Sender } from '@/lib/telegram/digest';

export type EveningResult = 'sent' | 'skipped-none' | 'skipped-done' | 'skipped-already' | 'failed';

const META_KEY = 'telegram:evening:lastSent';

export interface EveningRepo {
  getMeta<T>(key: string): Promise<T | null>;
  setMeta(key: string, value: unknown): Promise<void>;
}

/** At most once per KST day (`force` bypasses). No active routines -> nothing, nothing
 * recorded. All done -> nothing sent, lastSent still recorded. */
export async function runEvening(
  repo: EveningRepo,
  sender: Sender,
  today: string,
  force: boolean
): Promise<EveningResult> {
  if (!force && (await repo.getMeta<string>(META_KEY)) === today) return 'skipped-already';

  const [items, doneIds] = await Promise.all([loadRoutineItems(repo), loadRoutineDone(repo, today)]);
  const rows = routineStatus(items, doneIds, today);
  if (rows.length === 0) return 'skipped-none';

  const message = formatEvening(rows.filter((r) => !r.done).map((r) => r.item));
  if (!message) {
    await repo.setMeta(META_KEY, today);
    return 'skipped-done';
  }

  const result = await sender(message);
  if (!result.ok) return 'failed';
  await repo.setMeta(META_KEY, today);
  await repo.setMeta('integration:telegram', { at: new Date().toISOString(), detail: '저녁 루틴 알림' });
  return 'sent';
}
