import { notFound } from 'next/navigation';
import { getRepo } from '@/lib/repo';
import { ProjectEditForm } from '@/components/project-edit-form';
import { QuickCapture } from '@/components/quick-capture';
import { NoteItem } from '@/components/note-item';
import { DdayChip } from '@/components/dday-chip';
import { PaperSubmissions } from '@/components/paper-submissions';
import { QueueStrip } from '@/components/queue-strip';
import { TaskBoard } from '@/components/task-board';
import { dday, todayKST } from '@/lib/logic/dates';
import { tagCounts } from '@/lib/logic/notes';

// D-day depends on "today" in KST; never cache this page.
export const dynamic = 'force-dynamic';

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const repo = getRepo();
  const project = await repo.getProjectBySlug(slug);
  if (!project) notFound();

  const [notes, deadlines, papers, projects, activityList, milestones, tasks] = await Promise.all([
    repo.listNotes(),
    repo.listDeadlines(),
    repo.listPapers(),
    repo.listProjects(),
    repo.listProjectActivity(),
    repo.listMilestones(),
    repo.listTasks(),
  ]);
  const activity = activityList.find((a) => a.projectId === project.id);

  const today = todayKST();
  const linkedNotes = notes
    .filter((n) => n.projectId === project.id)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const linkedDeadlines = deadlines.filter((d) => d.projectId === project.id);
  const linkedPapers = papers.filter((p) => p.projectId === project.id);
  const linkedMilestones = milestones.filter((m) => m.projectId === project.id);
  const linkedTasks = tasks.filter((t) => t.projectId === project.id);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold">{project.name}</h1>
        <p className="text-sm text-foreground/50">
          {project.group} / {project.subgroup ?? '기타'}
        </p>
        {project.paths.length > 0 && (
          <p className="mt-1 text-xs text-foreground/40">{project.paths.join(' · ')}</p>
        )}
        {activity?.lastCommitAt && (
          <p className="mt-1 text-xs text-foreground/40">
            마지막 커밋 {dday(today, activity.lastCommitAt.slice(0, 10)) <= 0 ? '오늘' : `${dday(today, activity.lastCommitAt.slice(0, 10))}일 전`}
            {activity.branch ? ` (${activity.branch})` : ''}
            {activity.dirty ? ' · 미커밋 변경 있음' : ''}
          </p>
        )}
      </div>

      <ProjectEditForm project={project} />

      <QueueStrip projectId={project.id} milestones={linkedMilestones} tasks={linkedTasks} />

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-foreground/60">할 일</h2>
        <TaskBoard project={project} initialTasks={linkedTasks} milestones={linkedMilestones} />
      </section>

      {linkedPapers.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium text-foreground/60">논문</h2>
          <ul className="flex flex-col gap-2">
            {linkedPapers.map((p) => (
              <li key={p.id} className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-3 text-sm">
                {p.title}
                <PaperSubmissions paper={p} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-foreground/60">마감</h2>
        {linkedDeadlines.length === 0 ? (
          <p className="text-sm text-foreground/50">연결된 마감이 없습니다.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {linkedDeadlines.map((d) => (
              <li
                key={d.id}
                className="flex items-center gap-2 rounded-xl border border-border bg-surface p-3 text-sm"
              >
                <span className="flex-1">{d.title}</span>
                <DdayChip n={dday(d.dueDate, today)} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-foreground/60">메모 · 아이디어</h2>
        <QuickCapture
          projects={projects.filter((p) => p.status === 'active')}
          existingTags={tagCounts(notes)}
          defaultProjectId={project.id}
        />
        {linkedNotes.length === 0 ? (
          <p className="text-sm text-foreground/50">연결된 메모가 없습니다.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {linkedNotes.map((n) => (
              <NoteItem key={n.id} note={n} projects={projects} milestones={milestones} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
