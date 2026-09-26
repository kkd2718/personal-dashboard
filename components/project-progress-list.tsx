import Link from 'next/link';
import { projectProgress } from '@/lib/logic/progress';
import { projectColorClasses } from '@/lib/project-colors';
import type { Milestone, Project, Task } from '@/lib/types';

/** Active projects with >=1 task: name, current active queue, progress bar. */
export function ProjectProgressList({
  projects,
  milestones,
  tasks,
}: {
  projects: Project[];
  milestones: Milestone[];
  tasks: Task[];
}) {
  const rows = projects
    .filter((p) => p.status === 'active')
    .map((p) => ({ project: p, progress: projectProgress(p.id, tasks) }))
    .filter((r) => r.progress.total > 0);

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
        {rows.map(({ project, progress }) => {
          const activeQueue = milestones.find((m) => m.projectId === project.id && m.status === 'active');
          const colors = projectColorClasses(project.color);
          return (
            <li key={project.id}>
              <Link href={`/projects/${project.slug}`} className="flex flex-col gap-1 text-xs hover:opacity-80">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 font-medium">
                    <span className={`h-1.5 w-1.5 rounded-full ${colors.dot}`} />
                    {project.name}
                  </span>
                  <span className="text-foreground/50">
                    {progress.done}/{progress.total} ({progress.pct}%)
                  </span>
                </div>
                {activeQueue && <span className="text-foreground/40">{activeQueue.title}</span>}
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-foreground/10">
                  <div
                    className={`h-full rounded-full ${colors.dot}`}
                    style={{ width: `${progress.pct ?? 0}%` }}
                  />
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
