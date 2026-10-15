// Turns a decided intent + target into a concrete, confirmable change, and holds the
// pending-proposal / callback-data plumbing for Telegram's inline keyboard. Pure.
import { eventsFromParsed, type NewEvent } from '@/lib/logic/new-event';
import type { Candidate } from '@/lib/logic/ax-candidates';
import type { Intent } from '@/lib/logic/ax-intent';
import { stripTokens } from '@/lib/logic/capture';
import { absoluteDateLabel, weekdayOf } from '@/lib/logic/dates';
import { applyShift, parseKoDateTime, rescheduleBase, stripRequestVerbs, stripSpans } from '@/lib/logic/ko-datetime';
import { escapeHtml } from '@/lib/telegram/format';
import type { InlineKeyboard } from '@/lib/telegram/client';
import type { Deadline, Paper, Project, Task } from '@/lib/types';

export type Proposal =
  | { kind: 'task_done'; taskId: string; title: string }
  | { kind: 'task_reschedule'; taskId: string; title: string; from: string | null; to: string }
  | { kind: 'deadline_done'; deadlineId: string; title: string }
  | { kind: 'deadline_reschedule'; deadlineId: string; title: string; from: string; to: string; dueTime?: string }
  | { kind: 'calendar_event'; events: NewEvent[] }
  | { kind: 'waiting_reply'; title: string; projectId: string | null; match: { from?: string; subject?: string }; nudgeAfterDays: number };

export type BuildResult = { ok: true; proposal: Proposal } | { ok: false; reason: string /* Korean, user-facing */ };

export interface BuildInput {
  text: string;
  today: string;
  nowTime: string;
  intent: Exclude<Intent, 'memo'>;
  target: Candidate | null;
  tasks: Task[];
  deadlines: Deadline[];
  projects: Project[];
  papers: Paper[];
}

const NOT_FOUND = '대상을 찾을 수 없어요';

export function buildProposal(input: BuildInput): BuildResult {
  const { text, today, nowTime, intent, target, tasks, deadlines } = input;
  const parsed = parseKoDateTime(text, today);
  const fail = (reason: string): BuildResult => ({ ok: false, reason });
  const newDate = (currentDue: string | null): string | null =>
    parsed.date ?? (parsed.shift ? applyShift(rescheduleBase(currentDue, today), parsed.shift) : null);

  switch (intent) {
    case 'task_done': {
      const task = target?.kind === 'task' ? tasks.find((t) => t.id === target.id) : undefined;
      if (!task) return fail(NOT_FOUND);
      return { ok: true, proposal: { kind: 'task_done', taskId: task.id, title: task.title } };
    }
    case 'task_reschedule': {
      const task = target?.kind === 'task' ? tasks.find((t) => t.id === target.id) : undefined;
      if (!task) return fail(NOT_FOUND);
      const to = newDate(task.dueDate);
      if (!to) return fail('날짜를 찾지 못했어요');
      if (to < today) return fail('과거 날짜예요');
      if (to === task.dueDate) return fail('이미 그 날짜예요');
      return { ok: true, proposal: { kind: 'task_reschedule', taskId: task.id, title: task.title, from: task.dueDate, to } };
    }
    case 'deadline_done': {
      const dl = target?.kind === 'deadline' ? deadlines.find((d) => d.id === target.id) : undefined;
      if (!dl) return fail(NOT_FOUND);
      return { ok: true, proposal: { kind: 'deadline_done', deadlineId: dl.id, title: dl.title } };
    }
    case 'deadline_reschedule': {
      const dl = target?.kind === 'deadline' ? deadlines.find((d) => d.id === target.id) : undefined;
      if (!dl) return fail(NOT_FOUND);
      const to = newDate(dl.dueDate);
      if (!to) return fail('날짜를 찾지 못했어요');
      if (to < today) return fail('과거 날짜예요');
      const dueTime = parsed.range?.start ?? parsed.times[0];
      if (to === dl.dueDate && (!dueTime || dueTime === dl.dueTime)) return fail('이미 그 날짜예요');
      return {
        ok: true,
        proposal: {
          kind: 'deadline_reschedule',
          deadlineId: dl.id,
          title: dl.title,
          from: dl.dueDate,
          to,
          ...(dueTime ? { dueTime } : {}),
        },
      };
    }
    case 'calendar_event': {
      const events = eventsFromParsed(parsed, today, nowTime);
      if ('error' in events) return fail(events.error);
      const title = stripRequestVerbs(stripTokens(stripSpans(text, parsed.spans)));
      if (!title) return fail('제목을 찾지 못했어요');
      if (events.some((e) => e.date < today)) return fail('과거 날짜예요');
      return { ok: true, proposal: { kind: 'calendar_event', events: events.map((e) => ({ ...e, title })) } };
    }
    case 'waiting_reply':
      return fail('답장 대기 기능은 아직 준비 중이에요');
  }
}

function eventLine(e: NewEvent): string {
  const [, m, d] = e.date.split('-').map(Number);
  const when = `${m}/${d}(${'일월화수목금토'[weekdayOf(e.date)]})`;
  const time = e.startTime && e.endTime ? `${e.startTime}–${e.endTime}` : '종일';
  return `${when} ${time} ${escapeHtml(e.title)}`;
}

/** HTML body of the confirmation message (escaped). */
export function formatProposal(p: Proposal, today: string): string {
  const day = (d: string | null) => (d ? absoluteDateLabel(d, today) : '없음');
  switch (p.kind) {
    case 'task_done':
      return `✅ 할 일 완료 처리\n<b>${escapeHtml(p.title)}</b>`;
    case 'task_reschedule':
      return `📅 할 일 마감 변경\n<b>${escapeHtml(p.title)}</b>\n${day(p.from)} → ${day(p.to)}`;
    case 'deadline_done':
      return `✅ 마감 완료 처리\n<b>${escapeHtml(p.title)}</b>`;
    case 'deadline_reschedule':
      return `📅 마감 변경\n<b>${escapeHtml(p.title)}</b>\n${day(p.from)} → ${day(p.to)}${p.dueTime ? ` ${p.dueTime}` : ''}`;
    case 'calendar_event':
      return `📅 캘린더에 추가\n${p.events.map((e) => `• ${eventLine(e)}`).join('\n')}`;
    case 'waiting_reply':
      return `⏳ 답장 대기 등록\n<b>${escapeHtml(p.title)}</b>`;
  }
}

export type PendingStatus = 'pending' | 'applied' | 'cancelled' | 'memo';

export interface PendingProposal {
  type: 'proposal';
  id: string;
  createdAt: string;
  text: string;
  proposal: Proposal;
  status: PendingStatus;
  result?: string;
}

export const PENDING_PREFIX = 'telegram:pending:';

/** 10 chars of [0-9a-z]. */
export function newShortId(rand: () => number = Math.random): string {
  let id = '';
  for (let i = 0; i < 10; i++) id += Math.floor(rand() * 36).toString(36);
  return id;
}

export function isExpired(createdAt: string, now: string, ttlHours: number): boolean {
  return Date.parse(now) - Date.parse(createdAt) > ttlHours * 3_600_000;
}

export type CallbackData =
  | { t: 'p'; id: string; a: 'ok' | 'no' | 'memo' }
  | { t: 'w'; id: string; i: number; a: 'd' | 'p' | 'x' };

export function encodeCallback(c: CallbackData): string {
  return c.t === 'p' ? `p:${c.id}:${c.a}` : `w:${c.id}:${c.i}:${c.a}`;
}

export function decodeCallback(s: string): CallbackData | null {
  const p = /^p:([0-9a-z]{1,16}):(ok|no|memo)$/.exec(s);
  if (p) return { t: 'p', id: p[1], a: p[2] as 'ok' | 'no' | 'memo' };
  const w = /^w:([0-9a-z]{1,16}):(\d{1,3}):(d|p|x)$/.exec(s);
  if (w) return { t: 'w', id: w[1], i: Number(w[2]), a: w[3] as 'd' | 'p' | 'x' };
  return null;
}

export function proposalKeyboard(id: string): InlineKeyboard {
  return {
    inline_keyboard: [
      [
        { text: '적용', callback_data: encodeCallback({ t: 'p', id, a: 'ok' }) },
        { text: '취소', callback_data: encodeCallback({ t: 'p', id, a: 'no' }) },
      ],
      [{ text: '메모로 저장', callback_data: encodeCallback({ t: 'p', id, a: 'memo' }) }],
    ],
  };
}

/** Ring buffer of handled Telegram update ids: a retried webhook delivery must be a no-op. */
export function rememberUpdate(recent: number[], updateId: number, keep = 50): { seen: boolean; next: number[] } {
  if (recent.includes(updateId)) return { seen: true, next: recent };
  return { seen: false, next: [...recent, updateId].slice(-keep) };
}
