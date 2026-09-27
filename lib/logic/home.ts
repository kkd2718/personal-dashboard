import type { Deadline, Group, Milestone, Paper, PaperStage, Project, ProjectActivity, Task } from '@/lib/types';
import { dday, endOfIsoWeek, relTime } from '@/lib/logic/dates';
import { backlogProgress, milestoneProgress, type Progress } from '@/lib/logic/progress';

export interface DeadlineCounts {
  overdue: number;
  today: number;
  thisWeek: number; // due in (today, endOfIsoWeek(today)]
}

/** Open (non-done) deadline counts for the home header sentence (ux-advice.md §5.1). */
export function deadlineCounts(deadlines: Deadline[], today: string): DeadlineCounts {
  const weekEnd = endOfIsoWeek(today);
  const counts: DeadlineCounts = { overdue: 0, today: 0, thisWeek: 0 };
  for (const d of deadlines) {
    if (d.done) continue;
    if (d.dueDate < today) counts.overdue += 1;
    else if (d.dueDate === today) counts.today += 1;
    else if (d.dueDate <= weekEnd) counts.thisWeek += 1;
  }
  return counts;
}

/**
 * Header count sentence (§6): non-zero parts only, joined by " · ";
 * all-zero falls back to "이번 주 마감 없음".
 */
export function headerCountLabel(counts: DeadlineCounts, next?: { title: string; dueDate: string; today: string }): string {
  const parts: string[] = [];
  if (counts.today > 0) parts.push(`오늘 마감 ${counts.today}`);
  if (counts.thisWeek > 0) parts.push(`이번 주 ${counts.thisWeek}`);
  if (counts.overdue > 0) parts.push(`지남 ${counts.overdue}`);
  if (parts.length > 0) return parts.join(' · ');
  // Nothing this week: name the next one instead of a dead-end "없음".
  if (next) {
    const [, m, d] = next.dueDate.split('-');
    return `다음 마감 D-${dday(next.dueDate, next.today)} · ${Number(m)}/${Number(d)} ${next.title}`;
  }
  return '이번 주 마감 없음';
}

/** Earliest open deadline after this week (for headerCountLabel's fallback). */
export function nextDeadlineAfterWeek(deadlines: Deadline[], today: string): Deadline | null {
  const weekEnd = endOfIsoWeek(today);
  return (
    deadlines
      .filter((d) => !d.done && d.dueDate > weekEnd)
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0] ?? null
  );
}

/**
 * One-sentence project activity summary for the merged "프로젝트" section
 * (planner decision 1): "방금 세션 · 커밋 3일 전". Null when nothing is known yet.
 */
export function projectActivitySentence(activity: ProjectActivity | undefined, now: string): string | null {
  if (!activity) return null;
  const parts: string[] = [];
  if (activity.lastSessionAt) parts.push(`${relTime(activity.lastSessionAt, now)} 세션`);
  if (activity.lastCommitAt) parts.push(`커밋 ${relTime(activity.lastCommitAt, now)}`);
  if (parts.length === 0) return null;
  return parts.join(' · ');
}

/** Sorts active projects by most recent session/commit first; projects with no
 * activity data sort last (stable by input order within each group). */
export function sortByRecency(projects: Project[], activityByProjectId: Map<string, ProjectActivity>): Project[] {
  function recencyKey(p: Project): string {
    const a = activityByProjectId.get(p.id);
    return a?.lastSessionAt ?? a?.lastCommitAt ?? '';
  }
  return [...projects].sort((a, b) => (recencyKey(a) < recencyKey(b) ? 1 : recencyKey(a) > recencyKey(b) ? -1 : 0));
}

const STAGE_GROUP: Record<PaperStage, string> = {
  idea: '작성중',
  writing: '작성중',
  submitted: '심사중',
  under_review: '심사중',
  revision: '수정',
  accepted: '출판',
  published: '출판',
};

const STAGE_GROUP_ORDER = ['작성중', '심사중', '수정', '출판'] as const;

/** Home 논문 strip summary: "작성중 3 · 심사중 1 · 수정 2 · 출판 1" (non-zero groups only). */
export function paperStageSummary(papers: Paper[]): string {
  const counts = new Map<string, number>();
  for (const p of papers) {
    const group = STAGE_GROUP[p.stage];
    counts.set(group, (counts.get(group) ?? 0) + 1);
  }
  return STAGE_GROUP_ORDER.filter((g) => (counts.get(g) ?? 0) > 0)
    .map((g) => `${g} ${counts.get(g)}`)
    .join(' · ');
}

export type QueueLaneCard =
  | { kind: 'queue'; project: Project; milestone: Milestone; progress: Progress; nextTaskTitle: string | null; agentOpenCount: number }
  | { kind: 'backlog'; project: Project; backlog: Progress }
  | { kind: 'nextAction'; project: Project; nextAction: string };

const GROUP_ORDER: Group[] = ['app', 'research', 'personal'];

/**
 * Home 개발 큐 lane rows (PLAN_HOME2.md §Lanes 1), active projects only, `app`
 * group first then research/personal, by `project.sort` within a group. One
 * `queue` card per active milestone (a project with several active milestones
 * gets several cards); a project with no active milestone falls back to a
 * `backlog` card (collector backlog metrics) or, failing that, a `nextAction`
 * light row — never more than one fallback card per project.
 */
export function buildQueueLaneCards(
  projects: Project[],
  milestones: Milestone[],
  tasks: Task[],
  activityList: ProjectActivity[],
  papers: Paper[] = []
): QueueLaneCard[] {
  // A research project whose work is a paper already has its row (and next action)
  // in the 논문 lane — a bare next-action card here would just duplicate it.
  const projectsWithPaper = new Set(papers.map((p) => p.projectId).filter((id): id is string => !!id));
  const activityByProjectId = new Map(activityList.map((a) => [a.projectId, a]));
  const active = [...projects.filter((p) => p.status === 'active')].sort((a, b) => {
    const byGroup = GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group);
    return byGroup !== 0 ? byGroup : a.sort - b.sort;
  });

  const cards: QueueLaneCard[] = [];
  for (const project of active) {
    const activeMilestones = milestones
      .filter((m) => m.projectId === project.id && m.status === 'active')
      .sort((a, b) => a.sort - b.sort);

    if (activeMilestones.length > 0) {
      for (const milestone of activeMilestones) {
        const msTasks = tasks.filter((t) => t.milestoneId === milestone.id);
        const nextTask = msTasks.filter((t) => t.status !== 'done').sort((a, b) => a.sort - b.sort)[0];
        cards.push({
          kind: 'queue',
          project,
          milestone,
          progress: milestoneProgress(milestone, tasks),
          nextTaskTitle: nextTask?.title ?? null,
          agentOpenCount: msTasks.filter((t) => t.assignee === 'agent' && t.status !== 'done').length,
        });
      }
      continue;
    }

    const backlog = backlogProgress(activityByProjectId.get(project.id));
    if (backlog && backlog.total > 0) {
      cards.push({ kind: 'backlog', project, backlog });
      continue;
    }

    if (project.nextAction && !projectsWithPaper.has(project.id)) {
      cards.push({ kind: 'nextAction', project, nextAction: project.nextAction });
    }
  }
  return cards;
}

export interface RevisionDeadlineChip {
  paperShortName: string;
  dueDate: string;
  n: number; // dday
}

/** Earliest open paper-revision deadline due within 30 days, for the home 논문 strip warn chip. */
export function nextRevisionDeadline(papers: Paper[], deadlines: Deadline[], today: string): RevisionDeadlineChip | null {
  const candidates = deadlines
    .filter((d) => !d.done && d.kind === 'paper' && d.paperId && dday(d.dueDate, today) <= 30)
    .sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1));
  const next = candidates[0];
  if (!next) return null;
  const paper = papers.find((p) => p.id === next.paperId);
  if (!paper) return null;
  return { paperShortName: paper.shortName, dueDate: next.dueDate, n: dday(next.dueDate, today) };
}
