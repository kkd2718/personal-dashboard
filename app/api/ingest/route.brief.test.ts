import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseBrief } from '@/lib/logic/market-brief';
import { rawBody } from '@/lib/logic/market-brief.fixtures';

const meta = new Map<string, unknown>();
const fakeRepo = {
  getStatusSnapshot: vi.fn(async () => null),
  setStatusSnapshot: vi.fn(async () => {}),
  upsertProjectActivity: vi.fn(async () => ({})),
  getMeta: vi.fn(async (k: string) => (meta.has(k) ? structuredClone(meta.get(k)) : null)),
  setMeta: vi.fn(async (k: string, v: unknown) => void meta.set(k, structuredClone(v))),
};
vi.mock('@/lib/repo', () => ({ getRepo: () => fakeRepo }));
const sendMessage = vi.fn<(t: string) => Promise<{ ok: boolean }>>(async () => ({ ok: true }));
vi.mock('@/lib/telegram/client', () => ({ sendMessage: (t: string) => sendMessage(t), telegramConfig: () => ({}) }));

import { POST } from './route';

const post = (tradingBrief: unknown) =>
  POST(
    new Request('http://localhost/api/ingest', {
      method: 'POST',
      headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' },
      body: JSON.stringify({ statusItems: [], tradingBrief }),
    })
  );
const failing = { trades: { overall: 'fail', checks: [{ id: 'fill', label: '체결', status: 'fail', detail: '2건 실패' }] } };

beforeEach(() => {
  vi.clearAllMocks();
  meta.clear();
  process.env.INGEST_TOKEN = 'test-token';
});

describe('POST /api/ingest tradingBrief (PC fallback)', () => {
  it('stores the snapshot as source pc when none exists, allow-listed only', async () => {
    expect((await post(rawBody())).status).toBe(200);
    const stored = meta.get('trading:market') as { source: string };
    expect(stored.source).toBe('pc');
    const json = JSON.stringify(stored);
    for (const leaked of ['"regime":', 'ACCT-SECRET', 'ib_sniper']) expect(json).not.toContain(leaked);
  });

  it('never overwrites a VM snapshot younger than 6 hours', async () => {
    meta.set('trading:market', { ...parseBrief(rawBody({ as_of: 'vm' }))!, receivedAt: new Date(Date.now() - 3_600_000).toISOString(), source: 'vm' });
    await post(rawBody({ as_of: 'pc' }));
    expect(meta.get('trading:market')).toMatchObject({ as_of: 'vm', source: 'vm' });
  });

  it('replaces a snapshot older than 6 hours', async () => {
    meta.set('trading:market', { ...parseBrief(rawBody({ as_of: 'vm' }))!, receivedAt: new Date(Date.now() - 7 * 3_600_000).toISOString(), source: 'vm' });
    await post(rawBody({ as_of: 'pc' }));
    expect(meta.get('trading:market')).toMatchObject({ as_of: 'pc', source: 'pc' });
  });

  it('a stored fallback does not alert on repeats, but a first failing one does', async () => {
    await post(rawBody(failing));
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0][0]).toContain('체결');
  });

  it('a malformed tradingBrief is ignored, the rest of the ingest still succeeds', async () => {
    const res = await post({ as_of: 123 });
    expect(res.status).toBe(200);
    expect(meta.has('trading:market')).toBe(false);
    expect(fakeRepo.setStatusSnapshot).toHaveBeenCalled();
  });

  it('ingest without tradingBrief leaves the snapshot alone', async () => {
    const res = await POST(
      new Request('http://localhost/api/ingest', {
        method: 'POST',
        headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' },
        body: JSON.stringify({ statusItems: [] }),
      })
    );
    expect(res.status).toBe(200);
    expect(meta.has('trading:market')).toBe(false);
  });
});

describe('POST /api/ingest trading summary (PC fallback)', () => {
  const summary = (total: number) => ({ collectedAt: new Date().toISOString(), totalKrw: total, dayChangeKrw: null, dayChangePct: null, fxRate: null, lastSyncOk: true, points: [], accounts: [] });
  const postSummary = (total: number) =>
    POST(
      new Request('http://localhost/api/ingest', {
        method: 'POST',
        headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' },
        body: JSON.stringify({ statusItems: [], trading: summary(total) }),
      })
    );

  it('writes when none is stored; keeps a VM summary younger than 6 hours; replaces an older one', async () => {
    await postSummary(1);
    expect(meta.get('trading:summary')).toMatchObject({ totalKrw: 1 });
    meta.set('trading:summary', { ...summary(2), source: 'vm', collectedAt: new Date(Date.now() - 3_600_000).toISOString() });
    await postSummary(3);
    expect(meta.get('trading:summary')).toMatchObject({ totalKrw: 2 });
    meta.set('trading:summary', { ...summary(2), source: 'vm', collectedAt: new Date(Date.now() - 7 * 3_600_000).toISOString() });
    await postSummary(4);
    expect(meta.get('trading:summary')).toMatchObject({ totalKrw: 4, source: 'pc' });
    await postSummary(5); // hourly PC refresh over a PC-written summary
    expect(meta.get('trading:summary')).toMatchObject({ totalKrw: 5 });
  });
});
