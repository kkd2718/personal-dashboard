import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeClient, message, text } from '@/lib/ask/fixtures';

const meta = new Map<string, unknown>();
const stored: Array<Record<string, unknown>> = [];
let breakProjects = false;
const fakeRepo = {
  listReviewCandidates: vi.fn(async (status?: string) => stored.filter((c) => !status || c.status === status)),
  upsertReviewCandidates: vi.fn(async (list: Array<Record<string, unknown>>) => {
    const rows = list.map((c) => ({ ...c, id: `rc-${c.messageId}`, status: 'pending', reviewId: null, createdAt: 't', updatedAt: 't' }));
    stored.push(...rows);
    return rows;
  }),
  updateReviewCandidate: vi.fn(async () => ({})),
  listReviews: vi.fn(async () => []),
  updateReview: vi.fn(async () => ({})),
  listDeadlines: vi.fn(async () => []),
  listPapers: vi.fn(async () => []),
  listProjects: vi.fn(async () => {
    if (breakProjects) throw new Error('db down');
    return [];
  }),
  getMeta: vi.fn(async (k: string) => (meta.has(k) ? structuredClone(meta.get(k)) : null)),
  setMeta: vi.fn(async (k: string, v: unknown) => void meta.set(k, structuredClone(v))),
  listMetaByPrefix: vi.fn(async (p: string) => Object.fromEntries([...meta].filter(([k]) => k.startsWith(p)))),
  deleteMeta: vi.fn(async (k: string) => void meta.delete(k)),
};
vi.mock('@/lib/repo', () => ({ getRepo: () => fakeRepo }));
vi.mock('@/lib/ai/jev', () => ({ jevToken: () => null, createJev: () => null }));

const sends: Array<{ text: string; markup?: unknown }> = [];
vi.mock('@/lib/telegram/client', () => ({
  sendMessage: async (t: string, o?: { replyMarkup?: unknown }) => (sends.push({ text: t, markup: o?.replyMarkup }), { ok: true }),
  telegramConfig: () => ({}),
}));
const fc = fakeClient([message([text('리뷰 초대, 10/15까지')])]);
vi.mock('@/lib/ask/client', () => ({ createAskClient: () => fc.client }));

import { POST } from './route';

const TOKEN = 'sync-token';
// A forwarded revision letter: the candidate kind that is pushed to Telegram.
const invite = (n: number, extra = '') => ({
  messageId: `m${n}`,
  threadId: `t${n}`,
  receivedAt: '2026-09-20T02:00:00.000Z',
  from: '"Fictional Professor" <professor@fictional-university.test>',
  subject: `Fwd: Decision on your manuscript FOM-2026-447${n}`,
  body: [
    '---------- Forwarded message ----------',
    'From: Fictional Oncology Journal <em@fictional-oncology-press.test>',
    `Subject: Decision on your manuscript FOM-2026-447${n}`,
    '',
    `Dear Author, we have reached a decision on your manuscript entitled "Fictional Study ${n}" (FOM-2026-447${n}) for Fictional Oncology Journal: Major Revision. ${extra}`,
    'Please submit your revision within 60 days.',
  ].join('\n'),
});
const post = (mails: unknown[]) =>
  POST(
    new Request('http://localhost/api/google/sync', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ account: 'a', mails }),
    })
  );

beforeEach(() => {
  vi.clearAllMocks();
  meta.clear();
  stored.length = 0;
  sends.length = 0;
  fc.calls.length = 0;
  breakProjects = false;
  process.env.GOOGLE_SYNC_TOKEN = TOKEN;
  delete process.env.CLOUD_URL;
});

describe('review-candidate alerts with the AI extras', () => {
  it('one alert with summary and buttons; attachment names never reach Claude or the pending record', async () => {
    const res = await post([invite(1, 'Please see the attached secret-protocol.pdf and data_sheet.xlsx. ')]);
    expect(res.status).toBe(200);
    expect(sends).toHaveLength(1);
    expect(sends[0].text).toContain('🧾 리뷰 초대, 10/15까지');
    expect(sends[0].markup).toBeTruthy();
    expect(JSON.stringify(fc.calls)).not.toContain('secret-protocol.pdf');
    expect(JSON.stringify(fc.calls)).not.toContain('data_sheet.xlsx');
    const pending = [...meta].filter(([k]) => k.startsWith('telegram:pending:'));
    expect(pending).toHaveLength(1);
    expect(JSON.stringify(pending[0][1])).not.toContain('.pdf');
    expect(JSON.stringify(pending[0][1])).not.toContain('.xlsx');
  });

  it('if project/paper reads throw, the plain batch alert is still sent and sync completes', async () => {
    breakProjects = true;
    const res = await post([invite(1), invite(2)]);
    expect(res.status).toBe(200);
    expect(sends).toHaveLength(1);
    expect(sends[0].markup).toBeUndefined();
    expect(sends[0].text).toContain('FOM-2026-4471');
    expect(sends[0].text).toContain('FOM-2026-4472');
  });

  it('candidates beyond the fourth get one 외 N건 line', async () => {
    process.env.CLOUD_URL = 'https://dash.example.org';
    await post([1, 2, 3, 4, 5, 6].map((n) => invite(n)));
    expect(sends).toHaveLength(5);
    expect(sends.slice(0, 4).every((s) => s.markup)).toBe(true);
    expect(sends[4].text).toBe('…외 2건 · https://dash.example.org/papers?tab=review');
    expect(sends[4].markup).toBeUndefined();
  });

  it('summaries are requested one at a time (sequential ledger updates)', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const slow = {
      create: async () => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight--;
        return message([text('요약')]);
      },
    };
    fc.client.create = slow.create as never;
    await post([1, 2, 3].map((n) => invite(n)));
    expect(maxInFlight).toBe(1);
  });
});
