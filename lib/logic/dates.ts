// KST calendar-day date math. Dates are plain 'YYYY-MM-DD' strings (no time
// component), so diffs are computed on UTC-anchored Date objects to avoid
// any local-timezone off-by-one — the calendar day itself is already the
// KST day by construction (see todayKST).

export type Urgency = 'overdue' | 'today' | 'soon' | 'later';

function toUtcDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function fromUtcDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Add (or subtract, with negative n) calendar days to a 'YYYY-MM-DD' string. */
export function addDaysStr(dateStr: string, n: number): string {
  const d = toUtcDate(dateStr);
  d.setUTCDate(d.getUTCDate() + n);
  return fromUtcDate(d);
}

/** Monday of the ISO week (Mon-Sun) containing dateStr. */
export function startOfIsoWeek(dateStr: string): string {
  const d = toUtcDate(dateStr);
  const dow = d.getUTCDay(); // 0=Sun..6=Sat
  const back = dow === 0 ? 6 : dow - 1; // days since Monday
  return addDaysStr(dateStr, -back);
}

/** Sunday of the ISO week (Mon-Sun) containing dateStr. */
export function endOfIsoWeek(dateStr: string): string {
  return addDaysStr(startOfIsoWeek(dateStr), 6);
}

/** Sunday of the Sunday-first week (일~토) containing dateStr. */
export function startOfSundayWeek(dateStr: string): string {
  return addDaysStr(dateStr, -toUtcDate(dateStr).getUTCDay());
}

/** Saturday of the Sunday-first week (일~토) containing dateStr. */
export function endOfSundayWeek(dateStr: string): string {
  return addDaysStr(startOfSundayWeek(dateStr), 6);
}

/** Add (or subtract) calendar months, clamped to the target month's length. */
export function addMonthsStr(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1 + n, 1));
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(d, lastDay));
  return fromUtcDate(date);
}

/** First day of the month containing dateStr. */
export function startOfMonthStr(dateStr: string): string {
  return `${dateStr.slice(0, 7)}-01`;
}

/** Calendar-day diff dueDate - today. Negative = overdue. */
export function dday(dueDate: string, today: string): number {
  const ms = toUtcDate(dueDate).getTime() - toUtcDate(today).getTime();
  return Math.round(ms / 86_400_000);
}

/** 'D-3', 'D-DAY', 'D+2'. */
export function ddayLabel(n: number): string {
  if (n === 0) return 'D-DAY';
  if (n > 0) return `D-${n}`;
  return `D+${-n}`;
}

/** soon = due in 1..7 days. */
export function urgency(n: number): Urgency {
  if (n < 0) return 'overdue';
  if (n === 0) return 'today';
  if (n <= 7) return 'soon';
  return 'later';
}

/** Today's date in Asia/Seoul as 'YYYY-MM-DD'. */
export function todayKST(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;

/**
 * Humanized Korean relative time (docs/reviews/ux-advice.md §6): `방금` / `n분 전` /
 * `n시간 전` (< 24h) / `어제` / `n일 전` (< 14d) / `n주 전` (< 8w) / `n개월 전` (< 12m) /
 * else the absolute year+month. Future instants use the same buckets with `후` instead
 * of `전` (`내일`, `n일 후`, ...). Never renders raw hours beyond a day ("644시간 전").
 */
export function relTime(iso: string, now: string): string {
  const diffMs = new Date(now).getTime() - new Date(iso).getTime();
  const future = diffMs < 0;
  const abs = Math.abs(diffMs);
  const suffix = future ? '후' : '전';

  if (abs < MINUTE_MS) return '방금';
  if (abs < HOUR_MS) return `${Math.floor(abs / MINUTE_MS)}분 ${suffix}`;
  if (abs < DAY_MS) return `${Math.floor(abs / HOUR_MS)}시간 ${suffix}`;
  if (abs < 2 * DAY_MS) return future ? '내일' : '어제';
  if (abs < 14 * DAY_MS) return `${Math.floor(abs / DAY_MS)}일 ${suffix}`;
  if (abs < 8 * WEEK_MS) return `${Math.floor(abs / WEEK_MS)}주 ${suffix}`;
  const months = Math.floor(abs / (30 * DAY_MS));
  if (months < 12) return `${months}개월 ${suffix}`;

  const d = new Date(iso);
  return `${d.getUTCFullYear()}년 ${d.getUTCMonth() + 1}월`;
}

const WEEKDAY_KO = ['일', '월', '화', '수', '목', '금', '토'];

/** Absolute Korean date label (ux-advice.md §6): `10월 15일 (목)`, with the year
 * prefixed only when `dateStr`'s year differs from `today`'s. */
export function absoluteDateLabel(dateStr: string, today: string): string {
  const d = toUtcDate(dateStr);
  const [y] = dateStr.split('-').map(Number);
  const [todayY] = today.split('-').map(Number);
  const yearPrefix = y === todayY ? '' : `${y}년 `;
  return `${yearPrefix}${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일 (${WEEKDAY_KO[d.getUTCDay()]})`;
}

/** Converts an ISO instant to its Asia/Seoul calendar date ('YYYY-MM-DD') and
 * clock time ('HH:mm'). Used to convert Google Calendar event instants (phase 3). */
export function kstDateTime(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  const date = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Seoul',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(d);
  return { date, time };
}
