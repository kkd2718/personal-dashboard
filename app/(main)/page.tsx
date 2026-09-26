import Link from 'next/link';
import { Mail } from 'lucide-react';
import { getRepo } from '@/lib/repo';
import { getStatusPanelData } from '@/lib/status';
import { QuickCapture } from '@/components/quick-capture';
import { ChecklistPanel } from '@/components/checklist-panel';
import { CommandCalendar } from '@/components/command-calendar';
import { MemoPanel } from '@/components/memo-panel';
import { StatusPanel } from '@/components/status-panel';
import { ProjectProgressList } from '@/components/project-progress-list';
import { tagCounts } from '@/lib/logic/notes';
import { addDaysStr, todayKST } from '@/lib/logic/dates';
import { CALENDAR_VISIBLE_META_KEY, filterVisibleEvents, todayCalendarEvents } from '@/lib/logic/calendar';

// D-day / status probes depend on "now"; never cache this page.
export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const repo = getRepo();
  const [
    projects,
    tasks,
    milestones,
    deadlines,
    reviews,
    notes,
    activityList,
    reviewCandidates,
    calendarEvents,
    visibleCalendars,
  ] = await Promise.all([
    repo.listProjects(),
    repo.listTasks(),
    repo.listMilestones(),
    repo.listDeadlines(),
    repo.listReviews(),
    repo.listNotes(),
    repo.listProjectActivity(),
    repo.listReviewCandidates('pending'),
    repo.listCalendarEvents(addDaysStr(todayKST(), -60), addDaysStr(todayKST(), 180)),
    repo.getMeta<string[]>(CALENDAR_VISIBLE_META_KEY),
  ]);
  const status = await getStatusPanelData(repo, projects);
  const activeProjects = projects.filter((p) => p.status === 'active');
  const activeMilestoneIds = milestones.filter((m) => m.status === 'active').map((m) => m.id);
  const today = todayKST();
  const todayEvents = todayCalendarEvents(
    filterVisibleEvents(calendarEvents, visibleCalendars).filter((e) => e.startDate <= today && e.endDate >= today)
  );

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <QuickCapture projects={activeProjects} existingTags={tagCounts(notes)} />

      {reviewCandidates.length > 0 && (
        <Link
          href="/papers?tab=review"
          className="flex w-fit items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-1 text-xs text-amber-700 hover:bg-amber-500/20 dark:text-amber-300"
        >
          <Mail size={12} />
          메일 확인 {reviewCandidates.length}
        </Link>
      )}

      {todayEvents.length > 0 && (
        <div className="flex flex-wrap gap-1.5 text-xs text-foreground/70">
          <span className="text-foreground/40">오늘 일정</span>
          {todayEvents.slice(0, 5).map((e) => (
            <span key={e.id} className="rounded-full border border-border px-2 py-0.5">
              {e.startTime ? `${e.startTime} ` : ''}
              {e.title}
            </span>
          ))}
        </div>
      )}

      {/* mobile: capture -> status(urgent) -> checklist -> memo panel -> calendar -> progress */}
      <div className="min-w-0 lg:hidden">
        <StatusPanel initialItems={status.items} checkedAt={status.checkedAt} remote={status.remote} mobileUrgentOnly />
      </div>

      <div className="grid min-w-0 gap-4 lg:grid-cols-3">
        {/* row 1: checklist | calendar | status, equal height, viewport-capped */}
        <div className="order-1 min-w-0 lg:order-none lg:h-[min(640px,calc(100dvh-200px))]">
          <ChecklistPanel initialTasks={tasks} deadlines={deadlines} reviews={reviews} projects={activeProjects} activeMilestoneIds={activeMilestoneIds} />
        </div>

        <div className="order-3 min-w-0 lg:order-none lg:h-[min(640px,calc(100dvh-200px))]">
          <CommandCalendar
            milestones={milestones}
            tasks={tasks}
            deadlines={deadlines}
            reviews={reviews}
            notes={notes}
            googleEvents={calendarEvents}
            visibleCalendars={visibleCalendars}
            projects={projects}
            defaultView="month"
          />
        </div>

        <div className="order-4 hidden min-w-0 lg:order-none lg:block lg:h-[min(640px,calc(100dvh-200px))]">
          <StatusPanel initialItems={status.items} checkedAt={status.checkedAt} remote={status.remote} />
        </div>

        {/* row 2: memo (spans 2 cols) | progress, equal height */}
        <div className="order-2 min-w-0 lg:order-none lg:col-span-2 lg:h-[420px]">
          <MemoPanel notes={notes} projects={projects} milestones={milestones} />
        </div>

        <div className="order-5 min-w-0 lg:order-none lg:h-[420px]">
          <ProjectProgressList projects={projects} milestones={milestones} tasks={tasks} activityList={activityList} />
        </div>
      </div>
    </div>
  );
}
