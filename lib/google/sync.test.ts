import { describe, expect, it } from 'vitest';
import {
  buildCalendarEvent,
  buildReviewCandidateInputs,
  candidatesToDismiss,
  makeSnippet,
  shouldPushCandidate,
  deadlinesForCalendar,
  dropDuplicateCandidates,
} from '@/lib/google/sync';
import type { Deadline, ReviewJob } from '@/lib/types';

const NOW = '2026-09-20T00:00:00.000Z';

describe('buildCalendarEvent — timezone edges', () => {
  it('all-day single day: Google exclusive end becomes an inclusive same-day end_date', () => {
    const e = buildCalendarEvent('main', NOW, {
      calendarId: 'primary',
      calendarName: 'Personal',
      eventId: 'e1',
      title: 'Fictional Holiday',
      start: '2026-10-01T00:00:00.000+09:00', // Google all-day dates are date-only, but the
      end: '2026-10-02T00:00:00.000+09:00', // Apps Script layer always sends a KST midnight instant.
      allDay: true,
    });
    expect(e.startDate).toBe('2026-10-01');
    expect(e.endDate).toBe('2026-10-01');
    expect(e.startTime).toBeNull();
    expect(e.endTime).toBeNull();
  });

  it('all-day multi-day: exclusive end shifts back one day', () => {
    const e = buildCalendarEvent('main', NOW, {
      calendarId: 'primary',
      calendarName: 'Personal',
      eventId: 'e2',
      title: 'Fictional Conference',
      start: '2026-10-01T00:00:00.000+09:00',
      end: '2026-10-04T00:00:00.000+09:00', // covers Oct 1-3 inclusive
      allDay: true,
    });
    expect(e.startDate).toBe('2026-10-01');
    expect(e.endDate).toBe('2026-10-03');
  });

  it('timed event: UTC instant shifts to the next KST calendar day', () => {
    // 22:00 UTC on Sep 30 is 07:00 KST on Oct 1.
    const e = buildCalendarEvent('main', NOW, {
      calendarId: 'primary',
      calendarName: 'Personal',
      eventId: 'e3',
      title: 'Early call',
      start: '2026-09-30T22:00:00.000Z',
      end: '2026-09-30T23:00:00.000Z',
      allDay: false,
    });
    expect(e.startDate).toBe('2026-10-01');
    expect(e.startTime).toBe('07:00');
    expect(e.endTime).toBe('08:00');
  });

  it('timed event crossing midnight KST: start/end land on different dates', () => {
    const e = buildCalendarEvent('main', NOW, {
      calendarId: 'primary',
      calendarName: 'Personal',
      eventId: 'e4',
      title: 'Overnight shift',
      start: '2026-10-01T15:00:00.000Z', // 2026-10-02 00:00 KST
      end: '2026-10-01T21:00:00.000Z', // 2026-10-02 06:00 KST
      allDay: false,
    });
    expect(e.startDate).toBe('2026-10-02');
    expect(e.startTime).toBe('00:00');
    expect(e.endDate).toBe('2026-10-02');
    expect(e.endTime).toBe('06:00');
  });

  it('id namespaces account:calendarId:eventId so two accounts never collide', () => {
    const a = buildCalendarEvent('main', NOW, {
      calendarId: 'primary',
      calendarName: 'Personal',
      eventId: 'shared-id',
      title: 'A',
      start: '2026-10-01T00:00:00.000Z',
      end: '2026-10-01T01:00:00.000Z',
      allDay: false,
    });
    const b = buildCalendarEvent('lab', NOW, {
      calendarId: 'primary',
      calendarName: 'Lab',
      eventId: 'shared-id',
      title: 'B',
      start: '2026-10-01T00:00:00.000Z',
      end: '2026-10-01T01:00:00.000Z',
      allDay: false,
    });
    expect(a.id).not.toBe(b.id);
  });
});

describe('makeSnippet', () => {
  it('collapses whitespace and caps at 300 chars', () => {
    const text = `line one\n\n   line   two\t\t${'x'.repeat(400)}`;
    const snippet = makeSnippet(text);
    expect(snippet.length).toBe(300);
    expect(snippet).not.toMatch(/\s{2,}/);
  });
});

describe('buildReviewCandidateInputs', () => {
  it('drops non-assignment mails and never carries the body forward', () => {
    const inputs = buildReviewCandidateInputs('main', [
      {
        messageId: 'm1',
        threadId: 't1',
        receivedAt: '2026-09-20T00:00:00.000Z',
        from: '"Fictional Journal" <editor@fictional-journal.test>',
        subject: 'Invitation to review manuscript FJ-2026-0001',
        body: 'You are invited to review the manuscript FJ-2026-0001. Please respond by 2026-10-01.',
      },
      {
        messageId: 'm2',
        threadId: 't2',
        receivedAt: '2026-09-20T00:00:00.000Z',
        from: '"Fictional Conference" <no-reply@fictional-conf.test>',
        subject: 'Call for Reviewers',
        body: 'Apply to review for our conference.',
      },
    ]);
    expect(inputs).toHaveLength(1);
    expect(inputs[0].messageId).toBe('m1');
    expect(inputs[0].kind).toBe('invitation');
    expect(inputs[0].manuscriptId).toBe('FJ-2026-0001');
    expect((inputs[0] as Record<string, unknown>).body).toBeUndefined();
    expect(inputs[0].snippet.length).toBeLessThanOrEqual(300);
  });
});

describe('candidatesToDismiss / shouldPushCandidate', () => {
  const c = (messageId: string, status: string) => ({ messageId, status });

  it('dismisses only pending candidates whose message is in trash', () => {
    const pending = [c('m1', 'pending'), c('m2', 'pending'), c('m3', 'accepted')];
    expect(candidatesToDismiss(pending, ['m2', 'm3', 'mX'])).toEqual([c('m2', 'pending')]);
  });

  it('no trashed ids -> nothing dismissed', () => {
    expect(candidatesToDismiss([c('m1', 'pending')], [])).toEqual([]);
  });

  it('pushes revision + reminder only', () => {
    expect(shouldPushCandidate('revision')).toBe(true);
    expect(shouldPushCandidate('reminder')).toBe(true);
    expect(shouldPushCandidate('invitation')).toBe(false);
    expect(shouldPushCandidate('confirmation')).toBe(false);
    expect(shouldPushCandidate('completed')).toBe(false);
    expect(shouldPushCandidate('other')).toBe(false);
  });
});

describe('buildCalendarEvent — recurring instances', () => {
  it('instances sharing one Apps Script event id get distinct ids', () => {
    const base = { calendarId: 'primary', calendarName: 'P', eventId: 'rec1', title: 'Weekly', allDay: false };
    const a = buildCalendarEvent('main', NOW, { ...base, start: '2026-09-21T08:00:00+09:00', end: '2026-09-21T09:00:00+09:00' });
    const b = buildCalendarEvent('main', NOW, { ...base, start: '2026-09-28T08:00:00+09:00', end: '2026-09-28T09:00:00+09:00' });
    expect(a.id).not.toBe(b.id);
  });
});

describe('deadlinesForCalendar', () => {
  const dl = (over: Partial<Deadline>): Deadline => ({
    id: 'd1', title: 'Fictional 리비전 제출', kind: 'paper', dueDate: '2026-10-17', dueTime: null,
    projectId: null, paperId: 'p1', reviewId: null, done: false, remindDays: [7, 3, 1], updatedAt: NOW, ...over,
  });
  const rv = (over: Partial<ReviewJob>): ReviewJob => ({
    id: 'r1', journal: 'Fictional Journal', manuscriptId: 'FJ-2026-0001', title: null, status: 'accepted',
    invitedAt: null, dueDate: '2026-10-05', link: null, note: null, updatedAt: NOW, ...over,
  });

  it('lists open deadlines and accepted reviews, sorted by date', () => {
    expect(deadlinesForCalendar([dl({})], [rv({})], '2026-09-27')).toEqual([
      { key: 'review:r1', title: '📌 Fictional Journal FJ-2026-0001 리뷰 마감', date: '2026-10-05' },
      { key: 'deadline:d1', title: '📌 Fictional 리비전 제출', date: '2026-10-17' },
    ]);
  });

  it('skips done/old deadlines, non-accepted reviews, and reviews that already have a deadline', () => {
    const out = deadlinesForCalendar(
      [dl({ id: 'done', done: true }), dl({ id: 'old', dueDate: '2026-09-01' }), dl({ id: 'rd', reviewId: 'r2' })],
      [rv({ id: 'inv', status: 'invited' }), rv({ id: 'r2' }), rv({ id: 'nodue', dueDate: null })],
      '2026-09-27'
    );
    expect(out.map((d) => d.key)).toEqual(['deadline:rd']);
  });
});

describe('dropDuplicateCandidates — same letter in both accounts', () => {
  const c = (kind: string, manuscriptId: string | null, subject: string) => ({ kind, manuscriptId, subject });

  it('drops a revision already known from the other account (same manuscript id)', () => {
    const existing = [c('revision', 'FICSCI-D-26-01234', 'Fwd: Editorial Decision on Manuscript FICSCI-D-26-01234')];
    const inputs = [c('revision', 'FICSCI-D-26-01234', 'Editorial Decision on Manuscript FICSCI-D-26-01234')];
    expect(dropDuplicateCandidates(inputs, existing)).toEqual([]);
  });

  it('without an id, matches on the Fwd:/Re:-stripped subject', () => {
    const existing = [c('revision', null, 'Fwd: npj Fictional Medicine: Decision on your manuscript')];
    const inputs = [
      c('revision', null, 'npj Fictional Medicine: Decision on your manuscript'),
      c('revision', null, 'Fictional Letters: Decision on your manuscript'),
    ];
    expect(dropDuplicateCandidates(inputs, existing)).toEqual([inputs[1]]);
  });

  it('keeps different kinds for the same manuscript and dedups within one batch', () => {
    const inputs = [c('confirmation', 'FJ-2026-0001', 'a'), c('reminder', 'FJ-2026-0001', 'b'), c('reminder', 'FJ-2026-0001', 'c')];
    expect(dropDuplicateCandidates(inputs, [])).toEqual([inputs[0], inputs[1]]);
  });
});
