// Telegram "market + account" message: second message of the morning digest and the /macro reply.
// Pure formatting of the VM market snapshot (app_meta trading:market) plus the account summary
// (trading:summary: totals and per-account values only, never holdings). Sections with no data are omitted.
import type { TradingAccountSummary, TradingSummary } from '@/lib/types';
import { escapeHtml } from '@/lib/telegram/format';
import { addDaysStr, dday, weekdayOf } from '@/lib/logic/dates';
import { isStale, mdLabel, quadrantLabel, type MarketBrief } from '@/lib/logic/market-brief';
import { accountValueText, krwShort, pctText } from '@/lib/logic/trading';

type Macro = NonNullable<MarketBrief['macro']>;

const e = escapeHtml;
const WEEKDAY_KO = ['일', '월', '화', '수', '목', '금', '토'];
const SUMMARY_STALE_HOURS = 30;
const STATUS_ICON = { ok: '✅', warn: '⚠️', fail: '🚨' } as const;
const OVERALL_WORD = { ok: '정상', warn: '주의', fail: '실패' } as const;
/** Korean names for the known RSI-watch flags; unknown ones are shown raw. */
const FLAG_KO: Record<string, string> = {
  bull_div_confluence: '강세 다이버전스 합류',
  concentration_overheat: '쏠림 과열',
  dual_oversold: '이중 과매도',
  persistent_pattern: '지속 패턴',
  schd_overheat: 'SCHD 과열',
};

const present = <T,>(v: T | null | undefined): v is T => v !== null && v !== undefined;
const clip = (s: string, max: number): string => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);
const md = (date: string): string => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;

function fmt(n: number | null | undefined, digits = 1): string | null {
  return present(n) && Number.isFinite(n) ? n.toFixed(digits) : null;
}
function sgn(n: number | null | undefined, digits = 1, unit = ''): string | null {
  const s = fmt(n, digits);
  return s === null ? null : `${Number(s) > 0 ? '+' : ''}${s}${unit}`;
}
/** Joins the parts that exist with ' · '; null when none do. */
function join(parts: Array<string | null | undefined | false>): string | null {
  const have = parts.filter((p): p is string => !!p);
  return have.length > 0 ? have.join(' · ') : null;
}
/** `label cur (change)`; null without a current value. */
const withChg = (label: string, cur: number | null | undefined, chg: string | null, d = 1): string | null =>
  fmt(cur, d) === null ? null : `${label} ${fmt(cur, d)}${chg ? ` (${chg})` : ''}`;
/** A bold-headed section; null when it has no lines. `note` is an italic suffix such as "(M/D 기준)". */
function section(title: string, lines: Array<string | null | undefined | false>, note = ''): string | null {
  const have = lines.filter((l): l is string => !!l);
  return have.length > 0 ? [`<b>${title}</b>${note ? ` <i>${note}</i>` : ''}`, ...have].join('\n') : null;
}

function accountLine(a: TradingAccountSummary, today: string): string {
  const label = a.label.replace(/\s*\(.*\)\s*$/, '').trim() || a.label;
  const dormant = !!a.dormantUntil && a.dormantUntil > today;
  const state = dormant
    ? `${md(a.dormantUntil!)} 시작`
    : a.noData
      ? '데이터 없음'
      : a.status && a.status !== 'ok'
        ? `⚠️ ${e(a.status)}`
        : '정상';
  const ret = present(a.cumReturnPct)
    ? `누적 ${pctText(a.cumReturnPct)}`
    : present(a.sinceBaselinePct)
      ? `기준일${a.baselineDate ? `(${md(a.baselineDate)})` : ''} 대비 ${pctText(a.sinceBaselinePct)}`
      : null;
  return `• ${e(label)}: ${join([
    accountValueText(a),
    ret,
    state,
    a.totalValue !== null && a.reserveUsd ? `예비금 $${(a.reserveUsd / 1000).toFixed(1)}k` : null,
    !dormant && a.nextDue ? `다음 ${md(a.nextDue)}` : null,
  ])}`;
}

/** Change over the last week of daily totals: base = the latest point dated <= today-7, else the oldest one; null without a distinct base, when the base is over 10 days old, or when a fallback base is under 5 days old. */
function weekChangePct(points: TradingSummary['points'], today: string): number | null {
  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
  const last = sorted.at(-1);
  if (!last) return null;
  const cutoff = addDaysStr(today, -7);
  const found = [...sorted].reverse().find((p) => p.date <= cutoff);
  const base = found ?? sorted[0];
  if (!found && base.date > addDaysStr(today, -5)) return null; // a fallback base under 5 days old is not a week
  if (base.date < addDaysStr(today, -10)) return null; // too old to call it a week
  return base.date !== last.date && base.totalKrw > 0 ? (last.totalKrw / base.totalKrw - 1) * 100 : null;
}

function accountSection(s: TradingSummary | null, today: string, nowIso: string): string | null {
  if (!s) return null;
  const week = weekChangePct(s.points, today);
  const day = present(s.dayChangeKrw)
    ? `오늘 ${s.dayChangeKrw > 0 ? '+' : ''}${krwShort(s.dayChangeKrw)}${present(s.dayChangePct) ? ` (${pctText(s.dayChangePct)})` : ''}`
    : present(s.dayChangePct)
      ? `오늘 ${pctText(s.dayChangePct)}`
      : null;
  const total = join([present(s.totalKrw) ? `총 ${krwShort(s.totalKrw)}` : null, day, present(week) ? `1주 ${pctText(week)}` : null]);
  const age = (Date.parse(nowIso) - Date.parse(s.collectedAt)) / 3_600_000;
  const note = !Number.isFinite(age) ? '(기준 시각 없음)' : age > SUMMARY_STALE_HOURS ? `(${mdLabel(s.collectedAt)} 기준)` : '';
  return section('💰 계좌', [total, ...s.accounts.map((a) => accountLine(a, today))], note);
}

function tradesSection(brief: MarketBrief, note: string): string | null {
  const t = brief.trades;
  if (!t) return null;
  const ok = t.checks.filter((c) => c.status === 'ok').length;
  return section(
    `🩺 매매 점검 ${STATUS_ICON[t.overall]} ${OVERALL_WORD[t.overall]} (${ok}/${t.checks.length})`,
    t.checks.map((c) => `${STATUS_ICON[c.status]} ${e(c.label)}${c.detail ? ` — ${e(clip(c.detail, 70))}` : ''}`),
    note
  );
}

function tempSection(m: Macro | null | undefined, note: string): string | null {
  if (!m) return null;
  const zone = (z: string | null | undefined) => (z ? ` (${e(z)})` : '');
  const r = m.rsiwatch;
  const flags = Object.entries(r?.flags ?? {}).filter(([, on]) => on).map(([k]) => e(FLAG_KO[k] ?? k));
  return section(
    '🌡 시장 온도',
    [
      join([
        present(m.composite) ? `레짐 ${e(String(m.composite))}` : null,
        fmt(m.fear_greed?.score, 0) ? `공포탐욕 ${fmt(m.fear_greed?.score, 0)}${zone(m.fear_greed?.zone_label)}` : null,
        fmt(m.vix?.value) ? `VIX ${fmt(m.vix?.value)}${zone(m.vix?.zone_label)}` : null,
      ]),
      join([
        fmt(m.ndx_rsi?.daily, 0) ? `NDX RSI 일 ${fmt(m.ndx_rsi?.daily, 0)}` : null,
        fmt(m.ndx_rsi?.weekly, 0) ? `주 ${fmt(m.ndx_rsi?.weekly, 0)}` : null,
        fmt(m.ndx_rsi?.monthly, 0) ? `월 ${fmt(m.ndx_rsi?.monthly, 0)}` : null,
        fmt(r?.qqqe_z, 2) ? `QQQE z ${sgn(r?.qqqe_z, 2)}` : null,
      ]),
      join([fmt(r?.spx_wrsi, 0) ? `SPX 주간RSI ${fmt(r?.spx_wrsi, 0)}` : null, fmt(r?.schd_wrsi, 0) ? `SCHD ${fmt(r?.schd_wrsi, 0)}` : null]),
      flags.length > 0 && `🚩 ${flags.join(', ')}`,
    ],
    note
  );
}

function ratesSection(m: Macro | null | undefined, note: string): string | null {
  if (!m) return null;
  const q = m.liquidity?.quadrant;
  return section(
    '📉 금리·유동성',
    [
      join([withChg('10Y', m.us10y?.current, sgn(m.us10y?.change_bp, 0, 'bp'), 2), withChg('30Y', m.us30y?.current, sgn(m.us30y?.change_bp, 0, 'bp'), 2)]),
      join([
        fmt(m.curve?.current, 2) ? `곡선 ${fmt(m.curve?.current, 2)}${m.curve?.inverted_12m ? ' (12M 내 역전)' : ''}` : null,
        m.hy?.state ? `HY ${e(m.hy.state)}${sgn(m.hy.rise_bp, 0, 'bp') ? ` ${sgn(m.hy.rise_bp, 0, 'bp')}` : ''}` : null,
        fmt(m.sahm?.value, 2) ? `Sahm ${fmt(m.sahm?.value, 2)}${m.sahm?.state ? ` ${e(m.sahm.state)}` : ''}` : null,
      ]),
      join([
        fmt(m.monthly_overheat?.latest) ? `월간 과열 ${fmt(m.monthly_overheat?.latest)}${m.monthly_overheat?.overheat ? ' (과열)' : ''}` : null,
        fmt(m.liquidity?.ffr, 2) ? `FFR ${fmt(m.liquidity?.ffr, 2)}${sgn(m.liquidity?.ffr_chg13w, 2) ? ` (13주 ${sgn(m.liquidity?.ffr_chg13w, 2)})` : ''}` : null,
        sgn(m.liquidity?.netliq_chg13w_pct, 1, '%') ? `순유동성 13주 ${sgn(m.liquidity?.netliq_chg13w_pct, 1, '%')}` : null,
      ]),
      q ? (quadrantLabel(q) ?? `유동성 ${e(q)}`) : null,
      join([
        fmt(m.japan?.jgb10y, 2) ? `일본 JGB10Y ${fmt(m.japan?.jgb10y, 2)}` : null,
        fmt(m.japan?.jgb30y, 2) ? `30Y ${fmt(m.japan?.jgb30y, 2)}` : null,
        sgn(m.japan?.jpy_chg20d_pct, 1, '%') ? `엔 20일 ${sgn(m.japan?.jpy_chg20d_pct, 1, '%')}` : null,
      ]),
    ],
    note
  );
}

function fxSection(m: Macro | null | undefined, note: string): string | null {
  if (!m) return null;
  return section(
    '💱 환율',
    [
      join([
        withChg('USDKRW', m.usdkrw?.current, sgn(m.usdkrw?.change_pct, 1, '%'), 0),
        withChg('DXY', m.dxy?.current, sgn(m.dxy?.change_pct, 1, '%'), 1),
        fmt(m.japan?.usdjpy) ? `USDJPY ${fmt(m.japan?.usdjpy)}` : null,
      ]),
    ],
    note
  );
}

function riskSection(m: Macro | null | undefined, note: string): string | null {
  if (!m) return null;
  const coin = (name: string, d: number | null | undefined, below: boolean | null | undefined) =>
    fmt(d) ? `${name} ${sgn(d, 1, '%')}${below ? ' 200일선↓' : ''}` : null;
  // A value that rounds to 0.0 (>= -0.05) is at its 52-week high.
  const dist = (name: string, d: number | null | undefined) => (fmt(d) ? (d! >= -0.05 ? `${name} 신고가` : `${name} ${sgn(d, 1, '%')}`) : null);
  const c = join([coin('BTC', m.crypto?.btc_dist_200d_pct, m.crypto?.btc_below_200d), coin('ETH', m.crypto?.eth_dist_200d_pct, m.crypto?.eth_below_200d)]);
  const d = join([dist('유럽', m.europe_dist_pct), dist('BRK-B', m.brk_dist_pct), dist('SCHD', m.schd_dist_pct)]);
  return section('🪙 위험자산·방어', [c && `200일선 대비: ${c}`, d && `52주 고점 대비: ${d}`], note);
}

function leaderSection(m: Macro | null | undefined, note: string): string | null {
  const l = m?.leader;
  if (!l) return null;
  return section(
    '🏆 주도주',
    [
      join([
        l.us ? `US ${e(l.us)}${present(l.us_gap_pct) ? ` (격차 ${sgn(l.us_gap_pct, 1, '%p')})` : ''}` : null,
        l.kr ? `KR ${e(l.kr)}${present(l.kr_reign_days) ? ` ${l.kr_reign_days}일째` : ''}` : null,
      ]),
    ],
    note
  );
}

function sectorSection(brief: MarketBrief, note: string): string | null {
  return section(
    '🏭 섹터 (1일 · 200일선 · NDX대비 20일 · 주간RSI)',
    brief.sectors.map((s) => {
      const name = s.label ? `${e(s.label)}(${e(s.ticker)})` : e(s.ticker);
      // Fixed four columns ('–' for a missing one) so the header stays true; no data at all drops the line.
      const cols = [sgn(s.chg1d_pct, 1, '%'), sgn(s.dist_200d_pct, 1, '%'), sgn(s.rs_vs_ndx_20d_pct, 1, '%'), fmt(s.wrsi, 0)];
      if (cols.every((c) => c === null)) return null;
      return `• ${name} ${cols.map((c) => c ?? '–').join(' · ')}${s.note ? `\n   <i>${e(clip(s.note, 40))}</i>` : ''}`;
    }),
    note
  );
}

function strategySection(brief: MarketBrief, note: string): string | null {
  return section(
    '⚙️ 전략',
    brief.strategy.map((s) => `• ${e(s.label)} <b>${e(s.state)}</b>${s.detail ? ` — ${e(clip(s.detail, 60))}` : ''}`),
    note
  );
}

const isHigh = (v: string | number | null | undefined): boolean =>
  typeof v === 'number' ? v >= 3 : typeof v === 'string' && /high|높|상|★{3}|^3$/i.test(v);
const has = (v: string | number | null | undefined): v is string | number => v !== null && v !== undefined && v !== '';

/** Schedule: upcoming trading dates, today/tomorrow econ events (all importance), high-importance ones for the rest of the week. */
function scheduleSection(brief: MarketBrief, today: string, note: string): string | null {
  const dayLabel = (d: string) => (d === today ? '오늘' : d === addDaysStr(today, 1) ? '내일' : md(d));
  const tomorrow = addDaysStr(today, 1);
  const lastDay = addDaysStr(today, 6);
  const upcoming = brief.upcoming
    .filter((u) => u.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 6)
    .map((u) => `🗓 ${md(u.date)} ${e(u.name)} (D-${dday(u.date, today)})`);
  const econ = brief.econ
    .filter((x) => x.date >= today && x.date <= lastDay && (x.date <= tomorrow || isHigh(x.importance)))
    .sort((a, b) => `${a.date} ${a.time_kst ?? ''}`.localeCompare(`${b.date} ${b.time_kst ?? ''}`))
    .slice(0, 12)
    .map((x) => {
      const exp = has(x.consensus) || has(x.previous) ? ` (예상 ${has(x.consensus) ? x.consensus : '-'} / 이전 ${has(x.previous) ? x.previous : '-'})` : '';
      return `📆 ${dayLabel(x.date)}${x.time_kst ? ` ${e(x.time_kst)}` : ''} ${e(x.name)}${e(exp)}`;
    });
  return section('🗓 일정', [...upcoming, ...econ, brief.econ_error && `<i>경제 캘린더 오류: ${e(clip(brief.econ_error, 60))}</i>`], note);
}

export interface MarketDigestInput {
  brief: MarketBrief | null;
  summary: TradingSummary | null;
  today: string;
  nowIso: string;
  /** The Haiku "what changed / what to watch" paragraph; ignored when the snapshot is stale. */
  sentence: string | null;
}

/** The full market + account message; null when there is neither a snapshot nor an account summary. */
export function formatMarketBrief({ brief, summary, today, nowIso, sentence }: MarketDigestInput): string | null {
  const [, m, d] = today.split('-').map(Number);
  const title = `<b>📈 ${m}/${d}(${WEEKDAY_KO[weekdayOf(today)]}) 시장·계좌</b>`;
  const stale = !!brief && isStale(brief, nowIso);
  const note = brief && stale ? `(${mdLabel(brief.receivedAt)} 기준)` : '';
  const mk = brief?.macro;
  const sections = [
    accountSection(summary, today, nowIso),
    brief && tradesSection(brief, note),
    tempSection(mk, note),
    ratesSection(mk, note),
    fxSection(mk, note),
    riskSection(mk, note),
    leaderSection(mk, note),
    brief && sectorSection(brief, note),
    brief && strategySection(brief, note),
    brief && scheduleSection(brief, today, note),
    brief && !stale && sentence ? `💬 ${e(sentence)}` : null,
  ].filter((s): s is string => !!s);
  return sections.length > 0 ? [title, ...sections].join('\n\n') : null;
}
