// Pure formatting for the trading account summary (app_meta 'trading:summary', written
// by /api/ingest from scripts/lib/trading-summary.mjs). Framework-free for unit tests.
import type { TradingAccountSummary, TradingSummary } from '@/lib/types';
import type { BriefBody } from '@/lib/logic/market-brief';

export const TRADING_SUMMARY_META_KEY = 'trading:summary';
/** The project the local trading dashboard belongs to (same id the status probe uses). */
export const TRADING_PROJECT_ID = 'p-trading-system';

/** 123456789 -> '1억 2,346만원'; 23456789 -> '2,346만원'; under 1만 -> '9,999원'. */
export function krwShort(n: number): string {
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  if (abs < 10_000) return `${sign}${Math.round(abs).toLocaleString('ko-KR')}원`;
  const man = Math.round(abs / 10_000);
  const eok = Math.floor(man / 10_000);
  const rest = man % 10_000;
  if (eok === 0) return `${sign}${rest.toLocaleString('ko-KR')}만원`;
  return rest === 0 ? `${sign}${eok}억원` : `${sign}${eok}억 ${rest.toLocaleString('ko-KR')}만원`;
}

/** +0.43 -> '+0.4%', -1.2 -> '-1.2%', 0 -> '0.0%'. */
export function pctText(n: number): string {
  const r = Math.round(n * 10) / 10;
  return `${r > 0 ? '+' : ''}${r.toFixed(1)}%`;
}

/** An account's value in its own currency. */
export function accountValueText(a: TradingAccountSummary): string | null {
  if (a.totalValue === null) {
    // Not trading yet but money is parked at the broker (IB+VR before 10/1).
    return a.reserveUsd ? `$${Math.round(a.reserveUsd).toLocaleString('en-US')} 대기` : null;
  }
  if (a.currency === 'USD') return `$${Math.round(a.totalValue).toLocaleString('en-US')}`;
  return krwShort(a.totalValue);
}

/** 'M/D' from 'YYYY-MM-DD'. */
function md(date: string): string {
  const [, m, d] = date.split('-');
  return `${Number(m)}/${Number(d)}`;
}

/** Account state in a few words: '10/1 시작' (dormant), '데이터 없음', '다음 9/28', or the raw status. */
export function accountStateText(a: TradingAccountSummary, today: string): string {
  if (a.dormantUntil && a.dormantUntil > today) return `${md(a.dormantUntil)} 시작`;
  if (a.noData) return '데이터 없음';
  if (a.status && a.status !== 'ok') return a.status;
  return a.nextDue ? `다음 ${md(a.nextDue)}` : '정상';
}

/** Home card line: '1억 2,346만원 · 오늘 +0.4% · 운용 3/4'. */
export function tradingOneLine(s: TradingSummary, today: string): string {
  const parts: string[] = [];
  if (s.totalKrw !== null) parts.push(krwShort(s.totalKrw));
  if (s.dayChangePct !== null) parts.push(`오늘 ${pctText(s.dayChangePct)}`);
  const running = s.accounts.filter((a) => !a.noData && !(a.dormantUntil && a.dormantUntil > today)).length;
  if (s.accounts.length > 0) parts.push(`운용 ${running}/${s.accounts.length}`);
  return parts.join(' · ');
}

/** Tiny sparkline path for the week of daily totals (viewBox 0 0 w h), or null under 2 points. */
export function sparklinePath(points: Array<{ totalKrw: number }>, w: number, h: number): string | null {
  if (points.length < 2) return null;
  const vals = points.map((p) => p.totalKrw);
  const min = Math.min(...vals);
  const span = Math.max(...vals) - min || 1;
  return vals
    .map((v, i) => `${i === 0 ? 'M' : 'L'}${((i / (vals.length - 1)) * w).toFixed(1)},${(h - ((v - min) / span) * h).toFixed(1)}`)
    .join(' ');
}

/** Home strip chip: 'ISA 2,534만' / 'IB+VR 10/1 시작' (label without its parenthesised note). */
export function accountChipText(a: TradingAccountSummary, today: string): string {
  const label = a.label.replace(/\s*\(.*\)\s*$/, '').trim() || a.label;
  if (a.dormantUntil && a.dormantUntil > today) return `${label} ${md(a.dormantUntil)} 시작`;
  const value = accountValueText(a);
  if (!value) return `${label} —`;
  return `${label} ${value.replace(/원$/, '')}`;
}

/** True when the summary is older than `hours` (PC/collector off) — the strip says so. */
export function isStale(s: TradingSummary, nowMs: number, hours = 30): boolean {
  return nowMs - new Date(s.collectedAt).getTime() > hours * 3_600_000;
}

/** The return to show for an account: cumulative when the trading dashboard has a
 * principal, else P&L since its baseline ('+1.5% · 8/1~'). Null when neither exists. */
export function accountReturnText(a: TradingAccountSummary): string | null {
  if (a.cumReturnPct !== null) return pctText(a.cumReturnPct);
  if (a.sinceBaselinePct !== null && a.sinceBaselinePct !== undefined) {
    return a.baselineDate ? `${pctText(a.sinceBaselinePct)} · ${md(a.baselineDate)}~` : pctText(a.sinceBaselinePct);
  }
  return null;
}

/** Numeric value behind accountReturnText (for up/down colouring). */
export function accountReturnValue(a: TradingAccountSummary): number | null {
  return a.cumReturnPct ?? a.sinceBaselinePct ?? null;
}

/** The PC collector only overwrites the summary when the stored one is older than this. */
export const PC_SUMMARY_FALLBACK_HOURS = 6;

/** Maps the VM's snake_case `accounts` section to the stored TradingSummary shape; null when it holds nothing usable. */
export function accountsToSummary(a: BriefBody['accounts'], nowIso: string): TradingSummary | null {
  if (!a || (a.items.length === 0 && (a.total_krw ?? null) === null)) return null;
  // Missing, unparseable or future (> 10 min ahead) timestamps fall back to the receive time.
  const t = a.collected_at ? Date.parse(a.collected_at) : NaN;
  const at = Number.isFinite(t) && t <= Date.parse(nowIso) + 10 * 60_000 ? a.collected_at! : nowIso;
  const seen = new Set<string>();
  const items = a.items.filter((i) => !seen.has(i.id) && !!seen.add(i.id));
  return {
    collectedAt: at,
    totalKrw: a.total_krw ?? null,
    dayChangeKrw: a.day_change_krw ?? null,
    dayChangePct: a.day_change_pct ?? null,
    fxRate: a.fx_rate ?? null,
    lastSyncOk: null,
    points: a.points.map((p) => ({ date: p.date, totalKrw: p.total_krw })),
    accounts: items.map((i) => ({
      id: i.id,
      label: i.label,
      group: i.group ?? null,
      currency: i.currency ?? null,
      totalValue: i.total_value ?? null,
      cumReturnPct: i.cum_return_pct ?? null,
      sinceBaselinePct: i.since_baseline_pct ?? null,
      baselineDate: i.baseline_date ?? null,
      noData: i.no_data ?? (i.total_value == null && !i.reserve_usd),
      reserveUsd: i.reserve_usd ?? null,
      status: i.status ?? null,
      dormantUntil: i.dormant_until ?? null,
      lastRun: i.last_run ?? null,
      nextDue: i.next_due ?? null,
    })),
  };
}

/** VM summaries win when not older than the stored one. The PC fallback writes over a missing one, a PC-written one
 * (hourly refresh), or a VM one older than 6 h. */
export function shouldWriteSummary(
  stored: Pick<TradingSummary, 'collectedAt' | 'source'> | null,
  incoming: Pick<TradingSummary, 'collectedAt'>,
  source: 'vm' | 'pc',
  nowIso: string
): boolean {
  if (!stored) return true;
  if (source === 'vm') return !(Date.parse(incoming.collectedAt) < Date.parse(stored.collectedAt));
  if (stored.source !== 'vm') return true;
  const ageH = (Date.parse(nowIso) - Date.parse(stored.collectedAt)) / 3_600_000;
  return !Number.isFinite(ageH) || ageH > PC_SUMMARY_FALLBACK_HOURS;
}
