import { describe, expect, it, vi } from 'vitest';
import type { SpendRecord } from '@/lib/logic/ask-budget';
import { project, task } from '@/lib/logic/ax-fixtures';
import { ASK_CONV_META_KEY, type AskConv } from '@/lib/logic/ask-conv';
import { runAsk, type AskDeps, type AskRequest } from './run';
import { fakeClient, fakeRepo, message, text, toolUse } from './fixtures';

const NOW = new Date('2026-11-07T03:00:00.000Z'); // 2026-11-07 12:00 KST, cycle day 16 of 31
const CYCLE_KEY = 'ask:spend:2026-10-23';
const req = (over: Partial<AskRequest> = {}): AskRequest => ({ question: '이번 주 마감?', modifier: null, followUp: false, ...over });

function setup(opts: { replies?: Parameters<typeof fakeClient>[0]; data?: Parameters<typeof fakeRepo>[0]; jev?: AskDeps['jev']; noClient?: boolean } = {}) {
  const { repo, meta } = fakeRepo(opts.data);
  const { client, calls } = fakeClient(opts.replies ?? [message([text('답변이에요')])]);
  let id = 100;
  const events: string[] = [];
  const send = vi.fn(async (t: string) => {
    events.push(`send:${t.slice(0, 12)}`);
    return { ok: true, messageId: ++id };
  });
  const sendWithMarkup = vi.fn<(t: string, m: unknown) => Promise<{ ok: boolean }>>(async (t) => {
    events.push(`markup:${t.slice(0, 12)}`);
    return { ok: true };
  });
  const deps: AskDeps = { repo, client: opts.noClient ? null : client, send, sendWithMarkup, typing: vi.fn(async () => ({})), now: () => NOW, jev: opts.jev, env: {} };
  return { deps, meta, calls, send, sendWithMarkup, events };
}

describe('runAsk', () => {
  it('without a client it says so and calls nothing', async () => {
    const s = setup({ noClient: true });
    await runAsk(s.deps, req());
    expect(s.send).toHaveBeenCalledWith(expect.stringContaining('ANTHROPIC_API_KEY'));
  });

  it('an empty question shows the usage', async () => {
    const s = setup();
    await runAsk(s.deps, req({ question: '  ' }));
    expect(s.send.mock.calls[0][0]).toContain('/ask');
    expect(s.calls).toHaveLength(0);
  });

  it('sends the answer with model/cost footer, types, and stores the conversation with bot ids', async () => {
    const s = setup();
    await runAsk(s.deps, req());
    expect(s.deps.typing).toHaveBeenCalled();
    expect(s.send).toHaveBeenCalledTimes(1);
    const out = s.send.mock.calls[0][0];
    expect(out).toContain('답변이에요');
    expect(out).toContain('<i>haiku · $0.000');
    expect(out).toContain('남은 $'); // first answer of the day shows pace
    const conv = s.meta.get(ASK_CONV_META_KEY) as AskConv;
    expect(conv.botMessageIds).toEqual([101]);
    expect(conv.turns).toEqual([
      { role: 'user', text: '이번 주 마감?' },
      { role: 'assistant', text: '답변이에요' },
    ]);
    expect(conv.lastModel).toBe('claude-haiku-5-5');
  });

  it('the second answer of the day omits the pace line', async () => {
    const s = setup({ replies: [message([text('A')])] });
    await runAsk(s.deps, req());
    await runAsk(s.deps, req());
    expect(s.send.mock.calls[0][0]).toContain('남은 $');
    expect(s.send.mock.calls[1][0]).not.toContain('남은 $');
  });

  it('a 9000-char answer is split into 3 sends, each within the limit', async () => {
    const s = setup({ replies: [message([text('가'.repeat(9000))])] });
    await runAsk(s.deps, req());
    expect(s.send).toHaveBeenCalledTimes(3);
    for (const [t] of s.send.mock.calls) expect(t.length).toBeLessThanOrEqual(4096);
    expect((s.meta.get(ASK_CONV_META_KEY) as AskConv).botMessageIds).toEqual([101, 102, 103]);
  });

  it('a thrown client error sends the failure message and nothing else', async () => {
    const s = setup();
    s.deps.client = { create: async () => { throw new Error('sk-secret-key exploded'); } };
    await runAsk(s.deps, req());
    expect(s.send).toHaveBeenCalledTimes(1);
    expect(s.send.mock.calls[0][0]).toContain('답변 실패');
    expect(s.send.mock.calls[0][0]).not.toContain('sk-secret');
  });

  it('default answers are capped short with the brevity rule; 자세히/길게/상세 lifts both', async () => {
    const short = setup();
    await runAsk(short.deps, req());
    expect(short.calls[0].max_tokens).toBe(1200);
    const sys = short.calls[0].system as Array<{ text: string }>;
    expect(sys[0].text).toContain('한 화면');
    expect(sys[1].text).not.toContain('자세한 답');
    for (const word of ['자세히', '길게', '상세']) {
      const long = setup();
      await runAsk(long.deps, req({ question: `이번 주 마감 ${word} 알려줘` }));
      expect(long.calls[0].max_tokens).toBe(1500);
      expect((long.calls[0].system as Array<{ text: string }>)[1].text).toContain('자세한 답');
    }
    const sonnet = setup();
    await runAsk(sonnet.deps, req({ modifier: '+', question: '상세히 설명해줘' }));
    expect(sonnet.calls[0].max_tokens).toBe(3000);
  });

  it('a thinking-only reply never sends an empty message', async () => {
    const s = setup({ replies: [message([{ type: 'thinking', thinking: 'x', signature: 's' }], 'end_turn')] });
    await runAsk(s.deps, req());
    expect(s.send.mock.calls[0][0]).toContain('답이 비었어요');
    expect(s.meta.has(ASK_CONV_META_KEY)).toBe(false);
  });

  it('max_tokens adds the truncation note', async () => {
    const s = setup({ replies: [message([text('잘린 답')], 'max_tokens')] });
    await runAsk(s.deps, req());
    expect(s.send.mock.calls[0][0]).toContain('답이 길어 잘렸어요');
  });

  it('records every API call of the tool loop in the cycle and day ledger', async () => {
    const s = setup({
      data: { tasks: [task({ id: 't1', title: '일' })] },
      replies: [
        message([toolUse('a', 'list_tasks', {})], 'tool_use'),
        message([toolUse('b', 'get_overview', {})], 'tool_use'),
        message([text('끝')]),
      ],
    });
    await runAsk(s.deps, req());
    expect(s.calls).toHaveLength(3);
    const cycle = s.meta.get(CYCLE_KEY) as SpendRecord;
    expect(cycle.calls).toBe(3);
    expect(cycle.usd).toBeCloseTo(3 * 0.00015, 8);
    expect(cycle.byFeature.ask).toBeCloseTo(3 * 0.00015, 8);
    expect((s.meta.get('ask:spend:day:2026-11-07') as SpendRecord).calls).toBe(3);
  });

  it('a call made on a new cycle start lands in the new cycle key', async () => {
    const s = setup();
    s.deps.now = () => new Date('2026-11-23T03:00:00.000Z');
    await runAsk(s.deps, req());
    expect(s.meta.has('ask:spend:2026-11-23')).toBe(true);
    expect(s.meta.has(CYCLE_KEY)).toBe(false);
  });

  it('an exhausted budget stops before calling the API and names the reset date', async () => {
    const spent: SpendRecord = { usd: 90, calls: 50, unpricedCalls: 0, byModel: {}, byFeature: {} };
    const s = setup({ data: { meta: { [CYCLE_KEY]: spent } } });
    await runAsk(s.deps, req());
    expect(s.calls).toHaveLength(0);
    expect(s.send.mock.calls[0][0]).toContain('2026-11-23');
  });

  it('routes a confident Jev "reason" to Sonnet, and spends one Jev unit', async () => {
    const jev = { ask: vi.fn(async () => ({ complexity: { type: 'choice' as const, choice: 'reason', top: 0.8, margin: 0.5, probabilities: null } })) };
    const s = setup({ jev });
    await runAsk(s.deps, req());
    expect(s.calls[0].model).toBe('claude-sonnet-5-5');
    expect(s.send.mock.calls[0][0]).toContain('<i>sonnet');
    expect(s.meta.get('jev:count:ax:2026-11-07')).toBe(1);
  });

  it('explicit modifiers skip Jev', async () => {
    const jev = { ask: vi.fn(async () => null) };
    const s = setup({ jev });
    await runAsk(s.deps, req({ modifier: '+' }));
    expect(jev.ask).not.toHaveBeenCalled();
    expect(s.calls[0].model).toBe('claude-sonnet-5-5');
  });

  it('/ask! while ahead of pace is downgraded to Haiku and says why', async () => {
    const spent: SpendRecord = { usd: 60, calls: 5, unpricedCalls: 0, byModel: {}, byFeature: {} };
    const s = setup({ data: { meta: { [CYCLE_KEY]: spent } } });
    await runAsk(s.deps, req({ modifier: '!' }));
    expect(s.calls[0].model).toBe('claude-haiku-5-5');
    expect(s.send.mock.calls[0][0]).toContain('페이스 초과');
  });

  it('a follow-up carries the prior turns and reuses the previous model', async () => {
    const conv: AskConv = {
      id: 'c',
      updatedAt: NOW.toISOString(),
      turns: [
        { role: 'user', text: '첫 질문' },
        { role: 'assistant', text: '첫 답' },
      ],
      botMessageIds: [101],
      lastModel: 'claude-sonnet-5-5',
    };
    const s = setup({ data: { meta: { [ASK_CONV_META_KEY]: conv } } });
    await runAsk(s.deps, req({ question: '그 중 급한 건?', followUp: true }));
    expect(s.calls[0].model).toBe('claude-sonnet-5-5');
    expect(s.calls[0].messages).toEqual([
      { role: 'user', content: '첫 질문' },
      { role: 'assistant', content: '첫 답' },
      { role: 'user', content: '그 중 급한 건?' },
    ]);
    expect((s.meta.get(ASK_CONV_META_KEY) as AskConv).turns).toHaveLength(4);
  });

  it('retries a Telegram HTML rejection as tag-free text', async () => {
    const s = setup();
    s.send.mockResolvedValueOnce({ ok: false, status: 400 } as never);
    await runAsk(s.deps, req());
    expect(s.send).toHaveBeenCalledTimes(2);
    expect(s.send.mock.calls[1][0]).not.toMatch(/<[a-z]/);
  });

  it('propose_change: pending saved, keyboard sent after the answer, no repo mutation', async () => {
    const s = setup({
      data: { tasks: [task({ id: 't1', title: '초안' })], projects: [project({ id: 'p1', slug: 'brainct', name: 'BrainCT' })] },
      replies: [
        message([toolUse('a', 'propose_change', { kind: 'task_done', taskId: 't1' })], 'tool_use'),
        message([text('완료 처리를 제안했어요')]),
      ],
    });
    await runAsk(s.deps, req({ question: '초안 끝냈어' }));
    const pendings = [...s.meta].filter(([k]) => k.startsWith('telegram:pending:'));
    expect(pendings).toHaveLength(1);
    expect(pendings[0][1]).toMatchObject({ type: 'proposal', status: 'pending', text: '초안 끝냈어', proposal: { kind: 'task_done', taskId: 't1' } });
    expect(s.events[0]).toMatch(/^send:/);
    expect(s.events[1]).toMatch(/^markup:/);
    expect(s.sendWithMarkup.mock.calls[0][1]).toMatchObject({ inline_keyboard: expect.any(Array) });
    // the tool result told the model it is only a proposal
    const results = s.calls[1].messages.at(-1)!.content as Array<{ content: string }>;
    expect(results[0].content).toContain('눌러야 반영');
  });

  it('a fourth proposal is a tool error', async () => {
    const calls = Array.from({ length: 4 }, (_, i) => toolUse(`u${i}`, 'propose_change', { kind: 'task_create', title: `일${i}` }));
    const s = setup({ replies: [message(calls, 'tool_use'), message([text('끝')])] });
    await runAsk(s.deps, req());
    const results = s.calls[1].messages.at(-1)!.content as Array<{ is_error?: boolean; content: string }>;
    expect(results.filter((r) => r.is_error)).toHaveLength(1);
    expect(results.at(-1)!.content).toContain('3개까지');
    expect(s.sendWithMarkup).toHaveBeenCalledTimes(3);
  });
});
