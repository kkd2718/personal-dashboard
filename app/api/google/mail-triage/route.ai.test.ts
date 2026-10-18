import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeClient, message, text } from '@/lib/ask/fixtures';

const meta = new Map<string, unknown>();
const fakeRepo = {
  getMeta: vi.fn(async (k: string) => (meta.has(k) ? meta.get(k) : null)),
  setMeta: vi.fn(async (k: string, v: unknown) => void meta.set(k, v)),
  listMetaByPrefix: vi.fn(async (p: string) => Object.fromEntries([...meta].filter(([k]) => k.startsWith(p)))),
  deleteMeta: vi.fn(async (k: string) => void meta.delete(k)),
  listProjects: vi.fn(async () => []),
};
vi.mock('@/lib/repo', () => ({ getRepo: () => fakeRepo }));

type Sent = { ok: boolean; error?: string; status?: number };
const sendResults: Sent[] = [];
const sendMessage = vi.fn<(text: string, opts?: { replyMarkup?: unknown }) => Promise<Sent>>(async () => sendResults.shift() ?? { ok: true });
vi.mock('@/lib/telegram/client', () => ({ sendMessage: (t: string, o?: { replyMarkup?: unknown }) => sendMessage(t, o), telegramConfig: () => ({}) }));
vi.mock('@/lib/ai/jev', () => ({ jevToken: () => null, createJev: () => null }));

let summaryReply = message([text('리뷰 요청, 10/30까지')]);
vi.mock('@/lib/ask/client', () => ({
  createAskClient: () => fakeClient([summaryReply]).client,
}));

const TOKEN = 'sync-token';
const msg = (id: string, o: Record<string, unknown> = {}) => ({
  messageId: id,
  threadId: `t${id}`,
  from: 'Someone <someone@sender.example.org>',
  subject: `Subject ${id}`,
  receivedAt: '2026-10-15T00:00:00.000Z',
  link: `https://mail.google.com/mail/#all/t${id}`,
  snippet: '10/30까지 리뷰 부탁드립니다',
  ...o,
});
const post = (messages: unknown[]) =>
  new Request('http://localhost/api/google/mail-triage', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ account: 'a', messages }),
  });

beforeEach(() => {
  vi.clearAllMocks();
  meta.clear();
  sendResults.length = 0;
  summaryReply = message([text('리뷰 요청, 10/30까지')]);
  meta.set('mail:triage:config', { allow: ['sender.example.org'] });
  process.env.GOOGLE_SYNC_TOKEN = TOKEN;
});

describe('mail-triage with the AI extras', () => {
  it('one message per mail with summary and buttons', async () => {
    const { POST } = await import('./route');
    const res = await POST(post([msg('m1', { threadId: 'x1' }), msg('m2', { threadId: 'x2', subject: 'Other' })]));
    expect(await res.json()).toMatchObject({ ok: true, processed: 2, alerted: 2 });
    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(sendMessage.mock.calls[0][0]).toContain('🧾 리뷰 요청, 10/30까지');
    expect(sendMessage.mock.calls[0][1]?.replyMarkup).toMatchObject({ inline_keyboard: [[{ text: '작업 준비 요청' }, { text: '답장 초안' }]] });
    expect([...meta.keys()].filter((k) => k.startsWith('telegram:pending:'))).toHaveLength(2);
  });

  it('a failed summary still sends the plain alert with buttons', async () => {
    summaryReply = message([]);
    const { POST } = await import('./route');
    await POST(post([msg('m1')]));
    expect(sendMessage.mock.calls[0][0]).not.toContain('🧾');
    expect(sendMessage.mock.calls[0][1]?.replyMarkup).toBeTruthy();
  });

  it('a retryable failure on the second mail answers 502 but records the first as alerted', async () => {
    sendResults.push({ ok: true }, { ok: false, status: 500 });
    const { POST } = await import('./route');
    const res = await POST(post([msg('m1', { threadId: 'x1' }), msg('m2', { threadId: 'x2' })]));
    expect(res.status).toBe(502);
    const seen = (meta.get('mail:triage:seen:a') as string[]) ?? [];
    expect(seen).not.toContain('m2'); // unsent mail is resent next run
    const alerted = [...meta].find(([k]) => k.startsWith('mail:triage:alerted:'))?.[1] as string[];
    expect(alerted).toHaveLength(1);
  });

  it('a permanent failure (4xx) marks everything seen and reports the error', async () => {
    sendResults.push({ ok: false, status: 400, error: 'bad' });
    const { POST } = await import('./route');
    const res = await POST(post([msg('m1')]));
    expect(await res.json()).toMatchObject({ ok: true, alerted: 0, error: 'bad' });
    expect(meta.get('mail:triage:seen:a')).toContain('m1');
  });
});
