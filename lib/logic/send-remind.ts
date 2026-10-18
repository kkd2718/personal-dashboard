// Pure parsing/formatting for the owner commands /send and /remind (/reminds).
import { addMinutesKst, parseKoDateTime, parseRelativeOffset, stripRequestVerbs, stripSpans } from '@/lib/logic/ko-datetime';
import { matchProject, stripTokens } from '@/lib/logic/capture';
import { addDaysStr, weekdayOf } from '@/lib/logic/dates';
import { encodeCallback } from '@/lib/logic/ax-proposal';
import type { InlineKeyboard } from '@/lib/telegram/client';
import type { CalendarEvent, Project, ProjectActivity } from '@/lib/types';

export const SEND_USAGE = '사용법: /send @프로젝트 내용 (또는 보낼 메시지에 답장하며 /send @프로젝트)';
export const REMIND_USAGE = '사용법: /remind 내일 오전 9시 약 먹기 · /remind 30분 뒤 전화 · /reminds (목록) · /remind 취소 2';
export const MAX_SEND_PICK = 8;
export const REMIND_PREFIX = '🔔';
export const REMIND_MINUTES = 10;
const MAX_CONTENT = 4000;
const MAX_OFFSET_MIN = 14 * 24 * 60;

export interface PendingSend {
  type: 'send';
  id: string;
  createdAt: string;
  content: string;
  /** Project ids behind the pick keyboard (index = button). */
  choices?: string[];
  noteId?: string;
  projectName?: string;
}

export interface PendingRemind {
  type: 'remind';
  id: string;
  createdAt: string;
  eventId: string;
  date: string;
  rowId: string | null;
  account: string | null;
  summary: string;
  /** The cancel button works until the event time + 1 day. */
  expiresAt: string;
}

const MENTION_RE = /(^|\s)@([\p{L}\p{N}_-]+)/gu;

/** `@프로젝트 내용`: the first @token matching a project picks it and is removed from the content
 * (unknown @tokens stay in the content); an empty content falls back to the replied-to text. */
export function parseSendArg(
  arg: string,
  projects: Project[],
  replyToText: string | null
): { content: string; projectId: string | null } {
  let projectId: string | null = null;
  let content = arg;
  for (const m of arg.matchAll(MENTION_RE)) {
    const project = matchProject(m[2], projects);
    if (!project) continue;
    projectId = project.id;
    const start = m.index + m[1].length;
    content = `${arg.slice(0, start)}${arg.slice(start + 1 + m[2].length)}`;
    break;
  }
  content = content.replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').trim();
  if (!content && replyToText) content = replyToText.trim();
  return { content: content.slice(0, MAX_CONTENT), projectId };
}

/** Active projects, most recently active first (latest commit/session/collection), then list order; top MAX_SEND_PICK. */
export function recentActiveProjects(projects: Project[], activity: ProjectActivity[]): Project[] {
  const last = new Map(
    activity.map((a) => [a.projectId, [a.lastCommitAt, a.lastSessionAt, a.collectedAt].filter(Boolean).sort().at(-1) ?? ''])
  );
  return projects
    .filter((p) => p.status === 'active')
    .map((p, i) => ({ p, i, at: last.get(p.id) ?? '' }))
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : a.i - b.i))
    .slice(0, MAX_SEND_PICK)
    .map((x) => x.p);
}

export function sendNoteBody(content: string): string {
  return `[텔레그램 /send] ${content}`;
}

export function sendCancelKeyboard(id: string): InlineKeyboard {
  return { inline_keyboard: [[{ text: '취소', callback_data: encodeCallback({ t: 's', id, a: 'c' }) }]] };
}

export function sendPickKeyboard(id: string, projects: Project[]): InlineKeyboard {
  const buttons = projects.slice(0, MAX_SEND_PICK).map((p, i) => ({ text: p.name.slice(0, 24), callback_data: encodeCallback({ t: 's', id, a: 's', i }) }));
  const rows: InlineKeyboard['inline_keyboard'] = [];
  for (let i = 0; i < buttons.length; i += 2) rows.push(buttons.slice(i, i + 2));
  return { inline_keyboard: rows };
}

export type RemindCommand =
  | { kind: 'usage' }
  | { kind: 'past' }
  | { kind: 'cancel'; n: number }
  | { kind: 'set'; date: string; time: string; content: string; rolled?: boolean };

/** `/remind <시각> <내용>` | `/remind 취소 N`. A past explicit date is refused; a time-only phrase already passed today rolls to tomorrow (`rolled`), like /cal. */
export function parseRemindArg(arg: string, today: string, nowTime: string): RemindCommand {
  const text = arg.trim();
  if (!text) return { kind: 'usage' };
  const cancel = /^(?:취소|cancel)(?:\s+(\d{1,3}))?$/i.exec(text);
  if (cancel) return cancel[1] ? { kind: 'cancel', n: Number(cancel[1]) } : { kind: 'usage' };

  const clean = (spans: Array<[number, number]>) => stripRequestVerbs(stripTokens(stripSpans(text, spans)));
  const rel = parseRelativeOffset(text);
  if (rel) {
    if (rel.minutes > MAX_OFFSET_MIN) return { kind: 'usage' };
    const content = clean([rel.span]);
    if (!content) return { kind: 'usage' };
    const at = addMinutesKst(today, nowTime, rel.minutes);
    return { kind: 'set', date: at.date, time: at.time, content };
  }

  const parsed = parseKoDateTime(text, today);
  const time = parsed.range?.start ?? parsed.times[0] ?? null;
  if (time === null) return { kind: 'usage' };
  const rolled = !parsed.date && time <= nowTime;
  const date = rolled ? addDaysStr(today, 1) : (parsed.date ?? today);
  if (date < today || (date === today && time <= nowTime)) return { kind: 'past' };
  const content = clean(parsed.spans);
  return content ? { kind: 'set', date, time, content, ...(rolled ? { rolled: true } : {}) } : { kind: 'usage' };
}

/** The event a /remind creates: 10 minutes long, popup exactly at the start. */
export function reminderEvent(content: string, date: string, time: string) {
  const end = addMinutesKst(date, time, REMIND_MINUTES);
  return {
    title: `${REMIND_PREFIX} ${content}`,
    date,
    startTime: time,
    endTime: end.date === date ? end.time : '23:59',
    popupMinutes: 0,
  };
}

const WEEKDAY_SHORT = ['일', '월', '화', '수', '목', '금', '토'];
export const whenLabel = (date: string, time: string) => {
  const [, m, d] = date.split('-').map(Number);
  return `${m}/${d}(${WEEKDAY_SHORT[weekdayOf(date)]}) ${time}`;
};

/** When a reminder's cancel record may be dropped: the event time + 1 day. */
export function remindExpiry(date: string, time: string): string {
  return new Date(Date.parse(`${date}T${time}:00+09:00`) + 24 * 3_600_000).toISOString();
}

/** Upcoming 🔔 events (start >= now), soonest first: the numbering `/reminds` shows and `/remind 취소 N` uses.
 * Only the configured account and calendar; a series (the same Google id on several rows) is left out. */
export function upcomingReminders(
  rows: CalendarEvent[],
  today: string,
  nowTime: string,
  scope: { account: string | null; calendar: string },
  days = 14
): CalendarEvent[] {
  const last = addDaysStr(today, days);
  const seen = new Map<string, number>();
  for (const r of rows) {
    const id = googleEventId(r.id);
    if (id) seen.set(id, (seen.get(id) ?? 0) + 1);
  }
  return rows
    .filter((r) => (scope.account === null || r.account === scope.account) && r.id.split(':')[1] === scope.calendar)
    .filter((r) => (seen.get(googleEventId(r.id) ?? '') ?? 0) <= 1)
    .filter((r) => r.title.startsWith(REMIND_PREFIX) && r.startTime !== null && r.startDate <= last)
    .filter((r) => r.startDate > today || (r.startDate === today && (r.startTime as string) >= nowTime))
    .sort((a, b) => (a.startDate + (a.startTime as string)).localeCompare(b.startDate + (b.startTime as string)));
}

/** Google event id behind a mirrored row (`account:calendar:eventId:start`; Apps Script ids carry `@google.com`). */
export function googleEventId(rowId: string): string | null {
  const id = rowId.split(':')[2]?.replace(/@google\.com$/, '');
  return id || null;
}

export const reminderText = (row: Pick<CalendarEvent, 'title'>) => row.title.replace(/^🔔\s*/, '');
