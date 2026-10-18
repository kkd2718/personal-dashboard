import { describe, expect, it } from 'vitest';
import { fakeClient, fakeRepo, message, text } from '@/lib/ask/fixtures';
import { parseBrief, quadrantLabel, type MarketBrief } from '@/lib/logic/market-brief';
import { rawBody } from '@/lib/logic/market-brief.fixtures';
import type { SpendRecord } from '@/lib/logic/ask-budget';
import { formatMacroBlock, formatMacroFull, macroSentence } from './macro';

const TODAY = '2026-11-07';
const NOW = '2026-11-07T00:30:00.000Z'; // snapshot received 30 min earlier
const mk = (over: Record<string, unknown> = {}, meta: Partial<MarketBrief> = {}): MarketBrief => ({
  ...parseBrief(rawBody(over))!,
  receivedAt: '2026-11-07T00:00:00.000Z',
  source: 'vm',
  ...meta,
});

describe('formatMacroBlock', () => {
  it('compact grouped lines: trades, 온도, 금리·유동성, 환율, 위험자산, 주도주, 섹터, 전략, econ, sentence', () => {
    const out = formatMacroBlock(mk(), TODAY, NOW, '큰 변화 없음')!;
    const lines = out.split('\n');
    expect(lines[0]).toBe('<b>📈 매크로</b>');
    expect(lines[1]).toBe('🩺 매매 점검 ✅ 정상 (2/2 · 실패 0)');
    expect(out).toContain('🌡 온도 레짐 neutral · 공포탐욕 54(Neutral) · VIX 17.2(Calm) · NDX RSI 55/60/66');
    expect(out).toContain('📉 금리·유동성 10Y 4.21 (+3bp) · 30Y 4.55 (+2bp) · 곡선 0.35 (12M 내 역전) · HY calm +12bp · 유동성 expansion');
    expect(out).toContain('💱 환율 USDKRW 1391 (+0.3%) · DXY 104.1 (-0.2%) · USDJPY 151.3');
    expect(out).toContain('🪙 위험자산 BTC +12.5% · ETH -4.1% 200일선↓ · 유럽 +3.2% · BRK +1.1% · SCHD -0.6%');
    expect(out).toContain('🏆 주도주 US NVDA (+2.5%p) · KR 삼성전자 14일째');
    expect(out).toContain('🏭 섹터 SOXX +1.2%');
    expect(out).toContain('⚙️ 전략 SOXL 래더 OFF');
    expect(out).toContain('🤖 큰 변화 없음');
  });

  it('only high-importance econ events for today and tomorrow, with KST time', () => {
    const out = formatMacroBlock(mk(), TODAY, NOW, null)!;
    expect(out).toContain('📆 오늘 22:30 US CPI (예상 3.1% / 이전 3.0%)');
    expect(out).toContain('📆 내일 04:00 FOMC minutes');
    expect(out).not.toContain('Minor data');
    expect(out).not.toContain('Far event');
  });

  it('warn/fail checks come first, above the summary line', () => {
    const trades = {
      overall: 'fail',
      checks: [
        { id: 'a', label: '주문 전송', status: 'ok' },
        { id: 'b', label: '체결', status: 'fail', detail: '2건 실패' },
        { id: 'c', label: '예약 주문', status: 'warn', detail: '1건 지연' },
      ],
    };
    const lines = formatMacroBlock(mk({ trades }), TODAY, NOW, null)!.split('\n');
    expect(lines[1]).toBe('🚨 체결 — 2건 실패');
    expect(lines[2]).toBe('⚠️ 예약 주문 — 1건 지연');
    expect(lines[3]).toBe('🩺 매매 점검 🚨 실패 (1/3 · 실패 1)');
  });

  it('a snapshot without trades says so with its date', () => {
    expect(formatMacroBlock(mk({ trades: undefined }), TODAY, NOW, null)).toContain('🩺 매매 점검 정보 없음(11/7 기준)');
  });

  it('older than 36 h: dated header, no PC wording, no sentence, trades hidden', () => {
    const old = mk({}, { receivedAt: '2026-11-05T00:00:00.000Z' });
    const out = formatMacroBlock(old, TODAY, NOW, '문장')!;
    expect(out.split('\n')[0]).toBe('<b>📈 매크로</b> <i>(11/5 기준)</i>');
    expect(out).toContain('🩺 매매 점검 정보 없음(11/5 기준)');
    expect(out).not.toContain('🤖');
    expect(out).not.toContain('PC');
  });

  it('null without a snapshot; missing groups are skipped, not printed empty', () => {
    expect(formatMacroBlock(null, TODAY, NOW, null)).toBeNull();
    const sparse = mk({ macro: { vix: { value: 20 } }, sectors: [], strategy: [], econ: [] });
    const out = formatMacroBlock(sparse, TODAY, NOW, null)!;
    expect(out).toContain('🌡 온도 VIX 20.0');
    for (const g of ['금리', '환율', '위험자산', '주도주', '섹터', '전략', '📆']) expect(out).not.toContain(g);
  });

  it('escapes all snapshot text', () => {
    const out = formatMacroBlock(mk({ strategy: [{ id: 's', label: '<b>x</b>', state: 'A&B' }] }), TODAY, NOW, '<i>')!;
    expect(out).toContain('&lt;b&gt;x&lt;/b&gt; A&amp;B');
    expect(out).toContain('🤖 &lt;i&gt;');
  });
});

describe('formatMacroFull', () => {
  it('shows everything including all checks, details, upcoming and the whole econ week', () => {
    const out = formatMacroFull(mk(), TODAY, NOW, null);
    for (const piece of ['2026-11-06', 'Sahm 0.20', 'RSI 워치', 'JGB10Y 1.10', 'FFR 4.50', '주문 전송', '체결', 'SOXX 반도체', '52주고 -3.0%', 'SOXL 래더 <b>OFF</b> — 대기', 'DCA (D-14)', 'Minor data', 'FOMC minutes']) {
      expect(out).toContain(piece);
    }
    expect(out).toContain('Far event'); // inside the 7-day window
  });
  it('no snapshot message', () => {
    expect(formatMacroFull(null, TODAY, NOW, null)).toContain('아직 받은');
  });
  it('marks a stale snapshot', () => {
    expect(formatMacroFull(mk({}, { receivedAt: '2026-11-05T00:00:00.000Z' }), TODAY, NOW, null)).toContain('오래됨');
  });
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
    expect(x.calls[0]).toMatchObject({ model: 'claude-haiku-5-5', max_tokens: 200 });
    const user = x.calls[0].messages[0].content as string;
    const sent = JSON.parse(user);
    expect(Object.keys(sent)).toEqual(['today', 'yesterday']);
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

  it('renders in the rates line of the block and /macro, raw when unknown', () => {
    const mk = (quadrant: string) => {
      const raw = rawBody() as unknown as { macro: { liquidity: Record<string, unknown> } };
      raw.macro.liquidity.quadrant = quadrant;
      return { ...parseBrief(raw)!, receivedAt: new Date().toISOString(), source: 'vm' as const };
    };
    const now = new Date().toISOString();
    expect(formatMacroBlock(mk('R^Lv'), '2026-11-06', now, null)).toContain('금리↑·유동성↓ (⚠ 하락 꼬리 위험 국면)');
    expect(formatMacroFull(mk('R^L='), '2026-11-06', now, null)).toContain('금리↑·유동성 보합');
    expect(formatMacroBlock(mk('zzz'), '2026-11-06', now, null)).toContain('유동성 zzz');
  });
});
