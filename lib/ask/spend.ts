// One ledger for every Claude API call the dashboard makes (app_meta `ask:spend:<cycleStart>`
// plus a per-day key). Read-modify-write per call: single user, worst case a few cents of drift.
import { addDaysStr } from '@/lib/logic/dates';
import {
  SPEND_PREFIX,
  addCall,
  emptySpend,
  pace as paceOf,
  spendCycleKey,
  spendDayKey,
  cycleOf,
  type BudgetConfig,
  type Feature,
  type Pace,
  type SpendRecord,
} from '@/lib/logic/ask-budget';
import { costUsd, type AskModel, type Price, type UsageLike } from '@/lib/logic/ask-cost';
import type { Repo } from '@/lib/repo';

export type SpendRepo = Pick<Repo, 'getMeta' | 'setMeta' | 'listMetaByPrefix' | 'deleteMeta'>;

export async function loadSpend(
  repo: Pick<Repo, 'getMeta'>,
  cfg: BudgetConfig,
  today: string
): Promise<{ cycle: SpendRecord; day: SpendRecord }> {
  const [cycle, day] = await Promise.all([
    repo.getMeta<SpendRecord>(spendCycleKey(cycleOf(today, cfg.startDay))),
    repo.getMeta<SpendRecord>(spendDayKey(today)),
  ]);
  return { cycle: cycle ?? emptySpend(), day: day ?? emptySpend() };
}

/** Records one call in the cycle and day keys. A missing price keeps the tokens but adds no USD. */
export async function addSpend(
  repo: SpendRepo,
  cfg: BudgetConfig,
  today: string,
  feature: Feature,
  model: AskModel,
  usage: UsageLike,
  price: Price | null
): Promise<{ record: SpendRecord; usd: number | null }> {
  const usd = price ? costUsd(price, usage) : null;
  const tokens = {
    input: usage.input_tokens,
    output: usage.output_tokens,
    cacheWrite: usage.cache_creation_input_tokens ?? 0,
    cacheRead: usage.cache_read_input_tokens ?? 0,
  };
  const cycleKey = spendCycleKey(cycleOf(today, cfg.startDay));
  const dayKey = spendDayKey(today);
  const [cycle, day] = await Promise.all([repo.getMeta<SpendRecord>(cycleKey), repo.getMeta<SpendRecord>(dayKey)]);
  const record = addCall(cycle, feature, model, tokens, usd);
  await repo.setMeta(cycleKey, record);
  await repo.setMeta(dayKey, addCall(day, feature, model, tokens, usd));
  if (!day) await prune(repo, today);
  return { record, usd };
}

/** Drops day keys older than 45 days and cycle keys older than 400 days; best-effort, once per day. */
async function prune(repo: SpendRepo, today: string): Promise<void> {
  try {
    const dayCutoff = addDaysStr(today, -45);
    const cycleCutoff = addDaysStr(today, -400);
    for (const key of Object.keys(await repo.listMetaByPrefix(SPEND_PREFIX))) {
      const isDay = key.startsWith(`${SPEND_PREFIX}day:`);
      if (key.slice(-10) < (isDay ? dayCutoff : cycleCutoff)) await repo.deleteMeta(key);
    }
  } catch {
    // stale ledger keys are harmless
  }
}

const short = (model: string): string => model.replace(/^claude-/, '').replace(/-\d+-\d+$/, '');

/** Answer footer: model + this call's cost; with `showPace` also the remaining budget / pace status. */
export function footer(model: AskModel, callUsd: number | null, p: Pace, showPace: boolean, downgradeReason?: string): string {
  const cost = callUsd === null ? '가격 미설정' : `$${callUsd.toFixed(3)}`;
  let line = `${short(model)} · ${cost}${downgradeReason ? ` · ${downgradeReason}` : ''}`;
  if (showPace) {
    line += p.ahead ? ' · 페이스 초과 — Haiku만' : ` · 남은 $${p.remainingUsd.toFixed(2)} (페이스 여유)`;
  }
  return `<i>${line}</i>`;
}

/** Pace for `feature` from the loaded ledger (cycle total). */
export const paceFor = (cfg: BudgetConfig, today: string, rec: SpendRecord, feature: Feature): Pace =>
  paceOf(cfg, today, rec.usd, feature);
