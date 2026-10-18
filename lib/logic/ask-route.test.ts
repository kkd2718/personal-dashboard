import { describe, expect, it } from 'vitest';
import { budgetConfig, pace } from './ask-budget';
import { PRICES } from './ask-cost';
import { chooseModel, complexityOf, type RouteInput } from './ask-route';

const cfg = budgetConfig({});
const MID = '2026-11-07'; // dayIndex 15: allowed ~48.45, limit 90
const input = (over: Partial<RouteInput> & { spent?: number } = {}): RouteInput => ({
  modifier: null,
  complexity: null,
  prices: PRICES,
  pace: pace(cfg, MID, over.spent ?? 0, 'ask'),
  ...over,
});
const reason = (top: number, margin: number) => ({ choice: 'reason' as const, top, margin });

describe('chooseModel', () => {
  it('exhausted stops with the reset date', () => {
    const d = chooseModel(input({ spent: 90 }));
    expect(d).toMatchObject({ stop: true });
    expect('reason' in d && d.reason).toContain('2026-11-23');
  });
  it('ahead of pace downgrades /ask! to haiku', () => {
    expect(chooseModel(input({ spent: 60, modifier: '!' }))).toMatchObject({ model: 'claude-haiku-5-5', downgraded: true, reason: '페이스 초과' });
  });
  it('confident reason goes to sonnet, shaky or missing goes to haiku', () => {
    expect(chooseModel(input({ complexity: reason(0.7, 0.3) }))).toMatchObject({ model: 'claude-sonnet-5-5', downgraded: false });
    expect(chooseModel(input({ complexity: reason(0.62, 0.1) }))).toMatchObject({ model: 'claude-haiku-5-5' });
    expect(chooseModel(input({ complexity: null }))).toMatchObject({ model: 'claude-haiku-5-5' });
    expect(chooseModel(input({ complexity: { choice: 'lookup', top: 0.9, margin: 0.8 } }))).toMatchObject({ model: 'claude-haiku-5-5' });
  });
  it('modifiers pick sonnet/opus under pace', () => {
    expect(chooseModel(input({ modifier: '+' }))).toMatchObject({ model: 'claude-sonnet-5-5' });
    expect(chooseModel(input({ modifier: '!' }))).toMatchObject({ model: 'claude-opus-5-5' });
  });
  it('a big call may not jump the pace line', () => {
    expect(chooseModel(input({ spent: 48.4, modifier: '!' }))).toMatchObject({ model: 'claude-haiku-5-5', downgraded: true });
  });
  it('unknown price falls back to haiku; unknown haiku price is still allowed', () => {
    expect(chooseModel(input({ modifier: '+', prices: { ...PRICES, 'claude-sonnet-5-5': null } }))).toMatchObject({
      model: 'claude-haiku-5-5',
      downgraded: true,
      reason: '가격 미설정',
    });
    expect(chooseModel(input({ prices: { ...PRICES, 'claude-haiku-5-5': null } }))).toMatchObject({ model: 'claude-haiku-5-5' });
  });
  it('haiku worst case beyond the limit stops', () => {
    expect(chooseModel(input({ spent: 89.999 }))).toMatchObject({ stop: true });
  });
  it('follow-ups reuse the previous model but obey the same rules', () => {
    expect(chooseModel(input({ followUpModel: 'claude-sonnet-5-5' }))).toMatchObject({ model: 'claude-sonnet-5-5' });
    expect(chooseModel(input({ followUpModel: 'claude-sonnet-5-5', spent: 60 }))).toMatchObject({ model: 'claude-haiku-5-5', downgraded: true });
  });
});

describe('complexityOf', () => {
  it('accepts only the three choices', () => {
    expect(complexityOf({ type: 'choice', choice: 'reason', top: 0.8, margin: 0.5, probabilities: null })).toEqual({ choice: 'reason', top: 0.8, margin: 0.5 });
    expect(complexityOf({ type: 'choice', choice: 'weird', top: 1, margin: 1, probabilities: null })).toBeNull();
    expect(complexityOf({ type: 'noul', p: 1 })).toBeNull();
    expect(complexityOf(undefined)).toBeNull();
  });
});
