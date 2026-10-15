import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CalendarEvent } from '@/lib/types';

const meta = new Map<string, unknown>();
let calendarRows: CalendarEvent[] = [];
const fakeRepo = {
  getMeta: vi.fn(async (k: string) => (meta.has(k) ? meta.get(k) : null)),
  setMeta: vi.fn(async (k: string, v: unknown) => void meta.set(k, v)),
  listDeadlines: vi.fn(async () => []),
  listReviews: vi.fn(async () => []),
  listReviewCandidates: vi.fn(async () => []),
  listCalendarEvents: vi.fn(async () => calendarRows),
  upsertCalendarEvent: vi.fn(async () => {}),
};
vi.mock('@/lib/repo', () => ({ getRepo: () => fakeRepo }));
let sendOk = true;
const sendMessage = vi.fn<(text: string) => Promise<{ ok: boolean }>>(async () => ({ ok: sendOk }));
vi.mock('@/lib/telegram/client', () => ({ sendMessage: (t: string) => sendMessage(t), telegramConfig: () => ({}) }));

const TOKEN = 'sync-token';
const ENV_KEYS = [
  'GOOGLE_SYNC_TOKEN',
  'WORK_OFF_EVENTS',
  'GOOGLE_OAUTH_CLIENT_ID',
  'GOOGLE_OAUTH_CLIENT_SECRET',
  'GOOGLE_OAUTH_REFRESH_TOKEN',
] as const;
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

/** A month `YYYY-MM` of 30 rows: Mondays and the 1st off, the rest A1. */
function month(m: string) {
  return {
    from: `${m}-01`,
    to: `${m}-30`,
    shifts: Array.from({ length: 30 }, (_, i) => {
      const day = i + 1;
      return { date: `${m}-${String(day).padStart(2, '0')}`, code: day === 1 || day === 8 ? 'off' : 'A1' };
    }),
  };
}

const post = (work: unknown) =>
  new Request('http://localhost/api/google/sync', {
    method: 'POST',
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({ account: 'main', work }),
  });

beforeEach(() => {
  vi.clearAllMocks();
  meta.clear();
  calendarRows = [];
  sendOk = true;
  process.env.GOOGLE_SYNC_TOKEN = TOKEN;
  for (const k of ENV_KEYS.slice(1)) delete process.env[k];
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe('POST /api/google/sync: monthly shift announcement', () => {
  it('first POST seeds and sends nothing; a new month then sends once and is recorded', async () => {
    const { POST } = await import('./route');
    await POST(post(month('2099-01')));
    expect(sendMessage).not.toHaveBeenCalled();
    expect((meta.get('work:announced') as { months: string[] }).months).toContain('2099-01');

    await POST(post(month('2099-02')));
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0][0]).toContain('2월 근무표 나왔어요');
    expect((meta.get('work:announced') as { months: string[] }).months).toContain('2099-02');

    await POST(post(month('2099-02')));
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it('a failed send leaves the month unrecorded so the next sync retries', async () => {
    const { POST } = await import('./route');
    await POST(post(month('2099-01')));
    sendOk = false;
    await POST(post(month('2099-02')));
    expect((meta.get('work:announced') as { months: string[] }).months).not.toContain('2099-02');
    sendOk = true;
    await POST(post(month('2099-02')));
    expect((meta.get('work:announced') as { months: string[] }).months).toContain('2099-02');
  });
});

describe('seeding', () => {
  it('a one-day spill of the next month does not mark it announced', async () => {
    const { POST } = await import('./route');
    const oct = month('2099-10');
    const spill = { from: oct.from, to: '2099-11-01', shifts: [...Array.from({ length: 31 }, (_, i) => ({ date: `2099-10-${String(i + 1).padStart(2, '0')}`, code: 'A1' })), { date: '2099-11-01', code: 'off' }] };
    await POST(post(spill));
    expect((meta.get('work:announced') as { months: string[] }).months).toEqual(['2099-10']);
    expect(sendMessage).not.toHaveBeenCalled();

    await POST(post(month('2099-11')));
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0][0]).toContain('11월 근무표 나왔어요');
  });
});

describe('WORK_OFF_EVENTS', () => {
  function stubGoogle() {
    const inserts: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (String(url).includes('oauth2')) return Response.json({ access_token: 't', expires_in: 3600 });
        inserts.push(String(init?.body));
        return Response.json({ id: `e${inserts.length}`, organizer: { email: 'o@example.org' } });
      })
    );
    process.env.GOOGLE_OAUTH_CLIENT_ID = 'c';
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = 's';
    process.env.GOOGLE_OAUTH_REFRESH_TOKEN = `r-${Math.random()}`;
    return inserts;
  }

  async function announceNewMonth() {
    const { POST } = await import('./route');
    await POST(post(month('2099-01')));
    await POST(post(month('2099-02')));
  }

  it('unset or "true": no calendar call', async () => {
    const inserts = stubGoogle();
    await announceNewMonth();
    process.env.WORK_OFF_EVENTS = 'true';
    meta.set('work:announced', { months: ['2099-01'], seededAt: 't' });
    await announceNewMonth();
    expect(inserts).toHaveLength(0);
  });

  it('=1: one timed off event per off day, skipping a date that already has one', async () => {
    const inserts = stubGoogle();
    process.env.WORK_OFF_EVENTS = '1';
    calendarRows = [
      { id: 'x', account: 'main', calendarName: 'c', title: 'off', startDate: '2099-02-08', endDate: '2099-02-08', startTime: '08:00', endTime: '09:00', location: null, updatedAt: 't' },
    ];
    await announceNewMonth();
    expect(inserts).toHaveLength(1); // 02-01 only; 02-08 already has an `off`
    const body = JSON.parse(inserts[0]);
    expect(body.summary).toBe('off');
    expect(body.start).toEqual({ dateTime: '2099-02-01T08:30:00', timeZone: 'Asia/Seoul' });
  });
});
