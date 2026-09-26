'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CalendarDays } from 'lucide-react';
import { calendarVisibilityOptions } from '@/lib/logic/calendar';
import { setVisibleCalendarsAction } from '@/app/actions/calendar';
import { Chip } from '@/components/ui/chip';
import { EmptyState } from '@/components/ui/empty-state';
import type { CalendarEvent } from '@/lib/types';

/** 캘린더 표시 section (§5.8): same visible-calendar state the calendar header
 * toggles (app_meta 'calendar:visible'), editable here too. */
export function CalendarVisibilitySettings({
  googleEvents,
  visibleCalendars,
}: {
  googleEvents: CalendarEvent[];
  visibleCalendars: string[] | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const options = useMemo(() => calendarVisibilityOptions(googleEvents), [googleEvents]);
  const [optimistic, setOptimistic] = useState<string[] | null>(null);
  const effectiveVisible =
    optimistic ?? visibleCalendars ?? options.filter((o) => o.defaultVisible).map((o) => o.name);

  function toggle(name: string) {
    const next = effectiveVisible.includes(name)
      ? effectiveVisible.filter((n) => n !== name)
      : [...effectiveVisible, name];
    setOptimistic(next);
    startTransition(async () => {
      await setVisibleCalendarsAction(next);
      router.refresh();
    });
  }

  if (options.length === 0) return <EmptyState>연결된 Google 캘린더가 없어요.</EmptyState>;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <CalendarDays size={14} className="text-foreground/30" />
      {options.map((o) => {
        const on = effectiveVisible.includes(o.name);
        return (
          <button key={o.name} type="button" disabled={pending} onClick={() => toggle(o.name)}>
            <Chip tone={on ? 'accent' : 'neutral'} className="cursor-pointer disabled:opacity-40">
              {o.name}
            </Chip>
          </button>
        );
      })}
    </div>
  );
}
