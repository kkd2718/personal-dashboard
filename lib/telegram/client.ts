// Server-only Telegram Bot API client (phase 2b). Never logs the token or the
// full request URL — only HTTP status / generic error strings.
if (typeof window !== 'undefined') {
  throw new Error('lib/telegram/client.ts is server-only');
}

import { splitTelegram } from '@/lib/logic/ask-text';

export interface TelegramConfig {
  token: string;
  chatId: string;
  secret: string;
}

/** Any of TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID/TELEGRAM_WEBHOOK_SECRET missing ->
 * null, meaning every Telegram feature is a silent no-op (see docs/PLAN_2b.md §0). */
export function telegramConfig(): TelegramConfig | null {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!token || !chatId || !secret) return null;
  return { token, chatId, secret };
}

const MAX_LEN = 4096;
const CHUNK = 4000;
const TIMEOUT_MS = 5000;

export interface SendResult {
  ok: boolean;
  error?: string;
  status?: number; // HTTP status of a failed Bot API call
  description?: string; // Bot API error description of a failed call (never contains the token)
  messageId?: number;
}

export type InlineKeyboard = { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> };

/** Shared Bot API call: config check, dev guard, 5 s timeout, never throws. */
async function call(method: string, body: Record<string, unknown>): Promise<SendResult> {
  const config = telegramConfig();
  if (!config) return { ok: false, error: 'not configured' };
  // `next dev` reads the same .env.local as production, so local test posts once sent
  // real alerts (a fictional E2E revision mail reached the owner). Opt in explicitly.
  if (process.env.NODE_ENV === 'development' && process.env.TELEGRAM_DEV_SEND !== '1') {
    return { ok: false, error: 'dev: not sent (set TELEGRAM_DEV_SEND=1)' };
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${config.token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => null)) as { description?: unknown } | null;
      return {
        ok: false,
        error: `telegram http ${res.status}`,
        status: res.status,
        ...(typeof err?.description === 'string' ? { description: err.description } : {}),
      };
    }
    const json = (await res.json().catch(() => null)) as { result?: { message_id?: unknown } } | null;
    const id = json?.result?.message_id;
    return { ok: true, messageId: typeof id === 'number' ? id : undefined };
  } catch {
    return { ok: false, error: 'network error' };
  }
}

/** Tag-free text for the retry after Telegram rejected the HTML. */
const plain = (html: string) =>
  html
    .replace(/<\/?[a-z][^>]*>/gi, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

const isEntityError = (r: SendResult) => r.status === 400 && /can't parse entities/i.test(r.description ?? '');

/** One message: a "can't parse entities" 400 is retried once as plain text so the content still arrives. */
async function sendOne(chatId: string | undefined, text: string, replyMarkup?: InlineKeyboard): Promise<SendResult> {
  const body = { chat_id: chatId, disable_web_page_preview: true, ...(replyMarkup ? { reply_markup: replyMarkup } : {}) };
  const res = await call('sendMessage', { ...body, text, parse_mode: 'HTML' });
  if (!isEntityError(res)) return res;
  return call('sendMessage', { ...body, text: plain(text) });
}

/** Sends `text` to the configured chat (or `chatId` override). Text over Telegram's limit goes as several
 * tag-safe messages (never clipped mid-tag); the keyboard rides on the last one. Never throws. */
export async function sendMessage(
  text: string,
  opts?: { chatId?: string; replyMarkup?: InlineKeyboard }
): Promise<SendResult> {
  const chatId = opts?.chatId ?? telegramConfig()?.chatId;
  const chunks = text.length > MAX_LEN ? splitTelegram(text, CHUNK) : [text];
  let last: SendResult = { ok: true };
  for (const [i, chunk] of chunks.entries()) {
    last = await sendOne(chatId, chunk, i === chunks.length - 1 ? opts?.replyMarkup : undefined);
    if (!last.ok) return last;
  }
  return last;
}

/** Edits a message sent to the configured chat; `replyMarkup` null/omitted removes the keyboard. */
export async function editMessageText(
  messageId: number,
  text: string,
  replyMarkup?: InlineKeyboard | null
): Promise<SendResult> {
  const config = telegramConfig();
  return call('editMessageText', {
    chat_id: config?.chatId,
    message_id: messageId,
    text: text.length > MAX_LEN ? `${splitTelegram(text, CHUNK)[0]}…` : text, // an edit can't span messages
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    reply_markup: replyMarkup ?? { inline_keyboard: [] },
  });
}

/** Shows the "typing…" indicator for ~5 s. */
export async function sendChatAction(action: 'typing' = 'typing'): Promise<SendResult> {
  return call('sendChatAction', { chat_id: telegramConfig()?.chatId, action });
}

export async function answerCallbackQuery(callbackId: string, text?: string): Promise<SendResult> {
  return call('answerCallbackQuery', { callback_query_id: callbackId, ...(text ? { text } : {}) });
}
