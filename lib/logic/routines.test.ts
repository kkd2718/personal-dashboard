import { describe, expect, it } from 'vitest';
import {
  activeRoutines,
  doneAfterCount,
  formatRoutineCount,
  matchRoutine,
  nextRoutineCount,
  parseDoneArg,
  routineStatus,
  routineStreak,
  SEED_ROUTINES,
  type RoutineItem,
} from './routines';

const item = (o: Partial<RoutineItem>): RoutineItem => ({
  id: 'a',
  label: 'A',
  url: null,
  startDate: '2026-10-01',
  endDate: null,
  sort: 0,
  ...o,
});

describe('activeRoutines', () => {
  it('honours start/end dates and sorts', () => {
    const items = [
      item({ id: 'late', sort: 2 }),
      item({ id: 'future', startDate: '2026-11-01' }),
      item({ id: 'ended', endDate: '2026-10-01', sort: 5 }),
      item({ id: 'first', sort: 0 }),
    ];
    expect(activeRoutines(items, '2026-10-02').map((r) => r.id)).toEqual(['first', 'late']);
    expect(activeRoutines(items, '2026-10-01').map((r) => r.id)).toEqual(['first', 'late', 'ended']);
    expect(activeRoutines(items, '2026-09-30')).toEqual([]);
  });
});

describe('routineStatus', () => {
  it('marks done ids', () => {
    const s = routineStatus(SEED_ROUTINES, ['amgi-daily'], '2026-10-01');
    expect(s.map((x) => x.done)).toEqual([false, true]);
  });
});

describe('matchRoutine', () => {
  it('matches index and label substring; null when ambiguous or missing', () => {
    expect(matchRoutine(SEED_ROUTINES, '1')?.id).toBe('allen-daily');
    expect(matchRoutine(SEED_ROUTINES, '2')?.id).toBe('amgi-daily');
    expect(matchRoutine(SEED_ROUTINES, '3')).toBeNull();
    expect(matchRoutine(SEED_ROUTINES, '0')).toBeNull();
    expect(matchRoutine(SEED_ROUTINES, '알렌')?.id).toBe('allen-daily');
    expect(matchRoutine(SEED_ROUTINES, ' 암기 ')?.id).toBe('amgi-daily');
    expect(matchRoutine(SEED_ROUTINES, '오늘')).toBeNull(); // both labels contain it
    expect(matchRoutine(SEED_ROUTINES, '없음')).toBeNull();
    expect(matchRoutine(SEED_ROUTINES, '')).toBeNull();
  });
  it('is case-insensitive', () => {
    expect(matchRoutine([item({ label: 'Amgi Study' })], 'AMGI')?.id).toBe('a');
  });
});

describe('routineStreak', () => {
  const done = { '2026-10-01': ['a'], '2026-10-02': ['a'], '2026-10-03': ['a'], '2026-09-29': ['a'] };
  it('counts through today when done', () => expect(routineStreak(done, 'a', '2026-10-03')).toBe(3));
  it('counts up to yesterday when today is pending', () => expect(routineStreak(done, 'a', '2026-10-04')).toBe(3));
  it('breaks on a gap', () => expect(routineStreak(done, 'a', '2026-10-06')).toBe(0));
  it('is per routine', () => expect(routineStreak(done, 'b', '2026-10-03')).toBe(0));
});

describe('count routines', () => {
  const counted = item({ id: 'v', kind: 'count', unit: '문제' });

  it('routineStatus: done when count > 0 and carries the count', () => {
    expect(routineStatus([counted], [], '2026-10-13', { v: 3 })[0]).toMatchObject({ done: true, count: 3 });
    expect(routineStatus([counted], [], '2026-10-13', {})[0]).toMatchObject({ done: false, count: 0 });
    // Without counts loaded (evening reminder) the synced done list still counts.
    expect(routineStatus([counted], ['v'], '2026-10-13')[0].done).toBe(true);
    expect(routineStatus([item({})], [], '2026-10-13', { a: 5 })[0].count).toBeUndefined();
  });

  it('nextRoutineCount adds/sets and clamps', () => {
    expect(nextRoutineCount(2, { add: 5 })).toBe(7);
    expect(nextRoutineCount(2, { add: -5 })).toBe(0);
    expect(nextRoutineCount(2, { set: 12 })).toBe(12);
    expect(nextRoutineCount(990, { add: 50 })).toBe(999);
  });

  it('doneAfterCount syncs the done list', () => {
    expect(doneAfterCount(['a'], 'v', 3)).toEqual(['a', 'v']);
    expect(doneAfterCount(['a', 'v'], 'v', 4)).toEqual(['a', 'v']);
    expect(doneAfterCount(['a', 'v'], 'v', 0)).toEqual(['a']);
  });

  it('formatRoutineCount', () => {
    expect(formatRoutineCount(counted, 12)).toBe('12문제');
    expect(formatRoutineCount(item({}), 4)).toBe('4');
  });

  it('parseDoneArg splits a trailing count but keeps a lone index', () => {
    expect(parseDoneArg('알렌 5')).toEqual({ query: '알렌', change: { add: 5 } });
    expect(parseDoneArg('1 +3')).toEqual({ query: '1', change: { add: 3 } });
    expect(parseDoneArg('알렌 =12')).toEqual({ query: '알렌', change: { set: 12 } });
    expect(parseDoneArg('2')).toEqual({ query: '2', change: null });
    expect(parseDoneArg(' 알렌 ')).toEqual({ query: '알렌', change: null });
  });
});
