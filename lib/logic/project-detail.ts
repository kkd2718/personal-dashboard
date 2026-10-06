import { addDaysStr, relTime } from '@/lib/logic/dates';
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

export interface DueChecklistItem {
  projectId?: string;
  project: string; // short project name ('동네시세 (realty-chart)' -> '동네시세')
  text: string;
  due: string;
  blocked: boolean;
}

export interface DueChecklist {
  overdue: DueChecklistItem[]; // due within the last `overdueDays` days, before today
  today: DueChecklistItem[];
  tomorrow: DueChecklistItem[];
}

/** app_meta key for project-checklist items the owner resolved from the dashboard home
 * (ticked done or marked "안 함") before the project's own session updated its file. */
export const RESOLVED_PROJECT_ITEMS_META_KEY = 'project-checklist:resolved';

export interface ResolvedProjectItem {
  state: 'done' | 'skip';
  at: string; // 'YYYY-MM-DD' (KST) when resolved
  noteId: string | null; // memo sent to the project's session inbox
}

export type ResolvedProjectItems = Record<string, ResolvedProjectItem>;

export function resolvedItemKey(projectId: string, text: string): string {
  return `${projectId}::${text}`;
}

/** Drops entries resolved more than `keepDays` ago — by then the project's session has
 * long since rewritten its checklist, so the override is dead weight. */
export function pruneResolved(map: ResolvedProjectItems, today: string, keepDays = 60): ResolvedProjectItems {
  const oldest = addDaysStr(today, -keepDays);
  return Object.fromEntries(Object.entries(map).filter(([, v]) => v.at >= oldest));
}

/** The owner's ("me") open project-checklist items (docs/cc-status.json) that are
 * overdue, due today or due tomorrow — for the Telegram digest and /today, which
 * otherwise only see dashboard tasks. Overdue items older than `overdueDays` are
 * dropped so long-stale entries don't flood every morning. */
export function meChecklistDue(
  entries: { projectId?: string; projectName: string; status: CcStatus | null }[],
  today: string,
  overdueDays = 7,
  hidden: ReadonlySet<string> = new Set()
): DueChecklist {
  const tomorrow = addDaysStr(today, 1);
  const oldest = addDaysStr(today, -overdueDays);
  const out: DueChecklist = { overdue: [], today: [], tomorrow: [] };
  for (const { projectId, projectName, status } of entries) {
    const project = projectName.replace(/\s*\(.*\)\s*$/, '').trim() || projectName;
    for (const c of status?.checklist ?? []) {
      if (c.owner !== 'me' || c.status === 'done' || !c.due) continue;
      if (projectId && hidden.has(resolvedItemKey(projectId, c.text))) continue;
      const item: DueChecklistItem = { projectId, project, text: c.text, due: c.due, blocked: c.status === 'blocked' };
      if (c.due === today) out.today.push(item);
      else if (c.due === tomorrow) out.tomorrow.push(item);
      else if (c.due < today && c.due >= oldest) out.overdue.push(item);
    }
  }
  out.overdue.sort((a, b) => a.due.localeCompare(b.due));
  return out;
}
