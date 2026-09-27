'use client';
import type React from 'react';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { calendarEvents } from '@/lib/logic/calendar';
import { addDaysStr, todayKST } from '@/lib/logic/dates';
import { projectColorClasses } from '@/lib/project-colors';
import type { CalendarEvent, Deadline, Milestone, Note, Project, ReviewJob } from '@/lib/types';

const DAY_LABELS = ['월', '화', '수', '목', '금', '토', '일'];
const MAX_AGENDA_LINES = 4;

function fmtRange(weekStart: string): string {
  const end = addDaysStr(weekStart, 6);
  const [, sm, sd] = weekStart.split('-');
  const [, em, ed] = end.split('-');
  return sm === em ? `${Number(sm)}/${Number(sd)}–${Number(ed)}` : `${Number(sm)}/${Number(sd)}–${Number(em)}/${Number(ed)}`;
}

/**
 * Home "이번 주" panel (ux-advice.md §5.1): a 7-day strip with queue bars and a
 * short agenda, replacing the month calendar as the default home view (desktop
 * keeps a 월|주 toggle in the parent that swaps this out for <CommandCalendar>).
 */
export function WeekStrip({
  initialWeekStart,
  milestones,
  deadlines,
  reviews,
  notes,
  googleEvents,
  projects,
  headerAction,
  compact = false,
}: {
  initialWeekStart: string;
  milestones: Milestone[];
  deadlines: Deadline[];
  reviews: ReviewJob[];
  notes: Note[];
  googleEvents: CalendarEvent[];
  projects: Project[];
  headerAction?: React.ReactNode;
  /** Slim single-row header strip (PLAN_HOME2.md §Header): day numbers + up to 2
   * queue range labels, no agenda, no week nav — "캘린더 →" only. */
  compact?: boolean;
}) {
  const [weekStart, setWeekStart] = useState(initialWeekStart);
  const today = todayKST();
  const projectById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  const milestoneById = useMemo(() => new Map(milestones.map((m) => [m.id, m])), [milestones]);

  const { weeks, ranges, points } = useMemo(
    () =>
      calendarEvents(weekStart, {
        milestones,
        tasks: [],
        deadlines,
        reviews,
        notes,
        googleEvents,
      }),
    [weekStart, milestones, deadlines, reviews, notes, googleEvents]
  );
  const weekIndex = weeks.indexOf(weekStart);
  const days = Array.from({ length: 7 }, (_, i) => addDaysStr(weekStart, i));
  const weekRanges = ranges.filter((r) => r.weekIndex === weekIndex).slice(0, 2);

  const agenda = days
    .flatMap((date) => (points[date] ?? []).filter((p) => p.kind !== 'task').map((p) => ({ date, point: p })))
    .slice(0, MAX_AGENDA_LINES);

  if (compact) {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2 text-xs">
        <span className="shrink-0 font-medium text-foreground/70">이번 주</span>
        <div className="flex shrink-0 gap-0.5">
          {days.map((date, i) => {
            // A dot per day with anything scheduled (red when a deadline/review is due);
            // hover lists the titles.
            const dayPoints = (points[date] ?? []).filter((p) => p.kind !== 'task');
            const urgent = dayPoints.some((p) => p.kind === 'deadline' || p.kind === 'review');
            return (
              <Link
                key={date}
                href="/calendar"
                title={dayPoints.map((p) => (p.startTime ? `${p.startTime} ${p.title}` : p.title)).join('\n') || undefined}
                className={`tnum relative rounded px-1 pt-0.5 pb-1.5 ${date === today ? 'bg-accent-soft font-medium text-accent' : 'text-foreground/50 hover:bg-foreground/5'}`}
              >
                {DAY_LABELS[i]}
                {Number(date.slice(8, 10))}
                {dayPoints.length > 0 && (
                  <span
                    aria-hidden
                    className={`absolute bottom-0.5 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full ${urgent ? 'bg-danger' : 'bg-foreground/30'}`}
                  />
                )}
              </Link>
            );
          })}
        </div>
        {weekRanges.map((seg) => {
          const milestone = milestoneById.get(seg.milestoneId);
          if (!milestone) return null;
          return (
            <span key={`${seg.milestoneId}-${seg.weekIndex}`} className="min-w-0 truncate text-foreground/40">
              · {milestone.title}
            </span>
          );
        })}
        <Link href="/calendar" className="ml-auto hidden shrink-0 text-foreground/40 hover:underline sm:inline">
          캘린더 →
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          <h2 className="text-sm font-semibold">이번 주</h2>
          <button
            type="button"
            onClick={() => setWeekStart((w) => addDaysStr(w, -7))}
            aria-label="이전 주"
            className="rounded p-1 text-foreground/40 hover:bg-foreground/5"
          >
            <ChevronLeft size={14} />
          </button>
          <span className="tnum text-xs text-foreground/50">{fmtRange(weekStart)}</span>
          <button
            type="button"
            onClick={() => setWeekStart((w) => addDaysStr(w, 7))}
            aria-label="다음 주"
            className="rounded p-1 text-foreground/40 hover:bg-foreground/5"
          >
            <ChevronRight size={14} />
          </button>
        </div>
        <div className="flex items-center gap-2">
          {headerAction}
          <Link href="/calendar" className="text-xs text-foreground/50 hover:underline">
            캘린더 전체 →
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center text-xs">
        {days.map((date, i) => {
          const isToday = date === today;
          return (
            <Link
              key={date}
              href="/calendar"
              className={`flex flex-col items-center gap-0.5 rounded-lg py-1.5 ${
                isToday ? 'bg-accent-soft text-accent' : 'text-foreground/60 hover:bg-foreground/5'
              }`}
            >
              <span className="text-[10px]">{DAY_LABELS[i]}</span>
              <span className="tnum font-medium">{Number(date.slice(8, 10))}</span>
            </Link>
          );
        })}
      </div>

      {weekRanges.length > 0 && (
        <div className="flex flex-col gap-1">
          {weekRanges.map((seg) => {
            const milestone = milestoneById.get(seg.milestoneId);
            const project = milestone ? projectById.get(milestone.projectId) : undefined;
            const colors = projectColorClasses(project?.color);
            return (
              <div key={`${seg.milestoneId}-${seg.weekIndex}`} className="grid grid-cols-7 gap-1">
                <div
                  className={`truncate rounded px-1.5 py-1 text-[11px] text-white ${colors.dot}`}
                  style={{ gridColumn: `${seg.colStart} / ${seg.colEnd + 1}` }}
                >
                  {milestone?.title}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-auto text-xs text-foreground/60">
        {agenda.length === 0 ? (
          <p className="text-foreground/30">이번 주 일정이 없어요.</p>
        ) : (
          agenda.map(({ date, point }, i) => (
            <div key={`${point.kind}-${point.id}-${i}`} className="flex items-center gap-1.5">
              <span className="w-6 shrink-0 text-foreground/40">{DAY_LABELS[days.indexOf(date)]}</span>
              {point.startTime && <span className="tnum shrink-0">{point.startTime}</span>}
              <span className="truncate">{point.title}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
