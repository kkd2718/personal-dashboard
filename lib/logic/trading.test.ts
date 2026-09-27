import { describe, expect, it } from 'vitest';
import { accountChipText, accountStateText, accountValueText, isStale, krwShort, pctText, sparklinePath, tradingOneLine } from './trading';
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
