import type { Task, TaskStatus } from '@/lib/types';

/**
 * Move a task to `toStatus` at `toIndex` within its project's board, renumbering
 * `sort` densely (0..n-1) in the destination column, and the origin column if it
 * changed. Tasks from other projects are untouched. Unknown id returns tasks unchanged.
 */
export function moveTask(tasks: Task[], id: string, toStatus: TaskStatus, toIndex: number): Task[] {
  const moving = tasks.find((t) => t.id === id);
  if (!moving) return tasks;

  const fromStatus = moving.status;
  const projectId = moving.projectId;
  const others = tasks.filter((t) => t.id !== id);

  const inScope = (t: Task) => t.projectId === projectId;

  const destColumn = others.filter((t) => inScope(t) && t.status === toStatus).sort((a, b) => a.sort - b.sort);
  const clampedIndex = Math.max(0, Math.min(toIndex, destColumn.length));
  destColumn.splice(clampedIndex, 0, { ...moving, status: toStatus });

  const updates = new Map<string, { status: TaskStatus; sort: number }>();
  destColumn.forEach((t, i) => updates.set(t.id, { status: toStatus, sort: i }));

  if (fromStatus !== toStatus) {
    const originColumn = others
      .filter((t) => inScope(t) && t.status === fromStatus)
      .sort((a, b) => a.sort - b.sort);
    originColumn.forEach((t, i) => updates.set(t.id, { status: fromStatus, sort: i }));
  }

  return tasks.map((t) => {
    const u = updates.get(t.id);
    if (!u) return t;
    const doneAt = u.status === 'done' && t.status !== 'done' ? new Date().toISOString() : t.doneAt;
    return { ...t, status: u.status, sort: u.sort, doneAt };
  });
}
