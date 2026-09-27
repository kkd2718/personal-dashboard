import Link from 'next/link';
import { getRepo } from '@/lib/repo';
import { getStatusPanelData } from '@/lib/status';
import { QuickCapture } from '@/components/quick-capture';
import { ChecklistPanel } from '@/components/checklist-panel';
import { WeekStrip } from '@/components/home/week-strip';
import { MemoPanel } from '@/components/memo-panel';
import { QueueLane } from '@/components/home/queue-lane';
import { PaperLane } from '@/components/home/paper-lane';
import { LaneCard } from '@/components/home/lane-card';
import { HomeLanes } from '@/components/home/home-lanes';
import { StatusWarnChip } from '@/components/home/status-warn-chip';
import { tagCounts } from '@/lib/logic/notes';
import { checklist, checklistItemCount } from '@/lib/logic/checklist';
import { buildQueueLaneCards, deadlineCounts, headerCountLabel, nextDeadlineAfterWeek } from '@/lib/logic/home';
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

interface SearchParams {
  tab?: string;
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { tab } = await searchParams;
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
  const nextDeadline = nextDeadlineAfterWeek(deadlines, today);

  // Lane tab badge counts (HomeLanes' mobile tab bar) — cheap to recompute inside
  // each lane too, but the tab bar needs them before those lanes render.
  const queueCount = buildQueueLaneCards(projects, milestones, tasks, activityList, papers).length;
  const openReviewCount = reviews.filter((r) => (r.status === 'invited' || r.status === 'accepted') && r.dueDate).length;
  const meChecklist = checklist(tasks, deadlines, reviews, today, new Set(activeMilestoneIds)).me;
  const openNoteCount = notes.filter((n) => n.status === 'inbox' || n.status === 'filed').length;

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-1 flex-col sm:flex-row sm:items-baseline sm:gap-2">
          <h1 className="shrink-0 text-xl font-semibold">{HEADER_DATE_FMT.format(new Date())}</h1>
          <span className="truncate text-sm text-foreground/50">{headerCountLabel(counts, nextDeadline ? { title: nextDeadline.title, dueDate: nextDeadline.dueDate, today } : undefined)}</span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {reviewCandidates.length > 0 && (
            <Link
              href="/papers?tab=review"
              className="flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-1 text-xs text-amber-700 hover:bg-amber-500/20 dark:text-amber-300"
            >
              메일 확인 {reviewCandidates.length}
            </Link>
          )}
          <StatusWarnChip
            items={status.items}
            checkedAt={status.checkedAt}
            remote={status.remote}
            projects={projects}
            tasks={tasks}
            activityList={activityList}
          />
        </div>
      </div>

      {/* Mobile: capture happens via the bottom-nav FAB (§2) and the 메모 lane's own
          box, not a header box. */}
      <div className="hidden md:block">
        <QuickCapture projects={activeProjects} existingTags={tagCounts(notes)} />
      </div>

      <WeekStrip
        compact
        initialWeekStart={startOfIsoWeek(today)}
        milestones={milestones}
        deadlines={deadlines}
        reviews={reviews}
        notes={notes}
        googleEvents={visibleEvents}
        projects={projects}
      />

      <HomeLanes
        initialTab={tab}
        counts={{
          queue: queueCount,
          papers: papers.length + openReviewCount,
          todo: checklistItemCount(meChecklist),
          memo: openNoteCount,
        }}
        queue={<QueueLane projects={projects} milestones={milestones} tasks={tasks} activityList={activityList} papers={papers} />}
        papers={
          <PaperLane papers={papers} deadlines={deadlines} reviews={reviews} reviewCandidateCount={reviewCandidates.length} />
        }
        todo={
          <LaneCard title="할 일">
            <ChecklistPanel
              bare
              initialTasks={tasks}
              deadlines={deadlines}
              reviews={reviews}
              projects={activeProjects}
              activeMilestoneIds={activeMilestoneIds}
              todayEvents={todayEvents}
            />
          </LaneCard>
        }
        memo={
          <LaneCard title="메모" count={openNoteCount} href="/memo">
            <div className="md:hidden">
              <QuickCapture projects={activeProjects} existingTags={tagCounts(notes)} />
            </div>
            <MemoPanel bare limit={12} notes={notes} projects={projects} />
          </LaneCard>
        }
      />
    </div>
  );
}
