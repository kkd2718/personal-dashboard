import { getRepo } from '@/lib/repo';
import { DeadlineList } from '@/components/deadline-list';
import { MonthCalendar } from '@/components/month-calendar';
import { todayKST } from '@/lib/logic/dates';

// D-day depends on "today" in KST; never cache this page.
export const dynamic = 'force-dynamic';

export default async function DeadlinesPage() {
  const repo = getRepo();
  const deadlines = await repo.listDeadlines();
  const today = todayKST();

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-lg font-semibold">마감</h1>
      <MonthCalendar deadlines={deadlines} today={today} />
      <DeadlineList deadlines={deadlines} />
    </div>
  );
}
