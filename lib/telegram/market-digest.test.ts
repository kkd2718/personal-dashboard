import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseBrief, type MarketBrief } from '@/lib/logic/market-brief';
import { rawBody } from '@/lib/logic/market-brief.fixtures';
import { tradingSummary } from '@/lib/logic/trading-summary.fixtures';
import { splitTelegram } from '@/lib/logic/ask-text';
import { formatMarketBrief } from './market-digest';

const live = JSON.parse(readFileSync(join(__dirname, '..', 'logic', 'fixtures', 'trading-brief.live.json'), 'utf-8'));
const TODAY = '2026-10-19';
const NOW = '2026-10-19T00:30:00.000Z';
const mk = (raw: unknown = live, receivedAt = '2026-10-19T00:00:00.000Z'): MarketBrief => ({ ...parseBrief(raw)!, receivedAt, source: 'vm' });
const fmt = (o: Partial<Parameters<typeof formatMarketBrief>[0]> = {}) =>
  formatMarketBrief({ brief: mk(), summary: tradingSummary(), today: TODAY, nowIso: NOW, sentence: null, ...o });

describe('formatMarketBrief with the live VM payload', () => {
  const out = fmt({ sentence: '어제와 큰 변화 없음. 오늘 FOMC 대기.' })!;

  it('has every section in order', () => {
    const order = ['📈 10/19(월) 시장·계좌', '💰 계좌', '🩺 매매 점검', '🌡 시장 온도', '📉 금리·유동성', '💱 환율', '🪙 위험자산·방어', '🏆 주도주', '🏭 섹터', '⚙️ 전략', '🗓 일정', '💬'];
    const at = order.map((h) => out.indexOf(h));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it('account section: totals, 1-week change, one line per account, reserve, dormant', () => {
    expect(out).toContain('총 1억 2,346만원 · 오늘 -123만원 (-1.0%) · 1주 +2.9%');
    expect(out).toContain('• IB+VR: $41,234 · 누적 +12.3% · 정상 · 예비금 $18.8k · 다음 10/23');
    expect(out).toContain('• ISA: 2,534만원 · 기준일(8/1) 대비 +1.5% · ⚠️ stale · 다음 10/30');
    expect(out).toContain('• IRP: 11/1 시작');
    expect(out).not.toMatch(/<b>💰 계좌<\/b> <i>/);
  });

  it('market sections carry the live numbers', () => {
    expect(out).toContain('🩺 매매 점검 ✅ 정상 (4/4)');
    expect(out).toContain('✅ IB+VR (해외, 실전) — 주문 2건 접수 · 체결 2 · 실패 0 · 미체결 0');
    expect(out).toContain('레짐 warning · 공포탐욕 18 (극단적 공포) · VIX 20.0 (보통)');
    expect(out).toContain('NDX RSI 일 35 · 주 52 · 월 72 · QQQE z +0.50');
    expect(out).toContain('SPX 주간RSI 57 · SCHD 65');
    expect(out).toContain('10Y 5.10 (0bp) · 30Y 5.44 (0bp)');
    expect(out).toContain('곡선 0.83 (12M 내 역전) · HY 경계 +63bp · Sahm 0.00 무신호');
    expect(out).toContain('월간 과열 71.8 (과열) · FFR 3.88 (13주 +0.25) · 순유동성 13주 -1.9%');
    expect(out).toContain('금리↑·유동성 보합');
    expect(out).toContain('일본 JGB10Y 2.95 · 30Y 4.02 · 엔 20일 +1.2%');
    expect(out).toContain('USDKRW 1330 (-0.8%) · DXY 101.8 (-0.1%) · USDJPY 158.0');
    expect(out).toContain('BTC +12.4% · ETH +11.8% (200일선 대비)');
    expect(out).toContain('유럽 -6.1% · BRK 0.0% · SCHD -1.7% (52주 고점 대비)');
    expect(out).toContain('US NVDA (격차 +3.2%p) · KR 삼성전자 117일째');
    expect(out).toContain('• 반도체(^SOX) -3.8% · +5.1% · -5.0% · 48');
    expect(out).toContain('• SOXL 사다리 <b>OFF</b> — NDX 고점 대비 -6.5%, ON 조건 -10% / OFF = 신고가·방어·-25%');
    expect(out).toContain('🗓 10/22 SOXL 리밸런싱 잠금 해제 (D-3)');
    expect(out).toContain('💬 어제와 큰 변화 없음. 오늘 FOMC 대기.');
  });

  it('fits the 2-screen budget and a single Telegram message', () => {
    expect(out.length).toBeLessThanOrEqual(2000);
    expect(splitTelegram(out)).toHaveLength(1);
  });

  it('names raised RSI-watch flags and shows none otherwise', () => {
    expect(out).not.toContain('🚩');
    const raised = { ...live, macro: { ...live.macro, rsiwatch: { ...live.macro.rsiwatch, flags: { schd_overheat: true, dual_oversold: false, custom_x: true } } } };
    expect(fmt({ brief: mk(raised) })).toContain('🚩 SCHD 과열, custom_x');
  });
});

describe('formatMarketBrief edge cases', () => {
  it('schedule: today/tomorrow all importance, later this week high only, with KST time and consensus', () => {
    const out = formatMarketBrief({ brief: mk(rawBody(), '2026-11-07T00:00:00.000Z'), summary: null, today: '2026-11-07', nowIso: '2026-11-07T00:30:00.000Z', sentence: null })!;
    expect(out).toContain('📆 오늘 22:30 US CPI (예상 3.1% / 이전 3.0%)');
    expect(out).toContain('📆 오늘 23:00 Minor data');
    expect(out).toContain('📆 내일 04:00 FOMC minutes');
    expect(out).toContain('📆 11/12 22:30 Far event'); // high importance, inside the week
    expect(out).toContain('🗓 11/20 DCA (D-13)');
    const lowLater = rawBody({ econ: [{ date: '2026-11-10', name: 'Low later', importance: 'low' }] });
    expect(formatMarketBrief({ brief: mk(lowLater, '2026-11-07T00:00:00.000Z'), summary: null, today: '2026-11-07', nowIso: '2026-11-07T00:30:00.000Z', sentence: null })).not.toContain('Low later');
  });

  it('null with neither snapshot nor summary; either alone is enough; missing groups are omitted', () => {
    expect(fmt({ brief: null, summary: null })).toBeNull();
    const acct = fmt({ brief: null })!;
    expect(acct).toContain('💰 계좌');
    expect(acct).not.toContain('🩺');
    const mkt = fmt({ summary: null })!;
    expect(mkt).not.toContain('💰');
    const sparse = fmt({ summary: null, brief: mk(rawBody({ macro: { vix: { value: 20 } }, sectors: [], strategy: [], econ: [], upcoming: [], trades: undefined })) })!;
    expect(sparse).toContain('VIX 20.0');
    for (const g of ['금리', '환율', '위험자산', '주도주', '섹터', '전략', '일정', '매매']) expect(sparse).not.toContain(g);
  });

  it('stale snapshot: dated market sections, no sentence; stale summary dated, not hidden', () => {
    const out = fmt({ brief: mk(live, '2026-10-17T00:00:00.000Z'), summary: tradingSummary({ collectedAt: '2026-10-17T09:00:00+09:00' }), sentence: '문장' })!;
    expect(out).toContain('<b>💰 계좌</b> <i>(10/17 기준)</i>');
    expect(out).toContain('<b>🌡 시장 온도</b> <i>(10/17 기준)</i>');
    expect(out).toContain('<b>🏭 섹터 (1일 · 200일선 · NDX대비 20일 · 주간RSI)</b> <i>(10/17 기준)</i>');
    expect(out).not.toContain('💬');
  });

  it('escapes all snapshot and account text', () => {
    const brief = mk(rawBody({ strategy: [{ id: 's', label: '<b>x</b>', state: 'A&B' }] }));
    const summary = tradingSummary({ accounts: [{ ...tradingSummary().accounts[0], label: '<i>acct</i>', status: '<b>&bad' }] });
    const out = fmt({ brief, summary, sentence: '<u>' })!;
    expect(out).toContain('&lt;b&gt;x&lt;/b&gt; <b>A&amp;B</b>');
    expect(out).toContain('• &lt;i&gt;acct&lt;/i&gt;:');
    expect(out).toContain('⚠️ &lt;b&gt;&amp;bad');
    expect(out).toContain('💬 &lt;u&gt;');
  });

  it('1-week change uses the latest point dated <= today-7, not the first point', () => {
    const points = Array.from({ length: 30 }, (_, i) => ({ date: `2026-09-${String(i + 1).padStart(2, '0')}`, totalKrw: 1000 + i * 10 }));
    // today 2026-09-30: base = 09-23 (1220), last = 09-30 (1290) -> +5.7%; from point 0 it would be +29.0%
    const out = formatMarketBrief({ brief: null, summary: tradingSummary({ points, collectedAt: '2026-09-30T00:00:00Z' }), today: '2026-09-30', nowIso: '2026-09-30T01:00:00.000Z', sentence: null })!;
    expect(out).toContain('1주 +5.7%');
    const short = tradingSummary({ points: points.slice(-3), collectedAt: '2026-09-30T00:00:00Z' }); // oldest within 7 days
    expect(formatMarketBrief({ brief: null, summary: short, today: '2026-09-30', nowIso: '2026-09-30T01:00:00.000Z', sentence: null })).toContain('1주 +1.6%');
  });

  it('a summary without a valid collectedAt is labelled, not trusted', () => {
    const out = fmt({ brief: null, summary: tradingSummary({ collectedAt: '' }) })!;
    expect(out).toContain('<b>💰 계좌</b> <i>(기준 시각 없음)</i>');
  });

  it('a very long snapshot splits into valid chunks under 4096', () => {
    const checks = Array.from({ length: 20 }, (_, i) => ({ id: `c${i}`, label: `점검 ${i}`, status: 'fail', detail: '길게'.repeat(80) }));
    const sectors = Array.from({ length: 30 }, (_, i) => ({ ticker: `T${i}`, label: `섹터 ${i}`, chg1d_pct: 1, note: '노트'.repeat(40) }));
    const out = fmt({ brief: mk(rawBody({ trades: { overall: 'fail', checks }, sectors })) })!;
    const parts = splitTelegram(out);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(4096);
  });
});
