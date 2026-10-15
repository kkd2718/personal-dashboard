import { describe, expect, it } from 'vitest';
import type { WaitingItem } from '@/lib/logic/waiting';
import { addWaitingItem, loadWaiting, patchWaitingItem, saveWaiting } from './waiting-data';

const item = (id: string, o: Partial<WaitingItem> = {}): WaitingItem => ({
  id, title: id, projectId: null, taskId: null, deadlineId: null, match: {}, since: '2026-10-15',
  createdAt: '2026-10-15T00:00:00.000Z', nudgeAfterDays: 7, status: 'open', ...o,
});

function fakeRepo(initial: WaitingItem[]) {
  const store: Record<string, unknown> = { 'waiting:replies': initial };
  return {
    store,
    getMeta: async <T,>(k: string) => (k in store ? (store[k] as T) : null),
    setMeta: async (k: string, v: unknown) => void (store[k] = v),
  };
}

describe('waiting-data', () => {
  it('saveWaiting keeps items added since the snapshot was taken', async () => {
    const repo = fakeRepo([item('a')]);
    const snapshot = await loadWaiting(repo);
    await addWaitingItem(repo, item('b')); // added meanwhile
    await saveWaiting(repo, snapshot.map((i) => ({ ...i, title: 'edited' })));
    const after = await loadWaiting(repo);
    expect(after.map((i) => i.id)).toEqual(['a', 'b']);
    expect(after[0].title).toBe('edited');
  });

  it('patchWaitingItem edits only its item and ignores a vanished one', async () => {
    const repo = fakeRepo([item('a'), item('b')]);
    await patchWaitingItem(repo, 'a', (i) => ({ ...i, status: 'closed' }));
    expect((await loadWaiting(repo)).map((i) => i.status)).toEqual(['closed', 'open']);
    expect(await patchWaitingItem(repo, 'zz', (i) => i)).toBeNull();
  });
});
