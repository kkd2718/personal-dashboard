import type { TradingSummary } from '@/lib/types';
import { accountStateText, accountValueText, krwShort, pctText, sparklinePath } from '@/lib/logic/trading';
import { relTime } from '@/lib/logic/dates';

function changeClass(n: number | null): string {
  if (n === null || n === 0) return 'text-foreground/50';
  return n > 0 ? 'text-red-600 dark:text-red-400' : 'text-blue-600 dark:text-blue-400'; // KR convention: up red, down blue
}

export function Sparkline({ points, className = '' }: { points: TradingSummary['points']; className?: string }) {
  const d = sparklinePath(points, 60, 16);
  if (!d) return null;
  return (
    <svg viewBox="0 0 60 16" className={`h-4 w-[60px] shrink-0 overflow-visible ${className}`} aria-hidden>
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/** trading-system project page: total, today's change, the week trend and one row per account. */
export function AccountSummaryPanel({ summary, today, now }: { summary: TradingSummary; today: string; now: string }) {
  // DCA accounts have no cost basis in the trading dashboard (cum return null) — drop
  // the column rather than show a row of dashes.
  const showReturn = summary.accounts.some((a) => a.cumReturnPct !== null);
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-3">
      <div className="flex flex-wrap items-end gap-x-3 gap-y-1">
        {summary.totalKrw !== null && <span className="tnum text-xl font-semibold">{krwShort(summary.totalKrw)}</span>}
        {summary.dayChangePct !== null && (
          <span className={`tnum text-sm ${changeClass(summary.dayChangePct)}`}>
            오늘 {pctText(summary.dayChangePct)}
            {summary.dayChangeKrw !== null && ` (${summary.dayChangeKrw > 0 ? '+' : ''}${krwShort(summary.dayChangeKrw)})`}
          </span>
        )}
        <Sparkline points={summary.points} className="text-foreground/40" />
        <span className="ml-auto text-[11px] text-foreground/40">
          {relTime(summary.collectedAt, now)} 기준{summary.lastSyncOk === false ? ' · 동기화 실패' : ''}
        </span>
      </div>
      <ul className="flex flex-col divide-y divide-border text-sm">
        {summary.accounts.map((a) => (
          <li key={a.id} className="flex items-center gap-3 py-2">
            <span className="min-w-0 flex-1 truncate">{a.label}</span>
            <span className="tnum w-28 shrink-0 text-right">{accountValueText(a) ?? '—'}</span>
            {showReturn && (
              <span className={`tnum w-16 shrink-0 text-right ${changeClass(a.cumReturnPct)}`}>
                {a.cumReturnPct !== null ? pctText(a.cumReturnPct) : '—'}
              </span>
            )}
            <span className="w-20 shrink-0 text-right text-xs text-foreground/50">{accountStateText(a, today)}</span>
          </li>
        ))}
      </ul>
      <p className="text-[11px] text-foreground/35">
        {showReturn ? '수익률은 누적 기준 · ' : ''}보유 종목·주문 내역은 PC의 계좌 대시보드에서
      </p>
    </div>
  );
}
