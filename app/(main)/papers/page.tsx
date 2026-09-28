import { getRepo } from '@/lib/repo';
import { PaperBoard } from '@/components/paper-board';
import { ReviewList } from '@/components/review-list';
import { NewPaperSheet } from '@/components/papers/new-paper-sheet';
import { projectDetailMetaKey } from '@/lib/logic/project-detail';
import type { ProjectDetail } from '@/lib/types';

interface SearchParams {
  tab?: string;
  paper?: string;
}

// Review tab shows D-day chips depending on "today" in KST; never cache this page.
export const dynamic = 'force-dynamic';

export default async function PapersPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { tab, paper } = await searchParams;
  const active = tab === 'review' ? 'review' : 'papers';
  const repo = getRepo();
  const [papers, reviews, candidates, deadlines, projects] = await Promise.all([
    repo.listPapers(),
    repo.listReviews(),
    repo.listReviewCandidates('pending'),
    repo.listDeadlines(),
    repo.listProjects(),
  ]);
  const projectIds = [...new Set(papers.map((p) => p.projectId).filter((id): id is string => !!id))];
  const detailList = await Promise.all(projectIds.map((id) => repo.getMeta<ProjectDetail>(projectDetailMetaKey(id))));
  const details: Record<string, ProjectDetail> = {};
  projectIds.forEach((id, i) => {
    const d = detailList[i];
    if (d) details[id] = d;
  });

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">논문</h1>
        {active === 'papers' && <NewPaperSheet />}
      </div>

      <div className="flex gap-1 rounded-[var(--r-sm)] border border-border p-0.5 text-sm">
        <a
          href="/papers"
          className={`flex-1 rounded-[calc(var(--r-sm)-2px)] px-3 py-1.5 text-center transition ${
            active === 'papers' ? 'bg-accent text-white' : 'text-foreground/70 hover:bg-foreground/5'
          }`}
        >
          파이프라인
        </a>
        <a
          href="/papers?tab=review"
          className={`flex-1 rounded-[calc(var(--r-sm)-2px)] px-3 py-1.5 text-center transition ${
            active === 'review' ? 'bg-accent text-white' : 'text-foreground/70 hover:bg-foreground/5'
          }`}
        >
          리뷰{candidates.length > 0 ? ' ●' : ''}
        </a>
      </div>

      {active === 'papers' ? (
        <PaperBoard
          initialPapers={papers}
          deadlines={deadlines}
          projects={projects}
          details={details}
          initialSelectedId={paper}
        />
      ) : (
        <ReviewList reviews={reviews} candidates={candidates} papers={papers} />
      )}
    </div>
  );
}
