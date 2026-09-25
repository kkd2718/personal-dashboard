import { getRepo } from '@/lib/repo';
import { runStatusProbes } from '@/lib/status';
import { QuickCapture } from '@/components/quick-capture';
import { ChecklistPanel } from '@/components/checklist-panel';
import { CommandCalendar } from '@/components/command-calendar';
import { StatusPanel } from '@/components/status-panel';
import { ProjectProgressList } from '@/components/project-progress-list';

// D-day / status probes depend on "now"; never cache this page.
export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const repo = getRepo();
  const [projects, tasks, milestones, deadlines, reviews] = await Promise.all([
    repo.listProjects(),
    repo.listTasks(),
    repo.listMilestones(),
    repo.listDeadlines(),
    repo.listReviews(),
  ]);
  const statusItems = await runStatusProbes(projects);
  const checkedAt = new Date().toISOString();
  const activeProjects = projects.filter((p) => p.status === 'active');
  const activeMilestoneIds = milestones.filter((m) => m.status === 'active').map((m) => m.id);

  return (
    <div className="flex flex-col gap-4">
      <QuickCapture />

      {/* mobile: capture -> status(urgent) -> checklist -> calendar(week) -> progress */}
      <div className="lg:hidden">
        <StatusPanel initialItems={statusItems} checkedAt={checkedAt} mobileUrgentOnly />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(280px,340px)_1fr_minmax(300px,360px)]">
        <div className="order-2 lg:order-1">
          <ChecklistPanel initialTasks={tasks} deadlines={deadlines} reviews={reviews} projects={activeProjects} activeMilestoneIds={activeMilestoneIds} />
        </div>

        <div className="order-3 lg:order-2">
          <CommandCalendar
            milestones={milestones}
            tasks={tasks}
            deadlines={deadlines}
            reviews={reviews}
            projects={projects}
            defaultView="month"
          />
        </div>

        <div className="order-4 flex flex-col gap-4 lg:order-3">
          <div className="hidden lg:block">
            <StatusPanel initialItems={statusItems} checkedAt={checkedAt} />
          </div>
          <ProjectProgressList projects={projects} milestones={milestones} tasks={tasks} />
        </div>
      </div>
    </div>
  );
}
