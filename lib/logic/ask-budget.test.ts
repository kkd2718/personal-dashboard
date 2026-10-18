import { describe, expect, it } from 'vitest';
import { addCall, budgetConfig, cycleOf, emptySpend, pace, spendCycleKey, spendDayKey } from './ask-budget';

const cfg = budgetConfig({});

describe('budgetConfig', () => {
  it('defaults and clamps', () => {
    expect(cfg).toEqual({ creditUsd: 100, startDay: 23, reservePct: 10, slackUsd: 2 });
    expect(budgetConfig({ ASK_CYCLE_START_DAY: '31' }).startDay).toBe(28);
    expect(budgetConfig({ ASK_RESERVE_PCT: '90' }).reservePct).toBe(50);
    expect(budgetConfig({ ASK_CYCLE_CREDIT_USD: 'abc' }).creditUsd).toBe(100);
  });
});

describe('cycleOf', () => {
  it('start day itself', () => {
    expect(cycleOf('2026-10-23', 23)).toEqual({ start: '2026-10-23', nextStart: '2026-11-23', days: 31, dayIndex: 0 });
  });
  it('after the start day, next month', () => {
    expect(cycleOf('2026-11-05', 23)).toMatchObject({ start: '2026-10-23', dayIndex: 13 });
  });
  it('before the start day, previous month', () => {
    expect(cycleOf('2026-10-22', 23)).toEqual({ start: '2026-09-23', nextStart: '2026-10-23', days: 30, dayIndex: 29 });
  });
  it('year wrap and clamped start day', () => {
    expect(cycleOf('2027-01-10', 23).start).toBe('2026-12-23');
    expect(cycleOf('2026-10-28', 31).start).toBe('2026-10-28');
  });
  it('February cycle length', () => {
    expect(cycleOf('2027-02-24', 23)).toMatchObject({ start: '2027-02-23', nextStart: '2027-03-23', days: 28 });
  });
});

describe('pace', () => {
  it('day 1 is never starved', () => {
    const p = pace(cfg, '2026-10-23', 0, 'ask');
    expect(p.usableUsd).toBe(90);
    expect(p.allowedUsd).toBeCloseTo(4.9, 2);
    expect(p.ahead).toBe(false);
  });
  it('mid cycle', () => {
    const under = pace(cfg, '2026-11-07', 30, 'ask');
    expect(under.cycle.dayIndex).toBe(15);
    expect(under.allowedUsd).toBeCloseTo(48.45, 2);
    expect(under.ahead).toBe(false);
    expect(pace(cfg, '2026-11-07', 50, 'ask').ahead).toBe(true);
  });
  it('the reserve is only for mail/other', () => {
    expect(pace(cfg, '2026-11-07', 90, 'ask').exhausted).toBe(true);
    expect(pace(cfg, '2026-11-07', 90, 'mail').exhausted).toBe(false);
    expect(pace(cfg, '2026-11-07', 90, 'title').exhausted).toBe(true);
    expect(pace(cfg, '2026-11-07', 20, 'mail').limitUsd).toBe(100);
  });
  it('allowed never exceeds the limit; remaining floors at 0', () => {
    const p = pace(cfg, '2026-11-22', 95, 'ask');
    expect(p.allowedUsd).toBe(90);
    expect(p.remainingUsd).toBe(0);
  });
  it('no reserve: usable equals credit', () => {
    expect(pace(budgetConfig({ ASK_RESERVE_PCT: '0' }), '2026-10-23', 0, 'ask').usableUsd).toBe(100);
  });
});

describe('ledger keys and addCall', () => {
  it('keys', () => {
    expect(spendCycleKey(cycleOf('2026-10-25', 23))).toBe('ask:spend:2026-10-23');
    expect(spendDayKey('2026-10-25')).toBe('ask:spend:day:2026-10-25');
  });
  it('accumulates by model and feature; unpriced keeps tokens only', () => {
    const u = { input: 10, output: 5, cacheWrite: 0, cacheRead: 2 };
    let r = addCall(null, 'ask', 'm', u, 0.5);
    r = addCall(r, 'title', 'm', u, null);
    expect(r).toMatchObject({ usd: 0.5, calls: 2, unpricedCalls: 1, byFeature: { ask: 0.5, title: 0 } });
    expect(r.byModel.m).toMatchObject({ input: 20, output: 10, cacheRead: 4, usd: 0.5 });
    expect(emptySpend().calls).toBe(0);
  });
});
