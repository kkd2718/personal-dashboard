import { describe, expect, it } from 'vitest';
import { prefilterCandidates } from './ax-candidates';
import { project, task } from './ax-fixtures';

describe('prefilterCandidates', () => {
  it('keeps only the open overlapping item', () => {
    const tasks = [
      task({ id: '1', title: '논문 초안 작성' }),
      task({ id: '2', title: '논문 초안 작성', status: 'done' }),
      task({ id: '3', title: '장보기' }),
    ];
    const out = prefilterCandidates('논문 초안 끝냈어', tasks, [], []);
    expect(out.map((c) => c.key)).toEqual(['t:1']);
  });

  it('caps at the limit and returns [] without overlap', () => {
    const many = Array.from({ length: 60 }, (_, i) => task({ id: String(i), title: `논문 초안 ${i}` }));
    expect(prefilterCandidates('논문 초안 끝냈어', many, [], [])).toHaveLength(50);
    expect(prefilterCandidates('zzz', many, [], [])).toEqual([]);
  });

  it('a mentioned project boosts its task', () => {
    const projects = [
      project({ id: 'p1', slug: 'trading', name: '트레이딩' }),
      project({ id: 'p2', slug: 'amgi', name: '암기' }),
    ];
    const tasks = [
      task({ id: 'a', title: '리밸런싱 점검', projectId: 'p2' }),
      task({ id: 'b', title: '리밸런싱 점검', projectId: 'p1' }),
    ];
    const out = prefilterCandidates('@trading 리밸런싱', tasks, [], projects);
    expect(out[0].id).toBe('b');
    expect(out[0].projectName).toBe('트레이딩');
  });
});
