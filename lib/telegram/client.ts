// Server-only Telegram Bot API client (phase 2b). Never logs the token or the
// full request URL — only HTTP status / generic error strings.
if (typeof window !== 'undefined') {
  throw new Error('lib/telegram/client.ts is server-only');
}

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
const TRUNCATE_TO = 4000;
const TIMEOUT_MS = 5000;

export interface SendResult {
  ok: boolean;
  error?: string;
}

/** Sends `text` to the configured chat (or `chatId` override). Never throws. */
export async function sendMessage(text: string, opts?: { chatId?: string }): Promise<SendResult> {
  const config = telegramConfig();
  if (!config) return { ok: false, error: 'not configured' };
  // `next dev` reads the same .env.local as production, so local test posts once sent
  // real alerts (a fictional E2E revision mail reached the owner). Opt in explicitly.
  if (process.env.NODE_ENV === 'development' && process.env.TELEGRAM_DEV_SEND !== '1') {
    return { ok: false, error: 'dev: not sent (set TELEGRAM_DEV_SEND=1)' };
  }

  const body = text.length > MAX_LEN ? `${text.slice(0, TRUNCATE_TO)}…` : text;
  try {
    const res = await fetch(`https://api.telegram.org/bot${config.token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: opts?.chatId ?? config.chatId,
        text: body,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return { ok: false, error: `telegram http ${res.status}` };
    return { ok: true };
  } catch {
    return { ok: false, error: 'network error' };
  }
}
