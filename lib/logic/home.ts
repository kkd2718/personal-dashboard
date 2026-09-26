import type { Deadline, Paper, PaperStage, Project, ProjectActivity } from '@/lib/types';
import { dday, endOfIsoWeek, relTime } from '@/lib/logic/dates';

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
export function headerCountLabel(counts: DeadlineCounts): string {
  const parts: string[] = [];
  if (counts.today > 0) parts.push(`오늘 마감 ${counts.today}`);
  if (counts.thisWeek > 0) parts.push(`이번 주 ${counts.thisWeek}`);
  if (counts.overdue > 0) parts.push(`지남 ${counts.overdue}`);
  return parts.length > 0 ? parts.join(' · ') : '이번 주 마감 없음';
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
