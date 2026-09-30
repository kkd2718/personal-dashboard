import { describe, expect, it } from 'vitest';
import { activeRoutines, matchRoutine, routineStatus, routineStreak, SEED_ROUTINES, type RoutineItem } from './routines';

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
