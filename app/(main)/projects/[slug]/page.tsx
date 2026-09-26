import { notFound } from 'next/navigation';
import { GitBranch, Laptop, Link2, Folder, Radio } from 'lucide-react';
import { getRepo } from '@/lib/repo';
import { ProjectEditSheet } from '@/components/projects/project-edit-sheet';
import { StatusPillSelect } from '@/components/projects/status-pill-select';
import { CopyPathButton } from '@/components/projects/copy-path-button';
import { NextActionEditor } from '@/components/projects/next-action-editor';
import { QuickCapture } from '@/components/quick-capture';
import { NoteItem } from '@/components/note-item';
import { DdayChip } from '@/components/dday-chip';
import { PaperSubmissions } from '@/components/paper-submissions';
import { QueueStrip } from '@/components/queue-strip';
import { TaskBoard } from '@/components/task-board';
import { EmptyState } from '@/components/ui/empty-state';
import { relTime, dday, todayKST } from '@/lib/logic/dates';
import { tagCounts } from '@/lib/logic/notes';
import { projectProgress } from '@/lib/logic/progress';
import type { LinkRef } from '@/lib/types';

// D-day depends on "today" in KST; never cache this page.
export const dynamic = 'force-dynamic';

const LINK_ICON: Record<LinkRef['kind'], typeof Link2> = { public: Link2, repo: GitBranch, local: Laptop, tailscale: Radio, folder: Folder };

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
  const now = new Date().toISOString();
  const linkedNotes = notes
    .filter((n) => n.projectId === project.id)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const linkedDeadlines = deadlines.filter((d) => d.projectId === project.id && !d.done);
  const linkedPapers = papers.filter((p) => p.projectId === project.id);
  const linkedMilestones = milestones.filter((m) => m.projectId === project.id);
  const linkedTasks = tasks.filter((t) => t.projectId === project.id);
  const progress = projectProgress(project.id, linkedTasks);
  const agentCount = linkedTasks.filter((t) => t.assignee === 'agent').length;
  const meCount = linkedTasks.filter((t) => t.assignee === 'me').length;

  const activityParts: string[] = [];
  if (activity?.lastCommitAt) {
    activityParts.push(`${activity.branch ? `(${activity.branch}) ` : ''}커밋 ${relTime(activity.lastCommitAt, now)}`);
    if (activity.dirty) activityParts.push('미커밋 변경 있음');
  } else if (activity?.metrics.wsl === '1') {
    activityParts.push('WSL · 아직 수집 전');
  }
  if (activity?.lastSessionAt) activityParts.push(`마지막 세션 ${relTime(activity.lastSessionAt, now)}`);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="flex items-center gap-2 text-lg font-semibold">{project.name}</h1>
          <div className="flex items-center gap-1.5">
            <StatusPillSelect project={project} />
            <ProjectEditSheet project={project} />
          </div>
        </div>
        <p className="text-sm text-foreground/50">
          {project.group === 'app' ? '앱' : project.group === 'research' ? '연구' : '개인'}
          {project.subgroup ? ` · ${project.subgroup}` : ''}
          {project.summary ? ` · ${project.summary}` : ''}
        </p>
        {activityParts.length > 0 && <p className="text-xs text-foreground/40">{activityParts.join(' · ')}</p>}
        {(project.links.length > 0 || project.paths.length > 0) && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {project.links.map((link) => {
              const Icon = LINK_ICON[link.kind];
              const needsPc = link.kind === 'local' || link.kind === 'tailscale';
              return (
                <a
                  key={link.url}
                  href={link.kind === 'local' ? undefined : link.url}
                  target="_blank"
                  rel="noreferrer"
                  title={needsPc ? 'PC 필요' : link.url}
                  className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-foreground/70 hover:bg-foreground/5"
                >
                  <Icon size={12} />
                  {link.label}
                  {needsPc && <span className="text-foreground/40">(PC 필요)</span>}
                </a>
              );
            })}
            {project.paths.length > 0 && <CopyPathButton path={project.paths[0]} />}
          </div>
        )}
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-foreground/60">지금</h2>
        <div className="rounded-xl border border-border bg-surface p-3">
          <NextActionEditor projectId={project.id} nextAction={project.nextAction} />
        </div>
        <QueueStrip projectId={project.id} milestones={linkedMilestones} tasks={linkedTasks} />
      </section>

      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-foreground/60">할 일</h2>
          <span className="text-xs text-foreground/40">
            나 {meCount} · 에이전트 {agentCount}
            {progress.total >= 3 && ` · ${progress.done}/${progress.total} 완료`}
          </span>
        </div>
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

      {linkedDeadlines.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium text-foreground/60">마감</h2>
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
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-foreground/60">메모</h2>
        <QuickCapture
          projects={projects.filter((p) => p.status === 'active')}
          existingTags={tagCounts(notes)}
          defaultProjectId={project.id}
        />
        {linkedNotes.length === 0 ? (
          <EmptyState>연결된 메모가 없어요.</EmptyState>
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
