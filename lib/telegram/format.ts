// Pure formatting/parsing for the Telegram bot (phase 2b). Framework-free — no
// repo/network access — so these stay easy to unit test.
import type { CalendarEvent, Deadline, Note, ReviewJob } from '@/lib/types';
import type { StatusItem } from '@/lib/status/types';
import type { Checklist, ChecklistItem } from '@/lib/logic/checklist';
import type { UpcomingItem } from '@/lib/logic/upcoming';
import { dueReminders, reviewReminders } from '@/lib/logic/upcoming';
import { ddayLabel } from '@/lib/logic/dates';
import { todayCalendarEvents } from '@/lib/logic/calendar';

const WEEKDAY_KO = ['일', '월', '화', '수', '목', '금', '토'];

/** Escapes the three characters Telegram's `parse_mode: 'HTML'` requires. */
export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Reply sent right after a capture (webhook or, in principle, any source). */
export function formatCaptureReply(note: Note, projectName: string | null): string {
  let line = '메모 저장 ✓';
  if (projectName) line += ` · @${escapeHtml(projectName)}`;
  if (note.tags.length > 0) line += ` ${note.tags.map((t) => `#${escapeHtml(t)}`).join(' ')}`;
  return line;
}

function taskLine(item: ChecklistItem): string {
  return `- ${escapeHtml(item.title)}`;
}

function upcomingLine(item: UpcomingItem): string {
  return `- ${ddayLabel(item.dday)} ${escapeHtml(item.title)}`;
}

function memoLine(note: Note): string {
  const firstLine = note.body.split('\n')[0];
  return `- ${escapeHtml(firstLine)}`;
}

/** Timed events first, then all-day, holidays excluded (see lib/logic/calendar.ts). */
function eventLine(e: CalendarEvent): string {
  const time = e.startTime ? `${e.startTime} ` : '';
  return `- ${time}${escapeHtml(e.title)}`;
}

function statusLine(item: StatusItem): string {
  const detail = item.detail ? ` — ${escapeHtml(item.detail)}` : '';
  return `- ${escapeHtml(item.title)}${detail}`;
}

function isAlertable(item: StatusItem): boolean {
  return item.severity === 'critical' || item.severity === 'warn';
}

const MAX_LINES = 30;

/** Caps `lines` to at most 30, replacing overflow with `…외 n건`. */
function capLines(lines: string[]): string[] {
  if (lines.length <= MAX_LINES) return lines;
  const overflow = lines.length - (MAX_LINES - 1);
  return [...lines.slice(0, MAX_LINES - 1), `…외 ${overflow}건`];
}

export interface TodayInput {
  today: string; // 'YYYY-MM-DD'
  checklist: Checklist; // the `me` bucket from lib/logic/checklist
  upcoming: UpcomingItem[]; // horizon 7 days
  dayMemos: Note[]; // notes with date === today, not archived
  todayEvents?: CalendarEvent[]; // events overlapping today (holidays filtered out here)
  statusItems: StatusItem[];
  cloudUrl?: string | null;
}

/** `/today` message: 지연/오늘/7일 내 마감/오늘 일정/오늘 메모/상태, each section omitted when empty. */
export function formatToday(input: TodayInput): string {
  const sections: string[][] = [];

  if (input.checklist.overdue.length > 0) {
    sections.push(['🔴 지연', ...input.checklist.overdue.map(taskLine)]);
  }
  if (input.checklist.today.length > 0) {
    sections.push(['📌 오늘', ...input.checklist.today.map(taskLine)]);
  }
  if (input.upcoming.length > 0) {
    sections.push(['⏳ 7일 내 마감', ...input.upcoming.map(upcomingLine)]);
  }
  const todayEvents = todayCalendarEvents(input.todayEvents ?? []);
  if (todayEvents.length > 0) {
    sections.push(['🗓 오늘 일정', ...todayEvents.map(eventLine)]);
  }
  if (input.dayMemos.length > 0) {
    sections.push(['📝 오늘 메모', ...input.dayMemos.map(memoLine)]);
  }
  const statusItems = input.statusItems.filter(isAlertable);
  if (statusItems.length > 0) {
    sections.push(['⚠️ 상태', ...statusItems.map(statusLine)]);
  }

  if (sections.length === 0) return '오늘은 비어 있어요 ✨';

  const lines = capLines(sections.flat());
  if (input.cloudUrl) lines.push(`대시보드: ${input.cloudUrl}`);
  return lines.join('\n');
}

/** Standalone `/deadlines` list (upcoming items already filtered/sorted by the caller). */
export function formatUpcomingList(items: UpcomingItem[]): string {
  if (items.length === 0) return '기한 내 마감 없어요 ✨';
  return capLines(items.map(upcomingLine)).join('\n');
}

export interface DigestInput {
  today: string;
  deadlines: Deadline[];
  reviews: ReviewJob[];
  checklist: Checklist; // the `me` bucket
  todayEvents?: CalendarEvent[];
  statusItems: StatusItem[];
  cloudUrl?: string | null;
}

function headerDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const wd = WEEKDAY_KO[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${m}/${d}(${wd})`;
}

/** Daily 09:00 digest: reminders (D-7/3/1 deadlines + reviews), then 지연/오늘, then
 * critical/warn status. `null` when there's nothing to report — no message sent. */
export function formatDigest(input: DigestInput): string | null {
  const reminders = [...dueReminders(input.deadlines, input.today), ...reviewReminders(input.reviews, input.today)].sort(
    (a, b) => a.dday - b.dday
  );
  const statusItems = input.statusItems.filter(isAlertable);
  const hasOverdue = input.checklist.overdue.length > 0;
  const hasToday = input.checklist.today.length > 0;
  const todayEvents = todayCalendarEvents(input.todayEvents ?? []);

  if (reminders.length === 0 && !hasOverdue && !hasToday && statusItems.length === 0 && todayEvents.length === 0) {
    return null;
  }

  const sections: string[][] = [[`☀️ ${headerDate(input.today)} 브리핑`]];
  if (reminders.length > 0) sections.push(['📅 마감 리마인더', ...reminders.map(upcomingLine)]);
  if (hasOverdue) sections.push(['🔴 지연', ...input.checklist.overdue.map(taskLine)]);
  if (hasToday) sections.push(['📌 오늘', ...input.checklist.today.map(taskLine)]);
  if (todayEvents.length > 0) sections.push(['🗓 오늘 일정', ...todayEvents.map(eventLine)]);
  if (statusItems.length > 0) sections.push(['⚠️ 상태', ...statusItems.map(statusLine)]);

  const lines = capLines(sections.flat());
  if (input.cloudUrl) lines.push(`대시보드: ${input.cloudUrl}`);
  return lines.join('\n');
}

/** Immediate alert for newly-critical status items (see lib/logic/status-diff.ts). */
export function formatCriticalAlert(items: StatusItem[]): string {
  return items.map((i) => `🚨 ${escapeHtml(i.title)}${i.detail ? ` — ${escapeHtml(i.detail)}` : ''}`).join('\n');
}

export interface TelegramMessage {
  chatId: number;
  text: string;
}

/** Parses a Telegram update. Only plain `message` (not `edited_message`) with text
 * is handled — everything else returns null. */
export function parseUpdate(update: unknown): TelegramMessage | null {
  if (!update || typeof update !== 'object') return null;
  const message = (update as Record<string, unknown>).message;
  if (!message || typeof message !== 'object') return null;
  const chat = (message as Record<string, unknown>).chat;
  const chatId = chat && typeof chat === 'object' ? (chat as Record<string, unknown>).id : undefined;
  const text = (message as Record<string, unknown>).text;
  if (typeof chatId !== 'number' || typeof text !== 'string') return null;
  return { chatId, text };
}

export type CommandName = 'today' | 'deadlines' | 'help' | 'start' | 'unknown';

export type Route = { kind: 'command'; name: CommandName; arg: string } | { kind: 'capture'; text: string };

const COMMAND_NAMES: ReadonlySet<string> = new Set(['today', 'deadlines', 'help', 'start']);

/** Routes incoming text to a command or a plain capture. Commands may carry a
 * `@BotName` suffix (`/today@my_bot`); anything else is a memo to capture. */
export function route(text: string): Route {
  const trimmed = text.trim();
  const match = /^\/(\w+)(?:@\S+)?(?:\s+([\s\S]*))?$/.exec(trimmed);
  if (match) {
    const name = match[1].toLowerCase();
    const arg = match[2] ?? '';
    return { kind: 'command', name: (COMMAND_NAMES.has(name) ? name : 'unknown') as CommandName, arg };
  }
  return { kind: 'capture', text };
}
