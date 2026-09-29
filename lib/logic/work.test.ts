import { describe, expect, it } from 'vitest';
import { mergeShifts, parseShift, shiftsByDate, type WorkShiftsMeta } from './work';

describe('parseShift', () => {
  it('A1 on a weekday is 13층 1조 10:00-20:00', () => {
    const p = parseShift('A1', '2026-10-07'); // Wednesday
    expect(p).toMatchObject({ kind: 'work', floor: '13층', team: 1, start: '10:00', end: '20:00', swapped: false, short: 'A1' });
    expect(p.label).toBe('13층 1조 10:00–20:00');
  });

  it('B2 on a Saturday uses weekend hours', () => {
    const p = parseShift('B2', '2026-10-10');
    expect(p).toMatchObject({ floor: '14층', team: 2, start: '10:30', end: '18:30' });
  });

  it('Sunday is weekend too, in any year', () => {
    expect(parseShift('A1', '2026-10-11').end).toBe('18:00');
    expect(parseShift('A1', '2031-03-02').end).toBe('18:00'); // Sunday
    expect(parseShift('A1', '2031-03-03').end).toBe('20:00'); // Monday
    expect(parseShift('A2', '2027-01-01').end).toBe('20:30'); // Friday
  });

  it('off is off', () => {
    expect(parseShift('off', '2026-10-08')).toMatchObject({ kind: 'off', swapped: false, label: '휴무' });
  });

  it('swap annotation sets swapped and a label suffix', () => {
    const w = parseShift('A2(교환)', '2026-10-07');
    expect(w).toMatchObject({ kind: 'work', team: 2, swapped: true });
    expect(w.label).toBe('13층 2조 10:30–20:30 (교환)');
    expect(parseShift('off(교환)', '2026-10-07')).toMatchObject({ kind: 'off', swapped: true, label: '휴무 (교환)' });
  });

  it('unknown text is other with the text as label', () => {
    expect(parseShift('연차', '2026-10-07')).toMatchObject({ kind: 'other', label: '연차', swapped: false });
    expect(parseShift(' 학회 (교환) ', '2026-10-07')).toMatchObject({ kind: 'other', swapped: true });
  });
});

describe('mergeShifts', () => {
  const today = '2026-10-10';
  const at = '2026-10-10T00:00:00.000Z';
  const existing: WorkShiftsMeta = {
    at: 'old',
    shifts: [
      { date: '2026-09-01', code: 'A1' },
      { date: '2026-10-05', code: 'A1' },
      { date: '2026-10-06', code: 'B1' },
      { date: '2026-11-20', code: 'A2' },
    ],
  };

  it('replaces the window, keeps the rest, sorts', () => {
    const out = mergeShifts(existing, { from: '2026-10-01', to: '2026-10-31', shifts: [{ date: '2026-10-07', code: 'off' }] }, today, at);
    expect(out.at).toBe(at);
    expect(out.shifts.map((s) => s.date)).toEqual(['2026-09-01', '2026-10-07', '2026-11-20']);
  });

  it('works with no existing data', () => {
    const out = mergeShifts(null, { from: '2026-10-01', to: '2026-10-31', shifts: [{ date: '2026-10-02', code: 'A1' }] }, today, at);
    expect(out.shifts).toEqual([{ date: '2026-10-02', code: 'A1' }]);
  });

  it('drops shifts older than 120 days', () => {
    const old: WorkShiftsMeta = { at: 'x', shifts: [{ date: '2026-06-01', code: 'A1' }, { date: '2026-06-12', code: 'A1' }] };
    const out = mergeShifts(old, { from: '2026-10-01', to: '2026-10-31', shifts: [] }, today, at);
    expect(out.shifts.map((s) => s.date)).toEqual(['2026-06-12']); // cutoff 2026-06-12 inclusive
  });

  it('an incoming date outside the window still replaces the stored one (no duplicates)', () => {
    const out = mergeShifts(existing, { from: '2026-10-01', to: '2026-10-31', shifts: [{ date: '2026-09-01', code: 'B2' }] }, today, at);
    expect(out.shifts.filter((s) => s.date === '2026-09-01')).toEqual([{ date: '2026-09-01', code: 'B2' }]);
  });
});

describe('shiftsByDate', () => {
  it('indexes parsed shifts by date', () => {
    const m = shiftsByDate([{ date: '2026-10-07', code: 'A1' }]);
    expect(m.get('2026-10-07')?.short).toBe('A1');
    expect(m.get('2026-10-08')).toBeUndefined();
  });
});

describe('telegram workLine', () => {
  const today = '2026-10-07';
  it('work, off, and no data', async () => {
    const { workLine } = await import('@/lib/telegram/format');
    expect(workLine({ date: today, code: 'A1' }, today)).toBe('💼 근무 13층 1조 10:00–20:00');
    expect(workLine({ date: today, code: 'off' }, today)).toBe('🌿 오늘 휴무');
    expect(workLine(null, today)).toBeNull();
  });
  it('digest and /today put the shift line first', async () => {
    const { formatToday, formatDigest } = await import('@/lib/telegram/format');
    const empty = { overdue: [], today: [], soon: [], later: [] } as never;
    const shift = { date: today, code: 'B2' };
    expect(formatToday({ today, checklist: empty, upcoming: [], dayMemos: [], statusItems: [], workShift: shift })).toBe(
      '💼 근무 14층 2조 10:30–20:30'
    );
    expect(formatDigest({ today, deadlines: [], reviews: [], checklist: empty, statusItems: [], workShift: shift })).toBeNull();
  });
});
