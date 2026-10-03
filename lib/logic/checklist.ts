import type { Deadline, DeadlineKind, ReviewJob, Task } from '@/lib/types';
import { endOfSundayWeek } from '@/lib/logic/dates';

const NEXT_LIMIT = 8;

/** KST calendar date of an ISO timestamp. */
function kstDate(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
}

export interface ChecklistItem {
  id: string;
  title: string;
  kind: 'task' | 'deadline' | 'review';
  deadlineKind: DeadlineKind | null; // only set when kind === 'deadline'
  projectId: string | null;
  dueDate: string | null;
  done: boolean;
  readOnly: boolean; // true for deadline/review — ticked via their own actions (deadline done / review submitted), not the task toggle
}

export interface Checklist {
  overdue: ChecklistItem[];
  today: ChecklistItem[]; // done-today tasks appended at the bottom (done: true)
  thisWeek: ChecklistItem[];
  doing: ChecklistItem[];
  next: ChecklistItem[]; // undated todo tasks in active queues (capped)
}

/** Checklist split by who's responsible. Deadlines/reviews only ever show up in `me`. */
export interface ChecklistByAssignee {
  me: Checklist;
  agent: Checklist;
}

/** Total visible item count for one assignee's bucket (home lane tab badge, §Lanes 3). */
export function checklistItemCount(c: Checklist): number {
  return c.overdue.length + c.today.length + c.thisWeek.length + c.doing.length + c.next.length;
}

function byDueThenTitle(a: ChecklistItem, b: ChecklistItem): number {
  const ad = a.dueDate ?? '';
  const bd = b.dueDate ?? '';
  if (ad !== bd) return ad < bd ? -1 : 1;
  return a.title < b.title ? -1 : a.title > b.title ? 1 : 0;
}

/**
 * Buckets tasks/deadlines/reviews for the home checklist, split by assignee (나/에이전트).
 * Deadlines and reviews are always attributed to `me`.
 */
export function checklist(
  tasks: Task[],
  deadlines: Deadline[],
  reviews: ReviewJob[],
  today: string,
  activeMilestoneIds: ReadonlySet<string> = new Set()
): ChecklistByAssignee {
  const meTasks = tasks.filter((t) => t.assignee !== 'agent');
  const agentTasks = tasks.filter((t) => t.assignee === 'agent');
  return {
    me: bucketTasks(meTasks, deadlines, reviews, today, activeMilestoneIds),
    agent: bucketTasks(agentTasks, [], [], today, activeMilestoneIds),
  };
}

/**
 * thisWeek = due in (today, endOfSundayWeek(today)] (Sunday-start week, Saturday end), KST.
 * doing = status 'doing' with no due date. Done tasks are excluded except ones
 * completed today, which are appended (struck-through) at the bottom of `today`.
 * next = undated todo tasks whose milestone is in activeMilestoneIds (task order kept).
 */
function bucketTasks(
  tasks: Task[],
  deadlines: Deadline[],
  reviews: ReviewJob[],
  today: string,
  activeMilestoneIds: ReadonlySet<string>
): Checklist {
  const weekEnd = endOfSundayWeek(today);
  const overdue: ChecklistItem[] = [];
  const todayList: ChecklistItem[] = [];
  const doneToday: ChecklistItem[] = [];
  const thisWeek: ChecklistItem[] = [];
  const doing: ChecklistItem[] = [];
  const next: ChecklistItem[] = [];

  function route(item: ChecklistItem) {
    if (!item.dueDate) return;
    if (item.dueDate < today) overdue.push(item);
    else if (item.dueDate === today) todayList.push(item);
    else if (item.dueDate <= weekEnd) thisWeek.push(item);
  }

  for (const t of tasks) {
    if (t.status === 'done') {
      if (t.doneAt && kstDate(t.doneAt) === today) {
        doneToday.push({
          id: t.id,
          title: t.title,
          kind: 'task',
          deadlineKind: null,
          projectId: t.projectId,
          dueDate: t.dueDate,
          done: true,
          readOnly: false,
        });
      }
      continue;
    }
    if (t.status === 'doing' && !t.dueDate) {
      doing.push({
        id: t.id,
        title: t.title,
        kind: 'task',
        deadlineKind: null,
        projectId: t.projectId,
        dueDate: null,
        done: false,
        readOnly: false,
      });
      continue;
    }
    if (t.status === 'todo' && !t.dueDate && t.milestoneId && activeMilestoneIds.has(t.milestoneId)) {
      next.push({
        id: t.id,
        title: t.title,
        kind: 'task',
        deadlineKind: null,
        projectId: t.projectId,
        dueDate: null,
        done: false,
        readOnly: false,
      });
      continue;
    }
    route({
      id: t.id,
      title: t.title,
      kind: 'task',
      deadlineKind: null,
      projectId: t.projectId,
      dueDate: t.dueDate,
      done: false,
      readOnly: false,
    });
  }

  for (const d of deadlines) {
    if (d.done) continue;
    route({
      id: d.id,
      title: d.title,
      kind: 'deadline',
      deadlineKind: d.kind,
      projectId: d.projectId,
      dueDate: d.dueDate,
      done: false,
      readOnly: true,
    });
  }

  for (const r of reviews) {
    if (r.status !== 'invited' && r.status !== 'accepted') continue;
    if (!r.dueDate) continue;
    route({
      id: r.id,
      title: r.title ?? `${r.journal} 리뷰`,
      kind: 'review',
      deadlineKind: null,
      projectId: null,
      dueDate: r.dueDate,
      done: false,
      readOnly: true,
    });
  }

  overdue.sort(byDueThenTitle);
  todayList.sort(byDueThenTitle);
  thisWeek.sort(byDueThenTitle);
  doing.sort(byDueThenTitle);

  return {
    overdue,
    today: [...todayList, ...doneToday.sort(byDueThenTitle)],
    thisWeek,
    doing,
    next: next.slice(0, NEXT_LIMIT),
  };
}
