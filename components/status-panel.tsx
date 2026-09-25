'use client';

import { useState, useTransition } from 'react';
import { RefreshCw } from 'lucide-react';
import type { StatusItem } from '@/lib/status/types';

const SEVERITY_STYLE: Record<StatusItem['severity'], string> = {
  critical: 'border-red-300 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300',
  warn: 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300',
  info: 'border-border bg-foreground/[0.03] text-foreground/60',
  ok: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300',
};

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Only critical/warn items, for the mobile-collapsed view. */
export function urgentOnly(items: StatusItem[]): StatusItem[] {
  return items.filter((i) => i.severity === 'critical' || i.severity === 'warn');
}

export function StatusPanel({
  initialItems,
  checkedAt,
  mobileUrgentOnly = false,
}: {
  initialItems: StatusItem[];
  checkedAt: string;
  mobileUrgentOnly?: boolean;
}) {
  const [items, setItems] = useState(initialItems);
  const [lastChecked, setLastChecked] = useState(checkedAt);
  const [pending, startTransition] = useTransition();

  function refresh() {
    startTransition(async () => {
      try {
        const res = await fetch('/api/status');
        const data = (await res.json()) as { items: StatusItem[]; checkedAt: string };
        setItems(data.items);
        setLastChecked(data.checkedAt);
      } catch {
        // never throws visibly — leave stale data in place
      }
    });
  }

  const shown = mobileUrgentOnly ? urgentOnly(items) : items;

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">상황 체크</h2>
        <div className="flex items-center gap-2 text-[11px] text-foreground/40">
          <span>마지막 확인 {fmtTime(lastChecked)}</span>
          <button
            type="button"
            onClick={refresh}
            disabled={pending}
            className="rounded-md p-1 hover:bg-foreground/5"
            aria-label="새로고침"
          >
            <RefreshCw size={13} className={pending ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>
      {shown.length === 0 ? (
        <p className="text-xs text-foreground/40">이상 없음</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {shown.map((item) => (
            <li
              key={item.id}
              className={`flex flex-col gap-0.5 rounded-lg border px-2.5 py-1.5 text-xs ${SEVERITY_STYLE[item.severity]}`}
            >
              <span className="font-medium">{item.title}</span>
              {item.detail && <span className="opacity-80">{item.detail}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
