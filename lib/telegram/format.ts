// Pure formatting/parsing for the Telegram bot (phase 2b). Framework-free — no
// repo/network access — so these stay easy to unit test.
import type { CalendarEvent, Deadline, Note, ReviewJob } from '@/lib/types';
import type { StatusItem } from '@/lib/status/types';
import type { Checklist, ChecklistItem } from '@/lib/logic/checklist';
import type { UpcomingItem } from '@/lib/logic/upcoming';
import { dueReminders, reviewReminders } from '@/lib/logic/upcoming';
import { addDaysStr, ddayLabel, dday, weekdayOf } from '@/lib/logic/dates';
import type { Pace, SpendRecord } from '@/lib/logic/ask-budget';
import { MAX_ALERTS_PER_MESSAGE, senderAddress, type TriageMail } from '@/lib/logic/mail-triage';
import type { ShiftMonthSummary } from '@/lib/logic/work-announce';
import type { ReplyCategory, WaitingItem, WaitingReply } from '@/lib/logic/waiting';
import { todayCalendarEvents } from '@/lib/logic/calendar';
import { parseShift, type WorkShift } from '@/lib/logic/work';
import type { DueChecklist, DueChecklistItem } from '@/lib/logic/project-detail';
import { formatRoutineCount, isCountRoutine, type RoutineItem, type RoutineStatus } from '@/lib/logic/routines';

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
  return `• ${escapeHtml(item.title)}`;
}

/** Bold section header — sections are separated by a blank line (see joinSections). */
function header(title: string): string {
  return `<b>${title}</b>`;
}

/** Long checklist texts wrap into 3–4 lines on a phone; keep one glanceable line. */
function clip(text: string, max = 44): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** Sections joined with one blank line between them, capped at MAX_LINES. */
function joinSections(sections: string[][]): string[] {
  const lines: string[] = [];
  sections.forEach((sec, i) => {
    if (i > 0) lines.push('');
    lines.push(...sec);
  });
  return capLines(lines);
}

/** Project checklist items grouped under their project name:
 *   <i>trading-system</i>
 *    • RP 해지 (~9/28) (막힘)
 * — (~M/D) when overdue, (막힘) when blocked, text clipped to one phone line. */
function projectLines(items: DueChecklistItem[], today: string): string[] {
  const out: string[] = [];
  let current: string | null = null;
  for (const item of items) {
    if (item.project !== current) {
      current = item.project;
      out.push(`<i>${escapeHtml(item.project)}</i>`);
    }
    const [, m, d] = item.due.split('-').map(Number);
    const late = item.due < today ? ` (~${m}/${d})` : '';
    const blocked = item.blocked ? ' (막힘)' : '';
    out.push(`  • ${escapeHtml(clip(item.text))}${late}${blocked}`);
  }
  return out;
}

function upcomingLine(item: UpcomingItem): string {
  return `• ${ddayLabel(item.dday)} ${escapeHtml(item.title)}`;
}

function memoLine(note: Note): string {
  const firstLine = note.body.split('\n')[0];
  return `• ${escapeHtml(firstLine)}`;
}

/** Timed events first, then all-day, holidays excluded (see lib/logic/calendar.ts). */
function eventLine(e: CalendarEvent): string {
  const time = e.startTime ? `${e.startTime} ` : '';
  return `• ${time}${escapeHtml(e.title)}`;
}

function statusLine(item: StatusItem): string {
  const detail = item.detail ? ` — ${escapeHtml(item.detail)}` : '';
  return `• ${escapeHtml(item.title)}${detail}`;
}

function isAlertable(item: StatusItem): boolean {
  return item.severity === 'critical' || item.severity === 'warn';
}

/** Today's shift line: '💼 근무 13층 1조 10:00–20:00', '🌿 오늘 휴무', or null. */
export function workLine(shift: WorkShift | null | undefined, today: string): string | null {
  if (!shift) return null;
  const p = parseShift(shift.code, today);
  if (p.kind === 'off') return '🌿 오늘 휴무';
  return `💼 근무 ${escapeHtml(p.label)}`;
}

/** Routine label, as an HTML link when it has a url (both escaped). */
function routineLabel(item: RoutineItem): string {
  const label = escapeHtml(item.label);
  if (!item.url) return label;
  return `<a href="${escapeHtml(item.url).replace(/"/g, '&quot;')}">${label}</a>`;
}

/** " · 12문제" for count routines with a count today, else "". */
function countSuffix(r: RoutineStatus): string {
  return r.count !== undefined && r.count > 0 ? ` · ${escapeHtml(formatRoutineCount(r.item, r.count))}` : '';
}

function routineSection(rows: RoutineStatus[], withState: boolean): string[] {
  return [
    header('🔁 오늘 루틴'),
    ...rows.map((r) => `${withState ? (r.done ? '✅' : '⬜') : '•'} ${routineLabel(r.item)}${countSuffix(r)}`),
  ];
}

/** Evening reminder: only the routines not done yet, or null when there are none. */
export function formatEvening(pending: RoutineItem[]): string | null {
  if (pending.length === 0) return null;
  return [
    header('🌙 저녁 체크'),
    ...pending.map((r) => `• ${routineLabel(r)}`),
    '',
    pending.some(isCountRoutine) ? '완료하면 /done 1 처럼, 개수는 /done 1 5 처럼 보내세요' : '완료하면 /done 1 처럼 보내세요',
  ].join('\n');
}

/** `/done` with no/unknown argument: numbered status list of today's routines. */
export function formatRoutineList(rows: RoutineStatus[]): string {
  if (rows.length === 0) return '오늘 활성 루틴이 없어요';
  return [
    header('🔁 오늘 루틴'),
    ...rows.map((r, i) => `${i + 1}. ${r.done ? '✅' : '⬜'} ${escapeHtml(r.item.label)}${countSuffix(r)}`),
    '',
    rows.some((r) => isCountRoutine(r.item))
      ? '/done 1 또는 /done 알렌 처럼, 개수는 /done 알렌 5 처럼 보내세요'
      : '/done 1 또는 /done 알렌 처럼 보내세요',
  ].join('\n');
}

const MAX_LINES = 30;
const EMPTY_DUE: DueChecklist = { overdue: [], today: [], tomorrow: [] };

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
  workShift?: WorkShift | null; // today's own shift, if synced
  projectDue?: DueChecklist; // my dated items from each project's docs/cc-status.json
  routines?: RoutineStatus[]; // active routines today with done state
}

/** `/today` message: 지연/오늘/7일 내 마감/오늘 일정/오늘 메모/상태, each section omitted when empty. */
export function formatToday(input: TodayInput): string {
  const sections: string[][] = [];

  const shiftLine = workLine(input.workShift, input.today);
  if (shiftLine) sections.push([shiftLine]);
  if (input.routines && input.routines.length > 0) sections.push(routineSection(input.routines, true));
  const pd = input.projectDue ?? EMPTY_DUE;
  if (input.checklist.overdue.length > 0 || pd.overdue.length > 0) {
    sections.push([header('🔴 지연'), ...input.checklist.overdue.map(taskLine), ...projectLines(pd.overdue, input.today)]);
  }
  if (input.checklist.today.length > 0 || pd.today.length > 0) {
    sections.push([header('📌 오늘'), ...input.checklist.today.map(taskLine), ...projectLines(pd.today, input.today)]);
  }
  if (pd.tomorrow.length > 0) {
    sections.push([header('🔜 내일'), ...projectLines(pd.tomorrow, input.today)]);
  }
  if (input.upcoming.length > 0) {
    sections.push([header('⏳ 7일 내 마감'), ...input.upcoming.map(upcomingLine)]);
  }
  const todayEvents = todayCalendarEvents(input.todayEvents ?? []);
  if (todayEvents.length > 0) {
    sections.push([header('🗓 오늘 일정'), ...todayEvents.map(eventLine)]);
  }
  if (input.dayMemos.length > 0) {
    sections.push([header('📝 오늘 메모'), ...input.dayMemos.map(memoLine)]);
  }
  const statusItems = input.statusItems.filter(isAlertable);
  if (statusItems.length > 0) {
    sections.push([header('⚠️ 상태'), ...statusItems.map(statusLine)]);
  }

  if (sections.length === 0) return '오늘은 비어 있어요 ✨';

  const lines = joinSections(sections);
  if (input.cloudUrl) lines.push('', `대시보드: ${input.cloudUrl}`);
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
  workShift?: WorkShift | null; // today's own shift, if synced
  projectDue?: DueChecklist; // my dated items from each project's docs/cc-status.json
  routines?: RoutineStatus[]; // active routines today; count as content
  waiting?: Array<{ title: string; days: number }>; // open reply-waits past their nudge age; count as content
  staleSyncs?: string[]; // Google accounts whose sync stopped, e.g. 'main (10일 전)'
}

function headerDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const wd = WEEKDAY_KO[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${m}/${d}(${wd})`;
}

/** Daily morning (07:00–08:00 KST) digest: reminders (D-7/3/1 deadlines + reviews), then 지연/오늘, then
 * critical/warn status. `null` when there's nothing to report — no message sent. */
export function formatDigest(input: DigestInput): string | null {
  const reminders = [...dueReminders(input.deadlines, input.today), ...reviewReminders(input.reviews, input.today)].sort(
    (a, b) => a.dday - b.dday
  );
  const statusItems = input.statusItems.filter(isAlertable);
  const pd = input.projectDue ?? EMPTY_DUE;
  const hasOverdue = input.checklist.overdue.length > 0 || pd.overdue.length > 0;
  const hasToday = input.checklist.today.length > 0 || pd.today.length > 0;
  const hasTomorrow = pd.tomorrow.length > 0;
  const todayEvents = todayCalendarEvents(input.todayEvents ?? []);
  const routines = input.routines ?? [];
  const staleSyncs = input.staleSyncs ?? [];
  const waiting = input.waiting ?? [];

  if (
    staleSyncs.length === 0 &&
    waiting.length === 0 &&
    routines.length === 0 &&
    reminders.length === 0 &&
    !hasOverdue &&
    !hasToday &&
    !hasTomorrow &&
    statusItems.length === 0 &&
    todayEvents.length === 0
  ) {
    return null;
  }

  const sections: string[][] = [[header(`☀️ ${headerDate(input.today)} 브리핑`)]];
  const shiftLine = workLine(input.workShift, input.today);
  if (shiftLine) sections[0].push(shiftLine);
  if (routines.length > 0) sections.push(routineSection(routines, false));
  if (reminders.length > 0) sections.push([header('📅 마감 리마인더'), ...reminders.map(upcomingLine)]);
  if (hasToday)
    sections.push([header('📌 오늘'), ...input.checklist.today.map(taskLine), ...projectLines(pd.today, input.today)]);
  if (todayEvents.length > 0) sections.push([header('🗓 오늘 일정'), ...todayEvents.map(eventLine)]);
  if (hasTomorrow) sections.push([header('🔜 내일 (미리)'), ...projectLines(pd.tomorrow, input.today)]);
  if (hasOverdue)
    sections.push([header('🔴 지연'), ...input.checklist.overdue.map(taskLine), ...projectLines(pd.overdue, input.today)]);
  if (waiting.length > 0)
    sections.push([
      header('⏳ 답장 대기'),
      ...waiting.map((w) => `• ${escapeHtml(clip(w.title))} — 답장 없음 ${w.days}일 — 재문의?`),
    ]);
  if (statusItems.length > 0) sections.push([header('⚠️ 상태'), ...statusItems.map(statusLine)]);
  if (staleSyncs.length > 0)
    sections.push([
      header('🔌 구글 동기화 멈춤'),
      ...staleSyncs.map((s) => `• ${escapeHtml(s)} — Apps Script 에서 setup 다시 실행`),
    ]);

  const lines = joinSections(sections);
  if (input.cloudUrl) lines.push('', `대시보드: ${input.cloudUrl}`);
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

export type TelegramUpdate =
  | { kind: 'message'; updateId: number | null; chatId: number; text: string; messageId: number | null; replyToMessageId: number | null }
  | { kind: 'callback'; updateId: number | null; chatId: number; callbackId: string; messageId: number; data: string };

/** Parses a message or inline-button callback update (chat id of a callback is that of its message). */
export function parseTelegramUpdate(update: unknown): TelegramUpdate | null {
  if (!update || typeof update !== 'object') return null;
  const u = update as Record<string, unknown>;
  const updateId = typeof u.update_id === 'number' ? u.update_id : null;

  const message = parseUpdate(update);
  if (message) {
    const raw = u.message as Record<string, unknown>;
    const reply = raw.reply_to_message && typeof raw.reply_to_message === 'object' ? (raw.reply_to_message as Record<string, unknown>) : null;
    return {
      kind: 'message',
      updateId,
      ...message,
      messageId: typeof raw.message_id === 'number' ? raw.message_id : null,
      replyToMessageId: typeof reply?.message_id === 'number' ? reply.message_id : null,
    };
  }

  const cb = u.callback_query;
  if (!cb || typeof cb !== 'object') return null;
  const c = cb as Record<string, unknown>;
  const msg = c.message && typeof c.message === 'object' ? (c.message as Record<string, unknown>) : null;
  const chat = msg?.chat && typeof msg.chat === 'object' ? (msg.chat as Record<string, unknown>) : null;
  if (typeof c.id !== 'string' || typeof c.data !== 'string') return null;
  if (typeof chat?.id !== 'number' || typeof msg?.message_id !== 'number') return null;
  return { kind: 'callback', updateId, chatId: chat.id, callbackId: c.id, messageId: msg.message_id, data: c.data };
}

export type CommandName = 'today' | 'deadlines' | 'done' | 'cal' | 'waits' | 'wait' | 'mailrule' | 'ask' | 'budget' | 'help' | 'start' | 'unknown';

/** `modifier`: `/ask!` (Opus) or `/ask+` (Sonnet); other commands ignore it. */
export type Route = { kind: 'command'; name: CommandName; arg: string; modifier?: '!' | '+' } | { kind: 'capture'; text: string };

const COMMAND_NAMES: ReadonlySet<string> = new Set(['today', 'deadlines', 'done', 'cal', 'waits', 'wait', 'mailrule', 'ask', 'budget', 'help', 'start']);

/** Routes incoming text to a command or a plain capture. Commands may carry a
 * `@BotName` suffix (`/today@my_bot`); anything else is a memo to capture. */
export function route(text: string): Route {
  const trimmed = text.trim();
  const match = /^\/(\w+)([!+])?(?:@\S+)?(?:\s+([\s\S]*))?$/.exec(trimmed);
  if (match) {
    const name = match[1].toLowerCase();
    const arg = match[3] ?? '';
    return {
      kind: 'command',
      name: (COMMAND_NAMES.has(name) ? name : 'unknown') as CommandName,
      arg,
      ...(match[2] ? { modifier: match[2] as '!' | '+' } : {}),
    };
  }
  return { kind: 'capture', text };
}

const WEEKDAY_SHORT = ['일', '월', '화', '수', '목', '금', '토'];

/** `/cal` confirmation, one line per created event: `📅 10/16(금) 14:00–15:00 치과 — 캘린더에 추가`. */
export function formatCalReply(events: Array<{ title: string; date: string; startTime: string | null; endTime: string | null }>): string {
  return events
    .map((e) => {
      const [, m, d] = e.date.split('-').map(Number);
      const when = `${m}/${d}(${WEEKDAY_SHORT[weekdayOf(e.date)]})`;
      const time = e.startTime && e.endTime ? `${e.startTime}–${e.endTime}` : '종일';
      return `📅 ${when} ${time} ${escapeHtml(e.title)} — 캘린더에 추가`;
    })
    .join('\n');
}

/** `/waits`: numbered open reply-waits, oldest first (same order `/wait <n>` indexes). */
export function formatWaitList(open: WaitingItem[], today: string): string {
  if (open.length === 0) return '대기 중인 답장이 없어요';
  const lines = open.map((w, i) => {
    const days = dday(today, w.since);
    const parts = [escapeHtml(clip(w.title)), w.match.from ? `from:${escapeHtml(w.match.from)}` : '보낸이 미지정', days > 0 ? `${days}일째` : '오늘 등록'];
    return `${i + 1}. ${parts.join(' · ')}`;
  });
  return [`<b>⏳ 답장 대기 ${open.length}건</b>`, ...lines].join('\n');
}

const md = (d: string): string => `${Number(d.slice(5, 7))}/${Number(d.slice(8))}`;
const usd2 = (n: number): string => `$${n.toFixed(2)}`;
const modelLabel = (m: string): string => m.replace(/^claude-/, '').replace(/-\d+-\d+$/, '');

/** `/budget`: this cycle's Claude API spend against the paced budget. No API call involved. */
export function formatBudget(p: Pace, rec: { cycle: SpendRecord; day: SpendRecord }, today: string): string {
  const gap = p.allowedUsd - p.spentUsd;
  const status = p.exhausted ? '예산 소진' : p.ahead ? `페이스 초과 ${usd2(-gap)}` : `페이스 여유 ${usd2(gap)}`;
  const lines = [
    `<b>💰 /ask 예산</b> ${md(p.cycle.start)}–${md(addDaysStr(p.cycle.nextStart, -1))} (${p.cycle.dayIndex + 1}/${p.cycle.days}일째)`,
    `크레딧 ${usd2(p.creditUsd)} · 예비 ${usd2(p.creditUsd - p.usableUsd)} · 사용 가능 ${usd2(p.usableUsd)}`,
    `지출 ${usd2(p.spentUsd)} · 오늘까지 허용 ${usd2(p.allowedUsd)} · ${status}`,
    `남은 ${usd2(p.remainingUsd)} · 오늘(${md(today)}) ${usd2(rec.day.usd)} (${rec.day.calls}회)`,
  ];
  const models = Object.entries(rec.cycle.byModel);
  if (models.length > 0) lines.push(`모델별: ${models.map(([m, v]) => `${escapeHtml(modelLabel(m))} ${usd2(v.usd)}`).join(' · ')}`);
  const features = Object.entries(rec.cycle.byFeature);
  if (features.length > 0) lines.push(`기능별: ${features.map(([f, v]) => `${escapeHtml(f)} ${usd2(v ?? 0)}`).join(' · ')}`);
  if (rec.cycle.unpricedCalls > 0) lines.push(`가격 미설정 호출 ${rec.cycle.unpricedCalls}회 (비용 미반영)`);
  lines.push(`초기화 ${md(p.cycle.nextStart)} · 호출 ${rec.cycle.calls}회`);
  return lines.join('\n');
}

export const WAIT_USAGE = '사용법: /waits · /wait 2 from:주소 · /wait 2 subject:"키워드" · /wait 2 days:5 · /wait 2 close · /wait <id> reopen';

const CATEGORY_LABEL: Record<ReplyCategory, string> = { approved: '승인', declined: '거절', question: '질문', other: '기타' };

/** Alert for a freshly matched reply; classification is shown only when Jev produced one. */
export function formatWaitingReplyAlert(item: WaitingItem, reply: WaitingReply): string {
  const lines = [`📬 답장 도착: ${escapeHtml(item.title)}`];
  if (reply.category) {
    const pct = reply.positive !== undefined ? ` (긍정 ${Math.round(reply.positive * 100)}%)` : '';
    lines.push(`분류: ${CATEGORY_LABEL[reply.category]}${pct}`);
  }
  lines.push(`${escapeHtml(reply.from)} · ${escapeHtml(reply.subject)}`);
  lines.push(escapeHtml(reply.snippet.slice(0, 120)));
  lines.push(`<i>잘못 잡혔다면 /wait ${item.id} reopen</i>`);
  return lines.join('\n');
}

const dayOfMonth = (d: string) => `${Number(d.slice(8))}(${WEEKDAY_SHORT[weekdayOf(d)]})`;

/** One-time alert when a month's shifts first reach the server; empty lines are omitted. */
export function formatShiftMonth(s: ShiftMonthSummary): string {
  const lines = [`<b>📋 ${Number(s.month.slice(5))}월 근무표 나왔어요</b>`, `근무 ${s.workDays}일 · 휴무 ${s.offDays.length}일`];
  const counts = Object.entries(s.byShort).sort(([a], [b]) => a.localeCompare(b));
  if (counts.length > 0) lines.push(counts.map(([k, n]) => `${escapeHtml(k)} ${n}`).join(' · '));
  if (s.offDays.length > 0) lines.push(`휴무: ${s.offDays.map(dayOfMonth).join(' ')}`);
  if (s.weekendWork.length > 0) {
    lines.push(`주말 근무: ${s.weekendWork.map((w) => `${Number(w.date.slice(5, 7))}/${dayOfMonth(w.date)} ${escapeHtml(w.short)}`).join(', ')}`);
  }
  if (s.other.length > 0) {
    lines.push(`기타: ${s.other.map((o) => `${Number(o.date.slice(5, 7))}/${Number(o.date.slice(8))} ${escapeHtml(o.label)}`).join(', ')}`);
  }
  return lines.join('\n');
}

/** Display name of a `From:` header: the quoted/plain name part, else the address. */
function senderLabel(from: string): string {
  const name = from.replace(/<[^>]*>/, '').replace(/^["'\s]+|["'\s]+$/g, '');
  return name || senderAddress(from);
}

/** One message batching up to MAX_ALERTS_PER_MESSAGE mails: sender, subject, a short snippet line, link. */
export function formatMailAlert(mails: TriageMail[]): string {
  const shown = mails.slice(0, MAX_ALERTS_PER_MESSAGE);
  const blocks = shown.map((m) => {
    const lines = [`📧 <b>${escapeHtml(senderLabel(m.from))}</b> · ${escapeHtml(clip(m.subject, 80))}`];
    const first = m.snippet?.split('\n')[0].trim();
    if (first) lines.push(escapeHtml(clip(first, 80)));
    lines.push(escapeHtml(m.link));
    return lines.join('\n');
  });
  if (mails.length > shown.length) blocks.push(`…외 ${mails.length - shown.length}건`);
  return blocks.join('\n\n');
}

export const MAIL_CAP_NOTICE = '📧 메일 분류 한도 도달 — 허용 목록만 알림';
