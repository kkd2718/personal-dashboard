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
/** Mail alert records hold a snippet (for 답장 초안): shorter retention. */
const MAIL_KEEP_HOURS = 48;

/** Any pending record (proposal or weekly review) keyed by id. */
export interface PendingRecord {
  id: string;
  createdAt: string;
}

/** Drops pending records past their retention (mail 48 h, others 7 days) and old claim keys. Best-effort. */
export async function prunePending(repo: PendingRepo, now: string): Promise<void> {
  try {
    for (const [key, value] of Object.entries(await repo.listMetaByPrefix(PENDING_PREFIX))) {
      const createdAt = (value as { createdAt?: unknown } | null)?.createdAt;
      const hours = (value as { type?: unknown } | null)?.type === 'mail' ? MAIL_KEEP_HOURS : KEEP_HOURS;
      if (typeof createdAt === 'string' && isExpired(createdAt, now, hours)) await repo.deleteMeta(key);
    }
    for (const [key, claimedAt] of Object.entries(await repo.listMetaByPrefix(CLAIM_PREFIX))) {
      if (typeof claimedAt === 'string' && isExpired(claimedAt, now, KEEP_HOURS)) await repo.deleteMeta(key);
    }
  } catch {
    // pruning is best-effort
  }
}

export async function savePending<T extends PendingRecord>(repo: PendingRepo, record: T, now: string): Promise<void> {
  await prunePending(repo, now);
  await repo.setMeta(PENDING_PREFIX + record.id, record);
}

/** Raw record by id, whatever its type (callers narrow on `type`). */
export async function loadPendingRaw(repo: PendingRepo, id: string): Promise<(PendingRecord & { type?: string }) | null> {
  return repo.getMeta<PendingRecord & { type?: string }>(PENDING_PREFIX + id);
}

export async function loadPending(repo: PendingRepo, id: string): Promise<PendingProposal | null> {
  const record = await repo.getMeta<PendingProposal>(PENDING_PREFIX + id);
  return record && record.type === 'proposal' ? record : null;
}

export async function updatePending<T extends PendingRecord>(repo: PendingRepo, record: T): Promise<void> {
  await repo.setMeta(PENDING_PREFIX + record.id, record);
}
