import { describe, expect, it } from 'vitest';
import { fakeClient, fakeRepo, message, text } from '@/lib/ask/fixtures';
import { parseBrief, quadrantLabel, type MarketBrief } from '@/lib/logic/market-brief';
import { rawBody } from '@/lib/logic/market-brief.fixtures';
import type { SpendRecord } from '@/lib/logic/ask-budget';
import { macroSentence } from './macro';
import { formatMarketBrief } from './market-digest';

const TODAY = '2026-11-07';
const NOW = '2026-11-07T00:30:00.000Z'; // snapshot received 30 min earlier
const mk = (over: Record<string, unknown> = {}, meta: Partial<MarketBrief> = {}): MarketBrief => ({
  ...parseBrief(rawBody(over))!,
  receivedAt: '2026-11-07T00:00:00.000Z',
  source: 'vm',
  ...meta,
});

describe('macroSentence', () => {
  const prev = mk({ as_of: '2026-11-05' }, { receivedAt: '2026-11-06T00:00:00.000Z' });
  const deps = (replies = [message([text('VIX가 올랐고 SOXL 래더는 그대로예요')])], meta: Record<string, unknown> = {}) => {
    const { repo, meta: m } = fakeRepo({ meta });
    const fc = fakeClient(replies);
    return { d: { client: fc.client, repo, today: TODAY, env: {} }, calls: fc.calls, meta: m };
  };

  it('Haiku sees today and yesterday only and spends under feature macro', async () => {
    const x = deps();
    const r = await macroSentence(x.d, mk(), prev, NOW);
    expect(r?.text).toBe('VIX가 올랐고 SOXL 래더는 그대로예요');
    expect(x.calls[0]).toMatchObject({ model: 'claude-haiku-5-5', max_tokens: 400 });
    const user = x.calls[0].messages[0].content as string;
    const sent = JSON.parse(user);
    expect(Object.keys(sent)).toEqual(['today', 'yesterday', 'watch']);
    expect(sent.watch.econ.map((x: { name: string }) => x.name)).toEqual(['US CPI', 'Minor data', 'FOMC minutes']);
    expect(sent.watch.strategy[0]).toMatchObject({ l: 'SOXL 래더', s: 'OFF' });
    expect(user).not.toContain('ACCT-SECRET');
    expect(user).not.toContain('"regime":');
    expect((x.meta.get('ask:spend:2026-10-23') as SpendRecord).byFeature.macro).toBeGreaterThan(0);
  });

  it('null without previous, when stale, without budget, on empty reply', async () => {
    expect(await macroSentence(deps().d, mk(), null, NOW)).toBeNull();
    expect(await macroSentence(deps().d, mk({}, { receivedAt: '2026-11-05T00:00:00.000Z' }), prev, NOW)).toBeNull();
    const spent: SpendRecord = { usd: 120, calls: 9, unpricedCalls: 0, byModel: {}, byFeature: {} };
    const broke = deps(undefined, { 'ask:spend:2026-10-23': spent });
    expect(await macroSentence(broke.d, mk(), prev, NOW)).toBeNull();
    expect(broke.calls).toHaveLength(0);
    expect(await macroSentence(deps([message([])]).d, mk(), prev, NOW)).toBeNull();
  });
});

describe('quadrantLabel', () => {
  it('maps the R/L codes to Korean, flags R^Lv, and leaves unknown codes raw', () => {
    expect(quadrantLabel('R^L=')).toBe('금리↑·유동성 보합');
    expect(quadrantLabel('R=Lv')).toBe('금리 보합·유동성↓');
    expect(quadrantLabel('RvL^')).toBe('금리↓·유동성↑');
    expect(quadrantLabel('R^Lv')).toBe('금리↑·유동성↓ (⚠ 하락 꼬리 위험 국면)');
    expect(quadrantLabel('expansion')).toBeNull();
  });

  it('renders in the rates section of the market message, raw when unknown', () => {
    const mk = (quadrant: string) => {
      const raw = rawBody() as unknown as { macro: { liquidity: Record<string, unknown> } };
      raw.macro.liquidity.quadrant = quadrant;
      return { ...parseBrief(raw)!, receivedAt: new Date().toISOString(), source: 'vm' as const };
    };
    const now = new Date().toISOString();
    const out = (q: string) => formatMarketBrief({ brief: mk(q), summary: null, today: '2026-11-06', nowIso: now, sentence: null })!;
    expect(out('R^Lv')).toContain('금리↑·유동성↓ (⚠ 하락 꼬리 위험 국면)');
    expect(out('R^L=')).toContain('금리↑·유동성 보합');
    expect(out('zzz')).toContain('유동성 zzz');
  });
});
