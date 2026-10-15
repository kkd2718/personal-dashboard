import { beforeEach, describe, expect, it, vi } from 'vitest';

const meta = new Map<string, unknown>();
const fakeRepo = {
  getMeta: vi.fn(async (k: string) => (meta.has(k) ? meta.get(k) : null)),
  setMeta: vi.fn(async (k: string, v: unknown) => void meta.set(k, v)),
  listMetaByPrefix: vi.fn(async (p: string) => Object.fromEntries([...meta].filter(([k]) => k.startsWith(p)))),
  deleteMeta: vi.fn(async (k: string) => void meta.delete(k)),
};
vi.mock('@/lib/repo', () => ({ getRepo: () => fakeRepo }));
type Sent = { ok: boolean; error?: string; status?: number };
const OK: Sent = { ok: true };
let sendResult: Sent = OK;
const sendMessage = vi.fn<(text: string) => Promise<Sent>>(async () => sendResult);
vi.mock('@/lib/telegram/client', () => ({ sendMessage: (t: string) => sendMessage(t), telegramConfig: () => ({}) }));

// Fake Jev: records the state it was asked about and answers with the current `attention`.
let attention = 0.9;
const asked: string[] = [];
vi.mock('@/lib/ai/jev', () => ({
  jevToken: () => 'k',
  createJev: () => ({
    ask: async (state: string) => {
      asked.push(state);
      return { attention: { type: 'noul', p: attention } };
    },
  }),
}));

const TOKEN = 'sync-token';
const msg = (o: Record<string, unknown> = {}) => ({
  messageId: 'm1',
  threadId: 't1',
  from: 'Someone <someone@sender.example.org>',
  subject: 'Please review',
  receivedAt: '2026-10-15T00:00:00.000Z',
  link: 'https://mail.google.com/mail/#all/t1',
  ...o,
});
const post = (body: unknown, token: string | null = TOKEN) =>
  new Request('http://localhost/api/google/mail-triage', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  vi.clearAllMocks();
  meta.clear();
  asked.length = 0;
  attention = 0.9;
  sendResult = OK;
  process.env.GOOGLE_SYNC_TOKEN = TOKEN;
});

describe('POST /api/google/mail-triage', () => {
  it('503 without a server token, 401 with a wrong one', async () => {
    const { POST } = await import('./route');
    delete process.env.GOOGLE_SYNC_TOKEN;
    expect((await POST(post({ account: 'a', messages: [] }))).status).toBe(503);
    process.env.GOOGLE_SYNC_TOKEN = TOKEN;
    expect((await POST(post({ account: 'a', messages: [] }, 'bad'))).status).toBe(401);
  });

  it('rejects unexpected keys such as attachments', async () => {
    const { POST } = await import('./route');
    const res = await POST(post({ account: 'a', messages: [msg({ attachments: ['x.pdf'] })] }));
    expect(res.status).toBe(400);
    expect((await POST(post({ account: 'a', messages: [msg({ link: 'https://evil.test/' })] }))).status).toBe(400);
  });

  it('allow-listed sender alerts without calling Jev; deny-listed never does', async () => {
    const { POST } = await import('./route');
    meta.set('mail:triage:config', { allow: ['sender.example.org'], deny: ['bad.example.org'] });
    const res = await POST(
      post({ account: 'a', messages: [msg(), msg({ messageId: 'm2', from: 'x@bad.example.org', subject: 'spam' })] })
    );
    expect(await res.json()).toEqual({ ok: true, processed: 2, alerted: 1 });
    expect(asked).toHaveLength(0);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0][0]).toContain('Please review');
  });

  it('Jev threshold: 0.69 stays quiet, 0.71 alerts', async () => {
    const { POST } = await import('./route');
    attention = 0.69;
    await POST(post({ account: 'a', messages: [msg()] }));
    expect(sendMessage).not.toHaveBeenCalled();
    attention = 0.71;
    await POST(post({ account: 'a', messages: [msg({ messageId: 'm2', subject: 'Another' })] }));
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it('snippets: stripped of file names; dropped for a kill-switched account', async () => {
    const { POST } = await import('./route');
    const snippet = '결과는 첨부 scan.pdf 확인';
    await POST(post({ account: 'amc', messages: [msg({ snippet })] }));
    expect(asked[0]).toContain('내용: 결과는 첨부 확인');
    expect(asked[0]).not.toContain('.pdf');

    asked.length = 0;
    meta.set('mail:triage:config', { noBodyAccounts: ['main'] });
    await POST(post({ account: 'main', messages: [msg({ messageId: 'm9', subject: 'Other', snippet })] }));
    expect(asked[0]).not.toContain('내용:');
  });

  it('the same message id twice is processed once; the same letter in two accounts alerts once a day', async () => {
    const { POST } = await import('./route');
    await POST(post({ account: 'a', messages: [msg()] }));
    const again = await (await POST(post({ account: 'a', messages: [msg()] }))).json();
    expect(again).toMatchObject({ processed: 0, alerted: 0 });
    await POST(post({ account: 'b', messages: [msg({ messageId: 'other-id', subject: 'Fwd: Please review' })] }));
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it('budget exhausted: no Jev call, one cap notice per day', async () => {
    const { POST } = await import('./route');
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
    meta.set(`jev:count:mail:${today}`, 300);
    await POST(post({ account: 'a', messages: [msg()] }));
    await POST(post({ account: 'a', messages: [msg({ messageId: 'm2', subject: 'More' })] }));
    expect(asked).toHaveLength(0);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0][0]).toContain('한도');
  });

  it('a retryable Telegram failure (429/5xx/network) answers 502 and the mail is retried, not lost', async () => {
    const { POST } = await import('./route');
    meta.set('mail:triage:config', { allow: ['sender.example.org'] });
    for (const failure of [{ ok: false, status: 429 }, { ok: false, status: 503 }, { ok: false, error: 'network error' }]) {
      sendResult = failure;
      expect((await POST(post({ account: 'a', messages: [msg()] }))).status).toBe(502);
    }
    sendResult = OK;
    const retry = await (await POST(post({ account: 'a', messages: [msg()] }))).json();
    expect(retry).toMatchObject({ processed: 1, alerted: 1 });
  });

  it('a 4xx marks the batch seen: 200 with the error, no resend, error on the integration row', async () => {
    const { POST } = await import('./route');
    meta.set('mail:triage:config', { allow: ['sender.example.org'] });
    sendResult = { ok: false, status: 400, error: 'telegram http 400' };
    const res = await POST(post({ account: 'a', messages: [msg()] }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, alerted: 0, error: 'telegram http 400' });
    expect((meta.get('integration:mail:a') as { detail: string }).detail).toContain('telegram http 400');
    sendResult = OK;
    expect(await (await POST(post({ account: 'a', messages: [msg()] }))).json()).toMatchObject({ processed: 0 });
  });

  it('the link is HTML-escaped and old alerted lists are pruned', async () => {
    const { POST } = await import('./route');
    meta.set('mail:triage:config', { allow: ['sender.example.org'] });
    meta.set('mail:triage:alerted:2020-01-01', ['x']);
    await POST(post({ account: 'a', messages: [msg({ link: 'https://mail.google.com/mail/?a=1&b=2#all/t1' })] }));
    expect(sendMessage.mock.calls[0][0]).toContain('a=1&amp;b=2');
    expect(meta.has('mail:triage:alerted:2020-01-01')).toBe(false);
  });
});
