import { describe, expect, it } from 'vitest';
import {
  escapeHtml,
  formatCaptureReply,
  formatCriticalAlert,
  formatDigest,
  formatToday,
  formatUpcomingList,
  parseUpdate,
  route,
} from './format';
import type { Checklist, ChecklistItem } from '@/lib/logic/checklist';
import type { UpcomingItem } from '@/lib/logic/upcoming';
import type { StatusItem } from '@/lib/status/types';
import type { CalendarEvent, Deadline, Note, ReviewJob } from '@/lib/types';

const TODAY = '2026-09-26'; // Saturday

function emptyChecklist(): Checklist {
  return { overdue: [], today: [], thisWeek: [], doing: [], next: [] };
}

function checklistItem(overrides: Partial<ChecklistItem>): ChecklistItem {
  return {
    id: 'c1',
    title: 'test task',
    kind: 'task',
    deadlineKind: null,
    projectId: null,
    dueDate: null,
    done: false,
    readOnly: false,
    ...overrides,
  };
}

function upcomingItem(overrides: Partial<UpcomingItem>): UpcomingItem {
  return {
    id: 'deadline:u1',
    title: 'test deadline',
    dueDate: '2026-09-28',
    dueTime: null,
    kind: 'other',
    dday: 2,
    origin: 'deadline',
    originId: 'u1',
    ...overrides,
  };
}

function note(overrides: Partial<Note>): Note {
  return {
    id: 'n1',
    body: 'a memo',
    kind: 'memo',
    status: 'inbox',
    projectId: null,
    tags: [],
    date: TODAY,
    pinned: false,
    source: 'telegram',
    deliveredAt: null,
    taskId: null,
    externalId: null,
    createdAt: TODAY,
    updatedAt: TODAY,
    ...overrides,
  };
}

function statusItem(overrides: Partial<StatusItem>): StatusItem {
  return {
    id: 's1',
    severity: 'critical',
    source: 'git',
    projectId: null,
    title: 'test status',
    detail: null,
    href: null,
    ...overrides,
  };
}

function deadline(overrides: Partial<Deadline>): Deadline {
  return {
    id: 'd1',
    title: 'test deadline',
    kind: 'other',
    dueDate: '2026-09-27',
    dueTime: null,
    projectId: null,
    paperId: null,
    reviewId: null,
    done: false,
    remindDays: [7, 3, 1],
    updatedAt: TODAY,
    ...overrides,
  };
}

function review(overrides: Partial<ReviewJob>): ReviewJob {
  return {
    id: 'r1',
    journal: 'Test Journal',
    manuscriptId: null,
    title: null,
    status: 'invited',
    invitedAt: null,
    dueDate: '2026-09-27',
    link: null,
    note: null,
    updatedAt: TODAY,
    ...overrides,
  };
}

function calendarEvent(overrides: Partial<CalendarEvent>): CalendarEvent {
  return {
    id: 'main:primary:g1',
    account: 'main',
    calendarName: 'Personal',
    title: 'Event',
    startDate: TODAY,
    endDate: TODAY,
    startTime: null,
    endTime: null,
    location: null,
    updatedAt: TODAY,
    ...overrides,
  };
}

describe('escapeHtml', () => {
  it('escapes & < >', () => {
    expect(escapeHtml('a & <b> c')).toBe('a &amp; &lt;b&gt; c');
  });
});

describe('formatCaptureReply', () => {
  it('plain memo with no project/tags', () => {
    expect(formatCaptureReply(note({ tags: [] }), null)).toBe('메모 저장 ✓');
  });

  it('appends project and escaped tags', () => {
    const result = formatCaptureReply(note({ tags: ['a&b'] }), 'BrainCT<FU>');
    expect(result).toBe('메모 저장 ✓ · @BrainCT&lt;FU&gt; #a&amp;b');
  });
});

describe('formatToday', () => {
  it('returns the empty-state message when nothing to report', () => {
    const result = formatToday({
      today: TODAY,
      checklist: emptyChecklist(),
      upcoming: [],
      dayMemos: [],
      statusItems: [],
    });
    expect(result).toBe('오늘은 비어 있어요 ✨');
  });

  it('renders non-empty sections and omits empty ones', () => {
    const checklist = { ...emptyChecklist(), overdue: [checklistItem({ title: '지연 작업' })] };
    const result = formatToday({
      today: TODAY,
      checklist,
      upcoming: [upcomingItem({ title: '마감 임박', dday: 3 })],
      dayMemos: [],
      statusItems: [statusItem({ severity: 'ok' })], // ok is never alertable
    });
    expect(result).toContain('🔴 지연');
    expect(result).toContain('- 지연 작업');
    expect(result).toContain('⏳ 7일 내 마감');
    expect(result).toContain('D-3 마감 임박');
    expect(result).not.toContain('📌 오늘');
    expect(result).not.toContain('⚠️ 상태');
  });

  it('caps output at 30 lines with an overflow marker', () => {
    const checklist = {
      ...emptyChecklist(),
      overdue: Array.from({ length: 40 }, (_, i) => checklistItem({ id: `t${i}`, title: `task ${i}` })),
    };
    const result = formatToday({ today: TODAY, checklist, upcoming: [], dayMemos: [], statusItems: [] });
    const lines = result.split('\n');
    expect(lines.length).toBe(30);
    expect(lines[lines.length - 1]).toMatch(/^…외 \d+건$/);
  });

  it('renders today\'s timed events before all-day, excludes holidays', () => {
    const checklist = { ...emptyChecklist(), today: [checklistItem({ title: 'x' })] };
    const timed = calendarEvent({ id: 'g1', title: 'Fictional Meeting', startTime: '14:00' });
    const allDay = calendarEvent({ id: 'g2', title: 'Fictional All-Day' });
    const holiday = calendarEvent({ id: 'g3', title: 'Fictional Holiday', calendarName: '공휴일' });
    const result = formatToday({
      today: TODAY,
      checklist,
      upcoming: [],
      dayMemos: [],
      todayEvents: [allDay, timed, holiday],
      statusItems: [],
    });
    expect(result).toContain('🗓 오늘 일정');
    expect(result).toContain('- 14:00 Fictional Meeting');
    expect(result).toContain('- Fictional All-Day');
    expect(result).not.toContain('Fictional Holiday');
    // timed before all-day
    expect(result.indexOf('Fictional Meeting')).toBeLessThan(result.indexOf('Fictional All-Day'));
  });

  it('ends with a dashboard link line when cloudUrl is given', () => {
    const checklist = { ...emptyChecklist(), today: [checklistItem({ title: 'x' })] };
    const result = formatToday({
      today: TODAY,
      checklist,
      upcoming: [],
      dayMemos: [],
      statusItems: [],
      cloudUrl: 'https://example.test',
    });
    expect(result.split('\n').at(-1)).toBe('대시보드: https://example.test');
  });
});

describe('formatUpcomingList', () => {
  it('empty-state message when there is nothing upcoming', () => {
    expect(formatUpcomingList([])).toBe('기한 내 마감 없어요 ✨');
  });

  it('formats each item with a D-day label', () => {
    expect(formatUpcomingList([upcomingItem({ title: 'x', dday: 0 })])).toBe('- D-DAY x');
  });
});

describe('formatDigest', () => {
  it('returns null when there is nothing to report', () => {
    const result = formatDigest({
      today: TODAY,
      deadlines: [],
      reviews: [],
      checklist: emptyChecklist(),
      statusItems: [],
    });
    expect(result).toBeNull();
  });

  it('is sent (not null) when there is nothing but a today event', () => {
    const result = formatDigest({
      today: TODAY,
      deadlines: [],
      reviews: [],
      checklist: emptyChecklist(),
      todayEvents: [calendarEvent({ title: 'Fictional Standup', startTime: '09:00' })],
      statusItems: [],
    });
    expect(result).toContain('🗓 오늘 일정');
    expect(result).toContain('- 09:00 Fictional Standup');
  });

  it('includes a Korean weekday header and due reminders', () => {
    const result = formatDigest({
      today: TODAY,
      deadlines: [deadline({ dueDate: '2026-09-27' })], // dday 1, in remindDays
      reviews: [],
      checklist: emptyChecklist(),
      statusItems: [],
    });
    expect(result).toContain('☀️ 9/26(토) 브리핑');
    expect(result).toContain('📅 마감 리마인더');
  });

  it('includes pending review reminders', () => {
    const result = formatDigest({
      today: TODAY,
      deadlines: [],
      reviews: [review({ dueDate: TODAY })], // dday 0
      checklist: emptyChecklist(),
      statusItems: [],
    });
    expect(result).toContain('📅 마감 리마인더');
  });
});

describe('formatCriticalAlert', () => {
  it('one line per item, escaped, with detail after an em dash', () => {
    const result = formatCriticalAlert([
      statusItem({ title: 'a<b>', detail: 'oops' }),
      statusItem({ id: 's2', title: 'no detail', detail: null }),
    ]);
    expect(result).toBe('🚨 a&lt;b&gt; — oops\n🚨 no detail');
  });
});

describe('parseUpdate', () => {
  it('parses a plain text message', () => {
    expect(parseUpdate({ message: { chat: { id: 1 }, text: 'hi' } })).toEqual({ chatId: 1, text: 'hi' });
  });

  it('ignores edited_message', () => {
    expect(parseUpdate({ edited_message: { chat: { id: 1 }, text: 'hi' } })).toBeNull();
  });

  it('ignores non-text messages', () => {
    expect(parseUpdate({ message: { chat: { id: 1 }, photo: [] } })).toBeNull();
  });

  it('returns null for garbage input', () => {
    expect(parseUpdate(null)).toBeNull();
    expect(parseUpdate({})).toBeNull();
  });
});

describe('route', () => {
  it('routes plain text to capture', () => {
    expect(route('buy milk')).toEqual({ kind: 'capture', text: 'buy milk' });
  });

  it('routes known commands, stripping an @BotName suffix', () => {
    expect(route('/today@my_bot')).toEqual({ kind: 'command', name: 'today', arg: '' });
    expect(route('/deadlines')).toEqual({ kind: 'command', name: 'deadlines', arg: '' });
  });

  it('routes unknown commands to unknown', () => {
    expect(route('/frobnicate')).toEqual({ kind: 'command', name: 'unknown', arg: '' });
  });
});

describe('formatDigest — project checklist items', () => {
  it('lists my project items due today, tomorrow and overdue, and counts them as content', () => {
    const result = formatDigest({
      today: '2026-09-30',
      deadlines: [],
      reviews: [],
      checklist: { overdue: [], today: [], thisWeek: [], doing: [], next: [] },
      statusItems: [],
      projectDue: {
        today: [{ project: 'trading', text: 'RP 해지', due: '2026-09-30', blocked: false }],
        tomorrow: [{ project: 'trading', text: 'IB+VR 시작', due: '2026-10-01', blocked: false }],
        overdue: [{ project: 'Amgi', text: '콘솔 확인', due: '2026-09-28', blocked: true }],
      },
    });
    expect(result).toContain('📌 오늘\n- [trading] RP 해지');
    expect(result).toContain('🔜 내일 (미리)\n- [trading] IB+VR 시작');
    expect(result).toContain('- [Amgi] 콘솔 확인 (~9/28) (막힘)');
  });
});
