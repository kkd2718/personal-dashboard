import { getRepo } from '@/lib/repo';
import { PaperBoard } from '@/components/paper-board';
import { ReviewList } from '@/components/review-list';

interface SearchParams {
  tab?: string;
}

// Review tab shows D-day chips depending on "today" in KST; never cache this page.
export const dynamic = 'force-dynamic';

export default async function PapersPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { tab } = await searchParams;
  const active = tab === 'review' ? 'review' : 'papers';
  const repo = getRepo();
  const [papers, reviews, candidates] = await Promise.all([
    repo.listPapers(),
    repo.listReviews(),
    repo.listReviewCandidates('pending'),
  ]);

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-lg font-semibold">논문</h1>

      <div className="flex gap-1 rounded-lg border border-border p-1 text-sm">
        <a
          href="/papers"
          className={`flex-1 rounded-md px-3 py-1.5 text-center transition ${
            active === 'papers' ? 'bg-blue-600 text-white' : 'text-foreground/60 hover:bg-foreground/5'
          }`}
        >
          파이프라인
        </a>
        <a
          href="/papers?tab=review"
          className={`flex-1 rounded-md px-3 py-1.5 text-center transition ${
            active === 'review' ? 'bg-blue-600 text-white' : 'text-foreground/60 hover:bg-foreground/5'
          }`}
        >
          리뷰
        </a>
      </div>

      {active === 'papers' ? (
        <PaperBoard initialPapers={papers} />
      ) : (
        <ReviewList reviews={reviews} candidates={candidates} papers={papers} />
      )}
    </div>
  );
}
