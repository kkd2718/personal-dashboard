// Market-only snapshot pushed by the trading VM (POST /api/trading/brief) or, as a fallback,
// pulled by the PC collector (scripts/lib/trading-market.mjs). Stored as app_meta
// `trading:market`. ALLOW-LIST ONLY: portfolio regime/allocation, per-account data, amounts,
// quantities and holdings never enter this schema — unknown keys are stripped by zod and any key
// matching FORBIDDEN_KEY is dropped again as a second line of defense. Pure.
//
// Body shape (all leaf fields optional; a field with the wrong type is dropped, not a 400):
//   { as_of, macro:{ composite, curve, hy, sahm, monthly_overheat, fear_greed, vix, ndx_rsi, rsiwatch, usdkrw, dxy, us10y,
//       us30y, japan, liquidity, crypto, europe_dist_pct, brk_dist_pct, schd_dist_pct, leader, as_of } (flat),
//     sectors[], strategy[], upcoming[], econ[], econ_error?, trades:{overall, checks[]} }
import { z } from 'zod';
import { dday, kstDateTime } from '@/lib/logic/dates';

export const MARKET_BRIEF_META_KEY = 'trading:market';
export const MARKET_BRIEF_PREV_META_KEY = 'trading:market:prev';
export const MARKET_STALE_HOURS = 36;
/** The PC collector only writes when the stored snapshot is older than this. */
export const PC_FALLBACK_AFTER_HOURS = 6;

export const FORBIDDEN_KEY = /amount|qty|quantity|value_krw|balance|account|holding|weight|pnl|평가|수량|금액/i;

// A wrongly typed leaf becomes undefined instead of rejecting the whole push.
const num = z.number().nullish().catch(undefined);
const str = z.string().max(200).nullish().catch(undefined);
const bool = z.boolean().nullish().catch(undefined);
const strnum = z.union([z.string().max(80), z.number()]).nullish().catch(undefined);
const obj = <T extends z.ZodRawShape>(shape: T) => z.object(shape).nullish().catch(undefined);

const delta = (key: string) => obj({ current: num, [key]: num });

// `rsiwatch.flags` is an object of booleans on the wire; a legacy list of names is folded into one.
const flags = z
  .preprocess(
    (v) => (Array.isArray(v) ? Object.fromEntries(v.filter((x): x is string => typeof x === 'string').map((x) => [x, true])) : v),
    z.record(z.string().max(60), z.boolean())
  )
  .nullish()
  .catch(undefined);

/** FLAT contract (the VM's /api/brief `macro`): regime groups, FX/rates and crypto all sit at the top level. */
export const macroSchema = obj({
  composite: strnum,
  curve: obj({ current: num, inverted_12m: bool }),
  hy: obj({ state: str, rise_bp: num }),
  sahm: obj({ state: str, value: num }),
  monthly_overheat: obj({ latest: num, overheat: bool }),
  fear_greed: obj({ score: num, zone_label: str }),
  vix: obj({ value: num, zone_label: str }),
  ndx_rsi: obj({ daily: num, weekly: num, monthly: num }),
  rsiwatch: obj({
    flags,
    qqqe_z: num,
    spx_wrsi: num,
    schd_wrsi: num,
    dual_oversold: bool,
    ignition_count: num,
  }),
  usdkrw: delta('change_pct'),
  dxy: delta('change_pct'),
  us10y: delta('change_bp'),
  us30y: delta('change_bp'),
  japan: obj({ jgb10y: num, jgb30y: num, usdjpy: num, jpy_chg20d_pct: num }),
  liquidity: obj({ ffr: num, ffr_chg13w: num, netliq_chg13w_pct: num, quadrant: str }),
  crypto: obj({ btc_dist_200d_pct: num, btc_below_200d: bool, eth_dist_200d_pct: num, eth_below_200d: bool }),
  europe_dist_pct: num,
  brk_dist_pct: num,
  schd_dist_pct: num,
  leader: obj({ us: str, us_gap_pct: num, kr: str, kr_reign_days: num }),
  as_of: obj({ curve: str, fear_greed: str, hy: str, rsi: str, vix: str }),
});

const sectorSchema = z.object({
  ticker: z.string().max(20),
  label: str,
  price: num,
  chg1d_pct: num,
  dist_200d_pct: num,
  above_200d: bool,
  rs_vs_ndx_20d_pct: num,
  wrsi: num,
  dist_52wh_pct: num,
  note: z.string().max(120).nullish().catch(undefined),
});

const strategySchema = z.object({
  id: z.string().max(60),
  label: z.string().max(80),
  state: z.string().max(60),
  detail: z.string().max(160).nullish().catch(undefined),
  since: str,
});

const upcomingSchema = z.object({ date: z.string().max(20), name: z.string().max(120), d_day: num });

const econSchema = z.object({
  date: z.string().max(20),
  time_kst: str,
  name: z.string().max(120),
  importance: strnum,
  consensus: strnum,
  previous: strnum,
});

export const tradesSchema = z.object({
  overall: z.enum(['ok', 'warn', 'fail']),
  checks: z
    .array(
      z.object({
        id: z.string().max(60),
        label: z.string().max(80),
        status: z.enum(['ok', 'warn', 'fail']).catch('warn'),
        cycle_date: str,
        detail: z.string().max(160).nullish().catch(undefined),
      })
    )
    .max(20)
    .catch([]),
});

export const briefBodySchema = z.object({
  as_of: z.string().min(1).max(40),
  macro: macroSchema,
  sectors: z.array(sectorSchema).max(30).catch([]),
  strategy: z.array(strategySchema).max(20).catch([]),
  upcoming: z.array(upcomingSchema).max(30).catch([]),
  econ: z.array(econSchema).max(40).catch([]),
  econ_error: str,
  trades: tradesSchema.nullish().catch(undefined),
});

export type BriefBody = z.infer<typeof briefBodySchema>;

export interface MarketBrief extends BriefBody {
  receivedAt: string; // ISO
  source: 'vm' | 'pc';
  /** The flip-to-fail alert could not be sent: the next failing push alerts again. */
  alertPending?: boolean;
}

/** Recursively drops any key matching FORBIDDEN_KEY (defense in depth after the allow-list). */
export function stripForbiddenKeys<T>(value: T): T {
  if (Array.isArray(value)) return value.map(stripForbiddenKeys) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([k]) => !FORBIDDEN_KEY.test(k))
        .map(([k, v]) => [k, stripForbiddenKeys(v)])
    ) as T;
  }
  return value;
}

/** Parses a raw push body: allow-listed fields only, forbidden keys removed. Null when `as_of` is missing/invalid. */
export function parseBrief(raw: unknown): BriefBody | null {
  const parsed = briefBodySchema.safeParse(raw);
  return parsed.success ? stripForbiddenKeys(parsed.data) : null;
}

const hoursSince = (iso: string, nowIso: string): number => (Date.parse(nowIso) - Date.parse(iso)) / 3_600_000;

export function isStale(brief: Pick<MarketBrief, 'receivedAt'>, nowIso: string, hours = MARKET_STALE_HOURS): boolean {
  const h = hoursSince(brief.receivedAt, nowIso);
  return !Number.isFinite(h) || h > hours;
}

/** True when `next` newly reports a failing trade check (it was not failing before). */
export function flippedToFail(prev: (Pick<BriefBody, 'trades'> & { alertPending?: boolean }) | null, next: Pick<BriefBody, 'trades'>): boolean {
  return next.trades?.overall === 'fail' && (prev?.trades?.overall !== 'fail' || prev.alertPending === true);
}

/** The snapshot to rotate into `prev` when a new one arrives: only when the stored one is from an earlier KST day. */
export function shouldRotate(current: Pick<MarketBrief, 'receivedAt'> | null, nowIso: string): boolean {
  return !!current && kstDateTime(current.receivedAt).date < kstDateTime(nowIso).date;
}

/** 'M/D' (KST) of an ISO instant, for "(M/D 기준)" labels. */
export function mdLabel(iso: string): string {
  const d = kstDateTime(iso).date;
  return `${Number(d.slice(5, 7))}/${Number(d.slice(8))}`;
}

/** Days from `today` to a 'YYYY-MM-DD' (for upcoming/econ filtering). */
export const daysUntil = (date: string, today: string): number => dday(date, today);

const QUADRANT_RE = /^R([\^=v])L([\^=v])$/;
const RATE_WORD = { '^': '금리↑', '=': '금리 보합', v: '금리↓' } as const;
const LIQ_WORD = { '^': '유동성↑', '=': '유동성 보합', v: '유동성↓' } as const;

/** Korean legend for the trading system's `R?L?` quadrant code (13w 10Y/FFR change +-0.20pp, net liquidity 13w +-2%);
 * null for any other code so the caller shows it raw. R^Lv is the one mixed quadrant with a fat drawdown tail. */
export function quadrantLabel(code: string): string | null {
  const m = QUADRANT_RE.exec(code.trim());
  if (!m) return null;
  const [, r, l] = m as unknown as [string, keyof typeof RATE_WORD, keyof typeof LIQ_WORD];
  return `${RATE_WORD[r]}·${LIQ_WORD[l]}${r === '^' && l === 'v' ? ' (⚠ 하락 꼬리 위험 국면)' : ''}`;
}
