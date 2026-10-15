// Sunday weekly review (docs/PLAN_AX.md §8): what slipped, what went stale, which
// deadlines cluster next week. Pure.
import { addDaysStr, dday, kstDateTime, weekdayOf } from '@/lib/logic/dates';
import { encodeCallback } from '@/lib/logic/ax-proposal';
import type { DueChecklist } from '@/lib/logic/project-detail';
import type { InlineKeyboard } from '@/lib/telegram/client';
import { escapeHtml } from '@/lib/telegram/format';
import type { Deadline, Project, Task } from '@/lib/types';

export type WeeklyItemRef =
  | { kind: 'task'; id: string }
  | { kind: 'deadline'; id: string }
  | { kind: 'project'; projectId: string; text: string };

export interface WeeklyItem {
  ref: WeeklyItemRef;
  section: 'overdue' | 'stale' | 'project';
  title: string;
  project: string | null;
  due: string | null;
  state: 'open' | 'done' | 'postponed' | 'dropped';
  hint?: 'keep' | 'postpone' | 'drop';
}

export interface WeeklyReview {
  items: WeeklyItem[];
  more: number;
  clusters: Array<{ from: string; to: string; titles: string[] }>;
}

export const WEEKLY_MAX_ITEMS = 10;
export const WEEKLY_TTL_HOURS = 72;
const STALE_DAYS = 14;

export function isSunday(today: string): boolean {
  return weekdayOf(today) === 0;
}

const byDueThenTitle = (a: WeeklyItem, b: WeeklyItem) =>
  (a.due ?? '9999').localeCompare(b.due ?? '9999') || a.title.localeCompare(b.title);

/** Open deadlines within `days` days from today that sit on the same or consecutive days (>= 2 per chain). */
export function deadlineClusters(deadlines: Deadline[], today: string, days = 7): WeeklyReview['clusters'] {
  const end = addDaysStr(today, days);
  const upcoming = deadlines
    .filter((d) => !d.done && d.dueDate >= today && d.dueDate <= end)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const chains: Deadline[][] = [];
  for (const d of upcoming) {
    const last = chains.at(-1);
    if (last && dday(d.dueDate, last[last.length - 1].dueDate) <= 1) last.push(d);
    else chains.push([d]);
  }
  return chains
    .filter((c) => c.length >= 2)
    .map((c) => ({ from: c[0].dueDate, to: c[c.length - 1].dueDate, titles: c.map((d) => d.title) }));
}

export function buildWeeklyReview(input: {
  today: string;
  tasks: Task[];
  deadlines: Deadline[];
  projectDue: DueChecklist;
  projects: Project[];
}): WeeklyReview {
  const { today, tasks, deadlines, projectDue, projects } = input;
  const nameOf = (id: string | null) => (id ? (projects.find((p) => p.id === id)?.name ?? null) : null);
  const mine = tasks.filter((t) => t.assignee !== 'agent' && t.status !== 'done');
  const staleBefore = addDaysStr(today, -STALE_DAYS);

  const overdueDeadlines: WeeklyItem[] = deadlines
    .filter((d) => !d.done && d.dueDate < today)
    .map((d) => ({
      ref: { kind: 'deadline' as const, id: d.id },
      section: 'overdue' as const,
      title: d.title,
      project: nameOf(d.projectId),
      due: d.dueDate,
      state: 'open' as const,
    }))
    .sort(byDueThenTitle);
  const overdueTasks: WeeklyItem[] = mine
    .filter((t) => t.dueDate !== null && t.dueDate < today)
    .map((t) => ({
      ref: { kind: 'task' as const, id: t.id },
      section: 'overdue' as const,
      title: t.title,
      project: nameOf(t.projectId),
      due: t.dueDate,
      state: 'open' as const,
    }))
    .sort(byDueThenTitle);
  const projectItems: WeeklyItem[] = projectDue.overdue
    .filter((p) => p.projectId)
    .map((p) => ({
      ref: { kind: 'project' as const, projectId: p.projectId as string, text: p.text },
      section: 'project' as const,
      title: p.text,
      project: p.project,
      due: p.due,
      state: 'open' as const,
    }))
    .sort(byDueThenTitle);
  const stale: WeeklyItem[] = mine
    .filter((t) => (t.dueDate === null || t.dueDate >= today) && kstDateTime(t.updatedAt).date <= staleBefore)
    .map((t) => ({
      ref: { kind: 'task' as const, id: t.id },
      section: 'stale' as const,
      title: t.title,
      project: nameOf(t.projectId),
      due: t.dueDate,
      state: 'open' as const,
    }))
    .sort(byDueThenTitle);

  const all = [...overdueDeadlines, ...overdueTasks, ...projectItems, ...stale];
  return {
    items: all.slice(0, WEEKLY_MAX_ITEMS),
    more: Math.max(0, all.length - WEEKLY_MAX_ITEMS),
    clusters: deadlineClusters(deadlines, today),
  };
}

const MARK: Record<WeeklyItem['state'], string> = { open: '', done: '✅ ', postponed: '⏩ ', dropped: '✖ ' };
const HINT: Record<NonNullable<WeeklyItem['hint']>, string> = { keep: '', postpone: ' ⏩?', drop: ' 🗑?' };
/** Shortens before escaping so an HTML entity is never cut in half. */
const clip = (text: string, max = 80) => escapeHtml(text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8))}`;

export function formatWeekly(r: WeeklyReview, today: string): string {
  const lines = ['<b>🗓 주간 점검</b>'];
  r.items.forEach((item, i) => {
    const bits = [clip(item.title)];
    if (item.project) bits.push(clip(item.project, 40));
    if (item.due) {
      const late = dday(today, item.due);
      bits.push(late > 0 ? `마감 ${md(item.due)} (${late}일 지남)` : `마감 ${md(item.due)}`);
    } else if (item.section === 'stale') bits.push('2주 넘게 그대로');
    lines.push(`${i + 1}. ${MARK[item.state]}${bits.join(' · ')}${item.hint ? HINT[item.hint] : ''}`);
  });
  if (r.more > 0) lines.push(`…외 ${r.more}건 (대시보드에서 확인)`);
  for (const c of r.clusters) {
    const range = c.from === c.to ? md(c.from) : `${md(c.from)}–${md(c.to)}`;
    lines.push(`📌 마감 몰림 ${range}: ${c.titles.map((t) => clip(t, 40)).join(', ')}`);
  }
  return lines.join('\n');
}

/** One row per still-open item: [n ✅, n +1주, n ✖]; no rows once everything is handled. */
export function weeklyKeyboard(id: string, items: WeeklyItem[]): InlineKeyboard {
  const rows = items.flatMap((item, i) =>
    item.state !== 'open'
      ? []
      : [
          [
            { text: `${i + 1} ✅`, callback_data: encodeCallback({ t: 'w', id, i, a: 'd' }) },
            { text: `${i + 1} +1주`, callback_data: encodeCallback({ t: 'w', id, i, a: 'p' }) },
            { text: `${i + 1} ✖`, callback_data: encodeCallback({ t: 'w', id, i, a: 'x' }) },
          ],
        ]
  );
  return { inline_keyboard: rows };
}

export interface PendingWeekly {
  type: 'weekly';
  id: string;
  createdAt: string;
  today: string;
  review: WeeklyReview;
}
