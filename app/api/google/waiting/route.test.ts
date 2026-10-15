import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WaitingItem } from '@/lib/logic/waiting';

const meta = new Map<string, unknown>();
const fakeRepo = {
  getMeta: vi.fn(async (k: string) => (meta.has(k) ? meta.get(k) : null)),
  setMeta: vi.fn(async (k: string, v: unknown) => void meta.set(k, v)),
  listDeadlines: vi.fn(async () => []),
  listReviews: vi.fn(async () => []),
  listReviewCandidates: vi.fn(async () => []),
};
vi.mock('@/lib/repo', () => ({ getRepo: () => fakeRepo }));
const sendMessage = vi.fn<(text: string) => Promise<{ ok: boolean }>>(async () => ({ ok: true }));
vi.mock('@/lib/telegram/client', () => ({ sendMessage: (t: string) => sendMessage(t), telegramConfig: () => ({}) }));

const TOKEN = 'sync-token';
const ORIGINAL = {
  GOOGLE_SYNC_TOKEN: process.env.GOOGLE_SYNC_TOKEN,
  AI_GATEWAY_API_KEY: process.env.AI_GATEWAY_API_KEY,
  VERCEL_OIDC_TOKEN: process.env.VERCEL_OIDC_TOKEN,
};

const waitItem: WaitingItem = {
  id: 'w000001',
  title: '편집자 답장',
  projectId: null,
  taskId: null,
  deadlineId: null,
  match: { from: 'editor@journal.org' },
  since: '2026-10-15',
  createdAt: '2026-10-15T03:00:00.000Z',
  nudgeAfterDays: 7,
  status: 'open',
};

beforeEach(() => {
  vi.clearAllMocks();
  meta.clear();
  process.env.GOOGLE_SYNC_TOKEN = TOKEN;
  delete process.env.AI_GATEWAY_API_KEY; // offline: no Jev, alert has no classification
  delete process.env.VERCEL_OIDC_TOKEN;
});

afterEach(() => {
  for (const [k, v] of Object.entries(ORIGINAL)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

const get = (token?: string) =>
  new Request('http://localhost/api/google/waiting', {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });

const post = (body: unknown) =>
  new Request('http://localhost/api/google/sync', {
    method: 'POST',
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('GET /api/google/waiting', () => {
  it('503 without a server token, 401 with a wrong one', async () => {
    const { GET } = await import('./route');
    delete process.env.GOOGLE_SYNC_TOKEN;
    expect((await GET(get(TOKEN))).status).toBe(503);
    process.env.GOOGLE_SYNC_TOKEN = TOKEN;
    expect((await GET(get('nope'))).status).toBe(401);
    expect((await GET(get())).status).toBe(401);
  });

  it('200 with the open searches', async () => {
    const { GET } = await import('./route');
    meta.set('waiting:replies', [waitItem, { ...waitItem, id: 'w2', status: 'closed' }]);
    const res = await GET(get(TOKEN));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      items: [{ id: 'w000001', query: expect.stringContaining('from:editor@journal.org'), after: waitItem.createdAt }],
    });
  });
});

describe('POST /api/google/sync with waiting', () => {
  const matches = [
    { messageId: 'm1', from: 'Editor <editor@journal.org>', subject: 'Re: paper', snippet: 'Accepted!', receivedAt: '2026-10-16T01:00:00.000Z' },
  ];

  it('marks the item replied and sends exactly one alert, never a second', async () => {
    const { POST } = await import('../sync/route');
    meta.set('waiting:replies', [waitItem]);
    const res = await POST(post({ account: 'main', waiting: [{ id: 'w000001', matches }] }));
    expect(res.status).toBe(200);
    expect((meta.get('waiting:replies') as WaitingItem[])[0]).toMatchObject({ status: 'replied', reply: { messageId: 'm1' } });
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0][0]).toContain('📬 답장 도착: 편집자 답장');

    await POST(post({ account: 'main', waiting: [{ id: 'w000001', matches }] }));
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it('leaves waiting untouched when the key is absent', async () => {
    const { POST } = await import('../sync/route');
    meta.set('waiting:replies', [waitItem]);
    await POST(post({ account: 'main' }));
    expect((meta.get('waiting:replies') as WaitingItem[])[0].status).toBe('open');
    expect(sendMessage).not.toHaveBeenCalled();
  });
});
