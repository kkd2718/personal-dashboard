import type { Deadline, Paper, PaperStage } from '@/lib/types';
import { ddayLabel, dday } from '@/lib/logic/dates';

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

/** Stage-specific third line for a paper card (ux-advice.md §5.5). Pure, so the
 * board component just renders whatever this returns. */
export function paperCardLine(paper: Paper, deadlines: Deadline[], today: string): string | null {
  switch (paper.stage) {
    case 'writing':
      return paper.nextAction ? `▸ ${paper.nextAction}` : null;
    case 'submitted':
    case 'under_review': {
      const latest = [...paper.submissions].reverse().find((s) => s.submittedAt);
      if (latest?.submittedAt) {
        const days = -dday(latest.submittedAt.slice(0, 10), today);
        return `심사 ${days}일째`;
      }
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
      return `${paper.journal ?? latest.journal} · ${latest.decidedAt.slice(0, 7)}`;
    }
    default:
      return null;
  }
}
