import { getRepo } from '@/lib/repo';
import { groupProjects } from '@/lib/logic/projects';
import { ProjectCard } from '@/components/project-card';
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

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-lg font-semibold">프로젝트</h1>

      <div className="flex gap-1 rounded-lg border border-border p-1 text-sm">
        {GROUPS.map((g) => (
          <a
            key={g}
            href={`/projects?group=${g}`}
            className={`flex-1 rounded-md px-3 py-1.5 text-center transition ${
              g === active ? 'bg-blue-600 text-white' : 'text-foreground/60 hover:bg-foreground/5'
            }`}
          >
            {GROUP_LABEL[g]}
          </a>
        ))}
      </div>

      {Object.entries(grouped[active]).map(([subgroup, list]) => (
        <section key={subgroup} className="flex flex-col gap-2">
          <h2 className="text-sm font-medium text-foreground/60">{subgroup}</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
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
  );
}
