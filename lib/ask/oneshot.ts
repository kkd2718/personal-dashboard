// One-shot Claude call for the dashboard's small AI features (mail summary/draft, macro
// sentence): checks the paced budget for `feature` first, records spend in the shared ledger,
// and returns null on any doubt (no client, ahead of pace, exhausted, error, empty text).
import type { AskClient } from '@/lib/ask/client';
import { addSpend, loadSpend, type SpendRepo } from '@/lib/ask/spend';
import { budgetConfig, pace as paceOf, type Feature, type Pace } from '@/lib/logic/ask-budget';
import { MODEL_SETTINGS, loadPrices, worstCaseUsd, type AskModel } from '@/lib/logic/ask-cost';
import { extractText } from '@/lib/logic/ask-text';

export interface OneShotDeps {
  client: AskClient | null;
  repo: SpendRepo;
  today: string;
  env?: Record<string, string | undefined>;
}

export interface OneShotResult {
  text: string;
  model: AskModel;
  usd: number | null;
}

const HAIKU: AskModel = 'claude-haiku-5-5';
const SONNET: AskModel = 'claude-sonnet-5-5';

/** Pace for `feature` from the stored ledger (null when the ledger can't be read). */
export async function featurePace(deps: Pick<OneShotDeps, 'repo' | 'today' | 'env'>, feature: Feature): Promise<Pace | null> {
  try {
    const cfg = budgetConfig(deps.env ?? process.env);
    const ledger = await loadSpend(deps.repo, cfg, deps.today);
    return paceOf(cfg, deps.today, ledger.cycle.usd, feature);
  } catch {
    return null;
  }
}

/** Sonnet when it fits under the pace line (2x worst case, like /ask rule 4), else Haiku. */
export function pickModel(p: Pace, prices: ReturnType<typeof loadPrices>, preferSonnet: boolean): AskModel {
  const price = prices[SONNET];
  if (!preferSonnet || !price || p.ahead) return HAIKU;
  return p.spentUsd + 2 * worstCaseUsd(price, MODEL_SETTINGS[SONNET].maxTokens) > p.allowedUsd ? HAIKU : SONNET;
}

export async function oneShot(
  deps: OneShotDeps,
  feature: Feature,
  opts: { system: string; user: string; maxTokens: number; timeoutMs: number; preferSonnet?: boolean }
): Promise<OneShotResult | null> {
  if (!deps.client) return null;
  try {
    const env = deps.env ?? process.env;
    const p = await featurePace(deps, feature);
    if (!p || p.ahead || p.exhausted) return null;
    const prices = loadPrices(env);
    const model = pickModel(p, prices, opts.preferSonnet === true);
    const settings = MODEL_SETTINGS[model];
    const res = await deps.client.create(
      {
        model,
        max_tokens: opts.maxTokens,
        thinking: settings.thinking,
        ...(settings.effort ? { output_config: { effort: settings.effort } } : {}),
        system: opts.system,
        messages: [{ role: 'user', content: opts.user }],
      },
      { timeoutMs: opts.timeoutMs, maxRetries: 0 } // a retry would double the wait inside a time-boxed webhook
    );
    const spent = await addSpend(deps.repo, budgetConfig(env), deps.today, feature, model, res.usage, prices[model]).catch(() => null);
    const text = extractText(res.content);
    return text ? { text, model, usd: spent?.usd ?? null } : null;
  } catch {
    return null;
  }
}
