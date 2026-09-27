import Link from 'next/link';
import { Wallet } from 'lucide-react';
import type { TradingSummary } from '@/lib/types';
import { accountChipText, isStale, krwShort, pctText } from '@/lib/logic/trading';
import { relTime } from '@/lib/logic/dates';
import { Sparkline } from '@/components/trading/account-summary';

function changeClass(n: number | null): string {
  if (n === null || n === 0) return 'text-foreground/50';
  return n > 0 ? 'text-red-600 dark:text-red-400' : 'text-blue-600 dark:text-blue-400';
}

/** Home: one slim row with the account summary (always visible, phone included).
 * Without data yet it stays as a placeholder saying when it will fill in. */
export function AccountStrip({
  summary,
  href,
  today,
  now,
}: {
  summary: TradingSummary | null;
  href: string | null;
  today: string;
  now: string;
}) {
  const body = !summary ? (
    <span className="text-foreground/40">PC 수집기가 계좌 대시보드를 읽으면 여기에 합계·계좌별 금액이 표시돼요</span>
  ) : (
    <>
      {summary.totalKrw !== null && <span className="tnum font-medium">{krwShort(summary.totalKrw)}</span>}
      {summary.dayChangePct !== null && (
        <span className={`tnum ${changeClass(summary.dayChangePct)}`}>오늘 {pctText(summary.dayChangePct)}</span>
      )}
      <Sparkline points={summary.points} className="text-foreground/35" />
      <span className="flex min-w-0 basis-full flex-wrap gap-x-2 gap-y-0.5 text-foreground/55 sm:basis-auto">
        {summary.accounts.map((a) => (
          <span key={a.id} className="tnum whitespace-nowrap">
            {accountChipText(a, today)}
          </span>
        ))}
      </span>
      {isStale(summary, Date.parse(now)) && (
        <span className="text-amber-600 dark:text-amber-400">{relTime(summary.collectedAt, now)} 기준</span>
      )}
    </>
  );

  const className =
    'flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-border bg-surface px-3 py-2 text-xs';
  const content = (
    <>
      <span className="flex shrink-0 items-center gap-1 font-medium text-foreground/70">
        <Wallet size={13} /> 계좌
      </span>
      {body}
      {href && <span className="ml-auto hidden shrink-0 text-foreground/40 sm:inline">자세히 →</span>}
    </>
  );
  return href ? (
    <Link href={href} className={`${className} hover:bg-foreground/5`}>
      {content}
    </Link>
  ) : (
    <div className={className}>{content}</div>
  );
}
