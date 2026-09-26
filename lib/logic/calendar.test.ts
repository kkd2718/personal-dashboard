import { describe, expect, it } from 'vitest';
import { calendarEvents } from './calendar';
import type { Milestone, Note } from '@/lib/types';

function milestone(overrides: Partial<Milestone>): Milestone {
  return {
    id: 'm1',
    projectId: 'p1',
    title: 'Q',
    startDate: null,
    endDate: null,
    status: 'active',
    sort: 0,
    updatedAt: '2026-09-25',
    ...overrides,
  };
}

describe('calendarEvents', () => {
  it('splits a milestone spanning weeks into per-week-row segments (Monday-start grid)', () => {
    const m = milestone({ startDate: '2026-09-24', endDate: '2026-10-07' });
    const result = calendarEvents('2026-09-01', {
      milestones: [m],
      tasks: [],
      deadlines: [],
      reviews: [],
    });

    // grid weeks: 08-31, 09-07, 09-14, 09-21, 09-28 (last day of Sept -> endOfIsoWeek(09-30) = 10-04)
    expect(result.weeks).toEqual(['2026-08-31', '2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28']);

    const segs = result.ranges.filter((r) => r.milestoneId === 'm1');
    // week of 09-21 (index 3): 09-24 is Thursday -> col 4, runs to Sunday col 7, isStart
    expect(segs).toContainEqual(
      expect.objectContaining({ weekIndex: 3, colStart: 4, colEnd: 7, isStart: true, isEnd: false })
    );
    // week of 09-28 (index 4): full week, cols 1..7
    expect(segs).toContainEqual(
      expect.objectContaining({ weekIndex: 4, colStart: 1, colEnd: 7, isStart: false, isEnd: false })
    );
    // week of 10-05 is not in the grid -> no segment for it
    expect(segs.some((s) => s.weekIndex === 5)).toBe(false);
    expect(segs).toHaveLength(2);
  });

  it('assigns distinct lanes to overlapping milestones', () => {
    const a = milestone({ id: 'a', startDate: '2026-09-01', endDate: '2026-09-10' });
    const b = milestone({ id: 'b', startDate: '2026-09-05', endDate: '2026-09-15' });
    const result = calendarEvents('2026-09-01', {
      milestones: [a, b],
      tasks: [],
      deadlines: [],
      reviews: [],
    });
    const laneA = result.ranges.find((r) => r.milestoneId === 'a')!.lane;
    const laneB = result.ranges.find((r) => r.milestoneId === 'b')!.lane;
    expect(new Set([laneA, laneB])).toEqual(new Set([0, 1]));
  });

  it('renders a start-only milestone as a point', () => {
    const m = milestone({ id: 'm2', startDate: '2026-09-10', endDate: null });
    const result = calendarEvents('2026-09-01', {
      milestones: [m],
      tasks: [],
      deadlines: [],
      reviews: [],
    });
    expect(result.ranges).toHaveLength(0);
    expect(result.points['2026-09-10']).toContainEqual(
      expect.objectContaining({ id: 'm2', kind: 'milestone' })
    );
  });

  it('includes a dated note as a memo point', () => {
    const note: Note = {
      id: 'n1',
      body: '메모',
      kind: 'memo',
      status: 'inbox',
      projectId: null,
      tags: [],
      date: '2026-09-15',
      pinned: false,
      source: 'web',
      deliveredAt: null,
      taskId: null,
      createdAt: '2026-09-25',
      updatedAt: '2026-09-25',
    };
    const result = calendarEvents('2026-09-01', {
      milestones: [],
      tasks: [],
      deadlines: [],
      reviews: [],
      notes: [note],
    });
    expect(result.points['2026-09-15']).toContainEqual(expect.objectContaining({ id: 'n1', kind: 'memo' }));
  });
});
