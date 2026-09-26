import type { Milestone, Project, ProjectActivity, Task } from '@/lib/types';

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

/** Progress derived from the collector's markdown backlog count (phase 2a), or null if absent. */
export function backlogProgress(activity: ProjectActivity | undefined): Progress | null {
  const open = activity?.metrics.backlogOpen;
  const done = activity?.metrics.backlogDone;
  if (typeof open !== 'number' && typeof done !== 'number') return null;
  const o = typeof open === 'number' ? open : 0;
  const d = typeof done === 'number' ? done : 0;
  const total = o + d;
  return { done: d, total, pct: total === 0 ? null : Math.round((100 * d) / total) };
}

/** Korean progress copy (ux-advice.md §6): never "0/1 (0%)". Below 3 tasks say the
 * count only; at 3+ show the completed/total fraction. */
export function progressLabel(p: Progress): string {
  if (p.total < 3) return `할 일 ${p.total}개`;
  return `${p.done}/${p.total} 완료`;
}

/** Same rule for the markdown-backlog bar, labeled `백로그` instead of `BACKLOG`. */
export function backlogLabel(p: Progress): string {
  return `백로그 ${p.done}/${p.total}`;
}

/** Shown as a second bar under the task-based progress bar (never merged with it):
 * only for projects with no tasks, or app-group projects, and only when non-empty. */
export function shouldShowBacklogBar(project: Project, tasks: Task[], backlog: Progress | null): boolean {
  if (!backlog || backlog.total === 0) return false;
  const hasTasks = tasks.some((t) => t.projectId === project.id);
  return !hasTasks || project.group === 'app';
}
