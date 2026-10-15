import { describe, expect, it } from 'vitest';
import { takeJevBudget, type MetaRepo } from './jev-budget';

function fakeRepo(): MetaRepo & { store: Record<string, unknown> } {
  const store: Record<string, unknown> = {};
  return {
    store,
    getMeta: async <T,>(k: string) => (k in store ? (store[k] as T) : null),
    setMeta: async (k, v) => void (store[k] = v),
    listMetaByPrefix: async (p) => Object.fromEntries(Object.entries(store).filter(([k]) => k.startsWith(p))),
    deleteMeta: async (k) => void delete store[k],
  };
}

describe('takeJevBudget', () => {
  it('allows `limit` calls then refuses', async () => {
    const repo = fakeRepo();
    for (let i = 0; i < 200; i++) expect(await takeJevBudget(repo, 'ax', '2026-10-15', 200)).toBe(true);
    expect(await takeJevBudget(repo, 'ax', '2026-10-15', 200)).toBe(false);
  });

  it('a new day resets and old counters are pruned', async () => {
    const repo = fakeRepo();
    repo.store['jev:count:ax:2026-10-01'] = 5;
    await takeJevBudget(repo, 'ax', '2026-10-15', 1);
    expect(await takeJevBudget(repo, 'ax', '2026-10-15', 1)).toBe(false);
    expect(await takeJevBudget(repo, 'ax', '2026-10-16', 1)).toBe(true);
    expect('jev:count:ax:2026-10-01' in repo.store).toBe(false);
  });

  it('fails closed when storage throws', async () => {
    const repo = fakeRepo();
    repo.getMeta = async () => {
      throw new Error('db down');
    };
    expect(await takeJevBudget(repo, 'ax', '2026-10-15', 200)).toBe(false);
  });
});
