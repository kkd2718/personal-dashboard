// Owner's clinic work shifts (docs/PLAN_WORK_SCHEDULE.md). Pure, framework-free.
import { addDaysStr, startOfIsoWeek } from '@/lib/logic/dates';

export const WORK_SHIFTS_META_KEY = 'work:shifts';
const KEEP_DAYS = 120;

export interface WorkShift {
  date: string; // 'YYYY-MM-DD'
  code: string; // raw sheet cell, e.g. 'A1', 'off', 'A2(교환)'
}

export interface WorkShiftsMeta {
  at: string; // ISO time of the last sync
  shifts: WorkShift[];
}

export interface ParsedShift {
  kind: 'work' | 'off' | 'other';
  floor?: '13층' | '14층';
  team?: 1 | 2;
  start?: string;
  end?: string;
  swapped: boolean;
  /** Full text, e.g. '13층 1조 10:00–20:00 (교환)', '휴무', or the raw text. */
  label: string;
  /** Compact form for day cells: 'A1' for work, the raw text otherwise. */
  short: string;
}

/** Replaces stored shifts inside [incoming.from, incoming.to] with the incoming ones,
 * keeps the rest, drops anything older than 120 days before `today`, sorts by date. */
export function mergeShifts(
  existing: WorkShiftsMeta | null,
  incoming: { from: string; to: string; shifts: WorkShift[] },
  today: string,
  at: string
): WorkShiftsMeta {
  const cutoff = addDaysStr(today, -KEEP_DAYS);
  const byDate = new Map<string, WorkShift>();
  for (const s of existing?.shifts ?? []) {
    if (s.date >= incoming.from && s.date <= incoming.to) continue;
    byDate.set(s.date, s);
  }
  for (const s of incoming.shifts) byDate.set(s.date, s);
  const shifts = [...byDate.values()].filter((s) => s.date >= cutoff).sort((a, b) => a.date.localeCompare(b.date));
  return { at, shifts };
}

/** Saturday or Sunday, from the date string alone (no time zone, any year). */
function isWeekend(date: string): boolean {
  const monday = startOfIsoWeek(date);
  return date === addDaysStr(monday, 5) || date === addDaysStr(monday, 6);
}

/** Decodes a sheet cell. A/B = 13층/14층; 1조 10:00, 2조 10:30; weekday ends 20:00/20:30,
 * weekend 18:00/18:30. */
export function parseShift(code: string, date: string): ParsedShift {
  const text = code.trim();
  const swapped = text.includes('교환');
  const suffix = swapped ? ' (교환)' : '';
  const work = /^([AB])([12])\s*(\(.*\))?$/i.exec(text);
  if (work) {
    const floor = work[1].toUpperCase() === 'A' ? '13층' : '14층';
    const team = work[2] === '1' ? 1 : 2;
    const half = team === 1 ? '00' : '30';
    const start = `10:${half}`;
    const end = `${isWeekend(date) ? 18 : 20}:${half}`;
    return {
      kind: 'work',
      floor,
      team,
      start,
      end,
      swapped,
      label: `${floor} ${team}조 ${start}–${end}${suffix}`,
      short: `${work[1].toUpperCase()}${team}`,
    };
  }
  if (/^off\s*(\(.*\))?$/i.test(text)) return { kind: 'off', swapped, label: `휴무${suffix}`, short: 'off' };
  return { kind: 'other', swapped, label: text, short: text };
}

/** date -> parsed shift, for day-cell lookups. */
export function shiftsByDate(shifts: WorkShift[]): Map<string, ParsedShift> {
  return new Map(shifts.map((s) => [s.date, parseShift(s.code, s.date)]));
}
