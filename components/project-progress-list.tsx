import Link from 'next/link';
import { backlogProgress, projectProgress, shouldShowBacklogBar } from '@/lib/logic/progress';
import { projectColorClasses } from '@/lib/project-colors';
import type { Milestone, Project, ProjectActivity, Task } from '@/lib/types';

/** Active projects with a task board or a markdown backlog: name, current active
 * queue, progress bar (tasks first; falls back to the BACKLOG bar — phase 2a). */
export function ProjectProgressList({
  projects,
  milestones,
  tasks,
  activityList = [],
}: {
  projects: Project[];
  milestones: Milestone[];
  tasks: Task[];
  activityList?: ProjectActivity[];
}) {
  const activityByProjectId = new Map(activityList.map((a) => [a.projectId, a]));
  const rows = projects
    .filter((p) => p.status === 'active')
    .map((p) => {
      const progress = projectProgress(p.id, tasks);
      const backlog = backlogProgress(activityByProjectId.get(p.id));
      const showBacklog = shouldShowBacklogBar(p, tasks, backlog);
      return { project: p, progress, backlog: showBacklog ? backlog : null };
    })
    .filter((r) => r.progress.total > 0 || r.backlog != null);

  if (rows.length === 0) {
    return (
      <div className="flex h-full flex-col rounded-xl border border-border bg-surface p-3">
        <h2 className="mb-1 text-sm font-semibold">진행률</h2>
        <p className="text-xs text-foreground/40">할 일이 있는 진행중 프로젝트가 없습니다.</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-2 rounded-xl border border-border bg-surface p-3">
      <h2 className="text-sm font-semibold">진행률</h2>
      <ul className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-auto">
        {rows.map(({ project, progress, backlog }) => {
          const activeQueue = milestones.find((m) => m.projectId === project.id && m.status === 'active');
          const colors = projectColorClasses(project.color);
          const hasTasks = progress.total > 0;
          return (
            <li key={project.id}>
              <Link href={`/projects/${project.slug}`} className="flex flex-col gap-1 text-xs hover:opacity-80">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 font-medium">
                    <span className={`h-1.5 w-1.5 rounded-full ${colors.dot}`} />
                    {project.name}
                  </span>
                  {hasTasks && (
                    <span className="text-foreground/50">
                      {progress.done}/{progress.total} ({progress.pct}%)
                    </span>
                  )}
                </div>
                {activeQueue && <span className="text-foreground/40">{activeQueue.title}</span>}
                {hasTasks && (
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-foreground/10">
                    <div
                      className={`h-full rounded-full ${colors.dot}`}
                      style={{ width: `${progress.pct ?? 0}%` }}
                    />
                  </div>
                )}
                {backlog && (
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-foreground/10">
                      <div className="h-full rounded-full bg-foreground/30" style={{ width: `${backlog.pct ?? 0}%` }} />
                    </div>
                    <span className="shrink-0 text-foreground/50">
                      BACKLOG {backlog.done}/{backlog.total} ({backlog.pct}%)
                    </span>
                  </div>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
