import type { Deadline, Milestone, ReviewJob, Task } from '@/lib/types';
import { addDaysStr, endOfIsoWeek, startOfIsoWeek } from '@/lib/logic/dates';

export interface RangeSeg {
  milestoneId: string;
  weekIndex: number;
  colStart: number; // 1..7, Monday=1 .. Sunday=7
  colEnd: number; // 1..7
  isStart: boolean; // segment contains the milestone's actual start date
  isEnd: boolean; // segment contains the milestone's actual end date
  lane: number;
}

export interface CalendarPoint {
  id: string;
  title: string;
  kind: 'task' | 'deadline' | 'review' | 'milestone';
  projectId: string | null;
}

export interface CalendarEvents {
  weeks: string[]; // Monday date ('YYYY-MM-DD') of each grid week row
  ranges: RangeSeg[];
  points: Record<string, CalendarPoint[]>;
}

function monthLastDay(monthStart: string): string {
  const [y, m] = monthStart.split('-').map(Number);
  const lastDayOfMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${monthStart.slice(0, 8)}${String(lastDayOfMonth).padStart(2, '0')}`;
}

/** Greedy interval-graph lane assignment: same lane reused once its milestone ends. */
function assignLanes(milestones: Milestone[]): Map<string, number> {
  const sorted = [...milestones].sort((a, b) => (a.startDate! < b.startDate! ? -1 : 1));
  const laneEnds: string[] = []; // laneEnds[lane] = end date of the milestone currently occupying it
  const lanes = new Map<string, number>();
  for (const m of sorted) {
    let lane = laneEnds.findIndex((end) => end < m.startDate!);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(m.endDate!);
    } else {
      laneEnds[lane] = m.endDate!;
    }
    lanes.set(m.id, lane);
  }
  return lanes;
}

/**
 * Builds the month-grid range bars and day points for the calendar.
 * `monthStart` is any 'YYYY-MM-DD' date in the target month (first day recommended).
 * Weeks start Monday; the grid covers full Mon-Sun rows from the week containing
 * the 1st through the week containing the last day of the month.
 */
export function calendarEvents(
  monthStart: string,
  data: { milestones: Milestone[]; tasks: Task[]; deadlines: Deadline[]; reviews: ReviewJob[] }
): CalendarEvents {
  const gridStart = startOfIsoWeek(monthStart);
  const gridEnd = endOfIsoWeek(monthLastDay(monthStart));

  const weeks: string[] = [];
  for (let w = gridStart; w <= gridEnd; w = addDaysStr(w, 7)) weeks.push(w);

  const ranged = data.milestones.filter((m) => m.startDate && m.endDate);
  const lanes = assignLanes(ranged);

  const ranges: RangeSeg[] = [];
  for (const m of ranged) {
    const lane = lanes.get(m.id)!;
    weeks.forEach((weekMon, weekIndex) => {
      const weekSun = addDaysStr(weekMon, 6);
      const segStart = m.startDate! > weekMon ? m.startDate! : weekMon;
      const segEnd = m.endDate! < weekSun ? m.endDate! : weekSun;
      if (segStart > segEnd) return; // no overlap with this week
      const colStart = dayIndexInWeek(segStart, weekMon);
      const colEnd = dayIndexInWeek(segEnd, weekMon);
      ranges.push({
        milestoneId: m.id,
        weekIndex,
        colStart,
        colEnd,
        isStart: segStart === m.startDate,
        isEnd: segEnd === m.endDate,
        lane,
      });
    });
  }

  const points: Record<string, CalendarPoint[]> = {};
  function addPoint(date: string, point: CalendarPoint) {
    if (date < gridStart || date > gridEnd) return;
    (points[date] ??= []).push(point);
  }

  for (const m of data.milestones) {
    if (m.startDate && !m.endDate) {
      addPoint(m.startDate, { id: m.id, title: m.title, kind: 'milestone', projectId: m.projectId });
    }
  }
  for (const t of data.tasks) {
    if (t.status === 'done' || !t.dueDate) continue;
    addPoint(t.dueDate, { id: t.id, title: t.title, kind: 'task', projectId: t.projectId });
  }
  for (const d of data.deadlines) {
    if (d.done) continue;
    addPoint(d.dueDate, { id: d.id, title: d.title, kind: 'deadline', projectId: d.projectId });
  }
  for (const r of data.reviews) {
    if (r.status !== 'invited' && r.status !== 'accepted') continue;
    if (!r.dueDate) continue;
    addPoint(r.dueDate, {
      id: r.id,
      title: r.title ?? `${r.journal} 리뷰`,
      kind: 'review',
      projectId: null,
    });
  }

  return { weeks, ranges, points };
}

function dayIndexInWeek(date: string, weekMon: string): number {
  let d = weekMon;
  let i = 1;
  while (d !== date) {
    d = addDaysStr(d, 1);
    i += 1;
  }
  return i;
}
