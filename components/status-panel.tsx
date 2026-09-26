'use client';

import { useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { ChevronDown, RefreshCw } from 'lucide-react';
import type { Project } from '@/lib/types';
import type { StatusItem } from '@/lib/status/types';

// Light mode: soft filled card. Dark mode never fills a solid color slab
// (ux-advice.md §3) — a 3px left border + tinted text on the surface color instead.
const SEVERITY_STYLE: Record<StatusItem['severity'], string> = {
  critical:
    'border-red-300 bg-red-50 text-red-700 dark:border-border dark:border-l-[3px] dark:border-l-danger dark:bg-surface dark:text-danger',
  warn: 'border-amber-300 bg-amber-50 text-amber-700 dark:border-border dark:border-l-[3px] dark:border-l-warn dark:bg-surface dark:text-warn',
  info: 'border-border bg-foreground/[0.03] text-foreground/60',
  ok: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-border dark:border-l-[3px] dark:border-l-success dark:bg-surface dark:text-success',
};

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Only critical/warn items, for the mobile-collapsed view. */
export function urgentOnly(items: StatusItem[]): StatusItem[] {
  return items.filter((i) => i.severity === 'critical' || i.severity === 'warn');
}

const STALE_MS = 3 * 60 * 60 * 1000;

export function StatusPanel({
  initialItems,
  checkedAt,
  remote = false,
  mobileUrgentOnly = false,
  projects = [],
}: {
  initialItems: StatusItem[];
  checkedAt: string;
  /** True when items come from the last /api/ingest snapshot (cloud, LOCAL_PROBES=0), not a live probe. */
  remote?: boolean;
  mobileUrgentOnly?: boolean;
  /** Resolves item.projectId to a project link (§5.1: "each item links to its project"). */
  projects?: Project[];
}) {
  const [items, setItems] = useState(initialItems);
  const [lastChecked, setLastChecked] = useState(checkedAt);
  const [pending, startTransition] = useTransition();
  const [showCalm, setShowCalm] = useState(false);

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

  // Date.now() is impure, so staleness is computed in an effect (client-only,
  // re-checked every minute) rather than during render.
  const [stale, setStale] = useState(false);
  useEffect(() => {
    if (!remote) return;
    function check() {
      setStale(Date.now() - new Date(lastChecked).getTime() > STALE_MS);
    }
    check();
    const id = setInterval(check, 60_000);
    return () => clearInterval(id);
  }, [remote, lastChecked]);

  const shownMobile = urgentOnly(items);
  // Desktop: loud items (critical/warn) always open; info/ok collapse behind one toggle line (§5.1).
  const loud = items.filter((i) => i.severity === 'critical' || i.severity === 'warn');
  const calm = items.filter((i) => i.severity === 'info' || i.severity === 'ok');
  const shownDesktop = showCalm ? items : loud;
  const shown = mobileUrgentOnly ? shownMobile : shownDesktop;
  const slugById = new Map(projects.map((p) => [p.id, p.slug]));

  function ItemRow({ item }: { item: StatusItem }) {
    const body = (
      <>
        <span className="wrap-anywhere font-medium">{item.title}</span>
        {item.detail && <span className="wrap-anywhere opacity-80">{item.detail}</span>}
      </>
    );
    const className = `flex min-w-0 flex-col gap-0.5 rounded-lg border px-2.5 py-1.5 text-xs ${SEVERITY_STYLE[item.severity]}`;
    const slug = item.projectId ? slugById.get(item.projectId) : undefined;
    return (
      <li>
        {slug ? (
          <Link href={`/projects/${slug}`} className={`${className} hover:opacity-80`}>
            {body}
          </Link>
        ) : (
          <div className={className}>{body}</div>
        )}
      </li>
    );
  }

  return (
    <div className="flex h-full min-w-0 flex-col gap-2 rounded-xl border border-border bg-surface p-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">상황</h2>
        <div className="flex items-center gap-2 text-[11px] text-foreground/40">
          {remote ? (
            <span
              className={
                stale
                  ? 'rounded-full border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300'
                  : ''
              }
            >
              PC 기준 {fmtTime(lastChecked)}
            </span>
          ) : (
            <span>마지막 확인 {fmtTime(lastChecked)}</span>
          )}
          <button
            type="button"
            onClick={refresh}
            disabled={pending}
            className="flex h-[26px] w-[26px] items-center justify-center rounded-md hover:bg-foreground/5"
            aria-label="새로고침"
          >
            <RefreshCw size={13} className={pending ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>
      <div className="min-h-0 min-w-0 flex-1 overflow-auto">
        {items.length === 0 ? (
          <p className="text-xs text-foreground/40">모두 정상이에요 · {remote ? 'PC 기준' : '마지막 확인'} {fmtTime(lastChecked)}</p>
        ) : (
          <ul className="flex min-w-0 flex-col gap-1.5">
            {shown.map((item) => (
              <ItemRow key={item.id} item={item} />
            ))}
            {!mobileUrgentOnly && !showCalm && calm.length > 0 && (
              <li>
                <button
                  type="button"
                  onClick={() => setShowCalm(true)}
                  className="flex items-center gap-1 px-2.5 py-1 text-xs text-foreground/40 hover:text-foreground/70"
                >
                  그 외 {calm.length}개 정상 <ChevronDown size={12} />
                </button>
              </li>
            )}
          </ul>
        )}
      </div>
    </div>
  );
}
