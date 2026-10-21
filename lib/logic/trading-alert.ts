// Identity and wording of an alert from the trading dashboard's /api/alerts. The message embeds changing
// numbers (hours, counts, timestamps), so an id built from it would be "new" every hour and status-diff would
// re-send the Telegram alert. scripts/lib/trading-probe.mjs mirrors these two functions.
export interface TradingAlert {
  severity: 'critical' | 'warn' | 'info';
  message: string;
  kind?: string | null;
  state_id?: string | null;
  label?: string | null;
}

const NUMBER = /\d+(?:[.,]\d+)*/g;

/** Stable status-item id: the alert's kind (+ state_id/label when present), else the message with numbers removed. */
export function alertItemId(a: TradingAlert): string {
  if (a.kind) return `trading:alert:${a.kind}${a.state_id || a.label ? `:${a.state_id || a.label}` : ''}`;
  return `trading:alert:${a.message.replace(NUMBER, '#')}`;
}

const SYNC_FAILED_TITLE = '트레이딩 동기화 실패 (VM 접속)';

/** The alert text. The dashboard also raises its sync-stale alert when the last sync *failed* shortly ago, so
 * a fresh age (below the threshold in the same message) reads as a failure, not as "STALE". */
export function alertTitle(a: TradingAlert): string {
  if (a.kind === 'sync_stale' || (!a.kind && /마지막 동기화/.test(a.message))) {
    const age = /(\d+(?:\.\d+)?)\s*시간\s*전/.exec(a.message);
    const limit = /기준\s*(\d+(?:\.\d+)?)\s*시간/.exec(a.message);
    if (age && limit && Number(age[1]) < Number(limit[1])) return SYNC_FAILED_TITLE;
  }
  return a.message;
}
