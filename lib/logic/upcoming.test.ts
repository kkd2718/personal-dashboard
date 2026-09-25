import { describe, expect, it } from 'vitest';
import { dueReminders, upcoming } from './upcoming';
import type { Deadline, ReviewJob } from '@/lib/types';

const TODAY = '2026-09-25';

function deadline(overrides: Partial<Deadline>): Deadline {
  return {
    id: 'd1',
    title: 'test deadline',
    kind: 'other',
    dueDate: '2026-09-26',
    dueTime: null,
    projectId: null,
    paperId: null,
    reviewId: null,
    done: false,
    remindDays: [7, 3, 1],
    updatedAt: TODAY,
    ...overrides,
  };
}

function review(overrides: Partial<ReviewJob>): ReviewJob {
  return {
    id: 'r1',
    journal: 'Test Journal',
    manuscriptId: null,
    title: null,
    status: 'invited',
    invitedAt: null,
    dueDate: '2026-09-27',
    link: null,
    note: null,
    updatedAt: TODAY,
    ...overrides,
  };
}

describe('upcoming', () => {
  it('excludes done deadlines, non-pending/dateless reviews, and items beyond horizon; overdue first', () => {
    const deadlines: Deadline[] = [
      deadline({ id: 'overdue', dueDate: '2026-09-20' }), // dday -5
      deadline({ id: 'done', dueDate: '2026-09-26', done: true }),
      deadline({ id: 'far', dueDate: '2026-11-01' }), // beyond 30-day horizon
      deadline({ id: 'soon', dueDate: '2026-09-27' }), // dday 2
    ];
    const reviews: ReviewJob[] = [
      review({ id: 'declined', status: 'declined', dueDate: '2026-09-27' }),
      review({ id: 'submitted', status: 'submitted', dueDate: '2026-09-27' }),
      review({ id: 'no-date', status: 'invited', dueDate: null }),
      review({ id: 'pending', status: 'accepted', dueDate: '2026-09-28' }),
    ];

    const result = upcoming(deadlines, reviews, TODAY, 30);
    const ids = result.map((i) => i.originId);

    expect(ids).toEqual(['overdue', 'soon', 'pending']);
    expect(result[0].dday).toBe(-5);
  });
});

describe('dueReminders', () => {
  it('includes overdue, today, and remindDays hits; excludes other days', () => {
    const deadlines: Deadline[] = [
      deadline({ id: 'd7', dueDate: '2026-10-02' }), // dday 7
      deadline({ id: 'd3', dueDate: '2026-09-28' }), // dday 3
      deadline({ id: 'd1', dueDate: '2026-09-26' }), // dday 1
      deadline({ id: 'd0', dueDate: '2026-09-25' }), // dday 0
      deadline({ id: 'd-1', dueDate: '2026-09-24' }), // dday -1
      deadline({ id: 'd2', dueDate: '2026-09-27' }), // dday 2, not in remindDays
    ];

    const result = dueReminders(deadlines, TODAY);
    const ids = result.map((i) => i.originId).sort();

    expect(ids).toEqual(['d-1', 'd0', 'd1', 'd3', 'd7']);
  });
});
