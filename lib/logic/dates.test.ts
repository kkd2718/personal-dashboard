import { describe, expect, it } from 'vitest';
import { dday, ddayLabel, kstDateTime, urgency } from './dates';

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

describe('kstDateTime', () => {
  it('converts a UTC instant to its KST date/time', () => {
    // 2026-01-01T15:30:00Z is 2026-01-02 00:30 in Asia/Seoul (UTC+9).
    expect(kstDateTime('2026-01-01T15:30:00.000Z')).toEqual({ date: '2026-01-02', time: '00:30' });
  });

  it('handles a same-UTC-day KST instant', () => {
    expect(kstDateTime('2026-06-15T01:00:00.000Z')).toEqual({ date: '2026-06-15', time: '10:00' });
  });
});
