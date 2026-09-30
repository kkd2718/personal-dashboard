'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toggleRoutineAction } from '@/app/actions/routines';

export interface RoutineRow {
  id: string;
  label: string;
  url: string | null;
  done: boolean;
  streak: number;
}

/** 오늘 루틴 block above the home checklist: optimistic checkboxes, hidden when none are active. */
export function RoutineStrip({ date, routines }: { date: string; routines: RoutineRow[] }) {
  const router = useRouter();
  const [rows, setRows] = useState(routines);
  // Re-sync after a server refresh (same pattern as ChecklistPanel).
  const [syncedFrom, setSyncedFrom] = useState(routines);
  if (routines !== syncedFrom) {
    setSyncedFrom(routines);
    setRows(routines);
  }
  if (rows.length === 0) return null;

  function toggle(id: string, done: boolean) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, done } : r)));
    toggleRoutineAction(id, date, done)
      .then(() => router.refresh())
      .catch(() => router.refresh());
  }

  return (
    <section className="flex shrink-0 flex-col gap-1.5">
      <h3 className="text-xs font-medium text-foreground/50">
        오늘 루틴 ({rows.filter((r) => r.done).length}/{rows.length})
      </h3>
      <ul className="flex flex-col gap-1">
        {rows.map((r) => (
          <li key={r.id} className="flex items-center gap-2 rounded-lg border border-border bg-surface px-2.5 py-2 text-sm">
            <input
              id={`routine-${r.id}`}
              type="checkbox"
              checked={r.done}
              onChange={(e) => toggle(r.id, e.target.checked)}
              className="shrink-0"
            />
            <span className={`min-w-0 flex-1 truncate ${r.done ? 'text-foreground/40 line-through' : ''}`}>
              {r.url ? (
                <a href={r.url} target="_blank" rel="noopener noreferrer" className="hover:underline">
                  {r.label}
                </a>
              ) : (
                <label htmlFor={`routine-${r.id}`}>{r.label}</label>
              )}
            </span>
            {r.streak > 1 && <span className="tnum shrink-0 text-xs text-foreground/50">🔥{r.streak}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}
