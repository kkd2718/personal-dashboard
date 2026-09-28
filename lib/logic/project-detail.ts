import { relTime } from '@/lib/logic/dates';
import type { CcStatus } from '@/lib/types';

export interface ChecklistSummary {
  doing: string[];
  meOpen: number;
  open: number;
  total: number;
  blocked: number;
  nextDue: { text: string; due: string } | null;
}

/** Meta key a project's detail blob (open items + CcStatus) is stored under — see
 * app/api/ingest/route.ts (write) and app/(main)/projects/[slug]/page.tsx (read). */
export function projectDetailMetaKey(projectId: string): string {
  return `project:detail:${projectId}`;
}

/** "3시간 전 기록", or null when the status has no updatedAt to date it by. */
export function statusAgeLabel(status: CcStatus | null, now: string): string | null {
  if (!status?.updatedAt) return null;
  return `${relTime(status.updatedAt, now)} 기록`;
}

/** True when the status is missing an updatedAt, or it's older than `days` (default 7). */
export function isStatusStale(status: CcStatus | null, nowMs: number, days = 7): boolean {
  if (!status?.updatedAt) return true;
  const updatedMs = new Date(status.updatedAt).getTime();
  if (!Number.isFinite(updatedMs)) return true;
  return nowMs - updatedMs > days * 24 * 60 * 60 * 1000;
}

/** Summarizes a project's checklist for compact display (paper detail, home lanes,
 * project cards). Null when there's no checklist to summarize. */
export function checklistSummary(status: CcStatus | null, today: string): ChecklistSummary | null {
  const items = status?.checklist;
  if (!items || items.length === 0) return null;

  const doing = items.filter((c) => c.status === 'doing').map((c) => c.text);
  const open = items.filter((c) => c.status !== 'done');
  const meOpen = open.filter((c) => c.owner === 'me').length;
  const blocked = items.filter((c) => c.status === 'blocked').length;

  const dued = open
    .filter((c): c is typeof c & { due: string } => !!c.due)
    .sort((a, b) => a.due.localeCompare(b.due));
  const nextDueItem = dued.find((c) => c.due >= today) ?? dued[0] ?? null;

  return {
    doing,
    meOpen,
    open: open.length,
    total: items.length,
    blocked,
    nextDue: nextDueItem ? { text: nextDueItem.text, due: nextDueItem.due } : null,
  };
}

/** Compact one-liner for `checklistSummary` (paper cards, project rows, queue lane). */
export function checklistLine(summary: ChecklistSummary): string {
  let line: string;
  if (summary.doing.length > 0) {
    line = `진행 중: ${summary.doing[0]}`;
    if (summary.doing.length > 1) line += ` 외 ${summary.doing.length - 1}`;
  } else if (summary.nextDue) {
    const [, m, d] = summary.nextDue.due.split('-');
    line = `다음 마감 ${Number(m)}/${Number(d)} ${summary.nextDue.text}`;
  } else {
    line = `남은 ${summary.open}/${summary.total}`;
  }
  if (summary.meOpen > 0) line += ` · 내 할 일 ${summary.meOpen}`;
  return line;
}
