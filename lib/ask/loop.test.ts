import { describe, expect, it, vi } from 'vitest';
import { runAskLoop, type LoopInput } from './loop';
import { fakeClient, fakeRepo, message, text, toolUse } from './fixtures';

const base = (client: LoopInput['client'], over: Partial<LoopInput> = {}): LoopInput => ({
  client,
  repo: fakeRepo().repo,
  model: 'claude-haiku-5-5',
  system: [],
  tools: [],
  messages: [{ role: 'user', content: '질문' }],
  today: '2026-10-18',
  deadlineAt: Date.now() + 60_000,
  ...over,
});

describe('runAskLoop', () => {
  it('answers directly without tools', async () => {
    const { client, calls } = fakeClient([message([text('답')])]);
    const r = await runAskLoop(base(client));
    expect(r).toMatchObject({ text: '답', stopReason: 'end_turn', iterations: 1, timedOut: false });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ model: 'claude-haiku-5-5', max_tokens: 1500, thinking: { type: 'disabled' } });
    expect(calls[0].tool_choice).toBeUndefined();
  });

  it('runs tools, matches ids, passes assistant content (thinking included) back verbatim', async () => {
    const first = message(
      [{ type: 'thinking', thinking: '생각', signature: 'sig-1' }, text('조회할게요'), toolUse('tu_1', 'a', { x: 1 }), toolUse('tu_2', 'b', {})],
      'tool_use'
    );
    const { client, calls } = fakeClient([first, message([text('최종')])]);
    const handler = vi.fn(async (name: string) => (name === 'b' ? { content: '오류', isError: true } : { content: '{"ok":1}', isError: false }));
    const r = await runAskLoop(base(client, { toolHandler: handler }));

    expect(r.text).toBe('최종');
    expect(handler).toHaveBeenCalledTimes(2);
    const second = calls[1].messages;
    expect(second[1]).toEqual({ role: 'assistant', content: first.content });
    expect(second[2]).toEqual({
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 'tu_1', content: '{"ok":1}' },
        { type: 'tool_result', tool_use_id: 'tu_2', content: '오류', is_error: true },
      ],
    });
  });

  it('a throwing handler becomes an error result', async () => {
    const { client, calls } = fakeClient([message([toolUse('tu_1', 'a', {})], 'tool_use'), message([text('끝')])]);
    await runAskLoop(base(client, { toolHandler: async () => { throw new Error('boom'); } }));
    const results = calls[1].messages[2].content as Array<{ is_error?: boolean; content: string }>;
    expect(results[0]).toMatchObject({ is_error: true });
    expect(results[0].content).not.toContain('boom');
  });

  it('seven tool_use replies stop at 6 iterations plus one tools-forbidden final call', async () => {
    const { client, calls } = fakeClient([message([toolUse('tu', 'a', {})], 'tool_use')]);
    const handler = vi.fn(async () => ({ content: '{}', isError: false }));
    const r = await runAskLoop(base(client, { toolHandler: handler }));
    expect(calls).toHaveLength(7);
    expect(handler).toHaveBeenCalledTimes(6);
    expect(r.iterations).toBe(6);
    expect(calls.slice(0, 6).every((c) => c.tool_choice === undefined)).toBe(true);
    expect(calls[6].tool_choice).toEqual({ type: 'none' });
    const last = calls[6].messages.at(-1)!.content as Array<{ type: string }>;
    expect(last.at(-1)!.type).toBe('text'); // nudge after the tool_results
  });

  it('a passed deadline makes no call and reports timedOut', async () => {
    const { client, calls } = fakeClient([message([text('x')])]);
    const r = await runAskLoop(base(client, { deadlineAt: Date.now() - 1 }));
    expect(calls).toHaveLength(0);
    expect(r).toMatchObject({ timedOut: true, text: '' });
  });

  it('little time left goes straight to the final answer call', async () => {
    const { client, calls } = fakeClient([message([text('급한 답')])]);
    const r = await runAskLoop(base(client, { deadlineAt: Date.now() + 3000 }));
    expect(calls).toHaveLength(1);
    expect(calls[0].tool_choice).toEqual({ type: 'none' });
    expect(r.text).toBe('급한 답');
  });

  it('onUsage runs once per create and usage totals add up', async () => {
    const { client } = fakeClient([
      message([toolUse('tu', 'a', {})], 'tool_use', { input_tokens: 100, output_tokens: 10, cache_read_input_tokens: 5 }),
      message([text('끝')], 'end_turn', { input_tokens: 200, output_tokens: 20, cache_creation_input_tokens: 7 }),
    ]);
    const onUsage = vi.fn(async () => {});
    const r = await runAskLoop(base(client, { onUsage, toolHandler: async () => ({ content: '{}', isError: false }) }));
    expect(onUsage).toHaveBeenCalledTimes(2);
    expect(r.usage).toEqual({ input: 300, output: 30, cacheWrite: 7, cacheRead: 5 });
  });

  it('pause_turn continues with the assistant content appended', async () => {
    const paused = message([text('중간')], 'pause_turn');
    const { client, calls } = fakeClient([paused, message([text('끝')])]);
    const r = await runAskLoop(base(client));
    expect(r.text).toBe('끝');
    expect(calls[1].messages[1]).toEqual({ role: 'assistant', content: paused.content });
  });

  it('max_tokens stop is surfaced with its text', async () => {
    const { client } = fakeClient([message([text('잘린')], 'max_tokens')]);
    expect(await runAskLoop(base(client))).toMatchObject({ text: '잘린', stopReason: 'max_tokens' });
  });

  it('each model gets the thinking mode its API accepts', async () => {
    const opus = fakeClient([message([text('x')])]);
    await runAskLoop(base(opus.client, { model: 'claude-opus-5-5' }));
    expect(opus.calls[0]).toMatchObject({ max_tokens: 8000, thinking: { type: 'adaptive' }, output_config: { effort: 'medium' } });
    const sonnet = fakeClient([message([text('x')])]);
    await runAskLoop(base(sonnet.client, { model: 'claude-sonnet-5-5' }));
    expect(sonnet.calls[0]).toMatchObject({ max_tokens: 3000, thinking: { type: 'between_tools' } });
    expect(sonnet.calls[0].output_config).toBeUndefined();
  });
});
