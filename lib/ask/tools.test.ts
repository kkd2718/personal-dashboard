import { describe, expect, it } from 'vitest';
import { project, task } from '@/lib/logic/ax-fixtures';
import { READ_TOOLS, runTool, toolDefsForApi } from './tools';
import { fakeRepo, note } from './fixtures';

const ctx = { today: '2026-10-18' };
const p1 = project({ id: 'p1', slug: 'brainct', name: 'BrainCT', aliases: ['브레인'] });
const run = async (repo: ReturnType<typeof fakeRepo>['repo'], name: string, input: unknown) => {
  const out = await runTool(repo, name, input, ctx);
  return { ...out, json: out.isError ? null : JSON.parse(out.content) };
};

describe('runTool', () => {
  it('list_tasks open excludes done and resolves project aliases', async () => {
    const { repo } = fakeRepo({
      projects: [p1],
      tasks: [
        task({ id: 't1', title: '전처리', projectId: 'p1', dueDate: '2026-10-20' }),
        task({ id: 't2', title: '끝낸 일', status: 'done', projectId: 'p1' }),
        task({ id: 't3', title: '다른 프로젝트' }),
      ],
    });
    const open = await run(repo, 'list_tasks', { status: 'open' });
    expect(open.json.map((t: { id: string }) => t.id)).toEqual(['t1', 't3']);
    const byProject = await run(repo, 'list_tasks', { project: '브레인' });
    expect(byProject.json.map((t: { id: string }) => t.id)).toEqual(['t1']);
    expect(byProject.json[0]).toMatchObject({ project: 'BrainCT', status: 'todo', assignee: 'me' });
  });

  it('limit above 50 is an input error, not a throw', async () => {
    const { repo } = fakeRepo();
    const out = await runTool(repo, 'list_tasks', { limit: 51 }, ctx);
    expect(out.isError).toBe(true);
    expect(out.content).toContain('입력 오류');
  });

  it('unknown tool and unknown project are errors without throwing', async () => {
    const { repo } = fakeRepo({ projects: [p1] });
    expect(await runTool(repo, 'nope', {}, ctx)).toMatchObject({ isError: true });
    const out = await runTool(repo, 'list_tasks', { project: 'zzzz' }, ctx);
    expect(out).toMatchObject({ isError: true });
    expect(out.content).toContain('프로젝트를 찾을 수 없어요');
  });

  it('a tool crash is reported generically, never with the stack', async () => {
    const { repo } = fakeRepo();
    (repo as unknown as { listTasks: () => Promise<never> }).listTasks = async () => {
      throw new Error('secret-internal-detail');
    };
    const out = await runTool(repo, 'list_tasks', {}, ctx);
    expect(out.isError).toBe(true);
    expect(out.content).not.toContain('secret');
  });

  it('get_trading_total exposes the total only, never accounts', async () => {
    const { repo } = fakeRepo({
      meta: {
        'trading:summary': {
          collectedAt: '2026-10-18T00:00:00Z',
          totalKrw: 1000,
          dayChangeKrw: 10,
          dayChangePct: 1,
          fxRate: 1300,
          accounts: [{ id: 'a1', label: 'ACCT-SECRET', holdings: ['X'] }],
          points: [],
        },
      },
    });
    const out = await runTool(repo, 'get_trading_total', {}, ctx);
    expect(Object.keys(JSON.parse(out.content)).sort()).toEqual(['collectedAt', 'dayChangeKrw', 'dayChangePct', 'totalKrw']);
    expect(out.content).not.toContain('ACCT-SECRET');
    expect(out.content).not.toContain('accounts');
  });

  it('search_memos skips private and archived memos', async () => {
    const { repo } = fakeRepo({
      notes: [
        note({ id: 'n1', body: '공개 메모 alpha' }),
        note({ id: 'n2', body: '비밀 alpha', tags: ['비공개'] }),
        note({ id: 'n3', body: 'alpha #private 영어' }),
        note({ id: 'n4', body: '보관 alpha', status: 'archived' }),
        note({ id: 'n5', body: '다른 내용' }),
      ],
    });
    const out = await run(repo, 'search_memos', { query: 'ALPHA' });
    expect(out.json.map((n: { id: string }) => n.id)).toEqual(['n1']);
  });

  it('clips output over 6000 chars', async () => {
    const tasks = Array.from({ length: 50 }, (_, i) => task({ id: `t${i}`, title: '긴 제목 '.repeat(30) + i }));
    const { repo } = fakeRepo({ tasks });
    const out = await runTool(repo, 'list_tasks', { limit: 50 }, ctx);
    expect(out.isError).toBe(false);
    expect(out.content.length).toBeLessThanOrEqual(6000 + 10);
    expect(out.content.endsWith('…(생략)')).toBe(true);
  });

  it('list_calendar_events rejects ranges over 62 days', async () => {
    const { repo } = fakeRepo();
    expect(await runTool(repo, 'list_calendar_events', { from: '2026-10-01', to: '2026-12-31' }, ctx)).toMatchObject({ isError: true });
    expect(await runTool(repo, 'list_calendar_events', { from: '2026-10-01', to: '2026-10-31' }, ctx)).toMatchObject({ isError: false });
  });

  it('get_overview and get_routines run on an empty dashboard', async () => {
    const { repo } = fakeRepo();
    expect((await run(repo, 'get_overview', {})).json).toMatchObject({ date: '2026-10-18', overdue: [], upcoming: [] });
    expect((await run(repo, 'get_routines', {})).isError).toBe(false);
  });

  it('get_routines does not seed the routine list (read-only)', async () => {
    const { repo, meta } = fakeRepo();
    await run(repo, 'get_routines', {});
    expect(meta.size).toBe(0);
  });
});

describe('tool registry', () => {
  it('every tool has an object input schema; only the last carries the cache breakpoint', () => {
    const defs = toolDefsForApi(READ_TOOLS);
    expect(defs).toHaveLength(READ_TOOLS.length);
    for (const d of defs) expect(d.input_schema.type).toBe('object');
    expect(defs.filter((d) => d.cache_control).map((d) => d.name)).toEqual([defs.at(-1)!.name]);
  });
  it('exposes no write or secret tools', () => {
    const names = READ_TOOLS.map((t) => t.name);
    expect(names.every((n) => /^(get|list|search)_/.test(n))).toBe(true);
  });
});
