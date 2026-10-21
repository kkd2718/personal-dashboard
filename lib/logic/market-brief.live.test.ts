import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseBrief, type MarketBrief } from '@/lib/logic/market-brief';
import { formatMarketBrief } from '@/lib/telegram/market-digest';

// Captured from the trading dashboard's GET /api/brief on 2026-10-18 (market data only; checked: no amounts,
// no forbidden keys). This is what the VM really pushes.
const live = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'trading-brief.live.json'), 'utf-8')) as {
  as_of: string;
  macro: Record<string, unknown>;
};
const NOW = '2026-10-18T03:00:00.000Z';
const TODAY = '2026-10-18';
const stored = (raw: unknown = live): MarketBrief => ({ ...parseBrief(raw)!, receivedAt: NOW, source: 'vm' });

describe('the real VM payload', () => {
  it('parseBrief keeps every macro group (flat contract) and drops only the extra top-level keys', () => {
    const body = parseBrief(live)!;
    expect(Object.keys(body.macro!).sort()).toEqual(Object.keys(live.macro).sort());
    expect(body.macro).toEqual(live.macro);
    expect(Object.keys(live.macro)).toHaveLength(21);
    expect(Object.keys(body).sort()).toEqual(['as_of', 'econ', 'macro', 'sectors', 'strategy', 'trades', 'upcoming']);
    expect(body.sectors).toHaveLength(5);
    expect(body.trades?.checks.length).toBeGreaterThan(0);
  });

  it('rsiwatch.flags stays an object of booleans (a legacy list is folded into one)', () => {
    expect(parseBrief(live)!.macro?.rsiwatch?.flags).toEqual(live.macro.rsiwatch && (live.macro.rsiwatch as { flags: unknown }).flags);
    const legacy = parseBrief({ ...live, macro: { rsiwatch: { flags: ['qqqe'] } } })!;
    expect(legacy.macro?.rsiwatch?.flags).toEqual({ qqqe: true });
  });

  it('the market message renders the real payload and names raised RSI-watch flags', () => {
    const fmt = (raw?: unknown) => formatMarketBrief({ brief: stored(raw), summary: null, today: TODAY, nowIso: NOW, sentence: null })!;
    expect(fmt()).toContain('10Y 5.10 (0bp) · 30Y 5.44 (0bp)');
    expect(fmt()).not.toContain('🚩');
    const raised = { ...live, macro: { ...live.macro, rsiwatch: { ...(live.macro.rsiwatch as object), flags: { schd_overheat: true, dual_oversold: false, bull_div_confluence: true } } } };
    expect(fmt(raised)).toContain('🚩 SCHD 과열, 강세 다이버전스 합류');
  });
});
