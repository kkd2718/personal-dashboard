import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeRepo } from '@/lib/ask/fixtures';
import { ASK_CONV_META_KEY, type AskConv } from '@/lib/logic/ask-conv';

const h = vi.hoisted(() => ({
  afterCbs: [] as Array<() => unknown>,
  runAsk: vi.fn<(deps: unknown, req: unknown) => Promise<void>>(async () => {}),
  handleFreeText: vi.fn<(deps: unknown, text: string) => Promise<void>>(async () => {}),
  handleCallback: vi.fn<(deps: unknown, cb: unknown) => Promise<void>>(async () => {}),
  sendMessage: vi.fn<(text: string) => Promise<{ ok: boolean }>>(async () => ({ ok: true })),
  repo: null as unknown,
}));

vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), after: (cb: () => unknown) => void h.afterCbs.push(cb) }));
vi.mock('@/lib/repo', () => ({ getRepo: () => h.repo }));
vi.mock('@/lib/ask/run', () => ({ runAsk: h.runAsk }));
vi.mock('@/lib/ask/client', () => ({ createAskClient: () => ({ create: async () => ({}) }) }));
vi.mock('@/lib/telegram/ax', () => ({ handleFreeText: h.handleFreeText, handleCallback: h.handleCallback }));
vi.mock('@/app/actions/revalidate', () => ({ revalidateAll: () => {} }));
vi.mock('@/lib/telegram/client', () => ({
  telegramConfig: () => ({ token: 't', chatId: '5', secret: 'sec' }),
  sendMessage: h.sendMessage,
  sendChatAction: async () => ({ ok: true }),
  editMessageText: async () => ({ ok: true }),
  answerCallbackQuery: async () => ({ ok: true }),
}));

import { POST } from './route';

let updateId = 0;
const post = (message: Record<string, unknown>, id = ++updateId) =>
  POST(
    new Request('http://localhost/api/telegram/webhook', {
      method: 'POST',
      headers: { 'x-telegram-bot-api-secret-token': 'sec' },
      body: JSON.stringify({ update_id: id, message: { chat: { id: 5 }, ...message } }),
    })
  );

const conv = (over: Partial<AskConv> = {}): AskConv => ({
  id: 'c1',
  updatedAt: new Date().toISOString(),
  turns: [],
  botMessageIds: [101],
  lastModel: 'claude-haiku-5-5',
  ...over,
});

beforeEach(() => {
  h.afterCbs.length = 0;
  vi.clearAllMocks();
  h.repo = fakeRepo().repo;
});

describe('telegram webhook /ask', () => {
  it('/ask answers 200 before runAsk runs; the work happens in after()', async () => {
    const res = await post({ text: '/ask 이번 주 마감?' });
    expect(res.status).toBe(200);
    expect(h.runAsk).not.toHaveBeenCalled();
    expect(h.afterCbs).toHaveLength(1);
    await h.afterCbs[0]();
    expect(h.runAsk).toHaveBeenCalledWith(expect.anything(), { question: '이번 주 마감?', modifier: null, followUp: false });
    expect(h.handleFreeText).not.toHaveBeenCalled();
  });

  it('/ask! and /ask+ carry their modifier', async () => {
    await post({ text: '/ask! 계획 세워줘' });
    await post({ text: '/ask+ 요약해줘' });
    for (const cb of h.afterCbs) await cb();
    expect(h.runAsk.mock.calls.map((c) => c[1])).toEqual([
      { question: '계획 세워줘', modifier: '!', followUp: false },
      { question: '요약해줘', modifier: '+', followUp: false },
    ]);
  });

  it('a runAsk rejection inside after() is swallowed (never an unhandled rejection)', async () => {
    h.runAsk.mockRejectedValueOnce(new Error('boom'));
    await post({ text: '/ask x' });
    await expect(Promise.resolve(h.afterCbs[0]())).resolves.toBeUndefined();
  });

  it('a reply to a recent bot answer is a follow-up, not a memo', async () => {
    h.repo = fakeRepo({ meta: { [ASK_CONV_META_KEY]: conv() } }).repo;
    const res = await post({ text: '그 중 제일 급한 건?', reply_to_message: { message_id: 101 } });
    expect(res.status).toBe(200);
    await h.afterCbs[0]();
    expect(h.runAsk).toHaveBeenCalledWith(expect.anything(), { question: '그 중 제일 급한 건?', modifier: null, followUp: true });
    expect(h.handleFreeText).not.toHaveBeenCalled();
  });

  it('a stale or unknown reply, and plain text, still go to the AX/memo flow', async () => {
    h.repo = fakeRepo({ meta: { [ASK_CONV_META_KEY]: conv({ updatedAt: '2020-01-01T00:00:00.000Z' }) } }).repo;
    await post({ text: '오래된 답장', reply_to_message: { message_id: 101 } });
    h.repo = fakeRepo({ meta: { [ASK_CONV_META_KEY]: conv() } }).repo;
    await post({ text: '모르는 답장', reply_to_message: { message_id: 999 } });
    await post({ text: '그냥 메모' });
    expect(h.afterCbs).toHaveLength(0);
    expect(h.runAsk).not.toHaveBeenCalled();
    expect(h.handleFreeText.mock.calls.map((c) => c[1])).toEqual(['오래된 답장', '모르는 답장', '그냥 메모']);
  });

  it('a duplicate update_id is ignored', async () => {
    await post({ text: '/ask a' }, 777);
    await post({ text: '/ask a' }, 777);
    expect(h.afterCbs).toHaveLength(1);
  });

  it('/budget answers synchronously without an API call', async () => {
    await post({ text: '/budget' });
    expect(h.afterCbs).toHaveLength(0);
    expect(h.runAsk).not.toHaveBeenCalled();
    expect(h.sendMessage.mock.calls[0][0]).toContain('/ask 예산');
  });
});
