import { describe, expect, it } from 'vitest';
import { buildCalendarEvent, buildReviewCandidateInputs, makeSnippet } from '@/lib/google/sync';

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
