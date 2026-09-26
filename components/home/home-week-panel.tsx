'use client';

import { useMemo, useState } from 'react';
import { CommandCalendar } from '@/components/command-calendar';
import { WeekStrip } from '@/components/home/week-strip';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { filterVisibleEvents } from '@/lib/logic/calendar';
import type { CalendarEvent, Deadline, Milestone, Note, Project, ReviewJob, Task } from '@/lib/types';

/**
 * Home "이번 주" slot with the 월|주 toggle (§5.1): 주 (default) shows the compact
 * WeekStrip; 월 falls back to the existing month <CommandCalendar>.
 */
export function HomeWeekPanel({
  weekStart,
  milestones,
  tasks,
  deadlines,
  reviews,
  notes,
  googleEvents,
  visibleCalendars,
  projects,
}: {
  weekStart: string;
  milestones: Milestone[];
  tasks: Task[];
  deadlines: Deadline[];
  reviews: ReviewJob[];
  notes: Note[];
  googleEvents: CalendarEvent[];
  visibleCalendars: string[] | null;
  projects: Project[];
}) {
  const [view, setView] = useState<'week' | 'month'>('week');
  const filteredEvents = useMemo(
    () => filterVisibleEvents(googleEvents, visibleCalendars),
    [googleEvents, visibleCalendars]
  );

  if (view === 'month') {
    return (
      <div className="flex h-full flex-col gap-2">
        <div className="hidden justify-end md:flex">
          <SegmentedControl options={[{ value: 'week', label: '주' }, { value: 'month', label: '월' }]} value={view} onChange={setView} />
        </div>
        <div className="min-h-0 flex-1">
          <CommandCalendar
            milestones={milestones}
            tasks={tasks}
            deadlines={deadlines}
            reviews={reviews}
            notes={notes}
            googleEvents={googleEvents}
            visibleCalendars={visibleCalendars}
            projects={projects}
            defaultView="month"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="min-h-0">
        <WeekStrip
          headerAction={
            <span className="hidden md:inline-flex">
              <SegmentedControl options={[{ value: 'week', label: '주' }, { value: 'month', label: '월' }]} value={view} onChange={setView} />
            </span>
          }
          initialWeekStart={weekStart}
          milestones={milestones}
          deadlines={deadlines}
          reviews={reviews}
          notes={notes}
          googleEvents={filteredEvents}
          projects={projects}
        />
      </div>
    </div>
  );
}
