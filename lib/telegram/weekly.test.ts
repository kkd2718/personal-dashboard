import { describe, expect, it, vi } from 'vitest';
import type { Jev, JevAnswer } from '@/lib/ai/jev';
import { deadline, project, task } from '@/lib/logic/ax-fixtures';
import type { PendingWeekly } from '@/lib/logic/weekly-review';
import { applyWeeklyAction, runWeekly, type WeeklyRepo } from './weekly';

const SUNDAY = '2026-10-18';
const THURSDAY = '2026-10-15';

function fakeRepo(over: { tasks?: ReturnType<typeof task>[]; deadlines?: ReturnType<typeof deadline>[] } = {}) {
  const store: Record<string, unknown> = {};
  const notes: Array<{ id: string; body: string; status?: string; projectId?: string | null; source: string }> = [];
  const repo = {
    getMeta: async <T,>(k: string) => (k in store ? (store[k] as T) : null),
    setMeta: vi.fn(async (k: string, v: unknown) => void (store[k] = v)),
    listMetaByPrefix: async (p: string) => Object.fromEntries(Object.entries(store).filter(([k]) => k.startsWith(p))),
    deleteMeta: async (k: string) => void delete store[k],
    claimMeta: async (k: string, v: unknown) => (k in store ? false : ((store[k] = v), true)),
    listTasks: vi.fn(async () => over.tasks ?? [task({ id: 't1', title: 'late task', dueDate: '2026-10-10' })]),
    updateTask: vi.fn(async () => task({ id: 't1', title: 'x' })),
    listDeadlines: vi.fn(async () => over.deadlines ?? [deadline({ id: 'd1', title: 'late deadline', dueDate: '2026-10-10' })]),
    updateDeadline: vi.fn(async () => deadline({ id: 'd1', title: 'x' })),
    listProjects: vi.fn(async () => [project({ id: 'p1', slug: 'p', name: 'P' })]),
    createNote: vi.fn(async (input: { body: string; projectId?: string | null; source: string }) => {
      const n = { id: `n${notes.length + 1}`, ...input };
      notes.push(n);
      return n as never;
    }),
    updateNote: vi.fn(async (id: string, patch: { status?: string }) => {
      Object.assign(notes.find((n) => n.id === id)!, patch);
      return {} as never;
    }),
  };
  return { repo: repo as unknown as WeeklyRepo & typeof repo, store, notes };
}

type Send = (text: string, markup: unknown) => Promise<{ ok: boolean }>;
const sendOk = () => vi.fn<Send>(async () => ({ ok: true }));

describe('runWeekly', () => {
  it('weekday: skipped, nothing sent', async () => {
    const { repo } = fakeRepo();
    const send = sendOk();
    expect(await runWeekly(repo, send, THURSDAY, { force: false, jev: null })).toBe('skipped-weekday');
    expect(send).not.toHaveBeenCalled();
  });

  it('Sunday: sent once, pending weekly saved, lastSent set; second run skipped', async () => {
    const { repo, store } = fakeRepo();
    const send = sendOk();
    expect(await runWeekly(repo, send, SUNDAY, { force: false, jev: null })).toBe('sent');
    expect(send).toHaveBeenCalledTimes(1);
    expect(store['telegram:weekly:lastSent']).toBe(SUNDAY);
    expect(Object.values(store).some((v) => (v as { type?: string })?.type === 'weekly')).toBe(true);
    expect(await runWeekly(repo, send, SUNDAY, { force: false, jev: null })).toBe('skipped-already');
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('force works on a Thursday', async () => {
    const { repo } = fakeRepo();
    const send = sendOk();
    expect(await runWeekly(repo, send, THURSDAY, { force: true, jev: null })).toBe('sent');
  });

  it('nothing to review: skipped-empty, day still recorded', async () => {
    const { repo, store } = fakeRepo({ tasks: [], deadlines: [] });
    const send = sendOk();
    expect(await runWeekly(repo, send, SUNDAY, { force: false, jev: null })).toBe('skipped-empty');
    expect(send).not.toHaveBeenCalled();
    expect(store['telegram:weekly:lastSent']).toBe(SUNDAY);
  });

  it('sender failure: failed, lastSent not set', async () => {
    const { repo, store } = fakeRepo();
    const send = vi.fn<Send>(async () => ({ ok: false }));
    expect(await runWeekly(repo, send, SUNDAY, { force: false, jev: null })).toBe('failed');
    expect(store['telegram:weekly:lastSent']).toBeUndefined();
  });

  it('Jev hints appear only when confident', async () => {
    const { repo } = fakeRepo({ tasks: [], deadlines: [deadline({ id: 'd1', title: 'late deadline', dueDate: '2026-10-10' })] });
    const answer = (pick: string, p: Record<string, number>): JevAnswer => ({
      type: 'choice', choice: pick, probabilities: p, top: p[pick], margin: p[pick] - Math.max(...Object.entries(p).filter(([k]) => k !== pick).map(([, v]) => v)),
    });
    const jev: Jev = { ask: vi.fn(async () => ({ q0: answer('drop', { drop: 0.8, keep: 0.1, postpone: 0.1 }) })) };
    const send = sendOk();
    await runWeekly(repo, send, SUNDAY, { force: false, jev });
    expect(send.mock.calls[0][0]).toContain('🗑?');
  });
});

describe('applyWeeklyAction', () => {
  const record = (ref: PendingWeekly['review']['items'][number]['ref'], due: string | null = '2026-10-10'): PendingWeekly => ({
    type: 'weekly', id: 'abc', createdAt: 't', today: SUNDAY,
    review: { items: [{ ref, section: 'overdue', title: 'x', project: null, due, state: 'open' }], more: 0, clusters: [] },
  });

  it('+1주 on an overdue deadline moves it to today+7', async () => {
    const { repo } = fakeRepo();
    const out = await applyWeeklyAction(repo, record({ kind: 'deadline', id: 'd1' }), 0, 'p', SUNDAY);
    expect(repo.updateDeadline).toHaveBeenCalledWith('d1', { dueDate: '2026-10-25' });
    expect(out.record.review.items[0].state).toBe('postponed');
  });

  it('안 함 on a task: done plus a marker line', async () => {
    const { repo } = fakeRepo({ tasks: [task({ id: 't1', title: 'x', description: 'memo', dueDate: '2026-10-10' })] });
    await applyWeeklyAction(repo, record({ kind: 'task', id: 't1' }), 0, 'x', SUNDAY);
    expect(repo.updateTask).toHaveBeenCalledWith('t1', { status: 'done', description: 'memo\n[안 함 2026-10-18]' });
  });

  it('stale task without a due date goes to today+7', async () => {
    const { repo } = fakeRepo({ tasks: [task({ id: 't1', title: 'x' })] });
    await applyWeeklyAction(repo, record({ kind: 'task', id: 't1' }, null), 0, 'p', SUNDAY);
    expect(repo.updateTask).toHaveBeenCalledWith('t1', { dueDate: '2026-10-25' });
  });

  it('project item: resolved entry plus a memo to the project; snooze carries until', async () => {
    const { repo, store, notes } = fakeRepo();
    const ref = { kind: 'project' as const, projectId: 'p1', text: 'write intro' };
    await applyWeeklyAction(repo, record(ref), 0, 'd', SUNDAY);
    expect((store['project-checklist:resolved'] as Record<string, { state: string }>)['p1::write intro'].state).toBe('done');
    expect(notes[0]).toMatchObject({ projectId: 'p1', status: 'sent', source: 'telegram' });

    await applyWeeklyAction(repo, record(ref), 0, 'p', SUNDAY);
    expect((store['project-checklist:resolved'] as Record<string, { state: string; until?: string }>)['p1::write intro']).toMatchObject({
      state: 'snooze',
      until: '2026-10-25',
    });
  });

  it('a handled item is 이미 처리됨 with no repo call; a missing target is reported', async () => {
    const { repo } = fakeRepo();
    const r = record({ kind: 'task', id: 't1' });
    r.review.items[0].state = 'done';
    expect((await applyWeeklyAction(repo, r, 0, 'd', SUNDAY)).result).toBe('이미 처리됨');
    expect(repo.listTasks).not.toHaveBeenCalled();
    expect((await applyWeeklyAction(repo, record({ kind: 'task', id: 'gone' }), 0, 'd', SUNDAY)).result).toContain('찾을 수 없어요');
  });
});
