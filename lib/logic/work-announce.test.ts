import { describe, expect, it } from 'vitest';
import { formatShiftMonth } from '@/lib/telegram/format';
import type { WorkShift } from './work';
import { monthsToAnnounce, offDayEvents, summarizeShiftMonth } from './work-announce';

/** `n` consecutive days of `code` starting at the first of `month`. */
const shiftsFor = (month: string, n: number, code = 'A1'): WorkShift[] =>
  Array.from({ length: n }, (_, i) => ({ date: `${month}-${String(i + 1).padStart(2, '0')}`, code }));

describe('monthsToAnnounce', () => {
  const today = '2026-10-20';
  it('announces a full new month', () => {
    expect(monthsToAnnounce(shiftsFor('2026-11', 30), ['2026-10'], today)).toEqual(['2026-11']);
  });
  it('not when half filled, already announced, in the past, or on first run', () => {
    expect(monthsToAnnounce(shiftsFor('2026-11', 12), ['2026-10'], today)).toEqual([]);
    expect(monthsToAnnounce(shiftsFor('2026-11', 30), ['2026-11'], today)).toEqual([]);
    expect(monthsToAnnounce(shiftsFor('2026-09', 30), ['2026-10'], today)).toEqual([]);
    expect(monthsToAnnounce(shiftsFor('2026-11', 30), null, today)).toEqual([]);
  });
});

describe('summarizeShiftMonth', () => {
  const shifts: WorkShift[] = [
    { date: '2026-11-01', code: 'off' },
    { date: '2026-11-02', code: 'A1' },
    { date: '2026-11-07', code: 'A1' }, // Saturday
    { date: '2026-11-08', code: 'off' },
    { date: '2026-11-09', code: 'B2' },
    { date: '2026-11-12', code: '교육' },
    { date: '2026-12-01', code: 'A1' }, // other month, ignored
  ];
  const s = summarizeShiftMonth('2026-11', shifts);

  it('counts work, off, weekend work, other', () => {
    expect(s.workDays).toBe(3);
    expect(s.offDays).toEqual(['2026-11-01', '2026-11-08']);
    expect(s.weekendWork).toEqual([{ date: '2026-11-07', short: 'A1' }]);
    expect(s.byShort).toEqual({ A1: 2, B2: 1 });
    expect(s.other).toEqual([{ date: '2026-11-12', label: '교육' }]);
  });

  it('off-day events are timed 08:30-09:30', () => {
    expect(offDayEvents(s)).toEqual([
      { title: 'off', date: '2026-11-01', startTime: '08:30', endTime: '09:30' },
      { title: 'off', date: '2026-11-08', startTime: '08:30', endTime: '09:30' },
    ]);
  });

  it('message omits empty lines and lists the rest', () => {
    const text = formatShiftMonth(s);
    expect(text).toContain('11월 근무표 나왔어요');
    expect(text).toContain('근무 3일 · 휴무 2일');
    expect(text).toContain('A1 2 · B2 1');
    expect(text).toContain('휴무: 1(일) 8(일)');
    expect(text).toContain('주말 근무: 11/7(토) A1');
    expect(text).toContain('기타: 11/12 교육');
    expect(formatShiftMonth(summarizeShiftMonth('2026-11', [{ date: '2026-11-02', code: 'A1' }]))).not.toContain('휴무:');
  });
});
