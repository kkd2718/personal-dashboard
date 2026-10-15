import { describe, expect, it } from 'vitest';
import type { JevAnswer } from '@/lib/ai/jev';
import type { Candidate } from './ax-candidates';
import { axQuestions, axState, decide, obviousMemo } from './ax-intent';

const choice = (pick: string, probabilities: Record<string, number> | null): JevAnswer => {
  const values = probabilities ? Object.values(probabilities).sort((a, b) => b - a) : [];
  const top = probabilities ? (probabilities[pick] ?? values[0]) : null;
  const others = probabilities
    ? Object.entries(probabilities)
        .filter(([k]) => k !== pick)
        .map(([, v]) => v)
    : [];
  return {
    type: 'choice',
    choice: pick,
    probabilities,
    top,
    margin: top === null ? null : top - (others.length ? Math.max(...others) : 0),
  };
};

const cand = (key: string): Candidate => ({
  key,
  kind: key.startsWith('t:') ? 'task' : 'deadline',
  id: key.slice(2),
  title: 'x',
  projectName: null,
  dueDate: null,
});

describe('decide', () => {
  const cands = [cand('t:1'), cand('d:1')];

  it('null answers => jev_error', () => expect(decide(null, cands)).toEqual({ ok: false, reason: 'jev_error' }));

  it('intent needs top >= 0.6 and margin >= 0.2', () => {
    const run = (p: Record<string, number>) => decide({ intent: choice('memo', p) }, []);
    expect(run({ memo: 0.55, task_done: 0.45 })).toEqual({ ok: false, reason: 'low_intent' });
    expect(run({ memo: 0.62, task_done: 0.5 })).toEqual({ ok: false, reason: 'low_intent' }); // margin 0.12
    expect(run({ memo: 0.7, task_done: 0.25 })).toEqual({ ok: true, intent: 'memo', target: null });
    expect(decide({ intent: choice('memo', null) }, [])).toEqual({ ok: false, reason: 'low_intent' });
  });

  it('task_done with a confident target', () => {
    const r = decide(
      { intent: choice('task_done', { task_done: 0.9, memo: 0.1 }), target: choice('t:1', { 't:1': 0.8, none: 0.2 }) },
      cands
    );
    expect(r).toMatchObject({ ok: true, intent: 'task_done', target: { key: 't:1' } });
  });

  it('target none / wrong kind / unsure', () => {
    const intent = choice('task_done', { task_done: 0.9, memo: 0.1 });
    expect(decide({ intent, target: choice('none', { none: 0.9, 't:1': 0.1 }) }, cands)).toEqual({
      ok: false,
      reason: 'no_target',
    });
    expect(decide({ intent, target: choice('d:1', { 'd:1': 0.8, 't:1': 0.2 }) }, cands)).toEqual({
      ok: false,
      reason: 'kind_mismatch',
    });
    expect(decide({ intent, target: choice('t:1', { 't:1': 0.55, none: 0.45 }) }, cands)).toEqual({
      ok: false,
      reason: 'low_target',
    });
    expect(decide({ intent }, cands)).toEqual({ ok: false, reason: 'low_target' });
  });

  it('waiting_reply keeps a confident target and tolerates an unsure one', () => {
    const intent = choice('waiting_reply', { waiting_reply: 0.9, memo: 0.1 });
    expect(decide({ intent, target: choice('d:1', { 'd:1': 0.8, none: 0.2 }) }, cands)).toMatchObject({ ok: true, target: { key: 'd:1' } });
    expect(decide({ intent, target: choice('d:1', { 'd:1': 0.5, none: 0.5 }) }, cands)).toEqual({ ok: true, intent: 'waiting_reply', target: null });
    expect(decide({ intent }, cands)).toEqual({ ok: true, intent: 'waiting_reply', target: null });
  });

  it('calendar_event ignores the target', () => {
    const intent = choice('calendar_event', { calendar_event: 0.9, memo: 0.1 });
    expect(decide({ intent }, [])).toEqual({ ok: true, intent: 'calendar_event', target: null });
  });
});

describe('questions and gates', () => {
  it('target question only with candidates; waiting_reply is offered', () => {
    expect(Object.keys(axQuestions([]))).toEqual(['intent']);
    const q = axQuestions([cand('t:1')]);
    expect(Object.keys(q)).toEqual(['intent', 'target']);
    const intent = q.intent as { criteria: Record<string, string> };
    expect(Object.keys(intent.criteria)).toContain('waiting_reply');
    expect(Object.keys((q.target as { criteria: Record<string, string> }).criteria)).toEqual(['t:1', 'none']);
  });

  it('axState', () => expect(axState('끝냈어', '2026-10-15')).toBe('메시지: "끝냈어"\n오늘: 2026-10-15 (목)'));

  it('obviousMemo', () => {
    expect(obviousMemo('!앱 아이디어')).toBe(true);
    expect(obviousMemo('https://a.b/c')).toBe(true);
    expect(obviousMemo('내일 3시 치과')).toBe(false);
  });
});
