import { describe, expect, it } from 'vitest';
import { buildTradingSummary } from './trading-summary.mjs';

// Fictional numbers only.
const overview = {
  grand_total: { real_total_krw: 12345678, fx_rate: 1400 },
  last_sync: { ok: true },
  accounts: [
    { state_id: 'lump', label: 'Fic Lump', group: 'lump_sum', no_data: true, reserve_usd: 100 },
    {
      state_id: 'dca', label: 'Fic DCA', group: 'recurring', currency: 'KRW', no_data: false,
      total_value: 5000000, cum_return_pct: 3.2, dca_info: { since_baseline: { pnl_since_baseline_pct: 1.5 }, baseline: { first_seen_date: '2026-08-01' } }, sub_accounts: { a: { assets: { X: {} } } }, cash: 10,
    },
  ],
};
const health = { daemons: [
  { state_id: 'lump', status: 'ok', dormant: true, dormant_until: '2026-10-01', last_run: '2026-07-31', next_due: '2026-09-28' },
  { state_id: 'dca', status: 'ok', dormant: false, last_run: '2026-09-25', next_due: '2026-09-28' },
] };
const trend = { day_change_krw: -1200, day_change_pct: -0.1, points: [{ date: '2026-09-21', total_krw: 12300000 }, { date: 'bad', total_krw: 'x' }] };

describe('buildTradingSummary', () => {
  it('keeps totals, week points and per-account summary; drops holdings/cash', () => {
    const s = buildTradingSummary(overview, health, trend, '2026-09-27T00:00:00Z');
    expect(s.totalKrw).toBe(12345678);
    expect(s.dayChangePct).toBe(-0.1);
    expect(s.points).toEqual([{ date: '2026-09-21', totalKrw: 12300000 }]);
    expect(s.accounts[0]).toMatchObject({ id: 'lump', noData: true, totalValue: null, dormantUntil: '2026-10-01' });
    expect(s.accounts[1]).toMatchObject({ id: 'dca', totalValue: 5000000, cumReturnPct: 3.2, sinceBaselinePct: 1.5, baselineDate: '2026-08-01', dormantUntil: null, nextDue: '2026-09-28' });
    expect(JSON.stringify(s)).not.toMatch(/sub_accounts|assets|cash/);
  });

  it('null without an overview', () => {
    expect(buildTradingSummary(null, health, trend, 'x')).toBeNull();
  });
});
