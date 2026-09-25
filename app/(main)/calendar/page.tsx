import { getRepo } from '@/lib/repo';
import { CommandCalendar } from '@/components/command-calendar';
import { DeadlineList } from '@/components/deadline-list';
import { upcoming } from '@/lib/logic/upcoming';
import { DdayChip } from '@/components/dday-chip';
import { todayKST } from '@/lib/logic/dates';

// D-day depends on "today" in KST; never cache this page.
export const dynamic = 'force-dynamic';

export default async function CalendarPage() {
  const repo = getRepo();
  const [projects, tasks, milestones, deadlines, reviews] = await Promise.all([
    repo.listProjects(),
    repo.listTasks(),
    repo.listMilestones(),
    repo.listDeadlines(),
    repo.listReviews(),
  ]);
  const today = todayKST();
  const agenda = upcoming(deadlines, reviews, today, 30);

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-lg font-semibold">캘린더</h1>
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <CommandCalendar
          milestones={milestones}
          tasks={tasks}
          deadlines={deadlines}
          reviews={reviews}
          projects={projects}
          defaultView="month"
        />
        <div className="flex flex-col gap-4">
          <div className="rounded-xl border border-border bg-surface p-3">
            <h2 className="mb-2 text-sm font-semibold">다가오는 일정 (30일)</h2>
            {agenda.length === 0 ? (
              <p className="text-xs text-foreground/40">일정이 없습니다.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {agenda.map((item) => (
                  <li key={item.id} className="flex items-center gap-2 text-sm">
                    <DdayChip n={item.dday} />
                    <span className="flex-1 truncate">{item.title}</span>
                    <span className="text-xs text-foreground/40">{item.dueDate}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-foreground/60">마감 추가/관리</h2>
        <DeadlineList deadlines={deadlines} />
      </section>
    </div>
  );
}
