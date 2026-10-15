// "New monthly shift sheet" detection (docs/PLAN_AX.md §8a). Pure.
import { weekdayOf } from '@/lib/logic/dates';
import type { NewEvent } from '@/lib/logic/new-event';
import { parseShift, type WorkShift } from '@/lib/logic/work';

export const WORK_ANNOUNCED_META_KEY = 'work:announced'; // { months: string[] /* 'YYYY-MM' */, seededAt: string }
/** A half-filled tab is not "out" yet. */
export const WORK_ANNOUNCE_MIN_DAYS = 20;

export interface WorkAnnounced {
  months: string[];
  seededAt: string;
}

/**
 * Months in `incoming` with at least `minDays` shift rows that are current or future and not
 * announced yet. `announced === null` (first run after deploy) announces nothing: the caller
 * seeds it with every month already known so a rollout never spams.
 */
export function monthsToAnnounce(
  incoming: WorkShift[],
  announced: string[] | null,
  today: string,
  minDays = WORK_ANNOUNCE_MIN_DAYS
): string[] {
  if (announced === null) return [];
  const counts = new Map<string, number>();
  for (const s of incoming) counts.set(s.date.slice(0, 7), (counts.get(s.date.slice(0, 7)) ?? 0) + 1);
  return [...counts.entries()]
    .filter(([month, n]) => n >= minDays && month >= today.slice(0, 7) && !announced.includes(month))
    .map(([month]) => month)
    .sort();
}

/** Months complete enough to count as already announced when seeding (a one-day spill from the
 * previous tab, e.g. 11/1 on the October sheet, must not mark November as announced). */
export function seedMonths(shifts: WorkShift[], minDays = WORK_ANNOUNCE_MIN_DAYS): string[] {
  const counts = new Map<string, number>();
  for (const s of shifts) counts.set(s.date.slice(0, 7), (counts.get(s.date.slice(0, 7)) ?? 0) + 1);
  return [...counts.entries()].filter(([, n]) => n >= minDays).map(([m]) => m).sort();
}

export interface ShiftMonthSummary {
  month: string;
  workDays: number;
  offDays: string[];
  weekendWork: Array<{ date: string; short: string }>;
  byShort: Record<string, number>;
  other: Array<{ date: string; label: string }>;
}

export function summarizeShiftMonth(month: string, shifts: WorkShift[]): ShiftMonthSummary {
  const out: ShiftMonthSummary = { month, workDays: 0, offDays: [], weekendWork: [], byShort: {}, other: [] };
  for (const s of shifts.filter((x) => x.date.startsWith(month)).sort((a, b) => a.date.localeCompare(b.date))) {
    const p = parseShift(s.code, s.date);
    if (p.kind === 'work') {
      out.workDays++;
      out.byShort[p.short] = (out.byShort[p.short] ?? 0) + 1;
      if ([0, 6].includes(weekdayOf(s.date))) out.weekendWork.push({ date: s.date, short: p.short });
    } else if (p.kind === 'off') out.offDays.push(s.date);
    else out.other.push({ date: s.date, label: p.label });
  }
  return out;
}

/** Owner convention: one timed `off` event per day off, 08:30-09:30 KST (not all-day). */
export function offDayEvents(summary: ShiftMonthSummary): NewEvent[] {
  return summary.offDays.map((date) => ({ title: 'off', date, startTime: '08:30', endTime: '09:30' }));
}
