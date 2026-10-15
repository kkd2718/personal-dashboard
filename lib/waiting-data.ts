// Server-side persistence of the reply-waiting list (one app_meta key). Writers re-read
// right before writing — two Apps Script accounts and the webhook all touch it, and a
// single-user hourly cadence makes that read-modify-write good enough.
import { WAITING_META_KEY, type WaitingItem } from '@/lib/logic/waiting';
import type { Repo } from '@/lib/repo';

export async function loadWaiting(repo: Pick<Repo, 'getMeta'>): Promise<WaitingItem[]> {
  const items = await repo.getMeta<WaitingItem[]>(WAITING_META_KEY);
  return Array.isArray(items) ? items : [];
}

/** Saves `items`, but re-reads first and keeps any item added meanwhile (matched by id). */
export async function saveWaiting(repo: Pick<Repo, 'getMeta' | 'setMeta'>, items: WaitingItem[]): Promise<void> {
  const known = new Set(items.map((i) => i.id));
  const added = (await loadWaiting(repo)).filter((i) => !known.has(i.id));
  await repo.setMeta(WAITING_META_KEY, [...items, ...added]);
}

export async function addWaitingItem(repo: Pick<Repo, 'getMeta' | 'setMeta'>, item: WaitingItem): Promise<void> {
  await repo.setMeta(WAITING_META_KEY, [...(await loadWaiting(repo)), item]);
}

/** Re-reads the list, applies `fn` to the item with `id` (if still present) and saves. */
export async function patchWaitingItem(
  repo: Pick<Repo, 'getMeta' | 'setMeta'>,
  id: string,
  fn: (item: WaitingItem) => WaitingItem
): Promise<WaitingItem | null> {
  const items = await loadWaiting(repo);
  const i = items.findIndex((x) => x.id === id);
  if (i < 0) return null;
  items[i] = fn(items[i]);
  await repo.setMeta(WAITING_META_KEY, items);
  return items[i];
}
