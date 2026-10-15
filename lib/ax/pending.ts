// Pending-proposal storage in app_meta (`telegram:pending:<id>`). Records older than
// 7 days are pruned whenever a new one is saved.
import { PENDING_PREFIX, isExpired, type PendingProposal } from '@/lib/logic/ax-proposal';
import type { Repo } from '@/lib/repo';

export type PendingRepo = Pick<Repo, 'getMeta' | 'setMeta' | 'listMetaByPrefix' | 'deleteMeta' | 'claimMeta'>;

export const CLAIM_PREFIX = 'ax:applied:';

/** Atomically claims the single right to act on a pending proposal (double-tap guard). */
export function claimPending(repo: PendingRepo, id: string, now: string): Promise<boolean> {
  return repo.claimMeta(CLAIM_PREFIX + id, now);
}

const KEEP_HOURS = 7 * 24;

export async function savePending(repo: PendingRepo, record: PendingProposal, now: string): Promise<void> {
  try {
    for (const [key, value] of Object.entries(await repo.listMetaByPrefix(PENDING_PREFIX))) {
      const createdAt = (value as { createdAt?: unknown } | null)?.createdAt;
      if (typeof createdAt === 'string' && isExpired(createdAt, now, KEEP_HOURS)) await repo.deleteMeta(key);
    }
    for (const [key, claimedAt] of Object.entries(await repo.listMetaByPrefix(CLAIM_PREFIX))) {
      if (typeof claimedAt === 'string' && isExpired(claimedAt, now, KEEP_HOURS)) await repo.deleteMeta(key);
    }
  } catch {
    // pruning is best-effort
  }
  await repo.setMeta(PENDING_PREFIX + record.id, record);
}

export async function loadPending(repo: PendingRepo, id: string): Promise<PendingProposal | null> {
  const record = await repo.getMeta<PendingProposal>(PENDING_PREFIX + id);
  return record && record.type === 'proposal' ? record : null;
}

export async function updatePending(repo: PendingRepo, record: PendingProposal): Promise<void> {
  await repo.setMeta(PENDING_PREFIX + record.id, record);
}
