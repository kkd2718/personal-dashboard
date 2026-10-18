import { describe, expect, it } from 'vitest';
import type { SpendRecord } from '@/lib/logic/ask-budget';
import { fakeClient, fakeRepo, message, text } from './fixtures';
import { cleanTaskTitle } from './title';

const ORIGINAL = '클로드가 맥스 플랜에 API를 제공하기로 해서 검토해야 해';
const RULE = '클로드가 맥스 플랜에 API를 제공하기로 해서 검토';
const TODAY = '2026-11-07';

function run(reply: ReturnType<typeof message> | Error, opts: { meta?: Record<string, unknown>; env?: Record<string, string> } = {}) {
  const { repo, meta } = fakeRepo({ meta: opts.meta });
  const fc = fakeClient([message([])]);
  const client = {
    create: async (p: Parameters<typeof fc.client.create>[0], o?: { timeoutMs?: number }) => {
      await fc.client.create(p, o);
      if (reply instanceof Error) throw reply;
      return reply;
    },
  };
  const result = cleanTaskTitle({ client, repo, today: TODAY, env: opts.env ?? {} }, ORIGINAL, RULE);
  return { result, calls: fc.calls, meta };
}

describe('cleanTaskTitle', () => {
  it('uses a good reply and records spend under the title feature', async () => {
    const r = run(message([text('맥스 플랜 API 검토')]));
    expect(await r.result).toBe('맥스 플랜 API 검토');
    expect(r.calls[0]).toMatchObject({ model: 'claude-haiku-5-5', max_tokens: 120, thinking: { type: 'disabled' } });
    const cycle = r.meta.get('ask:spend:2026-10-23') as SpendRecord;
    expect(cycle.calls).toBe(1);
    expect(cycle.byFeature.title).toBeGreaterThan(0);
  });

  it('strips wrapping quotes', async () => {
    expect(await run(message([text('"맥스 플랜 API 검토"')])).result).toBe('맥스 플랜 API 검토');
  });

  it.each([
    ['empty', ''],
    ['multi-line', '맥스 플랜\nAPI 검토'],
    ['80 chars', '맥스'.repeat(40)],
    ['unrelated', 'ZZZ QQQ'],
  ])('%s reply falls back to the rule title', async (_name, reply) => {
    expect(await run(message(reply ? [text(reply)] : [])).result).toBe(RULE);
  });

  it('a throwing client falls back', async () => {
    expect(await run(new Error('network')).result).toBe(RULE);
  });

  it('no client, or opted out, makes no call', async () => {
    const { repo } = fakeRepo();
    expect(await cleanTaskTitle({ client: null, repo, today: TODAY, env: {} }, ORIGINAL, RULE)).toBe(RULE);
    const r = run(message([text('맥스 플랜 API 검토')]), { env: { ASK_TITLE_CLEANUP: '0' } });
    expect(await r.result).toBe(RULE);
    expect(r.calls).toHaveLength(0);
  });

  it('ahead of pace or exhausted makes no call', async () => {
    for (const usd of [60, 90]) {
      const spent: SpendRecord = { usd, calls: 9, unpricedCalls: 0, byModel: {}, byFeature: {} };
      const r = run(message([text('맥스 플랜 API 검토')]), { meta: { 'ask:spend:2026-10-23': spent } });
      expect(await r.result).toBe(RULE);
      expect(r.calls).toHaveLength(0);
    }
  });
});
