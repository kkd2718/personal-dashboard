import { describe, expect, it } from 'vitest';
import { parseBrief } from './market-brief';
import { rawBody } from './market-brief.fixtures';
import { accountsToSummary, shouldWriteSummary, accountReturnText, accountChipText, accountStateText, accountValueText, isStale, krwShort, pctText, sparklinePath, tradingOneLine } from './trading';
import type { TradingAccountSummary, TradingSummary } from '@/lib/types';

const acct = (over: Partial<TradingAccountSummary>): TradingAccountSummary => ({
  id: 'a', label: 'A', group: null, currency: 'KRW', totalValue: 1000000, cumReturnPct: 1, noData: false,
  status: 'ok', dormantUntil: null, lastRun: null, nextDue: '2026-09-28', ...over,
});

describe('trading formatting', () => {
  it('krwShort', () => {
    expect(krwShort(123456789)).toBe('1억 2,346만원');
    expect(krwShort(23456789)).toBe('2,346만원');
    expect(krwShort(200000000)).toBe('2억원');
    expect(krwShort(9999)).toBe('9,999원');
    expect(krwShort(-35000)).toBe('-4만원');
  });

  it('pctText', () => {
    expect(pctText(0.43)).toBe('+0.4%');
    expect(pctText(-1.25)).toBe('-1.2%');
    expect(pctText(0)).toBe('0.0%');
  });

  it('account value and state', () => {
    expect(accountValueText(acct({ currency: 'USD', totalValue: 12345.6 }))).toBe('$12,346');
    expect(accountValueText(acct({ totalValue: null }))).toBeNull();
    expect(accountValueText(acct({ totalValue: null, reserveUsd: 16000 }))).toBe('$16,000 대기');
    expect(accountStateText(acct({ dormantUntil: '2026-10-01', noData: true }), '2026-09-27')).toBe('10/1 시작');
    expect(accountStateText(acct({ noData: true }), '2026-09-27')).toBe('데이터 없음');
    expect(accountStateText(acct({}), '2026-09-27')).toBe('다음 9/28');
  });

  it('one line counts running accounts (dormant/no-data excluded)', () => {
    const s = {
      totalKrw: 123456789, dayChangePct: 0.43, accounts: [acct({}), acct({ id: 'b' }), acct({ id: 'c', dormantUntil: '2026-10-01', noData: true })],
    } as TradingSummary;
    expect(tradingOneLine(s, '2026-09-27')).toBe('1억 2,346만원 · 오늘 +0.4% · 운용 2/3');
  });

  it('sparkline', () => {
    expect(sparklinePath([{ totalKrw: 1 }], 10, 10)).toBeNull();
    expect(sparklinePath([{ totalKrw: 1 }, { totalKrw: 3 }], 10, 10)).toBe('M0.0,10.0 L10.0,0.0');
  });
});

describe('home strip helpers', () => {
  it('chip text drops the parenthesised note and 원', () => {
    expect(accountChipText(acct({ label: 'ISA (국내)', totalValue: 25340000 }), '2026-09-27')).toBe('ISA 2,534만');
    expect(accountChipText(acct({ label: 'IB+VR (해외, 실전)', dormantUntil: '2026-10-01', noData: true }), '2026-09-27')).toBe('IB+VR 10/1 시작');
    expect(accountChipText(acct({ label: 'X', totalValue: null }), '2026-09-27')).toBe('X —');
  });

  it('isStale', () => {
    const s = { collectedAt: '2026-09-27T00:00:00Z' } as TradingSummary;
    expect(isStale(s, Date.parse('2026-09-27T10:00:00Z'))).toBe(false);
    expect(isStale(s, Date.parse('2026-09-28T12:00:00Z'))).toBe(true);
  });
});

describe('accountReturnText', () => {
  it('cumulative first, else since-baseline with its start date', () => {
    expect(accountReturnText(acct({ cumReturnPct: 3.21 }))).toBe('+3.2%');
    expect(accountReturnText(acct({ cumReturnPct: null, sinceBaselinePct: -0.44, baselineDate: '2026-08-01' }))).toBe('-0.4% · 8/1~');
    expect(accountReturnText(acct({ cumReturnPct: null }))).toBeNull();
  });
});

describe('accountsToSummary / shouldWriteSummary', () => {
  const NOW = '2026-11-07T01:00:00.000Z';
  const wire = (over: Record<string, unknown> = {}) =>
    parseBrief(rawBody({
      accounts: {
        collected_at: '2026-11-07T00:00:00.000Z',
        total_krw: 1000,
        day_change_krw: 10,
        day_change_pct: 1,
        fx_rate: 1330,
        points: [{ date: '2026-11-06', total_krw: 990 }],
        items: [
          { id: 'ibvr', label: 'IB+VR', currency: 'USD', total_value: 5, cum_return_pct: 2, reserve_usd: 7, status: 'ok', next_due: '2026-11-13' },
          { id: 'irp', label: 'IRP', total_value: null, dormant_until: '2026-12-01' },
        ],
        ...over,
      },
    }))!.accounts;

  it('maps snake_case to the stored shape with null defaults', () => {
    expect(accountsToSummary(wire(), NOW)).toEqual({
      collectedAt: '2026-11-07T00:00:00.000Z',
      totalKrw: 1000,
      dayChangeKrw: 10,
      dayChangePct: 1,
      fxRate: 1330,
      lastSyncOk: null,
      points: [{ date: '2026-11-06', totalKrw: 990 }],
      accounts: [
        { id: 'ibvr', label: 'IB+VR', group: null, currency: 'USD', totalValue: 5, cumReturnPct: 2, sinceBaselinePct: null, baselineDate: null, noData: false, reserveUsd: 7, status: 'ok', dormantUntil: null, lastRun: null, nextDue: '2026-11-13' },
        { id: 'irp', label: 'IRP', group: null, currency: null, totalValue: null, cumReturnPct: null, sinceBaselinePct: null, baselineDate: null, noData: true, reserveUsd: null, status: null, dormantUntil: '2026-12-01', lastRun: null, nextDue: null },
      ],
    });
  });

  it('falls back to now without collected_at; null for an empty section', () => {
    expect(accountsToSummary(wire({ collected_at: undefined }), NOW)?.collectedAt).toBe(NOW);
    expect(accountsToSummary(undefined, NOW)).toBeNull();
    expect(accountsToSummary(wire({ total_krw: null, items: [] }), NOW)).toBeNull();
  });

  it('precedence: VM wins unless older than stored; PC only over a missing or > 6 h old summary', () => {
    const at = (iso: string) => ({ collectedAt: iso });
    const stored = at('2026-11-07T00:30:00.000Z');
    expect(shouldWriteSummary(null, at('2026-11-07T00:00:00.000Z'), 'pc', NOW)).toBe(true);
    expect(shouldWriteSummary(stored, at('2026-11-07T00:40:00.000Z'), 'vm', NOW)).toBe(true);
    expect(shouldWriteSummary(stored, at('2026-11-07T00:30:00.000Z'), 'vm', NOW)).toBe(true);
    expect(shouldWriteSummary(stored, at('2026-11-07T00:10:00.000Z'), 'vm', NOW)).toBe(false);
    const vm = (iso: string) => ({ collectedAt: iso, source: 'vm' as const });
    const pc = (iso: string) => ({ collectedAt: iso, source: 'pc' as const });
    expect(shouldWriteSummary(pc('2026-11-07T00:30:00.000Z'), at(NOW), 'pc', NOW)).toBe(true); // hourly PC refresh
    expect(shouldWriteSummary(at('2026-11-07T00:30:00.000Z'), at(NOW), 'pc', NOW)).toBe(true); // legacy record without source
    expect(shouldWriteSummary(vm('2026-11-07T00:30:00.000Z'), at(NOW), 'pc', NOW)).toBe(false); // fresh VM
    expect(shouldWriteSummary(vm('2026-11-06T18:00:00.000Z'), at(NOW), 'pc', NOW)).toBe(true); // stale VM
  });

  it('a future or offset-less collected_at falls back to the receive time; duplicate ids keep the first', () => {
    expect(accountsToSummary(wire({ collected_at: '2026-11-08T00:00:00.000Z' }), NOW)?.collectedAt).toBe(NOW);
    expect(accountsToSummary(wire({ collected_at: '2026-11-07T01:05:00.000Z' }), NOW)?.collectedAt).toBe('2026-11-07T01:05:00.000Z'); // within 10 min
    // naive KST timestamp (09:00 KST == 00:00Z) arrives without an offset: the schema drops it, so now is used
    expect(accountsToSummary(wire({ collected_at: '2026-11-07T10:00:00' }), NOW)?.collectedAt).toBe(NOW);
    const dup = accountsToSummary(wire({ items: [{ id: 'a', label: 'first' }, { id: 'a', label: 'second' }, { id: 'b', label: 'B' }] }), NOW)!;
    expect(dup.accounts.map((x) => x.label)).toEqual(['first', 'B']);
  });
});
