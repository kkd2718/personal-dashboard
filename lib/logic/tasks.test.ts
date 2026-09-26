import { describe, expect, it } from 'vitest';
import { moveTask } from './tasks';
import type { Task } from '@/lib/types';

function task(id: string, status: Task['status'], sort: number): Task {
  return {
    id,
    projectId: 'p1',
    milestoneId: null,
    title: id,
    description: null,
    status,
    dueDate: null,
    doneAt: null,
    assignee: 'me',
    sort,
    createdAt: '2026-09-25T00:00:00Z',
    updatedAt: '2026-09-25T00:00:00Z',
  };
}

describe('moveTask', () => {
  it('renumbers sort densely in both origin and destination columns', () => {
    const tasks = [task('a', 'todo', 0), task('b', 'todo', 1), task('c', 'doing', 0)];
    const result = moveTask(tasks, 'a', 'doing', 0);
    const byId = Object.fromEntries(result.map((t) => [t.id, t]));
    expect(byId.a.status).toBe('doing');
    expect(byId.a.sort).toBe(0);
    expect(byId.c.sort).toBe(1);
    expect(byId.b.sort).toBe(0); // origin column renumbered
  });

  it('sets doneAt when moved into done', () => {
    const tasks = [task('a', 'todo', 0)];
    const result = moveTask(tasks, 'a', 'done', 0);
    expect(result[0].doneAt).not.toBeNull();
  });

  it('does not touch tasks from other projects', () => {
    const other = { ...task('x', 'todo', 0), projectId: 'p2' };
    const tasks = [task('a', 'todo', 0), other];
    const result = moveTask(tasks, 'a', 'doing', 0);
    expect(result.find((t) => t.id === 'x')).toEqual(other);
  });
});
