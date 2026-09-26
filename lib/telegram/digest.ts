// Daily digest orchestration (phase 2b), extracted from app/api/cron/daily so it
// can be unit-tested with a fake repo + fake sender (no Next.js route needed).
import type { Deadline, ReviewJob, Task } from '@/lib/types';
import type { StatusItem } from '@/lib/status/types';
import { checklist } from '@/lib/logic/checklist';
import { formatDigest } from '@/lib/telegram/format';
import type { SendResult } from '@/lib/telegram/client';

export type DigestResult = 'sent' | 'skipped-empty' | 'skipped-already' | 'failed';

const META_KEY = 'telegram:digest:lastSent';

export interface DigestRepo {
  listTasks(): Promise<Task[]>;
  listDeadlines(): Promise<Deadline[]>;
  listReviews(): Promise<ReviewJob[]>;
  getStatusSnapshot(): Promise<{ items: StatusItem[] } | null>;
  getMeta<T>(key: string): Promise<T | null>;
  setMeta(key: string, value: unknown): Promise<void>;
}

export type Sender = (text: string) => Promise<SendResult>;

/** At most once per KST day (`force` bypasses the guard, still requires cron auth
 * upstream). Empty digest -> no message, no `lastSent` write. */
export async function runDigest(
  repo: DigestRepo,
  sender: Sender,
  today: string,
  force: boolean,
  cloudUrl: string | null
): Promise<DigestResult> {
  if (!force) {
    const lastSent = await repo.getMeta<string>(META_KEY);
    if (lastSent === today) return 'skipped-already';
  }

  const [tasks, deadlines, reviews, snapshot] = await Promise.all([
    repo.listTasks(),
    repo.listDeadlines(),
    repo.listReviews(),
    repo.getStatusSnapshot(),
  ]);
  const me = checklist(tasks, deadlines, reviews, today).me;
  const message = formatDigest({
    today,
    deadlines,
    reviews,
    checklist: me,
    statusItems: snapshot?.items ?? [],
    cloudUrl,
  });
  if (!message) return 'skipped-empty';

  const result = await sender(message);
  if (!result.ok) return 'failed';

  await repo.setMeta(META_KEY, today);
  return 'sent';
}
