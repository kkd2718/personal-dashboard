import Link from 'next/link';
import { projectActivitySentence, sortByRecency } from '@/lib/logic/home';
import { backlogLabel, backlogProgress, progressLabel, projectProgress, shouldShowBacklogBar } from '@/lib/logic/progress';
import { projectColorClasses } from '@/lib/project-colors';
import { EmptyState } from '@/components/ui/empty-state';
import type { Project, ProjectActivity, Task } from '@/lib/types';

const MAX_ROWS = 6;

/**
 * Merged "프로젝트" section (planner decision 1, ux-advice.md §5.1): replaces the
 * old 진행률 panel and the spec's separate "최근 활동" list with one list — each
 * active project as one activity sentence + one progress bar, sorted by recency.
 * PLAN_HOME2.md §Header: now embedded (no outer card chrome) inside the header's
 * "⚠ 확인 필요" popover/sheet, below StatusPanel.
 */
export function ProjectProgressList({
  projects,
  tasks,
  activityList = [],
}: {
  projects: Project[];
  tasks: Task[];
  activityList?: ProjectActivity[];
}) {
  const activityByProjectId = new Map(activityList.map((a) => [a.projectId, a]));
  const now = new Date().toISOString();
  const active = projects.filter((p) => p.status === 'active');

  const rows = sortByRecency(active, activityByProjectId)
    .map((project) => {
      const progress = projectProgress(project.id, tasks);
      const backlog = backlogProgress(activityByProjectId.get(project.id));
      const showBacklog = shouldShowBacklogBar(project, tasks, backlog);
      return {
        project,
        progress,
        backlog: showBacklog ? backlog : null,
        sentence: projectActivitySentence(activityByProjectId.get(project.id), now),
      };
    })
    .filter((r) => r.progress.total > 0 || r.backlog != null || r.sentence != null)
    .slice(0, MAX_ROWS);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">프로젝트</h2>
        <Link href="/projects" className="text-xs text-foreground/50 hover:underline">
          전체 →
        </Link>
      </div>
      {rows.length === 0 ? (
        <EmptyState>진행 중인 프로젝트 활동이 없어요.</EmptyState>
      ) : (
        <ul className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-auto">
          {rows.map(({ project, progress, backlog, sentence }) => {
            const colors = projectColorClasses(project.color);
            const hasTasks = progress.total > 0;
            return (
              <li key={project.id}>
                <Link href={`/projects/${project.slug}`} className="flex flex-col gap-1 text-xs hover:opacity-80">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-1.5 font-medium">
                      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${colors.dot}`} />
                      <span className="truncate">{project.name}</span>
                    </span>
                    {hasTasks && <span className="shrink-0 text-foreground/50">{progressLabel(progress)}</span>}
                  </div>
                  {sentence && <span className="text-foreground/40">{sentence}</span>}
                  {hasTasks && progress.total >= 3 && (
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-foreground/10">
                      <div className={`h-full rounded-full ${colors.dot}`} style={{ width: `${progress.pct ?? 0}%` }} />
                    </div>
                  )}
                  {backlog && (
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-foreground/10">
                        <div className="h-full rounded-full bg-foreground/30" style={{ width: `${backlog.pct ?? 0}%` }} />
                      </div>
                      <span className="shrink-0 text-foreground/50">{backlogLabel(backlog)}</span>
                    </div>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
