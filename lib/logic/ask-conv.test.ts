import { describe, expect, it } from 'vitest';
import { appendTurn, isFollowUp, toMessages, type AskConv } from './ask-conv';

const T0 = '2026-10-18T10:00:00.000Z';
const at = (min: number) => new Date(Date.parse(T0) + min * 60_000).toISOString();
const conv = (over: Partial<AskConv> = {}): AskConv => ({ id: 'c1', updatedAt: T0, turns: [], botMessageIds: [101, 102], ...over });

describe('isFollowUp', () => {
  it('reply to a stored bot id within 30 minutes', () => {
    expect(isFollowUp(conv(), 101, at(30))).toBe(true);
  });
  it('false after the TTL, for unknown ids, without reply or conversation', () => {
    expect(isFollowUp(conv(), 101, at(31))).toBe(false);
    expect(isFollowUp(conv(), 999, at(1))).toBe(false);
    expect(isFollowUp(conv(), null, at(1))).toBe(false);
    expect(isFollowUp(null, 101, at(1))).toBe(false);
  });
});

describe('appendTurn', () => {
  it('eight appends keep six pairs and twenty bot ids', () => {
    let c: AskConv | null = null;
    for (let i = 0; i < 8; i++) c = appendTurn(c, `q${i}`, `a${i}`, [i * 10, i * 10 + 1, i * 10 + 2], at(i), () => 'new');
    expect(c!.turns).toHaveLength(12);
    expect(c!.turns[0]).toEqual({ role: 'user', text: 'q2' });
    expect(c!.botMessageIds).toHaveLength(20);
    expect(c!.botMessageIds.at(-1)).toBe(72);
    expect(c!.id).toBe('new');
    expect(c!.updatedAt).toBe(at(7));
  });
  it('remembers the last model, keeping the previous one when none is given', () => {
    const a = appendTurn(null, 'q', 'a', [1], T0, () => 'x', 'claude-sonnet-5-5');
    expect(appendTurn(a, 'q2', 'a2', [2], T0, () => 'y').lastModel).toBe('claude-sonnet-5-5');
  });
});

describe('toMessages', () => {
  it('prior turns as plain text then the new question', () => {
    const c = appendTurn(null, 'q1', 'a1', [1], T0, () => 'x');
    expect(toMessages(c, 'q2')).toEqual([
      { role: 'user', content: 'q1' },
      { role: 'assistant', content: 'a1' },
      { role: 'user', content: 'q2' },
    ]);
    expect(toMessages(null, 'q')).toEqual([{ role: 'user', content: 'q' }]);
  });
});
