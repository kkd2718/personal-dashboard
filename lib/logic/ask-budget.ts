// Paced per-cycle budget for every Claude API call the dashboard makes. Pure.
// Plan credit does not roll over, so the cycle credit is spread across the cycle's days
// (with a little slack) instead of being a monthly cap.
import { addMonthsStr, dday } from '@/lib/logic/dates';

export interface BudgetConfig {
  creditUsd: number;
  startDay: number;
  reservePct: number;
  slackUsd: number;
}

type Env = Record<string, string | undefined>;

function num(raw: string | undefined, fallback: number, min: number, max: number): number {
  const n = raw === undefined || raw.trim() === '' ? NaN : Number(raw);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

export function budgetConfig(env: Env = process.env): BudgetConfig {
  const credit = num(env.ASK_CYCLE_CREDIT_USD, 100, 0, 1e6);
  return {
    creditUsd: credit > 0 ? credit : 100,
    startDay: Math.round(num(env.ASK_CYCLE_START_DAY, 23, 1, 28)),
    reservePct: num(env.ASK_RESERVE_PCT, 10, 0, 50),
    slackUsd: num(env.ASK_PACE_SLACK_USD, 2, 0, 1e6),
  };
}

export interface Cycle {
  start: string; // 'YYYY-MM-DD' KST
  nextStart: string;
  days: number;
  dayIndex: number; // 0 = start day
}

/** The billing cycle containing `today` (a cycle starts on `startDay` of each month, 1-28). */
export function cycleOf(today: string, startDay: number): Cycle {
  const day = Math.min(28, Math.max(1, Math.round(startDay)));
  const thisMonth = `${today.slice(0, 8)}${String(day).padStart(2, '0')}`;
  const start = today >= thisMonth ? thisMonth : addMonthsStr(thisMonth, -1);
  const nextStart = addMonthsStr(start, 1);
  return { start, nextStart, days: dday(nextStart, start), dayIndex: dday(today, start) };
}

export type Feature = 'ask' | 'title' | 'mail' | 'macro' | 'other';

export interface Pace {
  cycle: Cycle;
  creditUsd: number;
  usableUsd: number;
  limitUsd: number;
  spentUsd: number;
  allowedUsd: number;
  remainingUsd: number;
  ahead: boolean;
  exhausted: boolean;
}

/** Where `spentUsd` stands against the pace line. The reserve is only available to mail/other. */
export function pace(cfg: BudgetConfig, today: string, spentUsd: number, feature: Feature): Pace {
  const cycle = cycleOf(today, cfg.startDay);
  const usable = cfg.creditUsd * (1 - cfg.reservePct / 100);
  const limit = feature === 'ask' || feature === 'title' ? usable : cfg.creditUsd;
  const allowed = Math.min(limit, (limit * (cycle.dayIndex + 1)) / cycle.days + cfg.slackUsd);
  return {
    cycle,
    creditUsd: cfg.creditUsd,
    usableUsd: usable,
    limitUsd: limit,
    spentUsd,
    allowedUsd: allowed,
    remainingUsd: Math.max(0, limit - spentUsd),
    ahead: spentUsd > allowed,
    exhausted: spentUsd >= limit,
  };
}

export const spendCycleKey = (cycle: Cycle): string => `ask:spend:${cycle.start}`;
export const spendDayKey = (today: string): string => `ask:spend:day:${today}`;
export const SPEND_PREFIX = 'ask:spend:';

export interface ModelSpend {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
  usd: number;
}

export interface SpendRecord {
  usd: number;
  calls: number;
  unpricedCalls: number;
  byModel: Record<string, ModelSpend>;
  byFeature: Partial<Record<Feature, number>>;
}

export const emptySpend = (): SpendRecord => ({ usd: 0, calls: 0, unpricedCalls: 0, byModel: {}, byFeature: {} });

/** Returns `rec` plus one call. `usd` null = no price known: tokens are kept, cost is not. */
export function addCall(
  rec: SpendRecord | null,
  feature: Feature,
  model: string,
  u: { input: number; output: number; cacheWrite: number; cacheRead: number },
  usd: number | null
): SpendRecord {
  const base = rec ?? emptySpend();
  const m = base.byModel[model] ?? { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, usd: 0 };
  return {
    usd: base.usd + (usd ?? 0),
    calls: base.calls + 1,
    unpricedCalls: base.unpricedCalls + (usd === null ? 1 : 0),
    byModel: {
      ...base.byModel,
      [model]: {
        input: m.input + u.input,
        output: m.output + u.output,
        cacheWrite: m.cacheWrite + u.cacheWrite,
        cacheRead: m.cacheRead + u.cacheRead,
        usd: m.usd + (usd ?? 0),
      },
    },
    byFeature: { ...base.byFeature, [feature]: (base.byFeature[feature] ?? 0) + (usd ?? 0) },
  };
}
