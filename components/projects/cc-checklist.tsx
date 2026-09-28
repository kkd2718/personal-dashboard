'use client';

import { useMemo, useState } from 'react';
import type { CcChecklistItem } from '@/lib/types';

type View = 'all' | 'me' | 'agent';

const VIEW_LABEL: Record<View, string> = { all: '전체', me: '내 할 일', agent: '에이전트' };

function countOpenTotal(items: CcChecklistItem[]): { open: number; total: number } {
  return { open: items.filter((c) => c.status !== 'done').length, total: items.length };
}

/** Groups items by section (in first-seen order, '기타' last for unsectioned),
 * doing before todo within a group; done items are returned separately. */
function groupBySection(items: CcChecklistItem[]): { section: string | null; items: CcChecklistItem[] }[] {
  const order: Array<string | null> = [];
  const bySection = new Map<string | null, CcChecklistItem[]>();
  for (const item of items) {
    if (!bySection.has(item.section)) {
      order.push(item.section);
      bySection.set(item.section, []);
    }
    bySection.get(item.section)!.push(item);
  }
  const rank = { doing: 0, blocked: 1, todo: 2, done: 3 };
  return order.map((section) => ({
    section,
    items: [...bySection.get(section)!].sort((a, b) => rank[a.status] - rank[b.status]),
  }));
}

/** Checklist block of the "현황" card: a 전체/내 할 일/에이전트 view switcher over a
 * project's docs/cc-status.json checklist, grouped by section (doing, blocked, then todo;
 * done items collapsed). Client component so the switcher can hold local state. */
export function CcChecklist({ items }: { items: CcChecklistItem[] }) {
  const [view, setView] = useState<View>('all');

  const counts = useMemo(
    () => ({
      all: countOpenTotal(items),
      me: countOpenTotal(items.filter((c) => c.owner === 'me')),
      agent: countOpenTotal(items.filter((c) => c.owner === 'agent')),
    }),
    [items]
  );

  const filtered = view === 'all' ? items : items.filter((c) => c.owner === view);
  const open = filtered.filter((c) => c.status !== 'done');
  const done = filtered.filter((c) => c.status === 'done');
  const groups = groupBySection(open);

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        {(['all', 'me', 'agent'] as const).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setView(v)}
            className={`rounded-full px-2.5 py-1 ${v === view ? 'bg-blue-600 text-white' : 'border border-border text-foreground/60'}`}
          >
            {VIEW_LABEL[v]} ({counts[v].open}/{counts[v].total})
          </button>
        ))}
      </div>

      {groups.map(({ section, items: sectionItems }) => (
        <div key={section ?? '__none__'} className="min-w-0">
          {section && <p className="text-xs text-foreground/50">{section}</p>}
          <ul className="flex flex-col gap-0.5">
            {sectionItems.map((c, i) => (
              <li key={i} className="flex min-w-0 items-start gap-1.5 break-words">
                <span
                  className={
                    c.status === 'doing'
                      ? 'text-blue-600 dark:text-blue-400'
                      : c.status === 'blocked'
                        ? 'text-amber-700 dark:text-amber-300'
                        : 'text-foreground/70'
                  }
                >
                  {c.text}
                </span>
                {c.status === 'blocked' && (
                  <span className="shrink-0 rounded bg-amber-500/15 px-1 text-[10px] text-amber-700 dark:text-amber-300">막힘</span>
                )}
                {c.due && (
                  <span className="tnum shrink-0 text-[11px] text-foreground/40">
                    ~{Number(c.due.slice(5, 7))}/{Number(c.due.slice(8, 10))}
                  </span>
                )}
                {view === 'all' && c.owner === 'me' && (
                  <span className="shrink-0 rounded bg-foreground/10 px-1 text-[10px] text-foreground/60">나</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}

      {done.length > 0 && (
        <details className="min-w-0">
          <summary className="cursor-pointer text-xs text-foreground/50">완료 {done.length}개</summary>
          <ul className="flex flex-col gap-0.5 pt-1 text-foreground/40 line-through">
            {done.map((c, i) => (
              <li key={i} className="min-w-0 break-words">{c.text}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
