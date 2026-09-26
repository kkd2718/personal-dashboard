import { getRepo } from '@/lib/repo';
import { QuickCapture } from '@/components/quick-capture';
import { MemoBoard } from '@/components/memo-board';
import { tagCounts } from '@/lib/logic/notes';

interface SearchParams {
  kind?: string;
  status?: string;
  project?: string;
  tag?: string;
}

export default async function MemoPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { kind, status, project, tag } = await searchParams;
  const repo = getRepo();
  const [notes, projects, milestones] = await Promise.all([
    repo.listNotes(),
    repo.listProjects(),
    repo.listMilestones(),
  ]);
  const tags = tagCounts(notes);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-lg font-semibold">메모</h1>
        <p className="text-sm text-foreground/50">떠오른 생각을 적어두고, 필요하면 할 일로 바꾸세요.</p>
      </div>
      <QuickCapture projects={projects.filter((p) => p.status === 'active')} existingTags={tags} />
      <MemoBoard
        notes={notes}
        projects={projects}
        milestones={milestones}
        tags={tags}
        initial={{ kind: kind ?? '', status: status ?? '', project: project ?? '', tag: tag ?? '' }}
      />
    </div>
  );
}
