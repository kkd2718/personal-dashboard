// Plain JS, Node >=18. PC-collector FALLBACK for the market-only snapshot the trading VM normally
// pushes to POST /api/trading/brief (same body shape, lib/logic/market-brief.ts). GET-only against
// the local trading dashboard; responses can take 20-30 s, so 45 s timeout and all four in parallel.
//
// ALLOW-LIST ONLY. Never copied: market.regime (portfolio phase/allocation), rsi.ib_sniper,
// rsi.vr_sniper, /api/calendar, any `points`/series arrays, anything per-account. A final recursive
// filter drops keys matching FORBIDDEN_KEY as a second line of defense (the cloud filters again).

const TIMEOUT_MS = 45000;
export const FORBIDDEN_KEY = /amount|qty|quantity|value_krw|balance|account|holding|weight|pnl|평가|수량|금액/i;

async function getJson(baseUrl, path) {
  try {
    const res = await fetch(`${baseUrl}${path}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const str = (v) => (typeof v === 'string' && v ? v : undefined);
const bool = (v) => (typeof v === 'boolean' ? v : undefined);
const strnum = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : str(v));

/** Drops undefined/empty-object entries so the payload stays small and the cloud sees only real values. */
function compact(value) {
  if (Array.isArray(value)) return value.map(compact);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      const c = compact(v);
      if (c === undefined || (c && typeof c === 'object' && !Array.isArray(c) && Object.keys(c).length === 0)) continue;
      out[k] = c;
    }
    return out;
  }
  return value === null ? undefined : value;
}

export function stripForbiddenKeys(value) {
  if (Array.isArray(value)) return value.map(stripForbiddenKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([k]) => !FORBIDDEN_KEY.test(k))
        .map(([k, v]) => [k, stripForbiddenKeys(v)])
    );
  }
  return value;
}

const cur = (o, chgKey) => ({ current: num(o?.current), [chgKey]: num(o?.[chgKey]) });

/** @param {any} market @param {any} fx @param {any} rsi */
export function buildMacro(market, fx, rsi) {
  const mr = market?.macro_regime;
  return compact({
    macro_regime: mr && {
      composite: strnum(mr.composite),
      curve: { current: num(mr.curve?.current), inverted_12m: bool(mr.curve?.inverted_12m) },
      hy: { state: str(mr.hy?.state), rise_bp: num(mr.hy?.rise_bp) },
      sahm: { state: str(mr.sahm?.state), value: num(mr.sahm?.value) },
      monthly_overheat: { latest: num(mr.monthly_overheat?.latest), overheat: bool(mr.monthly_overheat?.overheat) },
    },
    fear_greed: market?.fear_greed && { score: num(market.fear_greed.score), zone_label: str(market.fear_greed.zone_label) },
    vix: market?.vix && { value: num(market.vix.value), zone_label: str(market.vix.zone_label) },
    ndx_rsi: { daily: num(rsi?.daily?.value), weekly: num(market?.ndx_rsi?.weekly?.value), monthly: num(market?.ndx_rsi?.monthly?.value) },
    rsiwatch: market?.rsiwatch && {
      flags: Array.isArray(market.rsiwatch.flags) ? market.rsiwatch.flags.filter((f) => typeof f === 'string').slice(0, 10) : undefined,
      qqqe_z: num(market.rsiwatch.qqqe_z),
      spx_wrsi: num(market.rsiwatch.spx_wrsi),
      schd_wrsi: num(market.rsiwatch.schd_wrsi),
      dual_oversold: bool(market.rsiwatch.dual_oversold),
      ignition_count: num(market.rsiwatch.ignition_count),
    },
    fx: fx && {
      usdkrw: cur(fx.usdkrw, 'change_pct'),
      dxy: cur(fx.dxy, 'change_pct'),
      us10y: cur(fx.us10y, 'change_bp'),
      us30y: cur(fx.us30y, 'change_bp'),
      japan: {
        jgb10y: num(fx.japan?.jgb10y?.value),
        jgb30y: num(fx.japan?.jgb30y?.value),
        usdjpy: num(fx.japan?.jpy?.usdjpy),
        jpy_chg20d_pct: num(fx.japan?.jpy?.chg20d_pct),
      },
      liquidity: {
        ffr: num(fx.liquidity?.ffr),
        ffr_chg13w: num(fx.liquidity?.ffr_chg13w),
        netliq_chg13w_pct: num(fx.liquidity?.netliq_chg13w_pct),
        quadrant: str(fx.liquidity?.quadrant),
      },
      crypto: {
        btc: { dist_200d_pct: num(fx.crypto?.btc?.dist_200d_pct), below_200d: bool(fx.crypto?.btc?.below_200d) },
        eth: { dist_200d_pct: num(fx.crypto?.eth?.dist_200d_pct), below_200d: bool(fx.crypto?.eth?.below_200d) },
      },
      europe: { dist_pct: num(fx.europe?.dist_pct) },
      brk: { dist_pct: num(fx.brk?.dist_pct) },
      schd_pole: { dist_pct: num(fx.schd_pole?.dist_pct) },
      leader: {
        us: { leader: str(fx.leader?.us?.leader), gap_pct: num(fx.leader?.us?.gap_pct) },
        kr: { leader: str(fx.leader?.kr?.leader), reign_days: num(fx.leader?.kr?.reign_days) },
      },
    },
    as_of: { market: str(market?.as_of), fx: str(fx?.as_of), rsi: str(rsi?.as_of) },
  });
}

const arr = (v, max) => (Array.isArray(v) ? v.slice(0, max) : []);

/**
 * Pure: raw endpoint JSON -> push body, or null when nothing at all was reachable.
 * @param {{market:any, fx:any, rsi:any, brief:any}} raw @param {string} collectedAt ISO
 */
export function buildMarketBrief(raw, collectedAt) {
  const { market, fx, rsi, brief } = raw;
  if (!market && !fx && !rsi && !brief) return null;
  const macro = buildMacro(market, fx, rsi);
  const body = {
    as_of: str(brief?.as_of) ?? str(market?.as_of) ?? collectedAt.slice(0, 10),
    macro,
    sectors: arr(brief?.sectors, 30).map((s) =>
      compact({
        ticker: str(s.ticker) ?? '?',
        label: str(s.label),
        price: num(s.price),
        chg1d_pct: num(s.chg1d_pct),
        dist_200d_pct: num(s.dist_200d_pct),
        above_200d: bool(s.above_200d),
        rs_vs_ndx_20d_pct: num(s.rs_vs_ndx_20d_pct),
        wrsi: num(s.wrsi),
        dist_52wh_pct: num(s.dist_52wh_pct),
        note: str(s.note),
      })
    ),
    strategy: arr(brief?.strategy, 20).map((s) =>
      compact({ id: str(s.id) ?? '?', label: str(s.label) ?? '?', state: str(s.state) ?? '?', detail: str(s.detail), since: str(s.since) })
    ),
    upcoming: arr(brief?.upcoming, 30).map((u) => compact({ date: str(u.date) ?? '?', name: str(u.name) ?? '?', d_day: num(u.d_day) })),
    econ: arr(brief?.econ, 40).map((x) =>
      compact({
        date: str(x.date) ?? '?',
        time_kst: str(x.time_kst),
        name: str(x.name) ?? '?',
        importance: strnum(x.importance),
        consensus: strnum(x.consensus),
        previous: strnum(x.previous),
      })
    ),
    ...(str(brief?.econ_error) ? { econ_error: str(brief.econ_error) } : {}),
    ...(brief?.trades && ['ok', 'warn', 'fail'].includes(brief.trades.overall)
      ? {
          trades: {
            overall: brief.trades.overall,
            checks: arr(brief.trades.checks, 20).map((c) =>
              compact({
                id: str(c.id) ?? '?',
                label: str(c.label) ?? '?',
                status: ['ok', 'warn', 'fail'].includes(c.status) ? c.status : 'warn',
                cycle_date: str(c.cycle_date),
                detail: str(c.detail),
              })
            ),
          },
        }
      : {}),
  };
  return stripForbiddenKeys(body);
}

/** GET-only fetch + build. Never throws; null when the dashboard is off or serves nothing. `/api/brief` may 404 (not built yet): skipped silently. */
export async function tradingMarketBrief(baseUrl, collectedAt) {
  const [market, fx, rsi, brief] = await Promise.all(['/api/market', '/api/fx', '/api/rsi', '/api/brief'].map((p) => getJson(baseUrl, p)));
  return buildMarketBrief({ market, fx, rsi, brief }, collectedAt);
}
