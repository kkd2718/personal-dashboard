import { getRepo } from '@/lib/repo';
import { runStatusProbes } from '@/lib/status';
import { QuickCapture } from '@/components/quick-capture';
import { ChecklistPanel } from '@/components/checklist-panel';
import { CommandCalendar } from '@/components/command-calendar';
import { MemoPanel } from '@/components/memo-panel';
import { StatusPanel } from '@/components/status-panel';
import { ProjectProgressList } from '@/components/project-progress-list';
import { tagCounts } from '@/lib/logic/notes';

// D-day / status probes depend on "now"; never cache this page.
export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const repo = getRepo();
  const [projects, tasks, milestones, deadlines, reviews, notes] = await Promise.all([
    repo.listProjects(),
    repo.listTasks(),
    repo.listMilestones(),
    repo.listDeadlines(),
    repo.listReviews(),
    repo.listNotes(),
  ]);
  const statusItems = await runStatusProbes(projects);
  const checkedAt = new Date().toISOString();
  const activeProjects = projects.filter((p) => p.status === 'active');
  const activeMilestoneIds = milestones.filter((m) => m.status === 'active').map((m) => m.id);

  return (
    <div className="flex flex-col gap-4">
      <QuickCapture projects={activeProjects} existingTags={tagCounts(notes)} />

      {/* mobile: capture -> status(urgent) -> checklist -> memo panel -> calendar -> progress */}
      <div className="lg:hidden">
        <StatusPanel initialItems={statusItems} checkedAt={checkedAt} mobileUrgentOnly />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* row 1: checklist | calendar | status, equal height, viewport-capped */}
        <div className="order-1 lg:order-none lg:h-[min(640px,calc(100dvh-200px))]">
          <ChecklistPanel initialTasks={tasks} deadlines={deadlines} reviews={reviews} projects={activeProjects} activeMilestoneIds={activeMilestoneIds} />
        </div>

        <div className="order-3 lg:order-none lg:h-[min(640px,calc(100dvh-200px))]">
          <CommandCalendar
            milestones={milestones}
            tasks={tasks}
            deadlines={deadlines}
            reviews={reviews}
            notes={notes}
            projects={projects}
            defaultView="month"
          />
        </div>

        <div className="order-4 hidden lg:order-none lg:block lg:h-[min(640px,calc(100dvh-200px))]">
          <StatusPanel initialItems={statusItems} checkedAt={checkedAt} />
        </div>

        {/* row 2: memo (spans 2 cols) | progress, equal height */}
        <div className="order-2 lg:order-none lg:col-span-2 lg:h-[420px]">
          <MemoPanel notes={notes} projects={projects} milestones={milestones} />
        </div>

        <div className="order-5 lg:order-none lg:h-[420px]">
          <ProjectProgressList projects={projects} milestones={milestones} tasks={tasks} />
        </div>
      </div>
    </div>
  );
}
