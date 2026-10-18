// Test-only fixtures for the market snapshot tests.
import type { BriefBody, MarketBrief } from '@/lib/logic/market-brief';

/** A raw VM push body: allow-listed fields plus a pile of things that must never be stored. */
export const rawBody = (over: Record<string, unknown> = {}) => ({
  as_of: '2026-11-06',
  macro: {
    composite: 'neutral',
    curve: { current: 0.35, inverted_12m: true },
    hy: { state: 'calm', rise_bp: 12 },
    sahm: { state: 'ok', value: 0.2 },
    monthly_overheat: { latest: 61, overheat: false },
    fear_greed: { score: 54, zone_label: 'Neutral' },
    vix: { value: 17.2, zone_label: 'Calm' },
    ndx_rsi: { daily: 55, weekly: 60, monthly: 66 },
    rsiwatch: { flags: { qqqe: true, spx: false }, qqqe_z: -0.4, spx_wrsi: 57, schd_wrsi: 48, dual_oversold: false, ignition_count: 1 },
    usdkrw: { current: 1391.2, change_pct: 0.3, series: [1, 2, 3] },
    dxy: { current: 104.1, change_pct: -0.2 },
    us10y: { current: 4.21, change_bp: 3 },
    us30y: { current: 4.55, change_bp: 2 },
    japan: { jgb10y: 1.1, jgb30y: 2.2, usdjpy: 151.3, jpy_chg20d_pct: -1.2 },
    liquidity: { ffr: 4.5, ffr_chg13w: 0, netliq_chg13w_pct: 1.4, quadrant: 'expansion' },
    crypto: { btc_dist_200d_pct: 12.5, btc_below_200d: false, eth_dist_200d_pct: -4.1, eth_below_200d: true },
    europe_dist_pct: 3.2,
    brk_dist_pct: 1.1,
    schd_dist_pct: -0.6,
    leader: { us: 'NVDA', us_gap_pct: 2.5, kr: '삼성전자', kr_reign_days: 14 },
    as_of: { curve: '2026-11-06', fear_greed: '2026-11-06', hy: '2026-11-06', rsi: '2026-11-06', vix: '2026-11-06' },
  },
  sectors: [{ ticker: 'SOXX', label: '반도체', price: 250.5, chg1d_pct: 1.2, dist_200d_pct: 8, above_200d: true, rs_vs_ndx_20d_pct: 2, wrsi: 61, dist_52wh_pct: -3 }],
  strategy: [{ id: 'soxl', label: 'SOXL 래더', state: 'OFF', detail: '대기', since: '2026-10-01' }],
  upcoming: [{ date: '2026-11-20', name: 'DCA', d_day: 14 }],
  econ: [
    { date: '2026-11-07', time_kst: '22:30', name: 'US CPI', importance: 'high', consensus: '3.1%', previous: '3.0%' },
    { date: '2026-11-07', time_kst: '23:00', name: 'Minor data', importance: 'low' },
    { date: '2026-11-08', time_kst: '04:00', name: 'FOMC minutes', importance: 3 },
    { date: '2026-11-12', time_kst: '22:30', name: 'Far event', importance: 'high' },
  ],
  trades: {
    overall: 'ok',
    checks: [
      { id: 'sent', label: '주문 전송', status: 'ok', cycle_date: '2026-11-06', detail: '4건' },
      { id: 'fill', label: '체결', status: 'ok', cycle_date: '2026-11-06', detail: '실패 0' },
    ],
  },
  // --- must never be stored ---
  regime: { phase: 'growth', allocation: { growth: 0.7 } },
  accounts: [{ label: 'ACCT-SECRET', total_value: 123456789 }],
  rsi: { ib_sniper: { x: 1 }, vr_sniper: { y: 2 } },
  ...over,
});

export const brief = (over: Partial<MarketBrief> = {}): MarketBrief => ({
  ...(rawBodyParsed() as BriefBody),
  receivedAt: '2026-11-07T00:00:00.000Z',
  source: 'vm',
  ...over,
});

import { parseBrief } from '@/lib/logic/market-brief';
function rawBodyParsed(): BriefBody {
  return parseBrief(rawBody())!;
}
