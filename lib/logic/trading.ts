// Pure formatting for the trading account summary (app_meta 'trading:summary', written
// by /api/ingest from scripts/lib/trading-summary.mjs). Framework-free for unit tests.
import type { TradingAccountSummary, TradingSummary } from '@/lib/types';

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
