import { beforeEach, describe, expect, it, vi } from 'vitest';
import { rawBody } from '@/lib/logic/market-brief.fixtures';

const meta = new Map<string, unknown>();
const fakeRepo = {
  getMeta: vi.fn(async (k: string) => (meta.has(k) ? structuredClone(meta.get(k)) : null)),
  setMeta: vi.fn(async (k: string, v: unknown) => void meta.set(k, structuredClone(v))),
};
vi.mock('@/lib/repo', () => ({ getRepo: () => fakeRepo }));
const sendMessage = vi.fn<(t: string) => Promise<{ ok: boolean }>>(async () => ({ ok: true }));
vi.mock('@/lib/telegram/client', () => ({ sendMessage: (t: string) => sendMessage(t), telegramConfig: () => ({}) }));

import { POST } from './route';

const TOKEN = 'brief-token';
const post = (body: unknown, token: string | null = TOKEN, raw?: string) =>
  POST(
    new Request('http://localhost/api/trading/brief', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: raw ?? JSON.stringify(body),
    })
  );
const failing = { trades: { overall: 'fail', checks: [{ id: 'fill', label: '체결', status: 'fail', detail: '2건 실패' }] } };

beforeEach(() => {
  vi.clearAllMocks();
  meta.clear();
  process.env.TRADING_BRIEF_TOKEN = TOKEN;
});

describe('POST /api/trading/brief', () => {
  it('503 without a server token, 401 for missing or wrong bearer', async () => {
    expect((await post(rawBody(), TOKEN)).status).toBe(200);
    expect((await post(rawBody(), null)).status).toBe(401);
    expect((await post(rawBody(), 'wrong')).status).toBe(401);
    delete process.env.TRADING_BRIEF_TOKEN;
    expect((await post(rawBody())).status).toBe(503);
  });

  it('rejects oversized and malformed bodies', async () => {
    expect((await post(null, TOKEN, 'x'.repeat(65 * 1024))).status).toBe(413);
    expect((await post(null, TOKEN, '{not json')).status).toBe(400);
    expect((await post({ macro: {} })).status).toBe(400); // as_of missing
    expect(meta.size).toBe(0);
  });

  it('stores an allow-listed snapshot only', async () => {
    const res = await post(rawBody());
    expect(await res.json()).toMatchObject({ ok: true, as_of: '2026-11-06', alerted: false });
    const stored = JSON.stringify(meta.get('trading:market'));
    expect(stored).toContain('"source":"vm"');
    for (const leaked of ['"regime":', 'ACCT-SECRET', 'total_value', 'ib_sniper', 'allocation']) expect(stored).not.toContain(leaked);
  });

  it('a flip to fail alerts once; repeats and recovery do not', async () => {
    await post(rawBody());
    const first = await post(rawBody(failing));
    expect(await first.json()).toMatchObject({ alerted: true });
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0][0]).toContain('체결');
    await post(rawBody(failing));
    await post(rawBody());
    expect(sendMessage).toHaveBeenCalledTimes(1);
    await post(rawBody(failing)); // a new flip alerts again
    expect(sendMessage).toHaveBeenCalledTimes(2);
  });

  it('a failed alert send keeps the flip pending: the next failing push retries, then it stays quiet', async () => {
    await post(rawBody());
    sendMessage.mockResolvedValueOnce({ ok: false });
    expect(await (await post(rawBody(failing))).json()).toMatchObject({ alerted: false });
    expect(meta.get('trading:market')).toMatchObject({ alertPending: true });
    expect(await (await post(rawBody(failing))).json()).toMatchObject({ alerted: true });
    expect(meta.get('trading:market')).not.toHaveProperty('alertPending');
    expect(sendMessage).toHaveBeenCalledTimes(2);
    await post(rawBody(failing));
    expect(sendMessage).toHaveBeenCalledTimes(2);
  });

  it('the same as_of pushed twice overwrites without rotating', async () => {
    await post(rawBody());
    await post(rawBody());
    expect(meta.has('trading:market:prev')).toBe(false);
  });
});
