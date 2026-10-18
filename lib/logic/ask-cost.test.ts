import { describe, expect, it } from 'vitest';
import { PRICES, costUsd, loadPrices, pricesKnown, worstCaseUsd } from './ask-cost';

const sonnet = PRICES['claude-sonnet-5-5']!;
const haiku = PRICES['claude-haiku-5-5']!;

describe('costUsd', () => {
  it('prices all four token kinds (cache writes default to the 5m rate)', () => {
    const u = { input_tokens: 1000, output_tokens: 500, cache_creation_input_tokens: 2000, cache_read_input_tokens: 4000 };
    expect(costUsd(sonnet, u)).toBeCloseTo(0.0124, 6);
  });
  it('uses the 1h write rate for the 1h share', () => {
    const u = {
      input_tokens: 1000,
      output_tokens: 500,
      cache_creation_input_tokens: 2000,
      cache_read_input_tokens: 4000,
      cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 2000 },
    };
    expect(costUsd(sonnet, u)).toBeCloseTo(0.0154, 6);
  });
  it('thinking tokens are part of output_tokens (billed as output)', () => {
    expect(costUsd(sonnet, { input_tokens: 0, output_tokens: 1_000_000 })).toBe(10);
  });
  it('Haiku switches tier above 100k prompt tokens (cache counts toward the prompt)', () => {
    expect(costUsd(haiku, { input_tokens: 100_000, output_tokens: 1000 })).toBeCloseTo(0.0105, 6);
    expect(costUsd(haiku, { input_tokens: 120_000, output_tokens: 1000 })).toBeCloseTo(0.0625, 6);
    expect(costUsd(haiku, { input_tokens: 1000, cache_read_input_tokens: 100_000, output_tokens: 0 })).toBeCloseTo(0.0055, 6);
  });
});

describe('plan worked numbers', () => {
  it('sonnet and haiku examples', () => {
    expect(costUsd(sonnet, { input_tokens: 10_000, output_tokens: 2000, cache_creation_input_tokens: 3000, cache_read_input_tokens: 5000 })).toBeCloseTo(0.048, 6);
    expect(
      costUsd(sonnet, { input_tokens: 10_000, output_tokens: 2000, cache_creation_input_tokens: 3000, cache_read_input_tokens: 5000, cache_creation: { ephemeral_1h_input_tokens: 3000 } })
    ).toBeCloseTo(0.0525, 6);
    expect(costUsd(haiku, { input_tokens: 90_000, cache_read_input_tokens: 20_000, output_tokens: 1000 })).toBeCloseTo(0.0485, 6);
    expect(costUsd(haiku, { input_tokens: 50_000, output_tokens: 1000 })).toBeCloseTo(0.0055, 6);
  });
});

describe('worstCaseUsd', () => {
  it('fresh input plus full output', () => {
    expect(worstCaseUsd(haiku, 1500)).toBeCloseTo(0.00275, 6);
    expect(worstCaseUsd(PRICES['claude-opus-5-5']!, 8000)).toBeCloseTo(0.24, 6);
  });
});

describe('loadPrices', () => {
  it('ASK_PRICES_JSON overrides one model, ignores garbage', () => {
    const override = { 'claude-sonnet-5-5': { input: 1, output: 2, cacheWrite5m: 3, cacheRead: 4 }, 'claude-opus-5-5': 'x' };
    const p = loadPrices({ ASK_PRICES_JSON: JSON.stringify(override) });
    expect(p['claude-sonnet-5-5']).toMatchObject({ input: 1, output: 2, cacheWrite5m: 3, cacheRead: 4, cacheWrite1h: 3 });
    expect(p['claude-opus-5-5']).toEqual(PRICES['claude-opus-5-5']);
    expect(loadPrices({ ASK_PRICES_JSON: '{nope' })).toEqual(PRICES);
  });
  it('pricesKnown', () => {
    expect(pricesKnown({ ...PRICES, 'claude-opus-5-5': null }, 'claude-opus-5-5')).toBe(false);
    expect(pricesKnown(PRICES, 'claude-opus-5-5')).toBe(true);
  });
});
