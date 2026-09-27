import { describe, expect, it } from 'vitest';
import { movePaper, paperCardLine, paperLaneGroups } from './papers';
import type { Deadline, Paper } from '@/lib/types';

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

function deadline(overrides: Partial<Deadline>): Deadline {
  return {
    id: 'd1',
    title: 'Revision',
    kind: 'paper',
    dueDate: '2026-10-01',
    dueTime: null,
    projectId: null,
    paperId: 'p1',
    reviewId: null,
    done: false,
    remindDays: [7, 3, 1],
    updatedAt: '2026-09-25',
    ...overrides,
  };
}

describe('paperCardLine', () => {
  const today = '2026-09-25';

  it('writing: shows the next action', () => {
    expect(paperCardLine(paper({ stage: 'writing', nextAction: '1차 평가지표 정리' }), [], today)).toBe(
      '▸ 1차 평가지표 정리'
    );
  });

  it('writing: appends the first target journal', () => {
    expect(
      paperCardLine(paper({ stage: 'writing', nextAction: 'discussion 작성', targetJournals: ['FJA', 'FJB'] }), [], today)
    ).toBe('▸ discussion 작성 · 목표 FJA');
  });

  it('under review without a submit date: names the journal', () => {
    const submissions = [
      { journal: 'Fictional A', submittedAt: null, decision: 'reject' as const, decidedAt: null },
      { journal: 'Fictional B', submittedAt: null, decision: 'pending' as const, decidedAt: null },
    ];
    expect(paperCardLine(paper({ stage: 'under_review', submissions }), [], today)).toBe('Fictional B 심사 중');
  });

  it('writing: null when there is no next action', () => {
    expect(paperCardLine(paper({ stage: 'writing', nextAction: null }), [], today)).toBeNull();
  });

  it('under_review: days since the latest submission', () => {
    const p = paper({
      stage: 'under_review',
      submissions: [{ journal: 'J', submittedAt: '2026-08-15', decision: 'pending', decidedAt: null }],
    });
    expect(paperCardLine(p, [], today)).toBe('심사 41일째');
  });

  it('submitted: falls back to submission count when never submittedAt and nothing pending', () => {
    const p = paper({
      stage: 'submitted',
      submissions: [{ journal: 'J', submittedAt: null, decision: 'reject', decidedAt: null }],
    });
    expect(paperCardLine(p, [], today)).toBe('투고 1회');
  });

  it('revision: D-day from the linked deadline', () => {
    const p = paper({ id: 'p1', stage: 'revision' });
    expect(paperCardLine(p, [deadline({ paperId: 'p1', dueDate: '2026-10-07' })], today)).toBe('⚠ 리비전 D-12');
  });

  it('revision: no linked deadline', () => {
    expect(paperCardLine(paper({ id: 'p1', stage: 'revision' }), [], today)).toBe('리비전 기한 없음');
  });

  it('published: journal and decision month', () => {
    const p = paper({
      stage: 'published',
      journal: 'Fictional Journal',
      submissions: [{ journal: 'Fictional Journal', submittedAt: '2026-01-01', decision: 'accept', decidedAt: '2026-03-15' }],
    });
    expect(paperCardLine(p, [], today)).toBe('Fictional Journal · 2026-03');
  });
});

describe('paperLaneGroups', () => {
  it('groups by stage in pipeline order, omitting empty stages', () => {
    const papers = [
      paper({ id: 'a', stage: 'revision', sort: 0 }),
      paper({ id: 'b', stage: 'writing', sort: 1 }),
      paper({ id: 'c', stage: 'writing', sort: 0 }),
    ];
    const groups = paperLaneGroups(papers);
    expect(groups.map((g) => g.stage)).toEqual(['writing', 'revision']);
    expect(groups[0].label).toBe('작성중');
    expect(groups[0].papers.map((p) => p.id)).toEqual(['c', 'b']); // sorted by `sort` within the stage
  });

  it('returns an empty list for no papers', () => {
    expect(paperLaneGroups([])).toEqual([]);
  });
});

describe('paperLaneGroups — published papers leave the lane after ~3 months', () => {
  it('keeps a recently published paper, drops one published over 90 days ago', () => {
    const papers = [
      paper({ id: 'new', stage: 'published', updatedAt: '2026-08-01T00:00:00.000Z' }),
      paper({ id: 'old', stage: 'published', updatedAt: '2026-05-01T00:00:00.000Z' }),
    ];
    const ids = paperLaneGroups(papers, '2026-09-27').flatMap((g) => g.papers.map((p) => p.id));
    expect(ids).toEqual(['new']);
  });

  it('uses the latest decision date when there is one', () => {
    const submissions = [{ journal: 'F', submittedAt: null, decision: 'accept' as const, decidedAt: '2026-09-01T00:00:00.000Z' }];
    const papers = [paper({ id: 'p', stage: 'published', updatedAt: '2026-01-01T00:00:00.000Z', submissions })];
    expect(paperLaneGroups(papers, '2026-09-27')).toHaveLength(1);
  });
});
