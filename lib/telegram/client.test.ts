import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sendMessage } from './client';

const calls: Array<Record<string, unknown>> = [];
let responder: (body: Record<string, unknown>) => Response;

beforeEach(() => {
  calls.length = 0;
  process.env.TELEGRAM_BOT_TOKEN = 't';
  process.env.TELEGRAM_CHAT_ID = '1';
  process.env.TELEGRAM_WEBHOOK_SECRET = 's';
  vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => {
    const body = JSON.parse(init.body) as Record<string, unknown>;
    calls.push(body);
    return responder(body);
  });
  responder = () => new Response(JSON.stringify({ ok: true, result: { message_id: 5 } }));
});
afterEach(() => vi.unstubAllGlobals());

describe('sendMessage', () => {
  it('a parse-entities 400 is retried once as plain text', async () => {
    responder = (b) =>
      b.parse_mode
        ? new Response(JSON.stringify({ ok: false, description: "Bad Request: can't parse entities: Unsupported start tag" }), { status: 400 })
        : new Response(JSON.stringify({ ok: true, result: { message_id: 9 } }));
    const res = await sendMessage('<b>안녕</b> a &lt; b');
    expect(res).toMatchObject({ ok: true, messageId: 9 });
    expect(calls).toHaveLength(2);
    expect(calls[1].text).toBe('안녕 a < b');
    expect(calls[1].parse_mode).toBeUndefined();
  });

  it('other 400s are not retried', async () => {
    responder = () => new Response(JSON.stringify({ description: 'Bad Request: chat not found' }), { status: 400 });
    expect(await sendMessage('hi')).toMatchObject({ ok: false, status: 400 });
    expect(calls).toHaveLength(1);
  });

  it('text over 4096 chars is sent as several tag-safe messages, keyboard on the last', async () => {
    const long = `<b>${'가나다라 '.repeat(1500)}</b>`;
    const markup = { inline_keyboard: [[{ text: 'x', callback_data: 'y' }]] };
    const res = await sendMessage(long, { replyMarkup: markup });
    expect(res.ok).toBe(true);
    expect(calls.length).toBeGreaterThan(1);
    for (const c of calls) {
      const t = c.text as string;
      expect(t.length).toBeLessThanOrEqual(4096);
      expect((t.match(/<b>/g) ?? []).length).toBe((t.match(/<\/b>/g) ?? []).length); // never cut mid-tag
    }
    expect(calls.at(-1)!.reply_markup).toEqual(markup);
    expect(calls[0].reply_markup).toBeUndefined();
  });

  it('a failing chunk stops the rest', async () => {
    responder = () => new Response('{}', { status: 500 });
    const res = await sendMessage('가 '.repeat(5000));
    expect(res.ok).toBe(false);
    expect(calls).toHaveLength(1);
  });
});
