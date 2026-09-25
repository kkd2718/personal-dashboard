import { describe, expect, it } from 'vitest';
import { checklist } from './checklist';
import type { Deadline, ReviewJob, Task } from '@/lib/types';

const today = '2026-09-25'; // Friday; ISO week Mon 09-21..Sun 09-27

function task(overrides: Partial<Task>): Task {
  return {
    id: Math.random().toString(36),
    projectId: 'p1',
    milestoneId: null,
    title: 't',
    description: null,
    status: 'todo',
    dueDate: null,
    doneAt: null,
    sort: 0,
    createdAt: today,
    updatedAt: today,
    ...overrides,
  };
}

describe('checklist', () => {
  it('buckets a task due yesterday as overdue', () => {
    const c = checklist([task({ dueDate: '2026-09-24' })], [], [], today);
    expect(c.overdue).toHaveLength(1);
  });

  it('buckets a task due today as today', () => {
    const c = checklist([task({ dueDate: today })], [], [], today);
    expect(c.today).toHaveLength(1);
  });

  it('buckets a task due Sunday of this week as thisWeek', () => {
    const c = checklist([task({ dueDate: '2026-09-27' })], [], [], today);
    expect(c.thisWeek).toHaveLength(1);
  });

  it('excludes a task due next Monday', () => {
    const c = checklist([task({ dueDate: '2026-09-28' })], [], [], today);
    expect(c.overdue).toHaveLength(0);
    expect(c.today).toHaveLength(0);
    expect(c.thisWeek).toHaveLength(0);
  });

  it('buckets a doing task with no due date as doing', () => {
    const c = checklist([task({ status: 'doing', dueDate: null })], [], [], today);
    expect(c.doing).toHaveLength(1);
  });

  it('includes an accepted review due in 3 days within the week, excludes it otherwise', () => {
    const review: ReviewJob = {
      id: 'r1',
      journal: 'J',
      manuscriptId: null,
      title: null,
      status: 'accepted',
      invitedAt: null,
      dueDate: '2026-09-28', // in 3 days but past this ISO week's Sunday
      link: null,
      note: null,
      updatedAt: today,
    };
    const c = checklist([], [], [review], today);
    expect(c.thisWeek).toHaveLength(0);

    const withinWeek = { ...review, dueDate: '2026-09-27' };
    const c2 = checklist([], [], [withinWeek], today);
    expect(c2.thisWeek).toHaveLength(1);
  });

  it('shows tasks done today struck through at the bottom of today, excludes older done tasks', () => {
    const doneToday = task({ status: 'done', doneAt: `${today}T10:00:00Z`, dueDate: today });
    const doneEarlier = task({ status: 'done', doneAt: '2026-09-20T10:00:00Z', dueDate: '2026-09-20' });
    const c = checklist([doneToday, doneEarlier], [], [], today);
    expect(c.today).toHaveLength(1);
    expect(c.today[0].done).toBe(true);
  });

  it('excludes done deadlines', () => {
    const deadline: Deadline = {
      id: 'd1',
      title: 'x',
      kind: 'other',
      dueDate: today,
      dueTime: null,
      projectId: null,
      paperId: null,
      reviewId: null,
      done: true,
      remindDays: [7, 3, 1],
      updatedAt: today,
    };
    const c = checklist([], [deadline], [], today);
    expect(c.today).toHaveLength(0);
  });
});

describe('checklist next bucket', () => {
  it('lists undated todo tasks of active milestones only', () => {
    const base = { projectId: 'p', description: null, doneAt: null, sort: 0, createdAt: '', updatedAt: '' };
    const tasks = [
      { ...base, id: 'a', title: 'A', milestoneId: 'm1', status: 'todo' as const, dueDate: null },
      { ...base, id: 'b', title: 'B', milestoneId: 'm2', status: 'todo' as const, dueDate: null },
      { ...base, id: 'c', title: 'C', milestoneId: null, status: 'todo' as const, dueDate: null },
    ];
    const r = checklist(tasks, [], [], '2026-09-25', new Set(['m1']));
    expect(r.next.map((i) => i.id)).toEqual(['a']);
  });
  it('counts a task done at 00:30 KST as done today', () => {
    const t = { id: 'd', title: 'D', projectId: 'p', milestoneId: null, description: null, status: 'done' as const,
      dueDate: null, doneAt: '2026-09-24T15:30:00.000Z', sort: 0, createdAt: '', updatedAt: '' };
    expect(checklist([t], [], [], '2026-09-25').today.map((i) => i.id)).toEqual(['d']);
  });
});
