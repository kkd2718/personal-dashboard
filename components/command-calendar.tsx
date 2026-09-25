'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ChevronLeft, ChevronRight, Link2, CalendarClock, ClipboardCheck, FileText } from 'lucide-react';
import { calendarEvents, type CalendarPoint } from '@/lib/logic/calendar';
import { addDaysStr, addMonthsStr, startOfMonthStr, todayKST } from '@/lib/logic/dates';
import { projectColorClasses } from '@/lib/project-colors';
import type { Deadline, Milestone, Project, ReviewJob, Task } from '@/lib/types';

const POINT_ICON: Record<CalendarPoint['kind'], typeof ClipboardCheck> = {
  task: ClipboardCheck,
  deadline: CalendarClock,
  review: FileText,
  milestone: Link2,
};

interface Props {
  milestones: Milestone[];
  tasks: Task[];
  deadlines: Deadline[];
  reviews: ReviewJob[];
  projects: Project[];
  defaultView?: 'month' | 'week';
  compact?: boolean;
}

export function CommandCalendar({
  milestones,
  tasks,
  deadlines,
  reviews,
  projects,
  defaultView = 'month',
  compact = false,
}: Props) {
  const today = todayKST();
  const [cursor, setCursor] = useState(today);
  const [view, setView] = useState<'month' | 'week'>(defaultView);
  // Defaults to week view on mobile widths. Read once after mount (window is unavailable
  // during SSR, so this can't be a lazy useState initializer without a hydration mismatch).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time browser-only media check
    if (window.innerWidth < 1024) setView('week');
  }, []);
  const [selected, setSelected] = useState<string | null>(null);

  const monthStart = startOfMonthStr(cursor);
  const events = useMemo(
    () => calendarEvents(monthStart, { milestones, tasks, deadlines, reviews }),
    [monthStart, milestones, tasks, deadlines, reviews]
  );

  const weeks =
    view === 'week' ? events.weeks.filter((w) => w <= cursor && cursor <= addDaysStr(w, 6)) : events.weeks;

  const maxLane = events.ranges.reduce((m, r) => Math.max(m, r.lane), -1);
  const laneRows = maxLane + 1;
  const projectById = new Map(projects.map((p) => [p.id, p]));
  const milestoneById = new Map(milestones.map((m) => [m.id, m]));

  function projectColorFor(projectId: string | null): string {
    if (!projectId) return 'bg-foreground/30';
    return projectColorClasses(projectById.get(projectId)?.color).bar;
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => setCursor((c) => addMonthsStr(c, -1))} aria-label="이전 달">
            <ChevronLeft size={16} />
          </button>
          <span className="min-w-20 text-center text-sm font-medium">
            {monthStart.slice(0, 4)}년 {Number(monthStart.slice(5, 7))}월
          </span>
          <button type="button" onClick={() => setCursor((c) => addMonthsStr(c, 1))} aria-label="다음 달">
            <ChevronRight size={16} />
          </button>
          <button
            type="button"
            onClick={() => setCursor(today)}
            className="ml-1 rounded-md border border-border px-2 py-0.5 text-xs text-foreground/60 hover:bg-foreground/5"
          >
            오늘
          </button>
        </div>
        <div className="flex gap-1 rounded-lg border border-border p-0.5 text-xs">
          {(['month', 'week'] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={`rounded-md px-2 py-1 ${view === v ? 'bg-blue-600 text-white' : 'text-foreground/60'}`}
            >
              {v === 'month' ? '월' : '주'}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-7 text-center text-[11px] text-foreground/40">
        {['월', '화', '수', '목', '금', '토', '일'].map((w) => (
          <div key={w}>{w}</div>
        ))}
      </div>

      <div className="flex flex-col gap-0.5">
        {weeks.map((weekMon) => {
          const weekIndex = events.weeks.indexOf(weekMon);
          const segs = events.ranges.filter((r) => r.weekIndex === weekIndex);
          return (
            <div key={weekMon} className="flex flex-col">
              {laneRows > 0 && (
                <div className="relative grid grid-cols-7 gap-px" style={{ minHeight: laneRows * 16 }}>
                  {segs.map((seg) => {
                    const m = milestoneById.get(seg.milestoneId);
                    return (
                      <div
                        key={`${seg.milestoneId}-${seg.weekIndex}`}
                        className={`h-3.5 min-w-0 truncate rounded-full px-1.5 text-[10px] leading-3.5 text-white ${projectColorFor(m?.projectId ?? null)}`}
                        style={{
                          gridColumn: `${seg.colStart} / ${seg.colEnd + 1}`,
                          gridRow: seg.lane + 1,
                        }}
                        title={m?.title}
                      >
                        {seg.isStart ? m?.title : ''}
                      </div>
                    );
                  })}
                </div>
              )}
              <div className="grid grid-cols-7 gap-px">
                {Array.from({ length: 7 }, (_, i) => addDaysStr(weekMon, i)).map((date) => {
                  const inMonth = date.slice(0, 7) === monthStart.slice(0, 7);
                  const isToday = date === today;
                  const points = events.points[date] ?? [];
                  return (
                    <button
                      type="button"
                      key={date}
                      onClick={() => setSelected(date)}
                      className={`flex min-h-14 min-w-0 flex-col items-start gap-0.5 rounded-md p-1 text-left text-[11px] ${
                        inMonth ? '' : 'text-foreground/25'
                      } ${isToday ? 'bg-blue-600/10' : 'hover:bg-foreground/5'} ${
                        selected === date ? 'ring-1 ring-blue-500' : ''
                      } ${compact ? 'min-h-11' : ''}`}
                    >
                      <span className={isToday ? 'font-semibold text-blue-600' : ''}>{Number(date.slice(8, 10))}</span>
                      {points.slice(0, 3).map((p) => {
                        const Icon = POINT_ICON[p.kind];
                        return (
                          <span key={p.id} className="flex w-full min-w-0 items-center gap-0.5 text-[10px] text-foreground/60">
                            <Icon size={9} className="shrink-0" />
                            <span className="min-w-0 truncate">{p.title}</span>
                          </span>
                        );
                      })}
                      {points.length > 3 && (
                        <span className="text-[10px] text-foreground/40">+{points.length - 3}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {selected && (
        <div className="rounded-lg border border-border bg-foreground/[0.03] p-2 text-xs">
          <p className="mb-1 font-medium">{selected}</p>
          {(events.points[selected] ?? []).length === 0 ? (
            <p className="text-foreground/40">일정 없음</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {(events.points[selected] ?? []).map((p) => (
                <li key={p.id} className="flex items-center gap-1.5">
                  <span className="rounded-full bg-foreground/10 px-1.5 py-0.5">{p.kind}</span>
                  {p.title}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {!compact && (
        <p className="text-[11px] text-foreground/30">
          <Link href="/projects" className="hover:underline">
            큐/할 일은 프로젝트 상세에서 편집
          </Link>
        </p>
      )}
    </div>
  );
}
