import { describe, expect, it } from 'vitest';
import {
  cleanParams,
  careErrorMessage,
  dayRecordChips,
  isMonthWithinRange,
  procedureStats,
  recordSummary,
  recordsByDate,
  suggestSeries,
} from './carenote';
import type { CareRecord, ParamSchema, ProcedureType } from '@/lib/carenote/types';

const schema: ParamSchema = {
  version: 1,
  fields: [
    { key: 'power', label: '출력', type: 'number', unit: 'mJ' },
    { key: 'note', label: '메모', type: 'text' },
    { key: 'areas', label: '부위', type: 'multiselect', options: ['볼', '턱'] },
    { key: 'units', label: '부위', type: 'region_units', regions: ['이마', '미간'] },
    { key: 'done', label: '완료', type: 'checkbox' },
  ],
};

function type(overrides: Partial<ProcedureType> = {}): ProcedureType {
  return {
    id: 1,
    name: '피코토닝',
    category: 'laser',
    paramSchema: schema,
    intervalMinDays: null,
    intervalMaxDays: null,
    seriesDefaultCount: null,
    seriesRestDays: null,
    sessionGraceDays: null,
    note: null,
    sortOrder: 0,
    active: true,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    ...overrides,
  };
}

function record(overrides: Partial<CareRecord> = {}): CareRecord {
  return {
    id: 1,
    personId: 1,
    procedureTypeId: 1,
    date: '2026-09-28',
    params: {},
    seriesIndex: null,
    seriesTotal: null,
    cost: null,
    note: null,
    createdAt: '2026-09-28',
    updatedAt: '2026-09-28',
    ...overrides,
  };
}

describe('cleanParams', () => {
  it('drops undefined, empty string, NaN, empty array, empty region map', () => {
    const out = cleanParams(schema, {
      power: NaN,
      note: '',
      areas: [],
      units: { 이마: 0, 미간: 0 },
      done: false,
    });
    expect(out).toEqual({ done: false });
  });

  it('drops keys not in the schema', () => {
    const out = cleanParams(schema, { power: 100, unknown: 'x' } as never);
    expect(out).toEqual({ power: 100 });
  });

  it('keeps valid values, strips zero entries from region maps', () => {
    const out = cleanParams(schema, { power: 100, units: { 이마: 5, 미간: 0 } });
    expect(out).toEqual({ power: 100, units: { 이마: 5 } });
  });
});

describe('suggestSeries', () => {
  it('returns null when the type has no seriesDefaultCount', () => {
    expect(suggestSeries(type(), [], 1, '2026-09-28')).toBeNull();
  });

  it('suggests index 1 when there are no prior records', () => {
    const t = type({ seriesDefaultCount: 5 });
    expect(suggestSeries(t, [], 1, '2026-09-28')).toEqual({ seriesIndex: 1, seriesTotal: 5 });
  });

  it('suggests the next index after an in-progress series', () => {
    const t = type({ seriesDefaultCount: 5 });
    const records = [record({ id: 1, date: '2026-09-01', seriesIndex: 2, seriesTotal: 5 })];
    expect(suggestSeries(t, records, 1, '2026-09-28')).toEqual({ seriesIndex: 3, seriesTotal: 5 });
  });

  it('restarts at index 1 after a completed series', () => {
    const t = type({ seriesDefaultCount: 5 });
    const records = [record({ id: 1, date: '2026-09-01', seriesIndex: 5, seriesTotal: 5 })];
    expect(suggestSeries(t, records, 1, '2026-09-28')).toEqual({ seriesIndex: 1, seriesTotal: 5 });
  });

  it('only considers the same person and procedure type', () => {
    const t = type({ id: 1, seriesDefaultCount: 5 });
    const records = [
      record({ id: 1, personId: 2, date: '2026-09-01', seriesIndex: 3, seriesTotal: 5 }),
      record({ id: 2, procedureTypeId: 9, date: '2026-09-01', seriesIndex: 3, seriesTotal: 5 }),
    ];
    expect(suggestSeries(t, records, 1, '2026-09-28')).toEqual({ seriesIndex: 1, seriesTotal: 5 });
  });
});

describe('recordSummary', () => {
  it('joins name, up to 3 non-empty params, and series', () => {
    const t = type();
    const r = record({ params: { power: 1200 }, seriesIndex: 2, seriesTotal: 5 });
    expect(recordSummary(t, r)).toBe('피코토닝 · 출력 1200mJ · 2/5회');
  });

  it('renders region_units as "부위 n" pairs', () => {
    const t = type();
    const r = record({ params: { units: { 이마: 10, 미간: 5 } } });
    expect(recordSummary(t, r)).toBe('피코토닝 · 이마 10 미간 5');
  });

  it('joins multiselect with a middle dot', () => {
    const t = type();
    const r = record({ params: { areas: ['볼', '턱'] } });
    expect(recordSummary(t, r)).toBe('피코토닝 · 볼·턱');
  });

  it('shows checkbox label only when true', () => {
    const t = type();
    expect(recordSummary(t, record({ params: { done: true } }))).toBe('피코토닝 · 완료');
    expect(recordSummary(t, record({ params: { done: false } }))).toBe('피코토닝');
  });

  it('caps at 3 params', () => {
    const t = type({
      paramSchema: {
        version: 1,
        fields: [
          { key: 'a', label: 'A', type: 'text' },
          { key: 'b', label: 'B', type: 'text' },
          { key: 'c', label: 'C', type: 'text' },
          { key: 'd', label: 'D', type: 'text' },
        ],
      },
    });
    const r = record({ params: { a: '1', b: '2', c: '3', d: '4' } });
    expect(recordSummary(t, r)).toBe('피코토닝 · A 1 · B 2 · C 3');
  });
});

describe('recordsByDate', () => {
  it('groups records by date', () => {
    const records = [
      record({ id: 1, date: '2026-09-01' }),
      record({ id: 2, date: '2026-09-01' }),
      record({ id: 3, date: '2026-09-02' }),
    ];
    const map = recordsByDate(records);
    expect(map.get('2026-09-01')?.map((r) => r.id)).toEqual([1, 2]);
    expect(map.get('2026-09-02')?.map((r) => r.id)).toEqual([3]);
  });
});

describe('procedureStats', () => {
  it('has no status/window when the type has no interval', () => {
    const t = type({ intervalMinDays: null, intervalMaxDays: null });
    const stats = procedureStats([record({ date: '2026-09-01' })], [t], '2026-09-28');
    expect(stats).toEqual([
      { personId: 1, procedureTypeId: 1, typeName: '피코토닝', lastDate: '2026-09-01', count: 1, nextFrom: null, nextTo: null, status: null },
    ]);
  });

  it('marks available when today is within [last+min, last+max]', () => {
    const t = type({ intervalMinDays: 10, intervalMaxDays: 20 });
    const stats = procedureStats([record({ date: '2026-09-01' })], [t], '2026-09-15');
    expect(stats[0]).toMatchObject({ nextFrom: '2026-09-11', nextTo: '2026-09-21', status: 'available' });
  });

  it('marks overdue when today is past last+max', () => {
    const t = type({ intervalMinDays: 10, intervalMaxDays: 20 });
    const stats = procedureStats([record({ date: '2026-09-01' })], [t], '2026-09-25');
    expect(stats[0]).toMatchObject({ status: 'overdue' });
  });

  it('keeps overdue through 30 days past last+max, then drops the status', () => {
    const t = type({ intervalMinDays: 10, intervalMaxDays: 20 });
    // nextTo = 2026-09-21 → overdue until 2026-10-21, null from 2026-10-22
    expect(procedureStats([record({ date: '2026-09-01' })], [t], '2026-10-21')[0]).toMatchObject({ status: 'overdue' });
    expect(procedureStats([record({ date: '2026-09-01' })], [t], '2026-10-22')[0]).toMatchObject({ status: null });
  });

  it('marks upcoming when today is before last+min', () => {
    const t = type({ intervalMinDays: 10, intervalMaxDays: 20 });
    const stats = procedureStats([record({ date: '2026-09-01' })], [t], '2026-09-05');
    expect(stats[0]).toMatchObject({ status: 'upcoming' });
  });

  it('groups multiple persons separately and sorts overdue first', () => {
    const t = type({ id: 1, intervalMinDays: 10, intervalMaxDays: 20 });
    const records = [
      record({ id: 1, personId: 1, date: '2026-09-01' }), // overdue by 2026-09-28
      record({ id: 2, personId: 2, date: '2026-09-20' }), // upcoming
    ];
    const stats = procedureStats(records, [t], '2026-09-28');
    expect(stats).toHaveLength(2);
    expect(stats[0]).toMatchObject({ personId: 1, status: 'overdue' });
    expect(stats[1]).toMatchObject({ personId: 2, status: 'upcoming' });
  });

  it('skips records whose procedure type is not in the given types list', () => {
    const stats = procedureStats([record({ procedureTypeId: 99 })], [type()], '2026-09-28');
    expect(stats).toEqual([]);
  });
});

describe('dayRecordChips', () => {
  it('shows all records with no overflow when at or under the cap', () => {
    const records = [record({ id: 1 }), record({ id: 2 })];
    expect(dayRecordChips(records)).toEqual({ shown: records, overflowCount: 0 });
  });

  it('caps at max and reports overflow', () => {
    const records = [record({ id: 1 }), record({ id: 2 }), record({ id: 3 }), record({ id: 4 })];
    const { shown, overflowCount } = dayRecordChips(records, 3);
    expect(shown).toEqual(records.slice(0, 3));
    expect(overflowCount).toBe(1);
  });

  it('handles empty input', () => {
    expect(dayRecordChips([])).toEqual({ shown: [], overflowCount: 0 });
  });
});

describe('isMonthWithinRange', () => {
  it('is true when the whole month is inside the range', () => {
    expect(isMonthWithinRange('2026-09-15', '2026-08-01', '2026-10-31')).toBe(true);
  });

  it('is true when the range boundary lands exactly on the month edges', () => {
    expect(isMonthWithinRange('2026-09-01', '2026-09-01', '2026-09-30')).toBe(true);
  });

  it('is false when the month start is before the range', () => {
    expect(isMonthWithinRange('2026-09-01', '2026-09-15', '2026-10-31')).toBe(false);
  });

  it('is false when the month end is after the range', () => {
    expect(isMonthWithinRange('2026-09-30', '2026-08-01', '2026-09-15')).toBe(false);
  });
});

describe('careErrorMessage', () => {
  it('maps every known code to a Korean message', () => {
    expect(careErrorMessage({ code: 'unauthorized', message: 'x', status: 401 })).toMatch(/토큰/);
    expect(careErrorMessage({ code: 'rate_limited', message: 'x', status: 429 })).toMatch(/잠시 후/);
    expect(careErrorMessage({ code: 'unreachable', message: 'x', status: 0 })).toMatch(/연결할 수 없어요/);
    expect(careErrorMessage({ code: 'internal', message: 'x', status: 500 })).toMatch(/연결할 수 없어요/);
    expect(careErrorMessage({ code: 'validation', message: 'x', status: 400 })).toMatch(/입력값/);
  });

  it('passes the server message through for not_found', () => {
    expect(careErrorMessage({ code: 'not_found', message: '알 수 없는 personId', status: 404 })).toBe(
      '알 수 없는 personId'
    );
  });
});
