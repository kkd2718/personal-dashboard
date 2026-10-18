import { beforeEach, describe, expect, it, vi } from 'vitest';

const runEvening = vi.fn();
const runWeekly = vi.fn(async () => 'sent');
vi.mock('@/lib/repo', () => ({ getRepo: () => ({}) }));
vi.mock('@/lib/telegram/client', () => ({ telegramConfig: () => ({}), sendMessage: vi.fn() }));
vi.mock('@/lib/telegram/evening', () => ({ runEvening: (...a: unknown[]) => runEvening(...a) }));
vi.mock('@/lib/telegram/weekly', () => ({ runWeekly: (...a: unknown[]) => runWeekly(...(a as [])) }));
vi.mock('@/lib/ai/jev', () => ({ createJev: () => null, jevToken: () => null }));

import { GET } from './route';

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = 'cron';
});

describe('GET /api/cron/evening', () => {
  it('an evening failure still runs the weekly review', async () => {
    runEvening.mockRejectedValueOnce(new Error('db down'));
    const res = await GET(new Request('http://localhost/api/cron/evening', { headers: { authorization: 'Bearer cron' } }));
    expect(await res.json()).toMatchObject({ ok: true, evening: 'failed', weekly: 'sent' });
    expect(runWeekly).toHaveBeenCalled();
  });
});
