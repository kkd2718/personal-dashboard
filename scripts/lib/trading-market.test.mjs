import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildMarketBrief, stripForbiddenKeys } from './trading-market.mjs';

const market = {
  as_of: '2026-11-06',
  macro_regime: {
    composite: 'neutral',
    curve: { current: 0.35, inverted_12m: true, series: [1, 2] },
    hy: { state: 'calm', rise_bp: 12 },
    sahm: { state: 'ok', value: 0.2 },
    monthly_overheat: { latest: 61, overheat: false },
  },
  fear_greed: { score: 54, zone_label: 'Neutral', history: [1, 2, 3] },
  vix: { value: 17.2, zone_label: 'Calm', points: [1] },
  ndx_rsi: { weekly: { value: 60, points: [1] }, monthly: { value: 66 } },
  rsiwatch: { flags: { qqqe: true, spx: false }, qqqe_z: -0.4, spx_wrsi: 57, schd_wrsi: 48, dual_oversold: false, ignition_count: 1 },
  regime: { phase: 'growth', allocation: { growth: 0.7 } },
};
const fx = {
  as_of: '2026-11-06',
  usdkrw: { current: 1391.2, change_pct: 0.3, points: [1] },
  dxy: { current: 104.1, change_pct: -0.2 },
  us10y: { current: 4.21, change_bp: 3 },
  us30y: { current: 4.55, change_bp: 2 },
  japan: { jgb10y: { value: 1.1 }, jgb30y: { value: 2.2 }, jpy: { usdjpy: 151.3, chg20d_pct: -1.2 } },
  liquidity: { ffr: 4.5, ffr_chg13w: 0, netliq_chg13w_pct: 1.4, quadrant: 'expansion' },
  crypto: { btc: { dist_200d_pct: 12.5, below_200d: false }, eth: { dist_200d_pct: -4.1, below_200d: true } },
  europe: { dist_pct: 3.2 },
  brk: { dist_pct: 1.1 },
  schd_pole: { dist_pct: -0.6 },
  leader: { us: { leader: 'NVDA', gap_pct: 2.5 }, kr: { leader: '삼성전자', reign_days: 14 } },
};
const rsi = { daily: { value: 55, points: [1] }, ib_sniper: { x: 1 }, vr_sniper: { y: 2 } };
const brief = {
  as_of: '2026-11-06',
  sectors: [{ ticker: 'SOXX', label: '반도체', price: 250.5, chg1d_pct: 1.2, above_200d: true, holdings_value_krw: 99 }],
  strategy: [{ id: 'soxl', label: 'SOXL 래더', state: 'OFF', detail: '대기', since: '2026-10-01', account_id: 'A1' }],
  upcoming: [{ date: '2026-11-20', name: 'DCA', d_day: 14 }],
  econ: [{ date: '2026-11-07', time_kst: '22:30', name: 'US CPI', importance: 'high' }],
  trades: { overall: 'warn', checks: [{ id: 'fill', label: '체결', status: 'warn', cycle_date: '2026-11-06', detail: '지연', qty: 5 }] },
};
const NOW = '2026-11-07T00:00:00.000Z';

describe('buildMarketBrief', () => {
  const body = buildMarketBrief({ market, fx, rsi, brief }, NOW);

  it('maps the allow-listed fields from market, fx, rsi and brief', () => {
    expect(body.as_of).toBe('2026-11-06');
    expect(body.macro.curve).toEqual({ current: 0.35, inverted_12m: true });
    expect(body.macro.composite).toBe('neutral');
    expect(body.macro.ndx_rsi).toEqual({ daily: 55, weekly: 60, monthly: 66 });
    expect(body.macro.rsiwatch.flags).toEqual({ qqqe: true, spx: false });
    expect(body.macro.japan).toEqual({ jgb10y: 1.1, jgb30y: 2.2, usdjpy: 151.3, jpy_chg20d_pct: -1.2 });
    expect(body.macro.usdkrw).toEqual({ current: 1391.2, change_pct: 0.3 });
    expect(body.macro.crypto).toEqual({ btc_dist_200d_pct: 12.5, btc_below_200d: false, eth_dist_200d_pct: -4.1, eth_below_200d: true });
    expect(body.macro.schd_dist_pct).toBe(-0.6);
    expect(body.macro.leader).toEqual({ us: 'NVDA', us_gap_pct: 2.5, kr: '삼성전자', kr_reign_days: 14 });
    expect(body.trades).toMatchObject({ overall: 'warn', checks: [{ id: 'fill', status: 'warn' }] });
  });

  it('never carries regime, sniper blocks, series, accounts, amounts or quantities', () => {
    const json = JSON.stringify(body);
    for (const leaked of ['"regime":', 'allocation', 'phase', 'ib_sniper', 'vr_sniper', 'points', 'series', 'history', 'holdings', 'account', 'qty', 'value_krw']) {
      expect(json).not.toContain(leaked);
    }
  });

  it('forwards /api/brief macro as-is when present (flat contract), still stripping forbidden keys', () => {
    const flat = { composite: 'warning', curve: { current: 0.8 }, leader: { us: 'NVDA', kr: '삼성전자' }, account_total: 5, usdkrw: { current: 1329.6, change_pct: -0.85 } };
    const b = buildMarketBrief({ market, fx, rsi, brief: { ...brief, macro: flat } }, NOW);
    expect(b.macro).toEqual({ composite: 'warning', curve: { current: 0.8 }, leader: { us: 'NVDA', kr: '삼성전자' }, usdkrw: { current: 1329.6, change_pct: -0.85 } });
  });

  it('works without /api/brief (not built yet) and falls back to the market as_of', () => {
    const b = buildMarketBrief({ market, fx, rsi, brief: null }, NOW);
    expect(b.sectors).toEqual([]);
    expect(b.trades).toBeUndefined();
    expect(b.as_of).toBe('2026-11-06');
  });

  it('null when nothing was reachable; as_of falls back to the collection date', () => {
    expect(buildMarketBrief({ market: null, fx: null, rsi: null, brief: null }, NOW)).toBeNull();
    expect(buildMarketBrief({ market: null, fx: { usdkrw: { current: 1 } }, rsi: null, brief: null }, NOW).as_of).toBe('2026-11-07');
  });

  it('ignores wrongly typed leaves instead of throwing', () => {
    const b = buildMarketBrief({ market: { vix: { value: 'x' }, fear_greed: { score: 40 } }, fx: null, rsi: null, brief: { trades: { overall: 'weird' } } }, NOW);
    expect(b.macro.vix).toBeUndefined();
    expect(b.macro.fear_greed).toEqual({ score: 40 });
    expect(b.trades).toBeUndefined();
  });
});

describe('PC fallback with the real /api/brief capture', () => {
  const live = JSON.parse(readFileSync(new URL('../../lib/logic/fixtures/trading-brief.live.json', import.meta.url), 'utf-8'));
  it('forwards the whole flat macro unchanged and drops the VM-only extras at the top level', () => {
    const b = buildMarketBrief({ market: null, fx: null, rsi: null, brief: live }, NOW);
    expect(b.macro).toEqual(live.macro);
    expect(b.as_of).toBe(live.as_of);
    expect(b.sectors).toHaveLength(live.sectors.length);
    expect(b.trades.overall).toBe(live.trades.overall);
  });
});

describe('stripForbiddenKeys', () => {
  it('removes forbidden keys at any depth', () => {
    expect(stripForbiddenKeys({ a: 1, b: [{ pnl: 2, c: 3 }], d: { 평가금액: 1, e: { account_id: 'x', f: 4 } } })).toEqual({ a: 1, b: [{ c: 3 }], d: { e: { f: 4 } } });
  });
});
