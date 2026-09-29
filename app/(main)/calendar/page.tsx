import { getRepo } from '@/lib/repo';
import { CommandCalendar } from '@/components/command-calendar';
import { DeadlineList } from '@/components/deadline-list';
import { upcoming } from '@/lib/logic/upcoming';
import { addDaysStr, todayKST } from '@/lib/logic/dates';
import { CALENDAR_VISIBLE_META_KEY } from '@/lib/logic/calendar';
import { WORK_SHIFTS_META_KEY, type WorkShiftsMeta } from '@/lib/logic/work';
import { careNoteConfigured } from '@/lib/carenote/client';

// D-day depends on "today" in KST; never cache this page.
export const dynamic = 'force-dynamic';

export default async function CalendarPage() {
  const repo = getRepo();
  const today = todayKST();
  const [projects, tasks, milestones, deadlines, reviews, notes, calendarEvents, visibleCalendars, workMeta] = await Promise.all([
    repo.listProjects(),
    repo.listTasks(),
    repo.listMilestones(),
    repo.listDeadlines(),
    repo.listReviews(),
    repo.listNotes(),
    repo.listCalendarEvents(addDaysStr(today, -60), addDaysStr(today, 180)),
    repo.getMeta<string[]>(CALENDAR_VISIBLE_META_KEY),
    repo.getMeta<WorkShiftsMeta>(WORK_SHIFTS_META_KEY),
  ]);
  const agenda = upcoming(deadlines, reviews, today, 30);

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-lg font-semibold">캘린더</h1>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
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
          careNoteEnabled={careNoteConfigured()}
          workShifts={workMeta?.shifts ?? []}
        />
        <div className="flex flex-col gap-4">
          <div className="rounded-[var(--r-md)] border border-border bg-surface p-3">
            <h2 className="mb-2 text-sm font-semibold">다가오는 30일</h2>
            <DeadlineList items={agenda} />
          </div>
        </div>
      </div>
    </div>
  );
}
