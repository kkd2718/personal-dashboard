'use client';

import { useEffect, useState, type ReactNode } from 'react';

const TABS = [
  { value: 'queue', label: '개발 큐' },
  { value: 'papers', label: '논문' },
  { value: 'todo', label: '할 일' },
  { value: 'memo', label: '메모' },
] as const;

type TabKey = (typeof TABS)[number]['value'];

const STORAGE_KEY = 'cc-home-tab';
const DEFAULT_TAB: TabKey = 'todo';

function isTabKey(v: string | null | undefined): v is TabKey {
  return TABS.some((t) => t.value === v);
}

/**
 * Home v2 four-lane layout (PLAN_HOME2.md §Layout): desktop shows all four lanes
 * in a grid at once; phone shows one at a time behind sticky segmented tabs
 * (default 할 일), persisted to localStorage and `?tab=` (server-read, passed in
 * as `initialTab` so there's no client-only searchParams read / hydration risk).
 */
export function HomeLanes({
  initialTab,
  counts,
  queue,
  papers,
  todo,
  memo,
}: {
  initialTab?: string;
  counts: Record<TabKey, number>;
  queue: ReactNode;
  papers: ReactNode;
  todo: ReactNode;
  memo: ReactNode;
}) {
  const [tab, setTab] = useState<TabKey>(isTabKey(initialTab) ? initialTab : DEFAULT_TAB);

  useEffect(() => {
    if (isTabKey(initialTab)) return; // ?tab= already won, matches the server-rendered default
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time sync from localStorage on mount
      if (isTabKey(stored)) setTab(stored);
    } catch {
      // localStorage unavailable (private mode) -- keep the default tab
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- read once on mount only
  }, []);

  function selectTab(next: TabKey) {
    setTab(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // ignore
    }
  }

  const content: Record<TabKey, ReactNode> = { queue, papers, todo, memo };

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="sticky top-0 z-10 -mx-4 bg-background px-4 py-1.5 md:hidden">
        <div className="grid grid-cols-4 gap-1 rounded-[var(--r-sm)] border border-border p-0.5 text-xs">
          {TABS.map((t) => (
            <button
              key={t.value}
              type="button"
              aria-pressed={tab === t.value}
              onClick={() => selectTab(t.value)}
              className={`flex flex-col items-center gap-0.5 rounded-[calc(var(--r-sm)-2px)] px-1 py-1.5 transition ${
                tab === t.value ? 'bg-accent text-white' : 'text-foreground/70 hover:bg-foreground/5'
              }`}
            >
              <span className="truncate">{t.label}</span>
              <span className={tab === t.value ? 'text-white/80' : 'text-foreground/40'}>{counts[t.value]}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="grid min-w-0 items-start gap-3 md:grid-cols-2 lg:grid-cols-4">
        {TABS.map((t) => (
          <div key={t.value} className={`min-w-0 ${tab === t.value ? '' : 'hidden'} md:block`}>
            {content[t.value]}
          </div>
        ))}
      </div>
    </div>
  );
}
