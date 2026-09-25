import Link from 'next/link';
import { getRepo } from '@/lib/repo';
import { todayKST } from '@/lib/logic/dates';
import { upcoming } from '@/lib/logic/upcoming';
import { QuickCapture } from '@/components/quick-capture';
import { DdayChip } from '@/components/dday-chip';
import { ProjectCard } from '@/components/project-card';

const STAGE_LABEL: Record<string, string> = {
  idea: '아이디어',
  writing: '작성중',
  submitted: '투고',
  under_review: '심사중',
  revision: '수정',
  accepted: '게재확정',
  published: '출판',
};

// D-day depends on "today" in KST; never cache this page.
export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const repo = getRepo();
  const [notes, projects, papers, deadlines, reviews, activity] = await Promise.all([
    repo.listNotes(),
    repo.listProjects(),
    repo.listPapers(),
    repo.listDeadlines(),
    repo.listReviews(),
    repo.listProjectActivity(),
  ]);
  const activityByProject = new Map(activity.map((a) => [a.projectId, a]));

  const today = todayKST();
  const items = upcoming(deadlines, reviews, today, 14);
  const inboxNotes = notes.filter((n) => n.status === 'inbox');
  const lastNotes = [...inboxNotes]
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, 5);
  const pinnedProjects = projects.filter((p) => p.pinned);

  const stageCounts = papers.reduce<Record<string, number>>((acc, p) => {
    acc[p.stage] = (acc[p.stage] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="flex flex-col gap-8">
      <QuickCapture />

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="font-medium">다가오는 마감</h2>
          <Link href="/deadlines" className="text-xs text-foreground/50 hover:underline">
            전체 보기
          </Link>
        </div>
        {items.length === 0 ? (
          <p className="text-sm text-foreground/50">14일 이내 마감이 없습니다.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {items.map((item) => (
              <li
                key={item.id}
                className="flex items-center gap-2 rounded-xl border border-border bg-surface p-3 text-sm"
              >
                <DdayChip n={item.dday} />
                <span className="flex-1 truncate">{item.title}</span>
                <span className="text-xs text-foreground/40">{item.dueDate}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="font-medium">인박스 ({inboxNotes.length})</h2>
          <Link href="/inbox" className="text-xs text-foreground/50 hover:underline">
            전체 보기
          </Link>
        </div>
        {lastNotes.length === 0 ? (
          <p className="text-sm text-foreground/50">인박스가 비어 있습니다.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {lastNotes.map((n) => (
              <li key={n.id} className="truncate rounded-xl border border-border bg-surface p-3 text-sm">
                {n.body}
              </li>
            ))}
          </ul>
        )}
      </section>

      {pinnedProjects.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="font-medium">고정된 프로젝트</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {pinnedProjects.map((p) => (
              <ProjectCard key={p.id} project={p} activity={activityByProject.get(p.id)} />
            ))}
          </div>
        </section>
      )}

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="font-medium">논문 파이프라인</h2>
          <Link href="/papers" className="text-xs text-foreground/50 hover:underline">
            전체 보기
          </Link>
        </div>
        <div className="flex flex-wrap gap-2">
          {Object.entries(STAGE_LABEL).map(([stage, label]) => (
            <div
              key={stage}
              className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs"
            >
              <span className="text-foreground/60">{label}</span>
              <span className="font-medium">{stageCounts[stage] ?? 0}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
