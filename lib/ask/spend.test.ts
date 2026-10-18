import { describe, expect, it } from 'vitest';
import { budgetConfig, pace, type SpendRecord } from '@/lib/logic/ask-budget';
import { PRICES } from '@/lib/logic/ask-cost';
import { formatBudget } from '@/lib/telegram/format';
import { fakeRepo } from './fixtures';
import { addSpend, footer, loadSpend } from './spend';

const cfg = budgetConfig({});
const usage = { input_tokens: 1000, output_tokens: 100 };
const haiku = PRICES['claude-haiku-5-5'];

describe('addSpend / loadSpend', () => {
  it('writes the cycle and day keys and returns the call cost', async () => {
    const { repo, meta } = fakeRepo();
    const r = await addSpend(repo, cfg, '2026-11-07', 'ask', 'claude-haiku-5-5', usage, haiku);
    expect(r.usd).toBeCloseTo(0.00015, 8);
    expect(meta.has('ask:spend:2026-10-23')).toBe(true);
    expect(meta.has('ask:spend:day:2026-11-07')).toBe(true);
    await addSpend(repo, cfg, '2026-11-07', 'title', 'claude-haiku-5-5', usage, haiku);
    const loaded = await loadSpend(repo, cfg, '2026-11-07');
    expect(loaded.cycle).toMatchObject({ calls: 2, byFeature: { ask: expect.any(Number), title: expect.any(Number) } });
    expect(loaded.day.calls).toBe(2);
  });

  it('without a price the tokens are kept and the call is counted as unpriced', async () => {
    const { repo } = fakeRepo();
    const r = await addSpend(repo, cfg, '2026-11-07', 'ask', 'claude-haiku-5-5', usage, null);
    expect(r.usd).toBeNull();
    expect(r.record).toMatchObject({ usd: 0, calls: 1, unpricedCalls: 1 });
    expect(r.record.byModel['claude-haiku-5-5']).toMatchObject({ input: 1000, output: 100 });
  });

  it('prunes old day keys once per day', async () => {
    const { repo, meta } = fakeRepo({ meta: { 'ask:spend:day:2026-08-01': { usd: 1 }, 'ask:spend:day:2026-11-01': { usd: 1 } } });
    await addSpend(repo, cfg, '2026-11-07', 'ask', 'claude-haiku-5-5', usage, haiku);
    expect(meta.has('ask:spend:day:2026-08-01')).toBe(false);
    expect(meta.has('ask:spend:day:2026-11-01')).toBe(true);
  });
});

describe('footer', () => {
  const p = pace(cfg, '2026-11-07', 20, 'ask');
  it('always model and cost', () => {
    expect(footer('claude-haiku-5-5', 0.004, p, false)).toBe('<i>haiku · $0.004</i>');
  });
  it('with pace: remaining or ahead', () => {
    expect(footer('claude-sonnet-5-5', 0.0123, p, true)).toBe('<i>sonnet · $0.012 · 남은 $70.00 (페이스 여유)</i>');
    expect(footer('claude-haiku-5-5', 0.001, pace(cfg, '2026-11-07', 60, 'ask'), true)).toContain('페이스 초과 — Haiku만');
  });
  it('shows a downgrade reason and unpriced calls', () => {
    expect(footer('claude-haiku-5-5', null, p, false, '페이스 초과')).toBe('<i>haiku · 가격 미설정 · 페이스 초과</i>');
  });
});

describe('formatBudget', () => {
  const rec = (usd: number, calls = 3): SpendRecord => ({
    usd,
    calls,
    unpricedCalls: 1,
    byModel: { 'claude-haiku-5-5': { input: 1, output: 1, cacheWrite: 0, cacheRead: 0, usd } },
    byFeature: { ask: usd },
  });
  it('includes the cycle, reset date and pace status', () => {
    const out = formatBudget(pace(cfg, '2026-11-07', 30, 'ask'), { cycle: rec(30), day: rec(1.5, 2) }, '2026-11-07');
    expect(out).toContain('10/23–11/22');
    expect(out).toContain('16/31일째');
    expect(out).toContain('페이스 여유 $18.45');
    expect(out).toContain('남은 $60.00');
    expect(out).toContain('초기화 11/23');
    expect(out).toContain('haiku $30.00');
    expect(out).toContain('가격 미설정 호출 1회');
  });
  it('flags exceeding the pace', () => {
    const out = formatBudget(pace(cfg, '2026-11-07', 60, 'ask'), { cycle: rec(60), day: rec(0, 0) }, '2026-11-07');
    expect(out).toContain('페이스 초과 $11.55');
  });
});
