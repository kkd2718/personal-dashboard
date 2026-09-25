import { dday } from '@/lib/logic/dates';

export type Staleness = 'fresh' | 'quiet' | 'stale';

/** fresh <= 7 days since last commit, quiet <= 21 days, stale beyond that (or no commit). */
export function staleness(lastCommitAt: string | null, today: string): Staleness {
  if (!lastCommitAt) return 'stale';
  const daysAgo = -dday(lastCommitAt.slice(0, 10), today);
  if (daysAgo <= 7) return 'fresh';
  if (daysAgo <= 21) return 'quiet';
  return 'stale';
}
