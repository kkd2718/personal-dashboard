import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WaitingItem } from '@/lib/logic/waiting';

const meta = new Map<string, unknown>();
const fakeRepo = {
  listReviewCandidates: vi.fn(async () => []),
  listReviews: vi.fn(async () => []),
  listDeadlines: vi.fn(async () => []),
  listPapers: vi.fn(async () => []),
  listProjects: vi.fn(async () => []),
  getMeta: vi.fn(async (k: string) => (meta.has(k) ? structuredClone(meta.get(k)) : null)),
  setMeta: vi.fn(async (k: string, v: unknown) => void meta.set(k, structuredClone(v))),
  listMetaByPrefix: vi.fn(async (p: string) => Object.fromEntries([...meta].filter(([k]) => k.startsWith(p)))),
  deleteMeta: vi.fn(async (k: string) => void meta.delete(k)),
};
vi.mock('@/lib/repo', () => ({ getRepo: () => fakeRepo }));
vi.mock('@/lib/ai/jev', () => ({ jevToken: () => null, createJev: () => null }));
vi.mock('@/lib/ask/client', () => ({ createAskClient: () => null }));

const sends: string[] = [];
vi.mock('@/lib/telegram/client', () => ({
  sendMessage: async (t: string) => (sends.push(t), { ok: true }),
  telegramConfig: () => ({}),
}));

import { POST } from './route';

const TOKEN = 'sync-token';
const item = (over: Partial<WaitingItem> = {}): WaitingItem => ({
  id: 'w000001',
  title: '리뷰어 답변',
  projectId: null,
  taskId: null,
  deadlineId: null,
  match: {},
  since: '2026-11-01',
  createdAt: '2026-11-01T00:00:00.000Z',
  nudgeAfterDays: 7,
  status: 'open',
  ...over,
});
const reply = (snippet: string) => ({
  waiting: [
    {
      id: 'w000001',
      matches: [{ messageId: 'm1', from: 'Ed <ed@journal.example.org>', subject: 'Re: manuscript', snippet, receivedAt: '2026-11-05T00:00:00.000Z' }],
    },
  ],
});
const post = (account: string, extra: Record<string, unknown>) =>
  POST(
    new Request('http://localhost/api/google/sync', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ account, ...extra }),
    })
  );

beforeEach(() => {
  vi.clearAllMocks();
  meta.clear();
  sends.length = 0;
  process.env.GOOGLE_SYNC_TOKEN = TOKEN;
});

describe('waiting-reply snippets', () => {
  it('attachment names are stripped before storing and alerting', async () => {
    meta.set('waiting:replies', [item()]);
    const res = await post('main', reply('Accepted, see revised_protocol.pdf and data.xlsx attached.'));
    expect(res.status).toBe(200);
    const stored = (meta.get('waiting:replies') as WaitingItem[])[0];
    expect(stored.status).toBe('replied');
    expect(stored.reply?.snippet).toBe('Accepted, see and attached.');
    expect(JSON.stringify(sends)).not.toContain('.pdf');
    expect(JSON.stringify(sends)).not.toContain('.xlsx');
  });

  it('a noBodyAccounts account sends no snippet at all', async () => {
    meta.set('mail:triage:config', { noBodyAccounts: ['main'] });
    meta.set('waiting:replies', [item()]);
    await post('main', reply('private body text'));
    expect((meta.get('waiting:replies') as WaitingItem[])[0].reply?.snippet).toBe('');
    expect(JSON.stringify(sends)).not.toContain('private body text');
  });

  it('replies already stored with file names are cleaned on the next sync, even without a waiting payload', async () => {
    meta.set('waiting:replies', [
      item({ status: 'replied', reply: { messageId: 'm0', from: 'a@b.org', subject: 's', snippet: 'see old_scan.pdf now', date: '2026-11-04T00:00:00.000Z' } }),
      item({ id: 'w000002', status: 'replied', reply: { messageId: 'm9', from: 'a@b.org', subject: 's', snippet: 'clean text', date: '2026-11-04T00:00:00.000Z' } }),
    ]);
    await post('main', {});
    const list = meta.get('waiting:replies') as WaitingItem[];
    expect(list[0].reply?.snippet).toBe('see now');
    expect(list[1].reply?.snippet).toBe('clean text');
    // idempotent
    const before = JSON.stringify(list);
    await post('main', {});
    expect(JSON.stringify(meta.get('waiting:replies'))).toBe(before);
  });
});
