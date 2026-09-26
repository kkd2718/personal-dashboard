import Link from 'next/link';
import { getRepo } from '@/lib/repo';
import { groupProjects } from '@/lib/logic/projects';
import { ProjectCard } from '@/components/project-card';
import { ProjectRow } from '@/components/projects/project-row';
import { EmptyState } from '@/components/ui/empty-state';
import type { Group } from '@/lib/types';

const GROUP_LABEL: Record<Group, string> = { app: '앱', research: '연구', personal: '개인' };
const GROUPS: Group[] = ['app', 'research', 'personal'];

interface SearchParams {
  group?: string;
}

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { group } = await searchParams;
  const active: Group = GROUPS.includes(group as Group) ? (group as Group) : 'app';

  const repo = getRepo();
  const [projects, activity, tasks, milestones] = await Promise.all([
    repo.listProjects(),
    repo.listProjectActivity(),
    repo.listTasks(),
    repo.listMilestones(),
  ]);
  const grouped = groupProjects(projects);
  const activityByProject = new Map(activity.map((a) => [a.projectId, a]));
  const now = new Date().toISOString();
  const activeList = Object.values(grouped[active]).flat();

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-lg font-semibold">프로젝트</h1>

      {/* 논문/리뷰 are reached from here on mobile — they aren't a bottom-nav tab (ux-advice.md §2). */}
      <div className="flex gap-1 rounded-[var(--r-sm)] border border-border p-0.5 text-sm md:hidden">
        <span className="flex-1 rounded-[calc(var(--r-sm)-2px)] bg-accent px-3 py-1.5 text-center text-white">프로젝트</span>
        <Link href="/papers" className="flex-1 rounded-[calc(var(--r-sm)-2px)] px-3 py-1.5 text-center text-foreground/70 hover:bg-foreground/5">
          논문
        </Link>
        <Link href="/papers?tab=review" className="flex-1 rounded-[calc(var(--r-sm)-2px)] px-3 py-1.5 text-center text-foreground/70 hover:bg-foreground/5">
          리뷰
        </Link>
      </div>

      <div className="flex gap-1 rounded-[var(--r-sm)] border border-border p-0.5 text-sm">
        {GROUPS.map((g) => {
          const count = Object.values(grouped[g]).flat().length;
          return (
            <Link
              key={g}
              href={`/projects?group=${g}`}
              aria-current={g === active ? 'page' : undefined}
              className={`flex-1 rounded-[calc(var(--r-sm)-2px)] px-3 py-1.5 text-center transition ${
                g === active ? 'bg-accent text-white' : 'text-foreground/70 hover:bg-foreground/5'
              }`}
            >
              {GROUP_LABEL[g]} {count}
            </Link>
          );
        })}
      </div>

      {activeList.length === 0 ? (
        <EmptyState>이 그룹에는 아직 프로젝트가 없어요.</EmptyState>
      ) : (
        <>
          {/* Desktop: flat row list per group, subgroup shown as a small label so a
              near-empty subgroup never wastes 2/3 of a grid row (ux-advice.md §5.3). */}
          <div className="hidden flex-col gap-4 lg:flex">
            {Object.entries(grouped[active]).map(([subgroup, list]) => (
              <section key={subgroup} className="flex flex-col gap-1.5">
                <h2 className="text-xs font-medium text-foreground/40">{subgroup}</h2>
                {list.map((p) => (
                  <ProjectRow
                    key={p.id}
                    project={p}
                    activity={activityByProject.get(p.id)}
                    tasks={tasks}
                    milestones={milestones}
                    now={now}
                  />
                ))}
              </section>
            ))}
          </div>

          {/* Mobile/tablet: cards, trimmed per project-card.tsx rules. */}
          <div className="flex flex-col gap-4 lg:hidden">
            {Object.entries(grouped[active]).map(([subgroup, list]) => (
              <section key={subgroup} className="flex flex-col gap-2">
                <h2 className="text-sm font-medium text-foreground/60">{subgroup}</h2>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {list.map((p) => (
                    <ProjectCard
                      key={p.id}
                      project={p}
                      activity={activityByProject.get(p.id)}
                      tasks={tasks}
                      milestones={milestones}
                      now={now}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
