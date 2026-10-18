// /ask follow-up conversation (app_meta `ask:conv`). Only final texts are kept — no tool
// payloads — so a follow-up never reuses stale dashboard data. Pure.
export const ASK_CONV_META_KEY = 'ask:conv';
export const CONV_TTL_MIN = 30;
export const CONV_MAX_TURNS = 6; // user+assistant pairs
const MAX_BOT_IDS = 20;

export interface AskConv {
  id: string;
  updatedAt: string; // ISO
  turns: Array<{ role: 'user' | 'assistant'; text: string }>;
  botMessageIds: number[];
  /** Model that answered last — a follow-up reuses it (subject to the budget rules). */
  lastModel?: string;
}

/** True when the message replies to one of the bot's answers within the TTL. */
export function isFollowUp(conv: AskConv | null, replyToMessageId: number | null, now: string): boolean {
  if (!conv || replyToMessageId === null) return false;
  if (!conv.botMessageIds.includes(replyToMessageId)) return false;
  return Date.parse(now) - Date.parse(conv.updatedAt) <= CONV_TTL_MIN * 60_000;
}

/** Adds one user+assistant pair, keeping the last CONV_MAX_TURNS pairs and 20 bot message ids. */
export function appendTurn(
  conv: AskConv | null,
  user: string,
  assistant: string,
  botMessageIds: number[],
  now: string,
  newId: () => string,
  lastModel?: string
): AskConv {
  const turns = [...(conv?.turns ?? []), { role: 'user' as const, text: user }, { role: 'assistant' as const, text: assistant }];
  const model = lastModel ?? conv?.lastModel;
  return {
    id: conv?.id ?? newId(),
    updatedAt: now,
    turns: turns.slice(-CONV_MAX_TURNS * 2),
    botMessageIds: [...(conv?.botMessageIds ?? []), ...botMessageIds].slice(-MAX_BOT_IDS),
    ...(model ? { lastModel: model } : {}),
  };
}

/** Prior turns as plain text plus the new question. */
export function toMessages(
  conv: AskConv | null,
  question: string
): Array<{ role: 'user' | 'assistant'; content: string }> {
  return [...(conv?.turns ?? []).map((t) => ({ role: t.role, content: t.text })), { role: 'user' as const, content: question }];
}
