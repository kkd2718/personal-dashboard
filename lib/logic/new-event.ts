// Pure: turns a parsed Korean date/time phrase into single-day calendar events.
import { addDaysStr } from '@/lib/logic/dates';
import { addMinutesKst, type KoDateTime } from '@/lib/logic/ko-datetime';

/** Single-day event; null times = all-day. */
export interface NewEvent {
  title: string;
  date: string;
  startTime: string | null;
  endTime: string | null;
}

/** Turns a parsed phrase into events (titles left empty for the caller). */
export function eventsFromParsed(p: KoDateTime, today: string, nowTime: string): NewEvent[] | { error: string } {
  const first = p.range?.start ?? p.times[0] ?? null;
  if (!p.date && first === null) return { error: '날짜를 찾지 못했어요' };
  const date = p.date ?? (first !== null && first > nowTime ? today : addDaysStr(today, 1));
  if (p.range) return [{ title: '', date, startTime: p.range.start, endTime: p.range.end }];
  if (p.times.length === 0) return [{ title: '', date, startTime: null, endTime: null }];
  return p.times.slice(0, 5).map((t) => {
    const end = addMinutesKst(date, t, p.durationMin ?? 60);
    return { title: '', date, startTime: t, endTime: end.date === date ? end.time : '23:59' };
  });
}
