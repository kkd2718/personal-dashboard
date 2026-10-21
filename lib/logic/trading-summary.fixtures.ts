// Test-only fixture: a fictional account summary (shape of app_meta 'trading:summary').
import type { TradingSummary } from '@/lib/types';

export const tradingSummary = (over: Partial<TradingSummary> = {}): TradingSummary => ({
  collectedAt: '2026-10-19T09:00:00+09:00',
  totalKrw: 123_456_789,
  dayChangeKrw: -1_234_567,
  dayChangePct: -1,
  fxRate: 1330,
  lastSyncOk: true,
  points: [
    { date: '2026-10-13', totalKrw: 120_000_000 },
    { date: '2026-10-14', totalKrw: 122_000_000 },
    { date: '2026-10-19', totalKrw: 123_456_789 },
  ],
  accounts: [
    { id: 'ibvr', label: 'IB+VR (해외, 실전)', group: null, currency: 'USD', totalValue: 41_234, cumReturnPct: 12.34, noData: false, reserveUsd: 18_800, status: 'ok', dormantUntil: null, lastRun: '2026-10-16', nextDue: '2026-10-23' },
    { id: 'isa', label: 'ISA (국내)', group: null, currency: 'KRW', totalValue: 25_340_000, cumReturnPct: null, sinceBaselinePct: 1.5, baselineDate: '2026-08-01', noData: false, status: 'stale', dormantUntil: null, lastRun: null, nextDue: '2026-10-30' },
    { id: 'irp', label: 'IRP', group: null, currency: 'KRW', totalValue: null, cumReturnPct: null, noData: false, status: 'ok', dormantUntil: '2026-11-01', lastRun: null, nextDue: null },
  ],
  ...over,
});
