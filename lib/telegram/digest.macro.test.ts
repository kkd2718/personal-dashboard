import { describe, expect, it, vi } from 'vitest';
import { fakeClient, fakeRepo, message, text } from '@/lib/ask/fixtures';
import { parseBrief } from '@/lib/logic/market-brief';
import { rawBody } from '@/lib/logic/market-brief.fixtures';
import { runDigest, type DigestRepo } from './digest';

const TODAY = '2026-09-26'; // before the seeded routines start, so only the macro block can make the digest non-empty
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
const snapshot = (over: Record<string, unknown> = {}, receivedAt = hoursAgo(1)) => ({ ...parseBrief(rawBody(over))!, receivedAt, source: 'vm' as const });

function setup(meta: Record<string, unknown> = {}) {
  const { repo, meta: store } = fakeRepo({ meta });
  const digestRepo = {
    ...repo,
    listProjects: async () => [],
    listTasks: async () => [],
    listDeadlines: async () => [],
    listReviews: async () => [],
    getStatusSnapshot: async () => null,
    listCalendarEvents: async () => [],
  } as unknown as DigestRepo;
  const sender = vi.fn<(t: string) => Promise<{ ok: boolean }>>(async () => ({ ok: true }));
  return { digestRepo, repo, sender, store };
}

describe('digest 📈 매크로 block', () => {
  it('no snapshot and nothing else: still skipped-empty', async () => {
    const s = setup();
    expect(await runDigest(s.digestRepo, s.sender, TODAY, false, null)).toBe('skipped-empty');
    expect(s.sender).not.toHaveBeenCalled();
  });

  it('a snapshot alone is worth a digest', async () => {
    const s = setup({ 'trading:market': snapshot() });
    expect(await runDigest(s.digestRepo, s.sender, TODAY, false, null)).toBe('sent');
    const sent = s.sender.mock.calls[0][0];
    expect(sent).toContain('<b>☀️ 브리핑</b>');
    expect(sent).toContain('<b>📈 매크로</b>');
    expect(sent).toContain('🩺 매매 점검 ✅ 정상');
    expect(sent).not.toContain('🤖');
    expect(s.store.get('telegram:digest:lastSent')).toBe(TODAY);
  });

  it('with an AI client, yesterday and a fresh snapshot add the Haiku sentence', async () => {
    const s = setup({ 'trading:market': snapshot(), 'trading:market:prev': snapshot({ as_of: '2026-11-05' }, hoursAgo(25)) });
    const fc = fakeClient([message([text('SOXL 래더는 그대로, VIX 소폭 상승')])]);
    await runDigest(s.digestRepo, s.sender, TODAY, false, null, { client: fc.client, repo: s.repo });
    expect(s.sender.mock.calls[0][0]).toContain('🤖 SOXL 래더는 그대로, VIX 소폭 상승');
    expect(fc.calls).toHaveLength(1);
  });

  it('no previous snapshot, or no client: no sentence, no call', async () => {
    const s1 = setup({ 'trading:market': snapshot() });
    const fc = fakeClient([message([text('x')])]);
    await runDigest(s1.digestRepo, s1.sender, TODAY, false, null, { client: fc.client, repo: s1.repo });
    expect(fc.calls).toHaveLength(0);
    const s2 = setup({ 'trading:market': snapshot(), 'trading:market:prev': snapshot({}, hoursAgo(25)) });
    await runDigest(s2.digestRepo, s2.sender, TODAY, false, null);
    expect(s2.sender.mock.calls[0][0]).not.toContain('🤖');
  });

  it('a stale snapshot is dated and gets no sentence or call', async () => {
    const s = setup({ 'trading:market': snapshot({}, hoursAgo(50)), 'trading:market:prev': snapshot({}, hoursAgo(80)) });
    const fc = fakeClient([message([text('x')])]);
    await runDigest(s.digestRepo, s.sender, TODAY, false, null, { client: fc.client, repo: s.repo });
    expect(s.sender.mock.calls[0][0]).toMatch(/매크로<\/b> <i>\(\d+\/\d+ 기준\)<\/i>/);
    expect(fc.calls).toHaveLength(0);
  });

  it('a failing sentence call never blocks the digest', async () => {
    const s = setup({ 'trading:market': snapshot(), 'trading:market:prev': snapshot({}, hoursAgo(25)) });
    const client = { create: async () => { throw new Error('boom'); } };
    expect(await runDigest(s.digestRepo, s.sender, TODAY, false, null, { client, repo: s.repo })).toBe('sent');
  });

  // Long check details push the macro block past one Telegram message.
  const longChecks = Array.from({ length: 5 }, (_, i) => ({ id: `c${i}`, label: `점검 ${i}`, status: 'fail', detail: '길게'.repeat(450) }));
  const longTasks = Array.from({ length: 40 }, (_, i) => ({
    id: `t${i}`,
    projectId: 'p1',
    milestoneId: null,
    title: `오늘 할 일 ${i} ${'가'.repeat(400)}`,
    description: null,
    dueDate: TODAY,
    status: 'todo',
    assignee: 'me',
    order: i,
    createdAt: TODAY,
    updatedAt: TODAY,
  }));
  const longSnapshot = () => snapshot({ trades: { overall: 'fail', checks: longChecks } });

  it('a long digest sends the macro block as its own message', async () => {
    const s = setup({ 'trading:market': longSnapshot() });
    (s.digestRepo as { listTasks: () => Promise<unknown[]>; listProjects: () => Promise<unknown[]> }).listTasks = async () => longTasks;
    (s.digestRepo as { listProjects: () => Promise<unknown[]> }).listProjects = async () => [{ id: 'p1', slug: 'p1', name: '프로젝트', status: 'active', order: 0 }];
    expect(await runDigest(s.digestRepo, s.sender, TODAY, false, null)).toBe('sent');
    const parts = s.sender.mock.calls.map((c) => c[0]);
    expect(parts.length).toBeGreaterThanOrEqual(2);
    expect(parts[0]).not.toContain('📈 매크로');
    expect(parts.at(-1)).toContain('📈 매크로');
    for (const part of parts) expect(part.length).toBeLessThanOrEqual(4096);
    expect(s.store.get('telegram:digest:lastSent')).toBe(TODAY);
  });

  it('a short digest stays one message with the macro block', async () => {
    const s = setup({ 'trading:market': snapshot() });
    await runDigest(s.digestRepo, s.sender, TODAY, false, null);
    expect(s.sender).toHaveBeenCalledTimes(1);
  });

  it('a failing part marks the digest failed (no lastSent)', async () => {
    const s = setup({ 'trading:market': longSnapshot() });
    (s.digestRepo as { listTasks: () => Promise<unknown[]>; listProjects: () => Promise<unknown[]> }).listTasks = async () => longTasks;
    (s.digestRepo as { listProjects: () => Promise<unknown[]> }).listProjects = async () => [{ id: 'p1', slug: 'p1', name: '프로젝트', status: 'active', order: 0 }];
    const sender = vi.fn<(t: string) => Promise<{ ok: boolean }>>(async () => ({ ok: false }));
    expect(await runDigest(s.digestRepo, sender, TODAY, false, null)).toBe('failed');
    expect(s.store.has('telegram:digest:lastSent')).toBe(false);
  });

  it('the sent-today mark is written once the main part is out, even if the macro part then fails', async () => {
    const s = setup({ 'trading:market': longSnapshot() });
    (s.digestRepo as { listTasks: () => Promise<unknown[]> }).listTasks = async () => longTasks;
    (s.digestRepo as { listProjects: () => Promise<unknown[]> }).listProjects = async () => [{ id: 'p1', slug: 'p1', name: '프로젝트', status: 'active', order: 0 }];
    const sender = vi.fn<(t: string) => Promise<{ ok: boolean }>>(async (t) => ({ ok: !t.includes('📈 매크로') }));
    expect(await runDigest(s.digestRepo, sender, TODAY, false, null)).toBe('failed');
    expect(s.store.get('telegram:digest:lastSent')).toBe(TODAY);
    expect(await runDigest(s.digestRepo, sender, TODAY, false, null)).toBe('skipped-already');
  });

  it('an unreadable snapshot never blocks the rest of the digest', async () => {
    const s = setup();
    const base = s.digestRepo.getMeta.bind(s.digestRepo);
    s.digestRepo.getMeta = (async (k: string) => {
      if (k.startsWith('trading:market')) throw new Error('db down');
      return base(k);
    }) as typeof s.digestRepo.getMeta;
    expect(await runDigest(s.digestRepo, s.sender, TODAY, false, null)).toBe('skipped-empty');
    expect(s.sender).not.toHaveBeenCalled();
  });

  it('shows at most 5 failing checks in the block, the rest counted', async () => {
    const checks = Array.from({ length: 8 }, (_, i) => ({ id: `c${i}`, label: `점검 ${i}`, status: 'fail', detail: '실패' }));
    const s = setup({ 'trading:market': snapshot({ trades: { overall: 'fail', checks } }) });
    await runDigest(s.digestRepo, s.sender, TODAY, false, null);
    const out = s.sender.mock.calls[0][0];
    expect(out.match(/🚨 점검 /g)).toHaveLength(5);
    expect(out).toContain('…외 3건 — /macro');
  });
});
