import Link from 'next/link';
import { Mail, Plus } from 'lucide-react';
import { LaneCard } from '@/components/home/lane-card';
import { EmptyState } from '@/components/ui/empty-state';
import { Chip } from '@/components/ui/chip';
import { DdayChip } from '@/components/dday-chip';
import { paperCardLine, paperLaneGroups } from '@/lib/logic/papers';
import { dday, todayKST } from '@/lib/logic/dates';
import type { Deadline, Paper, ReviewJob } from '@/lib/types';

/** Home 논문 lane (PLAN_HOME2.md §Lanes 2): stage-grouped compact rows, an open-
 * review section below, and a top amber row for pending review-mail candidates. */
export function PaperLane({
  papers,
  deadlines,
  reviews,
  reviewCandidateCount,
}: {
  papers: Paper[];
  deadlines: Deadline[];
  reviews: ReviewJob[];
  reviewCandidateCount: number;
}) {
  const today = todayKST();
  const groups = paperLaneGroups(papers);
  const openReviews = reviews.filter((r) => (r.status === 'invited' || r.status === 'accepted') && r.dueDate);
  const isEmpty = groups.length === 0 && openReviews.length === 0;

  return (
    <LaneCard
      title="논문"
      count={papers.length + openReviews.length}
      href="/papers"
      footer={
        <Link
          href="/papers"
          className="flex items-center gap-1 rounded-lg border border-dashed border-border px-2.5 py-1.5 text-xs text-foreground/50 hover:bg-foreground/5"
        >
          <Plus size={12} /> 논문
        </Link>
      }
    >
      {reviewCandidateCount > 0 && (
        <Link
          href="/papers?tab=review"
          className="flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-xs text-amber-700 hover:bg-amber-500/20 dark:text-amber-300"
        >
          <Mail size={12} /> 메일 확인 {reviewCandidateCount} →
        </Link>
      )}

      {isEmpty ? (
        <EmptyState>등록된 논문이 없어요.</EmptyState>
      ) : (
        <div className="flex flex-col gap-1.5">
          {groups.map((g) =>
            g.papers.map((p) => {
              const line = paperCardLine(p, deadlines.filter((d) => d.paperId === p.id), today);
              return (
                <Link
                  key={p.id}
                  href="/papers"
                  className="flex items-center gap-2 rounded-lg border border-border p-2 text-xs hover:bg-foreground/5"
                >
                  <Chip className="shrink-0">{g.label}</Chip>
                  <span className="shrink-0 font-medium">{p.shortName}</span>
                  {line && <span className="min-w-0 flex-1 truncate text-right text-foreground/50">{line}</span>}
                </Link>
              );
            })
          )}

          {openReviews.length > 0 && (
            <div className="flex flex-col gap-1.5 border-t border-border pt-2">
              <h3 className="text-[11px] font-medium text-foreground/40">리뷰</h3>
              {openReviews.map((r) => (
                <Link
                  key={r.id}
                  href="/papers?tab=review"
                  className="flex items-center gap-2 rounded-lg border border-border p-2 text-xs hover:bg-foreground/5"
                >
                  <span className="min-w-0 flex-1 truncate">
                    {r.journal}
                    {r.manuscriptId ? ` ${r.manuscriptId}` : ''}
                  </span>
                  {r.dueDate && <DdayChip n={dday(r.dueDate, today)} />}
                </Link>
              ))}
            </div>
          )}
        </div>
      )}
    </LaneCard>
  );
}
