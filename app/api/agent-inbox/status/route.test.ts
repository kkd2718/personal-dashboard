import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Project, ProjectActivity } from '@/lib/types';

const meta = new Map<string, unknown>();
let projects: Project[] = [];
let activity: ProjectActivity[] = [];
const fakeRepo = {
  listProjects: vi.fn(async () => projects),
  listProjectActivity: vi.fn(async () => activity),
  upsertProjectActivity: vi.fn(async (a: ProjectActivity) => a),
  getMeta: vi.fn(async (k: string) => (meta.has(k) ? structuredClone(meta.get(k)) : null)),
  setMeta: vi.fn(async (k: string, v: unknown) => void meta.set(k, structuredClone(v))),
};
vi.mock('@/lib/repo', () => ({ getRepo: () => fakeRepo }));

import { POST } from './route';

const project = (id: string, paths: string[], backlogGlobs: string[] = []): Project => ({
  id,
  slug: id,
  name: id,
  group: 'app',
  subgroup: null,
  status: 'active',
  summary: '',
  nextAction: null,
  links: [],
  paths,
  aliases: [],
  backlogGlobs,
  pinned: false,
  sort: 0,
  color: 'blue',
  updatedAt: '2026-11-01',
});
const act = (projectId: string): ProjectActivity => ({
  projectId,
  branch: 'main',
  lastCommitAt: null,
  lastCommitMsg: null,
  dirty: false,
  lastSessionAt: null,
  memoryDigest: null,
  metrics: { backlogOpen: 4, 'bar:코드:done': 1 },
  collectedAt: 'c',
});
const status = (
  checklist: unknown[] = [
    { text: 'a', status: 'done', section: null, owner: 'me' },
    { text: 'b', status: 'todo', section: null, owner: 'agent' },
  ]
) => ({ updatedAt: '2026-11-02T00:00:00Z', focus: 'f', next: [], blockers: [], done: [], checklist });
const post = (body: unknown, token = 'tok') =>
  POST(
    new Request('http://localhost/api/agent-inbox/status', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    })
  );

beforeEach(() => {
  vi.clearAllMocks();
  meta.clear();
  projects = [project('p1', ['/home/u/proj']), project('p2', ['C:\\W\\p'])];
  activity = [act('p1'), act('p2')];
  process.env.AGENT_TOKEN = 'tok';
});

describe('POST /api/agent-inbox/status', () => {
  it('rejects bad auth, oversize, bad JSON and bad schema', async () => {
    delete process.env.AGENT_TOKEN;
    expect((await post({})).status).toBe(503);
    process.env.AGENT_TOKEN = 'tok';
    expect((await post({}, 'nope')).status).toBe(401);
    expect((await post('x'.repeat(129 * 1024))).status).toBe(413);
    expect((await post('{not json')).status).toBe(400);
    const bad = status([{ text: 'a', status: 'later', section: null, owner: 'me' }]);
    expect((await post({ path: '/home/u/proj', status: bad })).status).toBe(400);
  });

  it('answers project:null without writing when no project matches', async () => {
    const res = await post({ path: '/elsewhere', status: status() });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, project: null });
    expect(fakeRepo.setMeta).not.toHaveBeenCalled();
  });

  it('replaces status but keeps openItems and collectedAt', async () => {
    meta.set('project:detail:p1', { projectId: 'p1', collectedAt: 'old', openItems: { 코드: ['a'] }, status: null });
    expect((await post({ path: '/home/u/proj', status: status() })).status).toBe(200);
    expect(meta.get('project:detail:p1')).toMatchObject({ collectedAt: 'old', openItems: { 코드: ['a'] }, status: { focus: 'f' } });
  });

  it('patches the 체크리스트 bar on an existing activity row, keeping other metrics', async () => {
    const res = await post({ path: '/home/u/proj', status: status() });
    expect((await res.json()).bar).toBe(true);
    expect(fakeRepo.upsertProjectActivity).toHaveBeenCalledWith(
      expect.objectContaining({ metrics: { backlogOpen: 4, 'bar:코드:done': 1, 'bar:체크리스트:done': 1, 'bar:체크리스트:open': 1 } })
    );
  });

  it('skips the bar when the project owns a 체크리스트 glob or has no activity row', async () => {
    projects = [project('p1', ['/home/u/proj'], ['체크리스트=docs/X.md'])];
    await post({ path: '/home/u/proj', status: status() });
    expect(fakeRepo.upsertProjectActivity).not.toHaveBeenCalled();
    projects = [project('p1', ['/home/u/proj'])];
    activity = [];
    await post({ path: '/home/u/proj', status: status() });
    expect(fakeRepo.upsertProjectActivity).not.toHaveBeenCalled();
  });

  it('matches WSL path forms', async () => {
    expect((await (await post({ path: '/home/u/proj/sub', status: status() })).json()).projectId).toBe('p1');
    expect((await (await post({ path: '/mnt/c/W/p', status: status() })).json()).projectId).toBe('p2');
  });
});
