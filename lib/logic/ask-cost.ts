// Claude API prices and per-call cost math for /ask. Pure.
// Thinking tokens are billed as output (they are included in `output_tokens`).
export type AskModel = 'claude-haiku-5-5' | 'claude-sonnet-5-5' | 'claude-opus-5-5';

/** USD per 1M tokens. */
export interface Rates {
  input: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  cacheRead: number;
  output: number;
}

/** `longContext` rates apply to the WHOLE request once its prompt (input + cache write + cache read) exceeds `overTokens`. */
export interface Price extends Rates {
  longContext?: { overTokens: number; rates: Rates };
}

export const ASK_MODELS: readonly AskModel[] = ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5'];

/** Official prices (lead-supplied 2026-10-18). `ASK_PRICES_JSON` overrides per model. */
export const PRICES: Record<AskModel, Price | null> = {
  'claude-opus-5-5': { input: 4, cacheWrite5m: 5, cacheWrite1h: 8, cacheRead: 0.2, output: 20 },
  'claude-sonnet-5-5': { input: 2, cacheWrite5m: 2.5, cacheWrite1h: 4, cacheRead: 0.1, output: 10 },
  'claude-haiku-5-5': {
    input: 0.1,
    cacheWrite5m: 0.125,
    cacheWrite1h: 0.2,
    cacheRead: 0.01,
    output: 0.5,
    longContext: { overTokens: 100_000, rates: { input: 0.5, cacheWrite5m: 0.625, cacheWrite1h: 1, cacheRead: 0.05, output: 2.5 } },
  },
};

export interface ModelSettings {
  maxTokens: number;
  thinking: { type: 'disabled' } | { type: 'between_tools' } | { type: 'adaptive' };
  effort?: 'low' | 'medium' | 'high';
}

/** Output cap and thinking mode per model. Verified live 2026-10-18: Haiku accepts `disabled`; Sonnet 5.5
 * rejects it and wants `between_tools` (no thinking before answering); Opus 5.5 only takes `adaptive`
 * + `output_config.effort` (neither `disabled` nor `enabled`+budget). */
export const MODEL_SETTINGS: Record<AskModel, ModelSettings> = {
  'claude-haiku-5-5': { maxTokens: 1500, thinking: { type: 'disabled' } },
  'claude-sonnet-5-5': { maxTokens: 3000, thinking: { type: 'between_tools' } },
  'claude-opus-5-5': { maxTokens: 8000, thinking: { type: 'adaptive' }, effort: 'medium' },
};

const isRate = (r: unknown): r is Rates =>
  !!r && typeof r === 'object' && ['input', 'output', 'cacheWrite5m', 'cacheRead'].every((k) => typeof (r as Record<string, unknown>)[k] === 'number');

/** Built-in prices; `ASK_PRICES_JSON` (`{"<model>": {input,output,cacheWrite5m,cacheRead[,cacheWrite1h,longContext]}}`) replaces a model's entry. */
export function loadPrices(env: Record<string, string | undefined> = process.env): Record<AskModel, Price | null> {
  const out = { ...PRICES };
  if (!env.ASK_PRICES_JSON) return out;
  try {
    const raw = JSON.parse(env.ASK_PRICES_JSON) as Record<string, unknown>;
    for (const model of ASK_MODELS) {
      const r = raw[model];
      if (isRate(r)) out[model] = { ...r, cacheWrite1h: (r as Partial<Rates>).cacheWrite1h ?? r.cacheWrite5m };
    }
  } catch {
    // malformed override: keep the built-in table
  }
  return out;
}

export function pricesKnown(p: Record<AskModel, Price | null>, model: AskModel): boolean {
  return p[model] !== null;
}

export interface UsageLike {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation?: { ephemeral_5m_input_tokens?: number; ephemeral_1h_input_tokens?: number } | null;
}

const rateFor = (price: Price, promptTokens: number): Rates =>
  price.longContext && promptTokens > price.longContext.overTokens ? price.longContext.rates : price;

/** USD for one API call; the 100k-prompt tier is decided per call. */
export function costUsd(price: Price, u: UsageLike): number {
  const created = u.cache_creation_input_tokens ?? 0;
  const read = u.cache_read_input_tokens ?? 0;
  const rate = rateFor(price, u.input_tokens + created + read);
  const w1h = Math.min(created, u.cache_creation?.ephemeral_1h_input_tokens ?? 0);
  const w5m = created - w1h;
  return (
    (u.input_tokens * rate.input +
      w5m * rate.cacheWrite5m +
      w1h * rate.cacheWrite1h +
      read * rate.cacheRead +
      u.output_tokens * rate.output) /
    1_000_000
  );
}

/** Upper bound for one call: `inputTokens` of fresh input plus the full `maxTokens` output. */
export function worstCaseUsd(price: Price, maxTokens: number, inputTokens = 20_000): number {
  const rate = rateFor(price, inputTokens);
  return (inputTokens * rate.input + maxTokens * rate.output) / 1_000_000;
}
