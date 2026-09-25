import type { Paper, PaperStage } from '@/lib/types';

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
