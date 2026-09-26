import Link from 'next/link';
import { Mail } from 'lucide-react';
import { getRepo } from '@/lib/repo';
import { getStatusPanelData } from '@/lib/status';
import { QuickCapture } from '@/components/quick-capture';
import { ChecklistPanel } from '@/components/checklist-panel';
import { HomeWeekPanel } from '@/components/home/home-week-panel';
import { MemoPanel } from '@/components/memo-panel';
import { PaperStrip } from '@/components/home/paper-strip';
import { StatusPanel } from '@/components/status-panel';
import { ProjectProgressList } from '@/components/project-progress-list';
import { tagCounts } from '@/lib/logic/notes';
import { deadlineCounts, headerCountLabel } from '@/lib/logic/home';
import { addDaysStr, startOfIsoWeek, todayKST } from '@/lib/logic/dates';
import { CALENDAR_VISIBLE_META_KEY, filterVisibleEvents, todayCalendarEvents } from '@/lib/logic/calendar';

// D-day / status probes depend on "now"; never cache this page.
export const dynamic = 'force-dynamic';

const HEADER_DATE_FMT = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  month: 'long',
  day: 'numeric',
  weekday: 'short',
});

export default async function HomePage() {
  const repo = getRepo();
  const [
    projects,
    tasks,
    milestones,
    deadlines,
    reviews,
    papers,
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
    repo.listPapers(),
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
  const visibleEvents = filterVisibleEvents(calendarEvents, visibleCalendars);
  const todayEvents = todayCalendarEvents(visibleEvents.filter((e) => e.startDate <= today && e.endDate >= today));
  const counts = deadlineCounts(deadlines, today);

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <h1 className="text-xl font-semibold">{HEADER_DATE_FMT.format(new Date())}</h1>
          <span className="text-sm text-foreground/50">{headerCountLabel(counts)}</span>
        </div>
        {reviewCandidates.length > 0 && (
          <Link
            href="/papers?tab=review"
            className="flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-1 text-xs text-amber-700 hover:bg-amber-500/20 dark:text-amber-300"
          >
            <Mail size={12} />
            메일 확인 {reviewCandidates.length}
          </Link>
        )}
      </div>

      {/* Mobile: capture happens via the bottom-nav FAB (§2), not a header box. */}
      <div className="hidden md:block">
        <QuickCapture projects={activeProjects} existingTags={tagCounts(notes)} />
      </div>

      {/* mobile: status(urgent) -> checklist -> week -> memo -> paper -> project */}
      <div className="min-w-0 lg:hidden">
        <StatusPanel initialItems={status.items} checkedAt={status.checkedAt} remote={status.remote} projects={projects} mobileUrgentOnly />
      </div>

      {/* Mobile: one grid, children ordered via order-*; lg: left 2/3 column (오늘|이번 주 row, then 메모)
          and right 1/3 column (상황, 프로젝트, 논문) stack independently so neither leaves gaps.
          The wrappers are display:contents below lg so their children join the outer grid. */}
      <div className="grid min-w-0 gap-4 lg:grid-cols-3 lg:items-start">
        <div className="contents lg:col-span-2 lg:flex lg:min-w-0 lg:flex-col lg:gap-4">
          <div className="contents lg:grid lg:grid-cols-2 lg:items-start lg:gap-4">
            <div className="order-1 min-w-0 lg:order-none">
              <ChecklistPanel
                initialTasks={tasks}
                deadlines={deadlines}
                reviews={reviews}
                projects={activeProjects}
                activeMilestoneIds={activeMilestoneIds}
                todayEvents={todayEvents}
              />
            </div>
            <div className="order-2 min-w-0 lg:order-none">
              <HomeWeekPanel
                weekStart={startOfIsoWeek(today)}
                milestones={milestones}
                tasks={tasks}
                deadlines={deadlines}
                reviews={reviews}
                notes={notes}
                googleEvents={calendarEvents}
                visibleCalendars={visibleCalendars}
                projects={projects}
              />
            </div>
          </div>
          <div className="order-4 min-w-0 lg:order-none">
            <MemoPanel notes={notes} projects={projects} />
          </div>
        </div>

        <div className="contents lg:flex lg:min-w-0 lg:flex-col lg:gap-4">
          <div className="hidden min-w-0 lg:block">
            <StatusPanel initialItems={status.items} checkedAt={status.checkedAt} remote={status.remote} projects={projects} />
          </div>
          <div className="order-3 min-w-0 lg:order-none">
            <ProjectProgressList projects={projects} tasks={tasks} activityList={activityList} />
          </div>
          <div className="order-5 min-w-0 lg:order-none">
            <PaperStrip papers={papers} deadlines={deadlines} today={today} />
          </div>
        </div>
      </div>
    </div>
  );
}
