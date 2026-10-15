import { describe, expect, it, vi } from 'vitest';
import type { Jev, JevAnswer } from '@/lib/ai/jev';
import { deadline, project, task } from '@/lib/logic/ax-fixtures';
import { formatCaptureReply } from './format';
import { handleCallback, handleFreeText, type AxDeps, type AxRepo } from './ax';
import type { Note } from '@/lib/types';

const NOW = new Date('2026-10-15T03:00:00Z'); // 12:00 KST Thursday

const choice = (pick: string, probabilities: Record<string, number>): JevAnswer => {
  const top = probabilities[pick];
  const others = Object.entries(probabilities).filter(([k]) => k !== pick).map(([, v]) => v);
  return { type: 'choice', choice: pick, probabilities, top, margin: top - Math.max(0, ...others) };
};

function makeNote(body: string): Note {
  return {
    id: 'n1',
    body,
    kind: 'memo',
    status: 'inbox',
    projectId: null,
    tags: [],
    date: null,
    pinned: false,
    source: 'telegram',
    deliveredAt: null,
    taskId: null,
    createdAt: 't',
    updatedAt: 't',
  } as unknown as Note;
}

function setup(answers: Record<string, JevAnswer> | null | 'none', over: Partial<AxDeps> = {}) {
  const store: Record<string, unknown> = {};
  const repo = {
    getMeta: async <T,>(k: string) => (k in store ? (store[k] as T) : null),
    setMeta: vi.fn(async (k: string, v: unknown) => void (store[k] = v)),
    listMetaByPrefix: async (p: string) => Object.fromEntries(Object.entries(store).filter(([k]) => k.startsWith(p))),
    deleteMeta: async (k: string) => void delete store[k],
    claimMeta: async (k: string, v: unknown) => {
      if (k in store) return false;
      store[k] = v;
      return true;
    },
    listTasks: vi.fn(async () => [task({ id: '1', title: '논문 초안 작성', dueDate: '2026-10-10' })]),
    updateTask: vi.fn(async () => task({ id: '1', title: 'x' })),
    listDeadlines: vi.fn(async () => [deadline({ id: '1', title: '학회 제출' })]),
    updateDeadline: vi.fn(async () => deadline({ id: '1', title: 'x' })),
    listProjects: vi.fn(async () => [project({ id: 'p', slug: 'p', name: 'P' })]),
    listPapers: vi.fn(async () => []),
    listCalendarEvents: vi.fn(async () => []),
    upsertCalendarEvent: vi.fn(async () => {}),
  };
  const jev: Jev | null =
    answers === 'none' ? null : { ask: vi.fn(async () => answers) };
  const sent: string[] = [];
  const markups: Array<{ text: string; markup: unknown }> = [];
  const edits: Array<{ id: number; text: string; markup: unknown }> = [];
  const answered: Array<string | undefined> = [];
  const createNote = vi.fn(async (text: string) => makeNote(text));
  const deps: AxDeps = {
    repo: repo as unknown as AxRepo,
    jev,
    send: async (t) => void sent.push(t),
    sendWithMarkup: async (text, markup) => {
      markups.push({ text, markup });
      return { ok: true };
    },
    edit: async (id, text, markup) => void edits.push({ id, text, markup }),
    answer: async (_id, text) => void answered.push(text),
    createNote,
    calendarCfg: null,
    now: () => NOW,
    ...over,
  };
  return { deps, repo, jev, sent, markups, edits, answered, createNote, store };
}

const taskDone = {
  intent: choice('task_done', { task_done: 0.95, memo: 0.05 }),
  target: choice('t:1', { 't:1': 0.9, none: 0.1 }),
};

/** The callback_data of the first button (적용) of the last proposal. */
function okData(markups: Array<{ markup: unknown }>): string {
  const kb = markups.at(-1)!.markup as { inline_keyboard: Array<Array<{ callback_data: string }>> };
  return kb.inline_keyboard[0][0].callback_data;
}

describe('handleFreeText', () => {
  it('without Jev: memo with the exact classic reply', async () => {
    const s = setup('none');
    await handleFreeText(s.deps, '그냥 메모');
    expect(s.createNote).toHaveBeenCalledWith('그냥 메모');
    expect(s.sent).toEqual([formatCaptureReply(makeNote('그냥 메모'), null)]);
  });

  it('obvious memos skip Jev', async () => {
    const s = setup(taskDone);
    await handleFreeText(s.deps, '!아이디어');
    expect(s.jev!.ask).not.toHaveBeenCalled();
    expect(s.sent).toHaveLength(1);
  });

  it('low intent: memo plus suffix', async () => {
    const s = setup({ intent: choice('memo', { memo: 0.55, task_done: 0.45 }) });
    await handleFreeText(s.deps, 'ㅋㅋ');
    expect(s.sent[0]).toContain('확신하지 못해');
    expect(s.markups).toHaveLength(0);
  });

  it('jev failure: memo plus suffix', async () => {
    const s = setup(null);
    await handleFreeText(s.deps, '논문 초안 끝냈어');
    expect(s.sent[0]).toContain('확신하지 못해');
  });

  it('intent memo: plain reply', async () => {
    const s = setup({ intent: choice('memo', { memo: 0.95, task_done: 0.05 }) });
    await handleFreeText(s.deps, '오늘 날씨 좋다');
    expect(s.sent).toEqual([formatCaptureReply(makeNote('x'), null)]);
  });

  it('proposal: pending saved, buttons sent, nothing mutated', async () => {
    const s = setup(taskDone);
    await handleFreeText(s.deps, '논문 초안 끝냈어');
    expect(s.markups).toHaveLength(1);
    expect(Object.keys(s.store).some((k) => k.startsWith('telegram:pending:'))).toBe(true);
    expect(s.repo.updateTask).not.toHaveBeenCalled();
    expect(s.createNote).not.toHaveBeenCalled();
  });

  it('proposal message fails to send: saved as a memo, text not lost', async () => {
    const s = setup(taskDone);
    s.deps.sendWithMarkup = async () => ({ ok: false });
    await handleFreeText(s.deps, '논문 초안 끝냈어');
    expect(s.createNote).toHaveBeenCalledWith('논문 초안 끝냈어');
    expect(s.sent[0]).toContain('확인 메시지를 보내지 못해');
  });

  it('budget exhausted: memo with the limit suffix', async () => {
    const s = setup(taskDone);
    s.store['jev:count:ax:2026-10-15'] = 200;
    await handleFreeText(s.deps, '논문 초안 끝냈어');
    expect(s.sent[0]).toContain('한도');
    expect(s.jev!.ask).not.toHaveBeenCalled();
  });

  it('calendar_event without OAuth config: memo with note', async () => {
    const s = setup({ intent: choice('calendar_event', { calendar_event: 0.95, memo: 0.05 }) });
    await handleFreeText(s.deps, '내일 3시 치과');
    expect(s.sent[0]).toContain('캘린더 연동 미설정');
  });

  it('build failure: memo with the reason', async () => {
    const s = setup({
      intent: choice('task_reschedule', { task_reschedule: 0.95, memo: 0.05 }),
      target: choice('t:1', { 't:1': 0.9, none: 0.1 }),
    });
    await handleFreeText(s.deps, '논문 초안 미뤄줘');
    expect(s.sent[0]).toContain('날짜를 찾지 못했어요');
  });
});

describe('handleCallback', () => {
  async function proposed() {
    const s = setup(taskDone);
    await handleFreeText(s.deps, '논문 초안 끝냈어');
    return s;
  }

  it('ok applies once; a second tap is already handled', async () => {
    const s = await proposed();
    const data = okData(s.markups);
    await handleCallback(s.deps, { callbackId: 'c1', messageId: 7, data });
    expect(s.repo.updateTask).toHaveBeenCalledTimes(1);
    expect(s.edits[0]).toMatchObject({ id: 7, markup: null });
    expect(Object.values(s.store).some((v) => (v as { status?: string }).status === 'applied')).toBe(true);

    await handleCallback(s.deps, { callbackId: 'c2', messageId: 7, data });
    expect(s.repo.updateTask).toHaveBeenCalledTimes(1);
    expect(s.answered.at(-1)).toBe('이미 처리됨');
  });

  it('concurrent double tap applies once', async () => {
    const s = await proposed();
    const data = okData(s.markups);
    await Promise.all([
      handleCallback(s.deps, { callbackId: 'a', messageId: 7, data }),
      handleCallback(s.deps, { callbackId: 'b', messageId: 7, data }),
    ]);
    expect(s.repo.updateTask).toHaveBeenCalledTimes(1);
    expect(s.answered).toContain('이미 처리됨');
  });

  it('cancel changes nothing', async () => {
    const s = await proposed();
    const data = okData(s.markups).replace(/:ok$/, ':no');
    await handleCallback(s.deps, { callbackId: 'c', messageId: 7, data });
    expect(s.repo.updateTask).not.toHaveBeenCalled();
    expect(s.createNote).not.toHaveBeenCalled();
  });

  it('memo saves the original text', async () => {
    const s = await proposed();
    const data = okData(s.markups).replace(/:ok$/, ':memo');
    await handleCallback(s.deps, { callbackId: 'c', messageId: 7, data });
    expect(s.createNote).toHaveBeenCalledWith('논문 초안 끝냈어');
    expect(s.repo.updateTask).not.toHaveBeenCalled();
  });

  it('expired after 24h: no mutation', async () => {
    const s = await proposed();
    const data = okData(s.markups);
    s.deps.now = () => new Date(NOW.getTime() + 25 * 3600_000);
    await handleCallback(s.deps, { callbackId: 'c', messageId: 7, data });
    expect(s.repo.updateTask).not.toHaveBeenCalled();
    expect(s.answered.at(-1)).toBe('만료됨');
  });

  it('unknown data and missing record', async () => {
    const s = setup(taskDone);
    await handleCallback(s.deps, { callbackId: 'c', messageId: 1, data: 'zzz' });
    expect(s.answered.at(-1)).toBe('알 수 없는 버튼');
    await handleCallback(s.deps, { callbackId: 'c', messageId: 1, data: 'p:abcdefghij:ok' });
    expect(s.answered.at(-1)).toBe('만료됨');
  });
});

describe('handleCallback: weekly review', () => {
  function withWeekly() {
    const s = setup(taskDone);
    s.store['telegram:pending:wk1'] = {
      type: 'weekly',
      id: 'wk1',
      createdAt: NOW.toISOString(),
      today: '2026-10-15',
      review: {
        items: [
          { ref: { kind: 'task', id: '1' }, section: 'overdue', title: '논문 초안 작성', project: null, due: '2026-10-10', state: 'open' },
          { ref: { kind: 'deadline', id: '1' }, section: 'overdue', title: '학회 제출', project: null, due: '2026-10-09', state: 'open' },
        ],
        more: 0,
        clusters: [],
      },
    };
    return s;
  }

  it('applies one item, edits the message and keeps the other row', async () => {
    const s = withWeekly();
    await handleCallback(s.deps, { callbackId: 'c', messageId: 9, data: 'w:wk1:0:p' });
    expect(s.repo.updateTask).toHaveBeenCalledWith('1', { dueDate: '2026-10-22' });
    const edit = s.edits.at(-1)!;
    expect(edit.text).toContain('1. ⏩');
    expect((edit.markup as { inline_keyboard: unknown[] }).inline_keyboard).toHaveLength(1);
  });

  it('the same button twice applies once; another item is still available', async () => {
    const s = withWeekly();
    await handleCallback(s.deps, { callbackId: 'a', messageId: 9, data: 'w:wk1:0:d' });
    await handleCallback(s.deps, { callbackId: 'b', messageId: 9, data: 'w:wk1:0:d' });
    expect(s.repo.updateTask).toHaveBeenCalledTimes(1);
    expect(s.answered.at(-1)).toBe('이미 처리됨');
    await handleCallback(s.deps, { callbackId: 'c', messageId: 9, data: 'w:wk1:1:d' });
    expect(s.repo.updateDeadline).toHaveBeenCalledWith('1', { done: true });
    const last = s.edits.at(-1)!;
    expect((last.markup as { inline_keyboard: unknown[] }).inline_keyboard).toHaveLength(0);
  });

  it('expired after 72h and unknown ids do nothing', async () => {
    const s = withWeekly();
    s.deps.now = () => new Date(NOW.getTime() + 73 * 3600_000);
    await handleCallback(s.deps, { callbackId: 'c', messageId: 9, data: 'w:wk1:0:d' });
    expect(s.repo.updateTask).not.toHaveBeenCalled();
    expect(s.answered.at(-1)).toBe('만료됨');
    await handleCallback(s.deps, { callbackId: 'c', messageId: 9, data: 'w:nope:0:d' });
    expect(s.answered.at(-1)).toBe('만료됨');
  });
});

describe('weekly callback: unchanged record', () => {
  it('a missing target answers without writing the pending record back', async () => {
    const s = setup(taskDone);
    s.repo.listTasks.mockResolvedValue([]);
    s.store['telegram:pending:wk2'] = {
      type: 'weekly', id: 'wk2', createdAt: NOW.toISOString(), today: '2026-10-15',
      review: { items: [{ ref: { kind: 'task', id: 'gone' }, section: 'overdue', title: 'x', project: null, due: '2026-10-10', state: 'open' }], more: 0, clusters: [] },
    };
    const before = s.repo.setMeta.mock.calls.length;
    await handleCallback(s.deps, { callbackId: 'c', messageId: 9, data: 'w:wk2:0:d' });
    expect(s.answered.at(-1)).toContain('찾을 수 없어요');
    expect(s.repo.setMeta.mock.calls.length).toBe(before);
  });
});
