import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseBrief, type MarketBrief } from '@/lib/logic/market-brief';
import { formatMacroBlock, formatMacroFull } from '@/lib/telegram/macro';

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

  it('the digest block shows rates, FX, risk assets and leaders', () => {
    const block = formatMacroBlock(stored(), TODAY, NOW, null)!;
    expect(block).toContain('📉 금리·유동성 10Y 5.10 (0bp) · 30Y 5.44 (0bp) · 곡선 0.83 (12M 내 역전) · HY 경계 +63bp · 금리↑·유동성 보합');
    expect(block).toContain('💱 환율 USDKRW 1330');
    expect(block).toContain('DXY 101.8');
    expect(block).toContain('USDJPY 158.0');
    expect(block).toContain('🪙 위험자산 BTC +12.4% · ETH +11.8% · 유럽 -6.1% · BRK 0.0% · SCHD -1.7%');
    expect(block).toContain('🏆 주도주 US NVDA (+3.2%p) · KR 삼성전자 117일째');
    expect(block).toContain('레짐 warning');
    expect(block).toContain('공포탐욕 18(극단적 공포)');
  });

  it('/macro adds the regime detail, Fed/Japan lines and names the raised RSI-watch flags', () => {
    const raised = { ...live, macro: { ...live.macro, rsiwatch: { ...(live.macro.rsiwatch as object), flags: { schd_overheat: true, dual_oversold: false, bull_div_confluence: true } } } };
    const out = formatMacroFull(stored(raised), TODAY, NOW, null);
    expect(out).toContain('플래그 schd_overheat,bull_div_confluence');
    expect(out).not.toContain('dual_oversold,');
    expect(out).toContain('Sahm 0.00 무신호');
    expect(out).toContain('월간 과열 71.8 (과열)');
    expect(out).toContain('연준 FFR 3.88 · 13주 +0.25 · 순유동성 13주 -1.9%');
    expect(out).toContain('일본 JGB10Y 2.95 · JGB30Y 4.02 · 엔 20일 +1.2%');
    expect(out).toContain('🏆 주도주 US NVDA');
  });

  it('with no flag raised, no flag text is shown', () => {
    expect(formatMacroFull(stored(), TODAY, NOW, null)).not.toContain('플래그');
  });
});
