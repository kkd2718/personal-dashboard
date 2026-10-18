// Server-only Anthropic client wrapper for /ask. Never logs the key or message text.
// SDK shapes verified against @anthropic-ai/sdk 0.135.0 (2026-10-18): `Anthropic.Messages.*`
// types, `tool_choice: {type:'none'}` exists, `usage.cache_creation` splits 5m/1h writes.
// Thinking params differ per model (see MODEL_SETTINGS in lib/logic/ask-cost.ts).
if (typeof window !== 'undefined') {
  throw new Error('lib/ask/client.ts is server-only');
}

import Anthropic from '@anthropic-ai/sdk';

export type { AskModel } from '@/lib/logic/ask-cost';
export { MODEL_SETTINGS } from '@/lib/logic/ask-cost';

export type AskMessage = Anthropic.Messages.Message;
export type AskCreateParams = Anthropic.Messages.MessageCreateParamsNonStreaming;

export interface AskClient {
  create(params: AskCreateParams, opts?: { timeoutMs?: number }): Promise<AskMessage>;
}

/** null without `ANTHROPIC_API_KEY` (every /ask feature then degrades to a notice). */
export function createAskClient(env: Record<string, string | undefined> = process.env): AskClient | null {
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  const client = new Anthropic({ apiKey, maxRetries: 1, timeout: 25_000 });
  return { create: (params, opts) => client.messages.create(params, opts?.timeoutMs ? { timeout: opts.timeoutMs } : undefined) };
}
