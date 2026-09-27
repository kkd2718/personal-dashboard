import type { Deadline, Paper, PaperStage } from '@/lib/types';
import { addDaysStr, ddayLabel, dday, kstDateTime } from '@/lib/logic/dates';

/**
 * Move a paper to `toStage` at `toIndex`, renumbering `sort` densely (0..n-1)
 * within the destination column, and within the origin column if it changed.
 * Unrelated columns are left untouched. Unknown id returns papers unchanged.
 */
export function movePaper(
  papers: Paper[],
  id: string,
  toStage: PaperStage,
  toIndex: number
): Paper[] {
  const moving = papers.find((p) => p.id === id);
  if (!moving) return papers;

  const fromStage = moving.stage;
  const others = papers.filter((p) => p.id !== id);

  const destColumn = others
    .filter((p) => p.stage === toStage)
    .sort((a, b) => a.sort - b.sort);
  const clampedIndex = Math.max(0, Math.min(toIndex, destColumn.length));
  destColumn.splice(clampedIndex, 0, { ...moving, stage: toStage });

  const updates = new Map<string, { stage: PaperStage; sort: number }>();
  destColumn.forEach((p, i) => updates.set(p.id, { stage: toStage, sort: i }));

  if (fromStage !== toStage) {
    const originColumn = others
      .filter((p) => p.stage === fromStage)
      .sort((a, b) => a.sort - b.sort);
    originColumn.forEach((p, i) => updates.set(p.id, { stage: fromStage, sort: i }));
  }

  return papers.map((p) => {
    const u = updates.get(p.id);
    return u ? { ...p, stage: u.stage, sort: u.sort } : p;
  });
}

/** Pipeline stage order + Korean labels shared by the papers kanban and the home
 * 논문 lane (PLAN_HOME2.md §Lanes 2). */
export const PAPER_STAGE_ORDER: PaperStage[] = [
  'idea',
  'writing',
  'submitted',
  'under_review',
  'revision',
  'accepted',
  'published',
];

export const PAPER_STAGE_LABEL: Record<PaperStage, string> = {
  idea: '아이디어',
  writing: '작성중',
  submitted: '투고',
  under_review: '심사중',
  revision: '수정',
  accepted: '게재확정',
  published: '출판',
};

export interface PaperLaneGroup {
  stage: PaperStage;
  label: string;
  papers: Paper[];
}

/** Home 논문 lane rows (PLAN_HOME2.md §Lanes 2): papers grouped by stage in
 * pipeline order, empty stages omitted, each group's papers sorted by `sort`. */
// Print-ahead-of-publication can lag up to ~3 months, so a published paper stays in
// the home lane that long, then drops out (it stays on /papers).
const PUBLISHED_LANE_DAYS = 90;

/** When the paper became published: the latest submission decision date, else its
 * last update (moving a card to 게재 on the board stamps updatedAt). */
function publishedSince(paper: Paper): string {
  const decided = paper.submissions.map((s) => s.decidedAt).filter((d): d is string => !!d).sort().pop();
  return kstDateTime(decided ?? paper.updatedAt).date;
}

export function paperLaneGroups(papers: Paper[], today?: string): PaperLaneGroup[] {
  const cutoff = today ? addDaysStr(today, -PUBLISHED_LANE_DAYS) : null;
  const visible = papers.filter((p) => !(cutoff && p.stage === 'published' && publishedSince(p) < cutoff));
  return PAPER_STAGE_ORDER.map((stage) => ({
    stage,
    label: PAPER_STAGE_LABEL[stage],
    papers: visible.filter((p) => p.stage === stage).sort((a, b) => a.sort - b.sort),
  })).filter((g) => g.papers.length > 0);
}

/** Stage-specific third line for a paper card (ux-advice.md §5.5). Pure, so the
 * board component just renders whatever this returns. */
export function paperCardLine(paper: Paper, deadlines: Deadline[], today: string): string | null {
  switch (paper.stage) {
    case 'writing': {
      const target = paper.targetJournals[0];
      if (paper.nextAction) return target ? `▸ ${paper.nextAction} · 목표 ${target}` : `▸ ${paper.nextAction}`;
      return target ? `목표 ${target}` : null;
    }
    case 'submitted':
    case 'under_review': {
      const latest = [...paper.submissions].reverse().find((s) => s.submittedAt);
      if (latest?.submittedAt) {
        const days = -dday(latest.submittedAt.slice(0, 10), today);
        return `심사 ${days}일째`;
      }
      const current = paper.submissions[paper.submissions.length - 1];
      if (current && (current.decision === null || current.decision === 'pending')) return `${current.journal} 심사 중`;
      return paper.submissions.length > 0 ? `투고 ${paper.submissions.length}회` : null;
    }
    case 'revision': {
      const linked = deadlines.find((d) => d.paperId === paper.id && !d.done);
      return linked ? `⚠ 리비전 ${ddayLabel(dday(linked.dueDate, today))}` : '리비전 기한 없음';
    }
    case 'accepted':
    case 'published': {
      const latest = [...paper.submissions].reverse().find((s) => s.decidedAt);
      if (!latest?.decidedAt) return paper.journal;
      // A placeholder journal like '(게재)' (date known, journal not recorded) reads as '게재 2026-09'.
      const journal = paper.journal ?? (/^\(.*\)$/.test(latest.journal) || !latest.journal ? null : latest.journal);
      return journal ? `${journal} · ${latest.decidedAt.slice(0, 7)}` : `게재 ${latest.decidedAt.slice(0, 7)}`;
    }
    default:
      return null;
  }
}
