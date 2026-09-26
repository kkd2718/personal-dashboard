import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const ORIGINAL_ENV = {
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID,
  TELEGRAM_WEBHOOK_SECRET: process.env.TELEGRAM_WEBHOOK_SECRET,
};
const CHAT_ID = 12345;
const SECRET = 'test-webhook-secret';

const createNote = vi.fn(async (input: Record<string, unknown>) => ({
  id: 'n1',
  body: input.body,
  kind: input.kind,
  status: 'inbox',
  projectId: input.projectId ?? null,
  tags: input.tags ?? [],
  date: input.date ?? null,
  pinned: false,
  source: input.source,
  deliveredAt: null,
  taskId: null,
  createdAt: 't',
  updatedAt: 't',
}));
const fakeRepo = {
  listProjects: vi.fn(async () => []),
  listNotes: vi.fn(async () => []),
  createNote,
  listTasks: vi.fn(async () => []),
  listDeadlines: vi.fn(async () => []),
  listReviews: vi.fn(async () => []),
  getStatusSnapshot: vi.fn(async () => null),
  setMeta: vi.fn(async () => {}),
};

vi.mock('@/lib/repo', () => ({ getRepo: () => fakeRepo }));
vi.mock('@/lib/telegram/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/telegram/client')>();
  return { ...actual, sendMessage: vi.fn(async () => ({ ok: true })) };
});

beforeEach(() => {
  vi.clearAllMocks();
  process.env.TELEGRAM_BOT_TOKEN = 'test-token';
  process.env.TELEGRAM_CHAT_ID = String(CHAT_ID);
  process.env.TELEGRAM_WEBHOOK_SECRET = SECRET;
});

afterEach(() => {
  Object.assign(process.env, ORIGINAL_ENV);
});

const NO_HEADER = Symbol('no-header');

function req(body: unknown, secret: string | typeof NO_HEADER = SECRET): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (secret !== NO_HEADER) headers['x-telegram-bot-api-secret-token'] = secret;
  return new Request('http://localhost/api/telegram/webhook', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

function update(chatId: number, text: string) {
  return { message: { chat: { id: chatId, type: 'private' }, text } };
}

describe('POST /api/telegram/webhook', () => {
  it('503s when telegram env is not configured', async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    const { POST } = await import('./route');
    const res = await POST(req(update(CHAT_ID, 'hi')));
    expect(res.status).toBe(503);
  });

  it('401s on a missing/wrong secret header', async () => {
    const { POST } = await import('./route');
    expect((await POST(req(update(CHAT_ID, 'hi'), 'wrong'))).status).toBe(401);
    expect((await POST(req(update(CHAT_ID, 'hi'), NO_HEADER))).status).toBe(401);
  });

  it('200s with no write for a chat id other than the configured one', async () => {
    const { POST } = await import('./route');
    const res = await POST(req(update(999, 'a memo')));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(createNote).not.toHaveBeenCalled();
  });

  it('captures a plain-text message as a note with source telegram', async () => {
    const { POST } = await import('./route');
    const res = await POST(req(update(CHAT_ID, 'buy milk')));
    expect(res.status).toBe(200);
    expect(createNote).toHaveBeenCalledTimes(1);
    expect(createNote.mock.calls[0][0]).toMatchObject({ body: 'buy milk', source: 'telegram' });
  });
});
