import { describe, expect, it } from 'vitest';
import { movePaper } from './papers';
import type { Paper } from '@/lib/types';

function paper(overrides: Partial<Paper>): Paper {
  return {
    id: 'p1',
    title: 'Test paper',
    shortName: 'test',
    stage: 'writing',
    track: 'AI',
    journal: null,
    manuscriptId: null,
    targetJournals: [],
    folderPath: null,
    nextAction: null,
    projectId: null,
    submissions: [],
    sort: 0,
    updatedAt: '2026-09-25',
    ...overrides,
  };
}

describe('movePaper', () => {
  it('reorders within a column densely', () => {
    const papers = [
      paper({ id: 'a', stage: 'writing', sort: 0 }),
      paper({ id: 'b', stage: 'writing', sort: 1 }),
      paper({ id: 'c', stage: 'writing', sort: 2 }),
    ];
    const result = movePaper(papers, 'c', 'writing', 0);
    const order = result
      .filter((p) => p.stage === 'writing')
      .sort((x, y) => x.sort - y.sort)
      .map((p) => p.id);
    expect(order).toEqual(['c', 'a', 'b']);
    expect(result.map((p) => p.sort).sort()).toEqual([0, 1, 2]);
  });

  it('moves across stages and renumbers both columns densely, leaving others untouched', () => {
    const papers = [
      paper({ id: 'a', stage: 'writing', sort: 0 }),
      paper({ id: 'b', stage: 'writing', sort: 1 }),
      paper({ id: 'c', stage: 'under_review', sort: 0 }),
      paper({ id: 'd', stage: 'accepted', sort: 0 }),
    ];
    const result = movePaper(papers, 'b', 'under_review', 0);

    const writing = result.filter((p) => p.stage === 'writing');
    const underReview = result
      .filter((p) => p.stage === 'under_review')
      .sort((x, y) => x.sort - y.sort);
    const accepted = result.filter((p) => p.stage === 'accepted');

    expect(writing.map((p) => p.id)).toEqual(['a']);
    expect(writing[0].sort).toBe(0);
    expect(underReview.map((p) => p.id)).toEqual(['b', 'c']);
    expect(underReview.map((p) => p.sort)).toEqual([0, 1]);
    // untouched column keeps its original sort
    expect(accepted[0].sort).toBe(0);
  });

  it('returns papers unchanged for an unknown id', () => {
    const papers = [paper({ id: 'a' })];
    const result = movePaper(papers, 'missing', 'accepted', 0);
    expect(result).toEqual(papers);
  });
});
