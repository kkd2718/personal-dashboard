import { describe, expect, it } from 'vitest';
import { nowKstTime, weekdayOf } from './dates';
import {
  addMinutesKst,
  applyShift,
  parseKoDateTime,
  parseRelativeOffset,
  rescheduleBase,
  stripSpans,
} from './ko-datetime';

const TODAY = '2026-10-15'; // Thursday
const p = (text: string, today = TODAY) => parseKoDateTime(text, today);

describe('dates helpers', () => {
  it('weekdayOf / nowKstTime', () => {
    expect(weekdayOf('2026-10-15')).toBe(4);
    expect(nowKstTime(new Date('2026-10-15T15:30:00Z'))).toBe('00:30');
  });
});

describe('absolute dates', () => {
  it.each([
    ['10/31', '2026-10-31'],
    ['10월 31일', '2026-10-31'],
    ['10월31일까지', '2026-10-31'],
    ['31일', '2026-10-31'],
    ['3일', '2026-11-03'],
    ['9/1', '2026-09-01'],
    ['8/1', '2027-08-01'],
    ['2027-01-05', '2027-01-05'],
  ])('%s', (text, date) => expect(p(text).date).toBe(date));

  it('rolls over month/year', () => {
    expect(p('31일', '2026-11-15').date).toBe('2026-12-31');
    expect(p('1/5', '2026-12-30').date).toBe('2027-01-05');
  });

  it('rejects invalid days and URLs', () => {
    expect(p('2월 30일').date).toBeNull();
    expect(p('13/45').date).toBeNull();
    expect(p('https://x.com/10/31 확인').date).toBeNull();
  });
});

describe('relative words and weekdays', () => {
  it.each([
    ['오늘', '2026-10-15'],
    ['내일', '2026-10-16'],
    ['모레', '2026-10-17'],
    ['내일모레', '2026-10-17'],
    ['글피', '2026-10-18'],
    ['다음주 화요일', '2026-10-20'],
    ['다음 주 화욜', '2026-10-20'],
    ['이번주 금요일', '2026-10-16'],
    ['이번주 월요일', '2026-10-12'],
    ['화요일', '2026-10-20'],
    ['목요일', '2026-10-22'],
    ['금요일', '2026-10-16'],
  ])('%s', (text, date) => expect(p(text).date).toBe(date));

  it('weeks run Sunday to Saturday', () => {
    expect(p('다음주 화요일', '2026-10-17').date).toBe('2026-10-20'); // Sat
    expect(p('다음주 화요일', '2026-10-18').date).toBe('2026-10-27'); // Sun starts a new week
    expect(p('이번주 토요일', '2026-10-18').date).toBe('2026-10-24');
    expect(p('이번주 일요일').date).toBe('2026-10-11');
    expect(p('이번주 일요일', '2026-10-17').date).toBe('2026-10-11'); // Sat
    expect(p('다음주 월요일', '2026-10-18').date).toBe('2026-10-26'); // Sun
    expect(p('저번주 금요일').date).toBe('2026-10-09');
    expect(p('지난주 월요일').date).toBe('2026-10-05');
  });

  it('일주일 is not a weekday', () => {
    expect(p('일주일 미뤄').date).toBeNull();
  });
});

describe('shift', () => {
  it.each([
    ['2주 미뤄', 14],
    ['일주일 미뤄', 7],
    ['+3일', 3],
    ['하루 연기', 1],
    ['이틀 미뤄줘', 2],
    ['다음주로 미뤄', 7],
    ['+1주', 7],
    ['3일 뒤로 미뤄', 3],
  ])('%s', (text, n) => {
    const r = p(text);
    expect(r.shift).toEqual({ unit: 'day', n });
    expect(r.date).toBeNull();
  });

  it.each([
    ['한 주 미뤄', { unit: 'day', n: 7 }],
    ['두 주 미뤄', { unit: 'day', n: 14 }],
    ['세 주 미뤄', { unit: 'day', n: 21 }],
    ['네주 미뤄', { unit: 'day', n: 28 }],
    ['두 달 미뤄', { unit: 'month', n: 2 }],
    ['세달 연기', { unit: 'month', n: 3 }],
    ['사흘 미뤄', { unit: 'day', n: 3 }],
    ['3개월 미뤄', { unit: 'month', n: 3 }],
  ])('korean numerals %s', (text, shift) => expect(p(text).shift).toEqual(shift));

  it('requires a unit and ignores dates', () => {
    expect(p('버전 2 미뤄').shift).toBeNull();
    const r = p('10월 3일 미뤄');
    expect(r.shift).toBeNull();
    expect(r.date).toBe('2026-10-03');
  });

  it('한 달 미뤄', () => expect(p('한 달 미뤄').shift).toEqual({ unit: 'month', n: 1 }));
});

describe('times', () => {
  it.each([
    ['오후 3시', '15:00'],
    ['3시 반', '15:30'],
    ['15:00', '15:00'],
    ['4시 30분', '16:30'],
    ['오전 11시', '11:00'],
    ['9시', '09:00'],
    ['12시', '12:00'],
    ['저녁 7시 반', '19:30'],
    ['새벽 2시', '02:00'],
    ['정오', '12:00'],
  ])('%s', (text, time) => expect(p(text).times).toEqual([time]));

  it('rejects invalid', () => {
    expect(p('밤 12시').times).toEqual([]);
    expect(p('25시').times).toEqual([]);
  });

  it('two bare times are two times, not a range', () => {
    expect(p('2시 3시')).toMatchObject({ times: ['14:00', '15:00'], range: null });
    expect(p('오후 2시 3시')).toMatchObject({ times: ['14:00', '15:00'], range: null });
    expect(p('오전 11시 2시').times).toEqual(['11:00', '14:00']);
  });

  it('a range crossing midnight keeps only the start', () => {
    expect(p('오후 11시~1시')).toMatchObject({ range: null, times: ['23:00'] });
  });

  it('ranges', () => {
    expect(p('2시~3시').range).toEqual({ start: '14:00', end: '15:00' });
    expect(p('2시부터 3시까지').range).toEqual({ start: '14:00', end: '15:00' });
    expect(p('2-4시').range).toEqual({ start: '14:00', end: '16:00' });
    expect(p('11시~1시').range).toEqual({ start: '11:00', end: '13:00' });
  });
});

describe('duration', () => {
  it.each([
    ['1시간', 60],
    ['1시간 반', 90],
    ['30분 동안', 30],
    ['90분간', 90],
  ])('%s', (text, min) => expect(p(text).durationMin).toBe(min));

  it('4시 30분 is a time', () => expect(p('4시 30분').durationMin).toBeNull());
});

describe('stripSpans', () => {
  it('leaves the title', () => {
    const text = '내일 오후 3시 치과 1시간';
    const r = p(text);
    expect(r).toMatchObject({ date: '2026-10-16', times: ['15:00'], durationMin: 60 });
    expect(stripSpans(text, r.spans)).toBe('치과');
  });

  it('multiple times', () => {
    const text = '다음주 화요일 2시 3시 미팅';
    const r = p(text);
    expect(r).toMatchObject({ date: '2026-10-20', times: ['14:00', '15:00'] });
    expect(stripSpans(text, r.spans)).toBe('미팅');
  });

  it('drops glued particles', () => {
    const text = '10월31일까지 보고서';
    expect(stripSpans(text, p(text).spans)).toBe('보고서');
  });
});

describe('shift helpers', () => {
  it('rescheduleBase', () => {
    expect(rescheduleBase('2026-10-01', TODAY)).toBe('2026-10-15');
    expect(rescheduleBase(null, TODAY)).toBe('2026-10-15');
    expect(rescheduleBase('2026-11-01', TODAY)).toBe('2026-11-01');
  });
  it('addMinutesKst', () => {
    expect(addMinutesKst('2026-10-15', '23:30', 60)).toEqual({ date: '2026-10-16', time: '00:30' });
  });
  it('applyShift', () => {
    expect(applyShift('2026-01-31', { unit: 'month', n: 1 })).toBe('2026-02-28');
    expect(applyShift('2026-10-15', { unit: 'day', n: 14 })).toBe('2026-10-29');
  });
});

describe('parseRelativeOffset', () => {
  it.each([
    ['30분 뒤 전화', 30],
    ['2시간 뒤에 회의', 120],
    ['1시간 30분 후 약', 90],
    ['한 시간 반 뒤', 90],
    ['두 시간 뒤', 120],
  ])('%s -> %i min', (text, minutes) => {
    expect(parseRelativeOffset(text)?.minutes).toBe(minutes);
  });
  it('span covers the phrase; absent or zero -> null', () => {
    const r = parseRelativeOffset('약 30분 뒤에 먹기')!;
    expect('약 30분 뒤에 먹기'.slice(...r.span)).toBe('30분 뒤에');
    expect(parseRelativeOffset('내일 3시 회의')).toBeNull();
    expect(parseRelativeOffset('0분 뒤')).toBeNull();
  });
});
