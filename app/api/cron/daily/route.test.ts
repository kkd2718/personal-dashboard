import { beforeEach, describe, expect, it, vi } from 'vitest';

const meta = new Map<string, unknown>();
const fakeRepo = {
  setHeartbeat: vi.fn(async () => {}),
  getMeta: vi.fn(async (k: string) => (meta.has(k) ? meta.get(k) : null)),
  setMeta: vi.fn(async (k: string, v: unknown) => void meta.set(k, v)),
  listMetaByPrefix: vi.fn(async (p: string) => Object.fromEntries([...meta].filter(([k]) => k.startsWith(p)))),
  deleteMeta: vi.fn(async (k: string) => void meta.delete(k)),
};
vi.mock('@/lib/repo', () => ({ getRepo: () => fakeRepo }));
vi.mock('@/lib/telegram/client', () => ({ telegramConfig: () => null, sendMessage: vi.fn() }));

import { GET } from './route';

const get = (auth?: string) =>
  GET(new Request('http://localhost/api/cron/daily', { headers: auth ? { authorization: `Bearer ${auth}` } : {} }));

beforeEach(() => {
  meta.clear();
  process.env.CRON_SECRET = 'cron';
});

describe('GET /api/cron/daily pruning', () => {
  it('prunes mail records after 48h and other pending records after 7 days, even without a digest', async () => {
    const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
    meta.set('telegram:pending:oldmail', { type: 'mail', id: 'oldmail', createdAt: hoursAgo(49) });
    meta.set('telegram:pending:newmail', { type: 'mail', id: 'newmail', createdAt: hoursAgo(47) });
    meta.set('telegram:pending:prop', { type: 'proposal', id: 'prop', createdAt: hoursAgo(100) });
    meta.set('telegram:pending:oldprop', { type: 'proposal', id: 'oldprop', createdAt: hoursAgo(24 * 8) });
    meta.set('ax:applied:oldprop', hoursAgo(24 * 8));
    const res = await get('cron');
    expect(res.status).toBe(200);
    expect([...meta.keys()].sort()).toEqual(['telegram:pending:newmail', 'telegram:pending:prop']);
  });

  it('401 without the cron secret', async () => {
    expect((await get()).status).toBe(401);
  });
});
