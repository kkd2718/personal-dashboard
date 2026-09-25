import { describe, expect, it } from 'vitest';
import { progress } from './progress';
import type { Task } from '@/lib/types';

function task(status: Task['status']): Task {
  return {
    id: Math.random().toString(36),
    projectId: 'p1',
    milestoneId: null,
    title: 't',
    description: null,
    status,
    dueDate: null,
    doneAt: null,
    sort: 0,
    createdAt: '2026-09-25T00:00:00Z',
    updatedAt: '2026-09-25T00:00:00Z',
  };
}

describe('progress', () => {
  it('returns null pct for an empty list', () => {
    expect(progress([])).toEqual({ done: 0, total: 0, pct: null });
  });

  it('rounds pct: 1 of 3 done -> 33', () => {
    const tasks = [task('done'), task('todo'), task('doing')];
    expect(progress(tasks)).toEqual({ done: 1, total: 3, pct: 33 });
  });
});
