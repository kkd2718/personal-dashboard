import Link from 'next/link';
import { nextRevisionDeadline, paperStageSummary } from '@/lib/logic/home';
import { ddayLabel } from '@/lib/logic/dates';
import { Chip } from '@/components/ui/chip';
import { EmptyState } from '@/components/ui/empty-state';
import type { Deadline, Paper } from '@/lib/types';

/** Home 논문 strip (§5.1): stage counts + an optional near-term revision warn chip. */
export function PaperStrip({ papers, deadlines, today }: { papers: Paper[]; deadlines: Deadline[]; today: string }) {
  const summary = paperStageSummary(papers);
  const revision = nextRevisionDeadline(papers, deadlines, today);

  return (
    <Link
      href="/papers"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-border bg-surface p-3 text-sm hover:opacity-80"
    >
      <h2 className="shrink-0 font-semibold">논문</h2>
      {summary ? <span className="text-foreground/60">{summary}</span> : <EmptyState>등록된 논문이 없어요.</EmptyState>}
      {revision && (
        <Chip tone="warn">
          ⚠ {revision.paperShortName} 리비전 {ddayLabel(revision.n)}
        </Chip>
      )}
      <span className="ml-auto shrink-0 text-xs text-foreground/40">전체 →</span>
    </Link>
  );
}
