import { describe, expect, it, vi } from 'vitest';
import { deadline, project, task } from '@/lib/logic/ax-fixtures';
import { formatProposal } from '@/lib/logic/ax-proposal';
import { handleCallback, type AxDeps, type AxRepo } from '@/lib/telegram/ax';
import { savePending } from '@/lib/ax/pending';
import { MAX_PROPOSALS, createProposeTool, proposalFromInput, proposeSchema, type ProposeInput } from './propose';
import { fakeRepo } from './fixtures';
import { runTool } from './tools';

const ctx = {
  today: '2026-10-18',
  tasks: [task({ id: 't1', title: '초안', dueDate: '2026-10-25' }), task({ id: 't2', title: '끝남', status: 'done' })],
  deadlines: [deadline({ id: 'd1', title: '제출', dueDate: '2026-10-30', dueTime: '17:00' }), deadline({ id: 'd2', title: '지남', done: true })],
  projects: [project({ id: 'p1', slug: 'brainct', name: 'BrainCT', aliases: ['브레인'] })],
};
const build = (i: ProposeInput) => proposalFromInput(i, ctx);

describe('proposalFromInput', () => {
  it('maps each kind to its proposal', () => {
    expect(build({ kind: 'task_create', title: '일', project: '브레인', dueDate: '2026-10-20' })).toEqual({
      ok: true,
      proposal: { kind: 'task_create', title: '일', projectId: 'p1', projectName: 'BrainCT', dueDate: '2026-10-20' },
    });
    expect(build({ kind: 'task_done', taskId: 't1' })).toMatchObject({ ok: true, proposal: { kind: 'task_done', taskId: 't1', title: '초안' } });
    expect(build({ kind: 'task_reschedule', taskId: 't1', to: '2026-10-28' })).toMatchObject({
      proposal: { kind: 'task_reschedule', from: '2026-10-25', to: '2026-10-28' },
    });
    expect(build({ kind: 'deadline_create', title: '새 마감', dueDate: '2026-11-01', deadlineKind: 'grant' })).toMatchObject({
      proposal: { kind: 'deadline_create', dueTime: null, projectId: null, deadlineKind: 'grant' },
    });
    expect(build({ kind: 'deadline_done', deadlineId: 'd1' })).toMatchObject({ proposal: { kind: 'deadline_done', deadlineId: 'd1' } });
    expect(build({ kind: 'deadline_reschedule', deadlineId: 'd1', to: '2026-11-02', dueTime: '09:00' })).toMatchObject({
      proposal: { kind: 'deadline_reschedule', from: '2026-10-30', to: '2026-11-02', dueTime: '09:00' },
    });
    expect(build({ kind: 'calendar_event', title: '치과', date: '2026-10-20', startTime: '15:00' })).toEqual({
      ok: true,
      proposal: { kind: 'calendar_event', events: [{ title: '치과', date: '2026-10-20', startTime: '15:00', endTime: '16:00' }] },
    });
    expect(build({ kind: 'calendar_event', title: '학회', date: '2026-10-20' })).toMatchObject({
      proposal: { events: [{ startTime: null, endTime: null }] },
    });
    expect(build({ kind: 'waiting_reply', title: '답장', from: 'Editor@Example.org', nudgeAfterDays: 5 })).toMatchObject({
      proposal: { kind: 'waiting_reply', match: { from: 'editor@example.org' }, nudgeAfterDays: 5, projectId: null },
    });
    expect(build({ kind: 'send_memo', project: 'brainct', body: '전처리 재실행' })).toEqual({
      ok: true,
      proposal: { kind: 'send_memo', projectId: 'p1', projectName: 'BrainCT', body: '전처리 재실행' },
    });
  });

  it('unknown or closed ids fail', () => {
    expect(build({ kind: 'task_done', taskId: 'nope' })).toEqual({ ok: false, reason: '할 일을 찾을 수 없어요' });
    expect(build({ kind: 'task_done', taskId: 't2' })).toMatchObject({ ok: false });
    expect(build({ kind: 'deadline_done', deadlineId: 'd2' })).toMatchObject({ ok: false });
    expect(build({ kind: 'deadline_done', deadlineId: 'zz' })).toMatchObject({ ok: false });
  });

  it('past dates fail', () => {
    expect(build({ kind: 'task_create', title: '일', dueDate: '2026-10-17' })).toEqual({ ok: false, reason: '과거 날짜예요' });
    expect(build({ kind: 'task_reschedule', taskId: 't1', to: '2026-10-01' })).toMatchObject({ ok: false });
    expect(build({ kind: 'deadline_create', title: 'x', dueDate: '2026-10-17' })).toMatchObject({ ok: false });
    expect(build({ kind: 'calendar_event', title: 'x', date: '2026-10-17' })).toMatchObject({ ok: false });
    expect(build({ kind: 'task_create', title: '일', dueDate: '2026-10-18' }).ok).toBe(true); // today is fine
  });

  it('unknown project, bad sender and no-op reschedules fail', () => {
    expect(build({ kind: 'task_create', title: '일', project: 'zzzz' })).toMatchObject({ ok: false });
    expect(build({ kind: 'send_memo', project: 'zzzz', body: 'x' })).toMatchObject({ ok: false });
    expect(build({ kind: 'waiting_reply', title: 'x', from: '이름만' })).toMatchObject({ ok: false });
    expect(build({ kind: 'task_reschedule', taskId: 't1', to: '2026-10-25' })).toMatchObject({ ok: false });
  });

  it('calendar end time rules', () => {
    expect(build({ kind: 'calendar_event', title: 'x', date: '2026-10-20', endTime: '10:00' })).toMatchObject({ ok: false });
    expect(build({ kind: 'calendar_event', title: 'x', date: '2026-10-20', startTime: '10:00', endTime: '09:00' })).toMatchObject({ ok: false });
  });
});

describe('proposeSchema', () => {
  it('rejects malformed input', () => {
    expect(proposeSchema.safeParse({ kind: 'task_done' }).success).toBe(false);
    expect(proposeSchema.safeParse({ kind: 'send_memo', project: 'p', body: 'x'.repeat(1001) }).success).toBe(false);
    expect(proposeSchema.safeParse({ kind: 'calendar_event', title: 'x', date: '10/20' }).success).toBe(false);
    expect(proposeSchema.safeParse({ kind: 'rm_rf' }).success).toBe(false);
  });
});

describe('propose_change tool', () => {
  const data = { tasks: ctx.tasks, deadlines: ctx.deadlines, projects: ctx.projects };

  it('collects proposals without mutating anything and says the owner must press 적용', async () => {
    const { repo, meta } = fakeRepo(data);
    const out: Parameters<typeof createProposeTool>[0] = [];
    const tool = createProposeTool(out);
    const r = await runTool(repo, 'propose_change', { kind: 'task_done', taskId: 't1' }, { today: ctx.today }, [tool]);
    expect(r).toMatchObject({ isError: false });
    expect(r.content).toContain('눌러야 반영');
    expect(out).toHaveLength(1);
    expect(meta.size).toBe(0);
  });

  it('API schema is a flat object', () => {
    expect(createProposeTool([]).inputSchema).toMatchObject({ type: 'object', required: ['kind'] });
  });

  it('the fourth proposal is refused, even when requested in parallel', async () => {
    const { repo } = fakeRepo(data);
    const out: Parameters<typeof createProposeTool>[0] = [];
    const tool = createProposeTool(out);
    const results = await Promise.all(
      Array.from({ length: MAX_PROPOSALS + 1 }, (_, i) => runTool(repo, 'propose_change', { kind: 'task_create', title: `일${i}` }, { today: ctx.today }, [tool]))
    );
    expect(out).toHaveLength(MAX_PROPOSALS);
    expect(results.filter((r) => r.isError)).toHaveLength(1);
  });

  it('a failed proposal does not use up a slot', async () => {
    const { repo } = fakeRepo(data);
    const out: Parameters<typeof createProposeTool>[0] = [];
    const tool = createProposeTool(out);
    for (let i = 0; i < 5; i++) await runTool(repo, 'propose_change', { kind: 'task_done', taskId: 'nope' }, { today: ctx.today }, [tool]);
    for (let i = 0; i < 3; i++) await runTool(repo, 'propose_change', { kind: 'task_create', title: `일${i}` }, { today: ctx.today }, [tool]);
    expect(out).toHaveLength(3);
  });
});

describe('applying an /ask proposal through the AX callback', () => {
  it('send_memo: one sent note for the project; a second press is already handled', async () => {
    const store: Record<string, unknown> = {};
    const createNote = vi.fn(async () => ({ id: 'n1' }));
    const updateNote = vi.fn(async () => ({}));
    const repo = {
      getMeta: async (k: string) => (k in store ? store[k] : null),
      setMeta: async (k: string, v: unknown) => void (store[k] = v),
      listMetaByPrefix: async (p: string) => Object.fromEntries(Object.entries(store).filter(([k]) => k.startsWith(p))),
      deleteMeta: async (k: string) => void delete store[k],
      claimMeta: async (k: string, v: unknown) => (k in store ? false : ((store[k] = v), true)),
      createNote,
      updateNote,
    };
    const now = new Date('2026-10-18T03:00:00Z');
    await savePending(
      repo as never,
      {
        type: 'proposal',
        id: 'abc',
        createdAt: now.toISOString(),
        text: '전달해줘',
        status: 'pending',
        proposal: { kind: 'send_memo', projectId: 'p1', projectName: 'BrainCT', body: '전처리 재실행' },
      } as never,
      now.toISOString()
    );
    const answered: Array<string | undefined> = [];
    const edits: string[] = [];
    const deps = {
      repo: repo as unknown as AxRepo,
      jev: null,
      send: async () => {},
      sendWithMarkup: async () => ({ ok: true }),
      edit: async (_id: number, text: string) => void edits.push(text),
      answer: async (_id: string, text?: string) => void answered.push(text),
      createNote: async () => ({}) as never,
      calendarCfg: null,
      now: () => now,
    } as AxDeps;
    await handleCallback(deps, { callbackId: 'c1', messageId: 5, data: 'p:abc:ok' });
    await handleCallback(deps, { callbackId: 'c2', messageId: 5, data: 'p:abc:ok' });
    expect(createNote).toHaveBeenCalledTimes(1);
    expect(updateNote).toHaveBeenCalledWith('n1', { status: 'sent' });
    expect(edits[0]).toContain('BrainCT');
    expect(answered).toContain('이미 처리됨');
  });

  it('proposal text for the new kinds is escaped', () => {
    expect(formatProposal({ kind: 'send_memo', projectId: 'p', projectName: 'A<B>', body: 'x & y' }, '2026-10-18')).toContain('A&lt;B&gt;');
    expect(formatProposal({ kind: 'deadline_create', title: '<b>', dueDate: '2026-10-30', dueTime: '09:00', projectId: null, deadlineKind: 'other' }, '2026-10-18')).toContain('&lt;b&gt;');
  });
});
