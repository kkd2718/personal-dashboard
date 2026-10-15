import { describe, expect, it } from 'vitest';
import { resolveProjectItem, unresolveProjectItem, type ChecklistRepo } from './project-checklist';

function fakeRepo() {
  const store: Record<string, unknown> = {};
  const notes: Array<{ id: string; body: string; status?: string; projectId?: string | null; source: string }> = [];
  const repo = {
    getMeta: async <T,>(k: string) => (k in store ? (store[k] as T) : null),
    setMeta: async (k: string, v: unknown) => void (store[k] = v),
    createNote: async (input: { body: string; projectId?: string | null; source: string }) => {
      const n = { id: `n${notes.length + 1}`, ...input };
      notes.push(n);
      return n as never;
    },
    updateNote: async (id: string, patch: { status?: string }) => {
      Object.assign(notes.find((n) => n.id === id)!, patch);
      return {} as never;
    },
  };
  return { repo: repo as unknown as ChecklistRepo, store, notes };
}

const RESOLVED = 'project-checklist:resolved';

describe('resolveProjectItem / unresolveProjectItem', () => {
  it('done: memo sent to the project and a resolved entry (unchanged wording)', async () => {
    const { repo, store, notes } = fakeRepo();
    await resolveProjectItem(repo, { projectId: 'p1', text: 'write intro', state: 'done' }, '2026-10-18', 'web');
    expect(notes[0]).toMatchObject({
      projectId: 'p1',
      status: 'sent',
      source: 'web',
      body: '[대시보드] 사용자가 완료로 표시함: "write intro" — docs/cc-status.json 체크리스트에서 done 으로 바꿔 주세요.',
    });
    expect(store[RESOLVED]).toEqual({ 'p1::write intro': { state: 'done', at: '2026-10-18', noteId: 'n1' } });
  });

  it('skip and snooze', async () => {
    const { repo, store, notes } = fakeRepo();
    await resolveProjectItem(repo, { projectId: 'p1', text: 'a', state: 'skip' }, '2026-10-18', 'web');
    await resolveProjectItem(repo, { projectId: 'p1', text: 'b', state: 'snooze', until: '2026-10-25' }, '2026-10-18', 'telegram');
    expect(notes[0].body).toContain('"안 함"');
    expect(notes[1].body).toContain('2026-10-25');
    expect((store[RESOLVED] as Record<string, { until?: string }>)['p1::b'].until).toBe('2026-10-25');
  });

  it('unresolve restores the item and archives the memo', async () => {
    const { repo, store, notes } = fakeRepo();
    await resolveProjectItem(repo, { projectId: 'p1', text: 'a', state: 'done' }, '2026-10-18', 'web');
    await unresolveProjectItem(repo, { projectId: 'p1', text: 'a' });
    expect(store[RESOLVED]).toEqual({});
    expect(notes[0].status).toBe('archived');
  });
});
