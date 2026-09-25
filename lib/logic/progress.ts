import type { Milestone, Task } from '@/lib/types';

export interface Progress {
  done: number;
  total: number;
  pct: number | null; // null when total is 0
}

/** done/total/pct over a task list (caller filters to the relevant scope). */
export function progress(tasks: Task[]): Progress {
  const total = tasks.length;
  const done = tasks.filter((t) => t.status === 'done').length;
  return { done, total, pct: total === 0 ? null : Math.round((100 * done) / total) };
}

export function milestoneProgress(milestone: Milestone, tasks: Task[]): Progress {
  return progress(tasks.filter((t) => t.milestoneId === milestone.id));
}

export function projectProgress(projectId: string, tasks: Task[]): Progress {
  return progress(tasks.filter((t) => t.projectId === projectId));
}
