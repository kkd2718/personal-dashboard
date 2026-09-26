'use client';

import { useState, useTransition } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { toggleDeadlineDoneAction } from '@/app/actions/deadlines';
import { DdayChip } from '@/components/dday-chip';
import { EmptyState } from '@/components/ui/empty-state';
import { Popover } from '@/components/ui/popover';
import type { UpcomingItem } from '@/lib/logic/upcoming';

/**
 * Right-rail "다가오는 30일" agenda (ux-advice.md §5.7): merges open deadlines +
 * pending reviews (see lib/logic/upcoming). Adding happens via the calendar's day
 * popover/sheet now, not a bottom form; only deadlines can be marked 완료 here
 * (reviews change status from the 논문 페이지).
 */
export function DeadlineList({ items }: { items: UpcomingItem[] }) {
  const [pending, startTransition] = useTransition();
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  if (items.length === 0) {
    return <EmptyState>30일 안에 마감이 없어요.</EmptyState>;
  }

  return (
    <ul className="flex flex-col gap-2">
      {items.map((item) => (
        <li key={item.id} className="group flex items-center gap-2 text-sm">
          <DdayChip n={item.dday} />
          <span className="min-w-0 flex-1 truncate">{item.title}</span>
          <span className="tnum shrink-0 text-xs text-foreground/40">{item.dueDate}</span>
          {item.origin === 'deadline' && (
            <Popover
              open={openMenuId === item.id}
              onClose={() => setOpenMenuId(null)}
              align="end"
              trigger={
                <button
                  type="button"
                  onClick={() => setOpenMenuId((cur) => (cur === item.id ? null : item.id))}
                  aria-label="더 보기"
                  className="rounded-md p-1 text-foreground/30 opacity-0 hover:bg-foreground/5 group-hover:opacity-100 group-focus-within:opacity-100"
                >
                  <MoreHorizontal size={14} />
                </button>
              }
            >
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  setOpenMenuId(null);
                  startTransition(async () => {
                    await toggleDeadlineDoneAction(item.originId, true);
                  });
                }}
                className="w-full rounded-[var(--r-sm)] px-2 py-1.5 text-left text-sm hover:bg-foreground/5"
              >
                완료로 표시
              </button>
            </Popover>
          )}
        </li>
      ))}
    </ul>
  );
}
