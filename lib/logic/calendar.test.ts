import { describe, expect, it } from 'vitest';
import {
  calendarEvents,
  calendarVisibilityOptions,
  filterVisibleEvents,
  isHolidayCalendar,
  isPrimaryCalendarEvent,
  todayCalendarEvents,
} from './calendar';
import type { CalendarEvent, Milestone, Note } from '@/lib/types';

function googleEvent(overrides: Partial<CalendarEvent>): CalendarEvent {
  return {
    id: 'main:primary:e1',
    account: 'main',
    calendarName: 'Personal',
    title: 'Event',
    startDate: '2026-09-24',
    endDate: '2026-09-24',
    startTime: null,
    endTime: null,
    location: null,
    updatedAt: '2026-09-20T00:00:00Z',
    ...overrides,
  };
}

function milestone(overrides: Partial<Milestone>): Milestone {
  return {
    id: 'm1',
    projectId: 'p1',
    title: 'Q',
    startDate: null,
    endDate: null,
    status: 'active',
    sort: 0,
    updatedAt: '2026-09-25',
    ...overrides,
  };
}

describe('calendarEvents', () => {
  it('splits a milestone spanning weeks into per-week-row segments (Monday-start grid)', () => {
    const m = milestone({ startDate: '2026-09-24', endDate: '2026-10-07' });
    const result = calendarEvents('2026-09-01', {
      milestones: [m],
      tasks: [],
      deadlines: [],
      reviews: [],
    });

    // grid weeks: 08-31, 09-07, 09-14, 09-21, 09-28 (last day of Sept -> endOfIsoWeek(09-30) = 10-04)
    expect(result.weeks).toEqual(['2026-08-31', '2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28']);

    const segs = result.ranges.filter((r) => r.milestoneId === 'm1');
    // week of 09-21 (index 3): 09-24 is Thursday -> col 4, runs to Sunday col 7, isStart
    expect(segs).toContainEqual(
      expect.objectContaining({ weekIndex: 3, colStart: 4, colEnd: 7, isStart: true, isEnd: false })
    );
    // week of 09-28 (index 4): full week, cols 1..7
    expect(segs).toContainEqual(
      expect.objectContaining({ weekIndex: 4, colStart: 1, colEnd: 7, isStart: false, isEnd: false })
    );
    // week of 10-05 is not in the grid -> no segment for it
    expect(segs.some((s) => s.weekIndex === 5)).toBe(false);
    expect(segs).toHaveLength(2);
  });

  it('assigns distinct lanes to overlapping milestones', () => {
    const a = milestone({ id: 'a', startDate: '2026-09-01', endDate: '2026-09-10' });
    const b = milestone({ id: 'b', startDate: '2026-09-05', endDate: '2026-09-15' });
    const result = calendarEvents('2026-09-01', {
      milestones: [a, b],
      tasks: [],
      deadlines: [],
      reviews: [],
    });
    const laneA = result.ranges.find((r) => r.milestoneId === 'a')!.lane;
    const laneB = result.ranges.find((r) => r.milestoneId === 'b')!.lane;
    expect(new Set([laneA, laneB])).toEqual(new Set([0, 1]));
  });

  it('renders a start-only milestone as a point', () => {
    const m = milestone({ id: 'm2', startDate: '2026-09-10', endDate: null });
    const result = calendarEvents('2026-09-01', {
      milestones: [m],
      tasks: [],
      deadlines: [],
      reviews: [],
    });
    expect(result.ranges).toHaveLength(0);
    expect(result.points['2026-09-10']).toContainEqual(
      expect.objectContaining({ id: 'm2', kind: 'milestone' })
    );
  });

  it('includes a dated note as a memo point', () => {
    const note: Note = {
      id: 'n1',
      body: '메모',
      kind: 'memo',
      status: 'inbox',
      projectId: null,
      tags: [],
      date: '2026-09-15',
      pinned: false,
      source: 'web',
      deliveredAt: null,
      taskId: null,
      externalId: null,
      createdAt: '2026-09-25',
      updatedAt: '2026-09-25',
    };
    const result = calendarEvents('2026-09-01', {
      milestones: [],
      tasks: [],
      deadlines: [],
      reviews: [],
      notes: [note],
    });
    expect(result.points['2026-09-15']).toContainEqual(expect.objectContaining({ id: 'n1', kind: 'memo' }));
  });

  it('adds a google event as a point on every day it spans, and tracks holiday dates separately', () => {
    const single = googleEvent({ id: 'g1', startDate: '2026-09-15', endDate: '2026-09-15', startTime: '10:00' });
    const multi = googleEvent({
      id: 'g2',
      startDate: '2026-09-16',
      endDate: '2026-09-17',
      calendarName: 'Fictional Conference',
    });
    const holiday = googleEvent({ id: 'g3', startDate: '2026-09-18', endDate: '2026-09-18', calendarName: '공휴일' });
    const result = calendarEvents('2026-09-01', {
      milestones: [],
      tasks: [],
      deadlines: [],
      reviews: [],
      googleEvents: [single, multi, holiday],
    });
    expect(result.points['2026-09-15']).toContainEqual(
      expect.objectContaining({ id: 'g1', kind: 'google', startTime: '10:00' })
    );
    expect(result.points['2026-09-16']).toContainEqual(expect.objectContaining({ id: 'g2' }));
    expect(result.points['2026-09-17']).toContainEqual(expect.objectContaining({ id: 'g2' }));
    expect(result.points['2026-09-18']).toBeUndefined(); // holiday event never becomes a chip
    expect(result.holidays.has('2026-09-18')).toBe(true);
  });
});

describe('isHolidayCalendar', () => {
  it('matches Korean 휴일 and English "holiday" calendar names, case-insensitively', () => {
    expect(isHolidayCalendar('대한민국 공휴일')).toBe(true);
    expect(isHolidayCalendar('Holidays in South Korea')).toBe(true);
    expect(isHolidayCalendar('Personal')).toBe(false);
  });
});

describe('todayCalendarEvents', () => {
  it('sorts timed events before all-day, excludes holidays', () => {
    const allDay = googleEvent({ id: 'g1', startTime: null });
    const timed = googleEvent({ id: 'g2', startTime: '09:00' });
    const holiday = googleEvent({ id: 'g3', calendarName: '공휴일' });
    const result = todayCalendarEvents([allDay, timed, holiday]);
    expect(result.map((e) => e.id)).toEqual(['g2', 'g1']);
  });
});

describe('isPrimaryCalendarEvent (Addendum A)', () => {
  it('true only when the id embeds calendarId "primary"', () => {
    expect(isPrimaryCalendarEvent(googleEvent({ id: 'main:primary:e1' }))).toBe(true);
    expect(isPrimaryCalendarEvent(googleEvent({ id: 'amc:professor@fictional-univ.test:e1' }))).toBe(false);
  });
});

describe('calendarVisibilityOptions (Addendum A)', () => {
  it('lists distinct non-holiday calendar names, flagging the primary one as default-visible', () => {
    const primary = googleEvent({ id: 'main:primary:e1', calendarName: 'Personal' });
    const lab = googleEvent({ id: 'main:lab-cal-id:e2', calendarName: 'Lab' });
    const holiday = googleEvent({ id: 'main:ko.holiday:e3', calendarName: '공휴일' });
    const options = calendarVisibilityOptions([primary, lab, holiday]);
    expect(options).toEqual(
      expect.arrayContaining([
        { name: 'Personal', defaultVisible: true },
        { name: 'Lab', defaultVisible: false },
      ])
    );
    expect(options.find((o) => o.name === '공휴일')).toBeUndefined();
  });
});

describe('filterVisibleEvents (Addendum A)', () => {
  const primary = googleEvent({ id: 'main:primary:e1', calendarName: 'Personal' });
  const lab = googleEvent({ id: 'main:lab-cal-id:e2', calendarName: 'Lab' });
  const holiday = googleEvent({ id: 'main:ko.holiday:e3', calendarName: '공휴일' });

  it('null (unset) visible set defaults to the primary calendar + holidays', () => {
    const result = filterVisibleEvents([primary, lab, holiday], null);
    expect(result.map((e) => e.id).sort()).toEqual([primary.id, holiday.id].sort());
  });

  it('an explicit visible set overrides the default, holidays still always pass', () => {
    const result = filterVisibleEvents([primary, lab, holiday], ['Lab']);
    expect(result.map((e) => e.id).sort()).toEqual([lab.id, holiday.id].sort());
  });

  it('an empty explicit visible set still keeps holidays', () => {
    const result = filterVisibleEvents([primary, lab, holiday], []);
    expect(result.map((e) => e.id)).toEqual([holiday.id]);
  });
});
