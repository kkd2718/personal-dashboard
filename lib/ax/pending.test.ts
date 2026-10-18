import { describe, expect, it } from 'vitest';
import { claimPending, loadPending, savePending, type PendingRepo } from './pending';

function fakeRepo(): PendingRepo & { store: Record<string, unknown> } {
  const store: Record<string, unknown> = {};
  return {
    store,
    getMeta: async <T,>(k: string) => (k in store ? (store[k] as T) : null),
    setMeta: async (k, v) => void (store[k] = v),
    listMetaByPrefix: async (p) => Object.fromEntries(Object.entries(store).filter(([k]) => k.startsWith(p))),
    deleteMeta: async (k) => void delete store[k],
    claimMeta: async (k, v) => (k in store ? false : ((store[k] = v), true)),
  };
}

describe('pending records and claims', () => {
  it('saving prunes records and claims older than 7 days, keeps recent ones', async () => {
    const repo = fakeRepo();
    const now = '2026-10-18T00:00:00.000Z';
    repo.store['telegram:pending:old'] = { type: 'proposal', id: 'old', createdAt: '2026-10-01T00:00:00.000Z' };
    repo.store['telegram:pending:recent'] = { type: 'proposal', id: 'recent', createdAt: '2026-10-17T00:00:00.000Z' };
    repo.store['ax:applied:old'] = '2026-10-01T00:00:00.000Z';
    repo.store['ax:applied:recent'] = '2026-10-17T00:00:00.000Z';
    await savePending(repo, { type: 'proposal', id: 'new', createdAt: now }, now);
    expect(Object.keys(repo.store).sort()).toEqual([
      'ax:applied:recent',
      'telegram:pending:new',
      'telegram:pending:recent',
    ]);
  });

  it('a claim succeeds once', async () => {
    const repo = fakeRepo();
    expect(await claimPending(repo, 'x', 't')).toBe(true);
    expect(await claimPending(repo, 'x', 't')).toBe(false);
    expect(await loadPending(repo, 'nope')).toBeNull();
  });
});

describe('mail records retention', () => {
  it('savePending prunes mail records after 48h but keeps proposals for 7 days', async () => {
    const store: Record<string, unknown> = {
      'telegram:pending:m1': { type: 'mail', id: 'm1', createdAt: '2026-11-01T00:00:00.000Z' },
      'telegram:pending:m2': { type: 'mail', id: 'm2', createdAt: '2026-11-06T12:00:00.000Z' },
      'telegram:pending:p1': { type: 'proposal', id: 'p1', createdAt: '2026-11-01T00:00:00.000Z' },
    };
    const repo = {
      getMeta: async (k: string) => store[k] ?? null,
      setMeta: async (k: string, v: unknown) => void (store[k] = v),
      listMetaByPrefix: async (p: string) => Object.fromEntries(Object.entries(store).filter(([k]) => k.startsWith(p))),
      deleteMeta: async (k: string) => void delete store[k],
      claimMeta: async () => true,
    };
    await savePending(repo as never, { id: 'new', createdAt: '2026-11-07T00:00:00.000Z' }, '2026-11-07T00:00:00.000Z');
    expect(Object.keys(store).sort()).toEqual(['telegram:pending:m2', 'telegram:pending:new', 'telegram:pending:p1']);
  });
});
