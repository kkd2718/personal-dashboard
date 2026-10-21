import { describe, expect, it } from 'vitest';
import { alertItemId, alertTitle, type TradingAlert } from './trading-alert';
import * as probe from '../../scripts/lib/trading-probe.mjs';

const alert = (over: Partial<TradingAlert>): TradingAlert => ({ severity: 'critical', message: 'm', ...over });
const STALE = (h: string) => `마지막 동기화 ${h}시간 전 -- STALE (기준 54시간)`;

// The TS helpers and the collector's .mjs mirror must agree.
describe.each([
  ['lib/logic/trading-alert.ts', { alertItemId, alertTitle }],
  ['scripts/lib/trading-probe.mjs', probe],
])('%s', (_name, f) => {
  it('same kind with a different number in the message -> same id', () => {
    expect(f.alertItemId(alert({ kind: 'sync_stale', message: STALE('1.8') }))).toBe(f.alertItemId(alert({ kind: 'sync_stale', message: STALE('2.8') })));
  });

  it('kind plus state_id/label separates accounts; the same account stays stable', () => {
    const a = (label: string, n: number) => f.alertItemId(alert({ kind: 'orders_failed', label, message: `${label} 주문 ${n}건 실패` }));
    expect(a('ISA', 2)).not.toBe(a('IB+VR', 2));
    expect(a('ISA', 2)).toBe(a('ISA', 5));
    expect(f.alertItemId(alert({ kind: 'orders_failed', state_id: 's1', label: 'x' }))).toBe('trading:alert:orders_failed:s1');
  });

  it('sync_failed (warn, < 54 h) and sync_stale (critical) get distinct ids; sync_failed keeps its own text', () => {
    const failed = alert({ kind: 'sync_failed', severity: 'warn', message: '동기화 실패 (마지막 성공 1.8시간 전, 기준 54시간)' });
    const stale = alert({ kind: 'sync_stale', message: STALE('60') });
    expect(f.alertItemId(failed)).toBe('trading:alert:sync_failed');
    expect(f.alertItemId(failed)).not.toBe(f.alertItemId(stale));
    expect(f.alertTitle(failed)).toBe(failed.message); // the remap is only for the legacy sync_stale text
  });

  it('without a kind, digits and decimals are stripped from the message-based id', () => {
    const id = (m: string) => f.alertItemId(alert({ message: m }));
    expect(id('체결 3건 지연 (2026-10-21 09:00)')).toBe(id('체결 7건 지연 (2026-10-22 10:30)'));
    expect(id('체결 3건 지연')).not.toBe(id('주문 3건 지연'));
  });

  it('a fresh sync-stale age reads as a sync failure; a real stale age keeps its text', () => {
    expect(f.alertTitle(alert({ kind: 'sync_stale', message: STALE('1.8') }))).toBe('트레이딩 동기화 실패 (VM 접속)');
    expect(f.alertTitle(alert({ message: STALE('1.8') }))).toBe('트레이딩 동기화 실패 (VM 접속)'); // no kind: matched by text
    const old = STALE('60');
    expect(f.alertTitle(alert({ kind: 'sync_stale', message: old }))).toBe(old);
    expect(f.alertTitle(alert({ kind: 'orders_failed', message: '주문 2건 실패' }))).toBe('주문 2건 실패');
  });
});
