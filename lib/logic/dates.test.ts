import { describe, expect, it } from 'vitest';
import { absoluteDateLabel, dday, ddayLabel, kstDateTime, relTime, urgency } from './dates';

describe('dday', () => {
  it('computes forward, same-day, and backward diffs', () => {
    expect(dday('2026-09-28', '2026-09-25')).toBe(3);
    expect(dday('2026-09-25', '2026-09-25')).toBe(0);
    expect(dday('2026-09-24', '2026-09-25')).toBe(-1);
  });

  it('handles month/year boundaries', () => {
    expect(dday('2027-01-01', '2026-12-31')).toBe(1);
  });
});

describe('ddayLabel', () => {
  it('formats positive, zero, and negative days', () => {
    expect(ddayLabel(3)).toBe('D-3');
    expect(ddayLabel(0)).toBe('D-DAY');
    expect(ddayLabel(-2)).toBe('D+2');
  });
});

describe('urgency', () => {
  it('classifies by day count', () => {
    expect(urgency(-1)).toBe('overdue');
    expect(urgency(0)).toBe('today');
    expect(urgency(1)).toBe('soon');
    expect(urgency(7)).toBe('soon');
    expect(urgency(8)).toBe('later');
  });
});

describe('absoluteDateLabel', () => {
  it('omits the year when it matches today', () => {
    expect(absoluteDateLabel('2026-10-15', '2026-09-26')).toBe('10월 15일 (목)');
  });

  it('prefixes the year when it differs from today', () => {
    expect(absoluteDateLabel('2027-01-05', '2026-09-26')).toBe('2027년 1월 5일 (화)');
  });
});

describe('kstDateTime', () => {
  it('converts a UTC instant to its KST date/time', () => {
    // 2026-01-01T15:30:00Z is 2026-01-02 00:30 in Asia/Seoul (UTC+9).
    expect(kstDateTime('2026-01-01T15:30:00.000Z')).toEqual({ date: '2026-01-02', time: '00:30' });
  });

  it('handles a same-UTC-day KST instant', () => {
    expect(kstDateTime('2026-06-15T01:00:00.000Z')).toEqual({ date: '2026-06-15', time: '10:00' });
  });
});

describe('relTime', () => {
  const now = '2026-09-26T12:00:00.000Z';

  it('buckets recent past instants', () => {
    expect(relTime('2026-09-26T11:59:31.000Z', now)).toBe('방금');
    expect(relTime('2026-09-26T11:45:00.000Z', now)).toBe('15분 전');
    expect(relTime('2026-09-26T09:00:00.000Z', now)).toBe('3시간 전');
  });

  it('never shows raw hours beyond a day', () => {
    // ~27 days ago (644 hours) must read as days/weeks, not "644시간 전".
    expect(relTime('2026-08-30T12:00:00.000Z', now)).not.toMatch(/시간/);
  });

  it('shows 어제/내일 for one day away', () => {
    expect(relTime('2026-09-25T12:00:00.000Z', now)).toBe('어제');
    expect(relTime('2026-09-27T12:00:00.000Z', now)).toBe('내일');
  });

  it('buckets days, weeks, and months', () => {
    expect(relTime('2026-09-20T12:00:00.000Z', now)).toBe('6일 전');
    expect(relTime('2026-09-01T12:00:00.000Z', now)).toBe('3주 전');
    expect(relTime('2026-06-26T12:00:00.000Z', now)).toBe('3개월 전');
  });

  it('falls back to year+month beyond a year', () => {
    expect(relTime('2025-03-15T00:00:00.000Z', now)).toBe('2025년 3월');
  });

  it('supports future instants', () => {
    expect(relTime('2026-09-30T12:00:00.000Z', now)).toBe('4일 후');
  });
});
