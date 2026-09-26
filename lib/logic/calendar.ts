import type { CalendarEvent, Deadline, Milestone, Note, ReviewJob, Task } from '@/lib/types';
import { addDaysStr, endOfIsoWeek, startOfIsoWeek } from '@/lib/logic/dates';

/** app_meta key for the persisted per-calendar visibility set (Addendum A §3). */
export const CALENDAR_VISIBLE_META_KEY = 'calendar:visible';

/** Google Calendar names containing this are rendered as holidays (red date number),
 * per docs/PLAN_3.md §5 — matches both the Korean 공휴일 calendar and any "Holiday" one. */
export function isHolidayCalendar(calendarName: string): boolean {
  return /휴일|holiday/i.test(calendarName);
}

/** Recovers the Google calendarId embedded in a CalendarEvent.id
 * ('<account>:<calendarId>:<eventId>' — see lib/google/sync.ts). Account is
 * validated colon-free by the sync route's zod schema; eventId may theoretically
 * contain a colon, in which case this over-includes into calendarId, which is
 * harmless here (only used to detect the literal calendarId 'primary'). */
function calendarIdFromEventId(id: string): string {
  const parts = id.split(':');
  return parts.slice(1, -1).join(':');
}

/** True for events from an account's 'primary' Google calendar (Apps Script's
 * default CALENDAR_IDS) — visible by default (Addendum A §3), before the user
 * has ever saved an explicit `calendar:visible` set. */
export function isPrimaryCalendarEvent(e: CalendarEvent): boolean {
  return calendarIdFromEventId(e.id) === 'primary';
}

export interface CalendarVisibilityOption {
  name: string; // distinct calendar_name, holiday calendars excluded (never a toggle)
  defaultVisible: boolean; // true only for the account's primary calendar
}

/** Distinct non-holiday calendar names present in `events`, each flagged with
 * whether it's visible by default — used to render toggle chips and to compute
 * the default set the first time app_meta 'calendar:visible' is unset. */
export function calendarVisibilityOptions(events: CalendarEvent[]): CalendarVisibilityOption[] {
  const byName = new Map<string, boolean>();
  for (const e of events) {
    if (isHolidayCalendar(e.calendarName)) continue;
    byName.set(e.calendarName, (byName.get(e.calendarName) ?? false) || isPrimaryCalendarEvent(e));
  }
  return [...byName.entries()].map(([name, defaultVisible]) => ({ name, defaultVisible }));
}

/** Filters events down to visible calendars: holiday calendars always pass (they
 * render as red dates, never a toggle); others pass only if `visible` is null
 * (fall back to the primary-calendar default) or their calendar_name is listed. */
export function filterVisibleEvents(events: CalendarEvent[], visible: string[] | null): CalendarEvent[] {
  const names =
    visible ?? calendarVisibilityOptions(events).filter((o) => o.defaultVisible).map((o) => o.name);
  const set = new Set(names);
  return events.filter((e) => isHolidayCalendar(e.calendarName) || set.has(e.calendarName));
}

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
  kind: 'task' | 'deadline' | 'review' | 'milestone' | 'memo' | 'google';
  projectId: string | null;
  startTime?: string | null; // 'HH:mm' KST, google events only; null = all-day
}

export interface CalendarEvents {
  weeks: string[]; // Monday date ('YYYY-MM-DD') of each grid week row
  ranges: RangeSeg[];
  points: Record<string, CalendarPoint[]>;
  holidays: Set<string>; // dates with a holiday-calendar google event (red date number)
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
  data: {
    milestones: Milestone[];
    tasks: Task[];
    deadlines: Deadline[];
    reviews: ReviewJob[];
    notes?: Note[];
    googleEvents?: CalendarEvent[];
  }
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
  for (const n of data.notes ?? []) {
    if (!n.date || n.status === 'archived' || n.status === 'done') continue;
    addPoint(n.date, { id: n.id, title: n.body, kind: 'memo', projectId: n.projectId });
  }

  // Google events render as a lighter chip (see components/command-calendar.tsx). A
  // multi-day event gets one point per day it spans rather than a lane bar — a
  // deliberate simplification to keep the range-bar system milestone-only.
  const holidays = new Set<string>();
  for (const e of data.googleEvents ?? []) {
    if (isHolidayCalendar(e.calendarName)) {
      for (let d = e.startDate; d <= e.endDate; d = addDaysStr(d, 1)) {
        if (d < gridStart || d > gridEnd) continue;
        holidays.add(d);
      }
      continue;
    }
    for (let d = e.startDate; d <= e.endDate; d = addDaysStr(d, 1)) {
      addPoint(d, { id: e.id, title: e.title, kind: 'google', projectId: null, startTime: e.startTime });
    }
  }

  return { weeks, ranges, points, holidays };
}

/** Today's non-holiday Google events, timed first (by start time) then all-day —
 * used by the home page's compact "오늘 일정" widget and the Telegram /today + digest. */
export function todayCalendarEvents(events: CalendarEvent[]): CalendarEvent[] {
  return events
    .filter((e) => !isHolidayCalendar(e.calendarName))
    .sort((a, b) => {
      if (a.startTime && b.startTime) return a.startTime < b.startTime ? -1 : 1;
      if (a.startTime) return -1;
      if (b.startTime) return 1;
      return 0;
    });
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
