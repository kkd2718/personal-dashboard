'use client';

import { useMemo, useState } from 'react';
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  startOfMonth,
  startOfWeek,
  subMonths,
} from 'date-fns';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { Deadline } from '@/lib/types';

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

export function MonthCalendar({ deadlines, today }: { deadlines: Deadline[]; today: string }) {
  const [cursor, setCursor] = useState(() => new Date(`${today}T00:00:00`));

  const days = useMemo(() => {
    const start = startOfWeek(startOfMonth(cursor));
    const end = endOfWeek(endOfMonth(cursor));
    return eachDayOfInterval({ start, end });
  }, [cursor]);

  const byDate = useMemo(() => {
    const map = new Map<string, Deadline[]>();
    for (const d of deadlines) {
      const list = map.get(d.dueDate) ?? [];
      list.push(d);
      map.set(d.dueDate, list);
    }
    return map;
  }, [deadlines]);

  return (
    <div className="rounded-xl border border-border bg-surface p-3">
      <div className="mb-2 flex items-center justify-between">
        <button type="button" onClick={() => setCursor((c) => subMonths(c, 1))} aria-label="이전 달">
          <ChevronLeft size={16} />
        </button>
        <span className="text-sm font-medium">{format(cursor, 'yyyy년 M월')}</span>
        <button type="button" onClick={() => setCursor((c) => addMonths(c, 1))} aria-label="다음 달">
          <ChevronRight size={16} />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-foreground/50">
        {WEEKDAYS.map((w) => (
          <div key={w}>{w}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {days.map((day) => {
          const key = format(day, 'yyyy-MM-dd');
          const items = byDate.get(key) ?? [];
          const isToday = isSameDay(day, new Date(`${today}T00:00:00`));
          return (
            <div
              key={key}
              className={`flex min-h-14 flex-col rounded-md p-1 text-[11px] ${
                isSameMonth(day, cursor) ? '' : 'text-foreground/30'
              } ${isToday ? 'bg-blue-600/10' : ''}`}
            >
              <span className={isToday ? 'font-semibold text-blue-600' : ''}>{format(day, 'd')}</span>
              {items.slice(0, 2).map((d) => (
                <span key={d.id} className="truncate rounded bg-foreground/10 px-1 text-[10px]">
                  {d.title}
                </span>
              ))}
              {items.length > 2 && <span className="text-[10px] text-foreground/40">+{items.length - 2}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
