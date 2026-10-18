// Haiku title cleanup for AX task_create (docs/PLAN_ASK.md §6). Any doubt, failure or
// budget condition returns the rule-based title, so this can only improve a proposal.
import type { AskClient } from '@/lib/ask/client';
import { addSpend, loadSpend, type SpendRepo } from '@/lib/ask/spend';
import { budgetConfig, pace as paceOf } from '@/lib/logic/ask-budget';
import { loadPrices } from '@/lib/logic/ask-cost';
import { extractText } from '@/lib/logic/ask-text';

const MODEL = 'claude-haiku-5-5' as const;
const SYSTEM = 'Return only a concise Korean task title (≤ 40 chars) for this message; no date/time words, no quotes.';
const TIMEOUT_MS = 4000;
const MAX_TITLE = 60;

export interface TitleDeps {
  client: AskClient | null;
  repo: SpendRepo;
  today: string;
  env?: Record<string, string | undefined>;
}

const squeeze = (s: string): string => s.replace(/[\s\p{P}]+/gu, '');

/** True when `reply` shares at least one 2-character token with `original`. */
function sharesToken(reply: string, original: string): boolean {
  const a = squeeze(reply);
  const b = squeeze(original);
  for (let i = 0; i + 2 <= a.length; i++) if (b.includes(a.slice(i, i + 2))) return true;
  return false;
}

export async function cleanTaskTitle(deps: TitleDeps, text: string, ruleTitle: string): Promise<string> {
  const env = deps.env ?? process.env;
  const prices = loadPrices(env);
  const price = prices[MODEL];
  if (!deps.client || env.ASK_TITLE_CLEANUP === '0') return ruleTitle;
  if (!price && env.ASK_TITLE_CLEANUP !== '1') return ruleTitle;
  try {
    const cfg = budgetConfig(env);
    const ledger = await loadSpend(deps.repo, cfg, deps.today);
    const p = paceOf(cfg, deps.today, ledger.cycle.usd, 'title');
    if (p.ahead || p.exhausted) return ruleTitle;

    const res = await deps.client.create(
      { model: MODEL, max_tokens: 120, thinking: { type: 'disabled' }, system: SYSTEM, messages: [{ role: 'user', content: text }] },
      { timeoutMs: TIMEOUT_MS }
    );
    await addSpend(deps.repo, cfg, deps.today, 'title', MODEL, res.usage, price).catch(() => {});
    const title = extractText(res.content).replace(/^["'“”‘’「」]+|["'“”‘’「」]+$/g, '').trim();
    if (!title || title.includes('\n') || title.length > MAX_TITLE || !sharesToken(title, text)) return ruleTitle;
    return title;
  } catch {
    return ruleTitle;
  }
}
