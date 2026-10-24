'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Minus, Plus } from 'lucide-react';
import { setRoutineCountAction, toggleRoutineAction } from '@/app/actions/routines';

export interface RoutineRow {
  id: string;
  label: string;
  url: string | null;
  done: boolean;
  streak: number;
  /** Count routines only (null for checkbox routines). */
  count: number | null;
  unit: string | null;
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

  function setCount(id: string, count: number) {
    const next = Math.max(0, Math.min(999, count));
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, count: next, done: next > 0 } : r)));
    setRoutineCountAction(id, date, next)
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
            {r.count === null ? (
              <input
                id={`routine-${r.id}`}
                type="checkbox"
                checked={r.done}
                onChange={(e) => toggle(r.id, e.target.checked)}
                className="shrink-0"
              />
            ) : (
              <span className={`shrink-0 text-xs ${r.done ? 'text-green-600' : 'text-foreground/30'}`}>{r.done ? '✓' : '○'}</span>
            )}
            <span
              title={r.label}
              className={`min-w-0 flex-1 truncate ${r.done && r.count === null ? 'text-foreground/40 line-through' : ''}`}
            >
              {r.url ? (
                <a href={r.url} target="_blank" rel="noopener noreferrer" className="hover:underline">
                  {r.label}
                </a>
              ) : (
                <label htmlFor={`routine-${r.id}`}>{r.label}</label>
              )}
            </span>
            {r.count !== null && (
              <span className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  aria-label="하나 빼기"
                  onClick={() => setCount(r.id, r.count! - 1)}
                  disabled={r.count === 0}
                  className="rounded p-1 hover:bg-foreground/5 disabled:opacity-30"
                >
                  <Minus size={12} />
                </button>
                {/* Commits on blur/Enter so typing "12" doesn't send 1 then 12. */}
                <input
                  key={r.count}
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={999}
                  aria-label={`${r.label} 개수`}
                  defaultValue={r.count}
                  onBlur={(e) => {
                    const n = Number(e.target.value) || 0;
                    if (n !== r.count) setCount(r.id, n);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur();
                  }}
                  className="tnum w-12 rounded-md border border-border bg-transparent px-1 py-0.5 text-center text-sm"
                />
                {r.unit && <span className="text-xs text-foreground/50">{r.unit}</span>}
                <button
                  type="button"
                  aria-label="하나 더하기"
                  onClick={() => setCount(r.id, r.count! + 1)}
                  className="rounded p-1 hover:bg-foreground/5"
                >
                  <Plus size={12} />
                </button>
              </span>
            )}
            {r.streak > 1 && <span className="tnum shrink-0 text-xs text-foreground/50">🔥{r.streak}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}
