// Turns a decided intent + target into a concrete, confirmable change, and holds the
// pending-proposal / callback-data plumbing for Telegram's inline keyboard. Pure.
import { eventsFromParsed, type NewEvent } from '@/lib/logic/new-event';
import type { Candidate } from '@/lib/logic/ax-candidates';
import { TASK_PREFIX_RE, type Intent } from '@/lib/logic/ax-intent';
import { parseCapture, stripTokens } from '@/lib/logic/capture';
import { extractEmailOrDomain, extractWaitDays } from '@/lib/logic/waiting';
import { absoluteDateLabel, weekdayOf } from '@/lib/logic/dates';
import { applyShift, parseKoDateTime, rescheduleBase, stripRequestVerbs, stripSpans } from '@/lib/logic/ko-datetime';
import { escapeHtml } from '@/lib/telegram/format';
import type { InlineKeyboard } from '@/lib/telegram/client';
import type { Deadline, DeadlineKind, Paper, Project, Task } from '@/lib/types';

export type Proposal =
  | { kind: 'task_create'; title: string; projectId: string | null; projectName: string | null; dueDate: string | null }
  | { kind: 'task_done'; taskId: string; title: string }
  | { kind: 'task_reschedule'; taskId: string; title: string; from: string | null; to: string }
  | { kind: 'deadline_done'; deadlineId: string; title: string }
  | { kind: 'deadline_reschedule'; deadlineId: string; title: string; from: string; to: string; dueTime?: string }
  | { kind: 'calendar_event'; events: NewEvent[] }
  | { kind: 'waiting_reply'; title: string; projectId: string | null; match: { from?: string; subject?: string }; nudgeAfterDays: number; taskId?: string | null; deadlineId?: string | null }
  // /ask only (docs/PLAN_ASK.md §4)
  | { kind: 'send_memo'; projectId: string; projectName: string; body: string }
  | { kind: 'deadline_create'; title: string; dueDate: string; dueTime: string | null; projectId: string | null; deadlineKind: DeadlineKind };

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
  /** task_create: the project Jev picked (an `@project` in the text wins). */
  projectId?: string | null;
}

const NOT_FOUND = '대상을 찾을 수 없어요';
const FILLER_ONLY = /^(?:에서|에게|한테|로부터|으로|로|가|이|은|는|을|를|의|도|에|답장|답|오면|오기|오는|기다림|기다려|기다리는|기다릴게|중|대기|알려|주세요|줘|좀|\s)+$/;

export function buildProposal(input: BuildInput): BuildResult {
  const { text, today, nowTime, intent, target, tasks, deadlines } = input;
  const parsed = parseKoDateTime(text, today);
  const fail = (reason: string): BuildResult => ({ ok: false, reason });
  const newDate = (currentDue: string | null): string | null =>
    parsed.date ?? (parsed.shift ? applyShift(rescheduleBase(currentDue, today), parsed.shift) : null);

  switch (intent) {
    case 'task_create': {
      const wanted = parseCapture(text, input.projects).projectId ?? input.projectId ?? null;
      const project = wanted ? input.projects.find((p) => p.id === wanted) : undefined;
      const title = stripRequestVerbs(stripTokens(stripSpans(text, parsed.spans)))
        .replace(TASK_PREFIX_RE, '')
        .replace(/\s*(?:해야\s?(?:해|함|한다|겠다|돼|됨)|하기)[.!]?$/, '')
        .trim();
      if (!title) return fail('제목을 찾지 못했어요');
      if (parsed.date && parsed.date < today) return fail('과거 날짜예요');
      return {
        ok: true,
        proposal: { kind: 'task_create', title, projectId: project?.id ?? null, projectName: project?.name ?? null, dueDate: parsed.date },
      };
    }
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
    case 'waiting_reply': {
      // Pull the sender and "N일 기다림" out first: neither may reach the title, date or project detection.
      const from = extractEmailOrDomain(text);
      const at = from ? text.toLowerCase().indexOf(from) : -1;
      const withoutFrom = from && at >= 0 ? text.slice(0, at) + ' ' + text.slice(at + from.length) : text;
      const waitDays = extractWaitDays(withoutFrom);
      const wp = parseKoDateTime(waitDays.text, today);
      const projectId = parseCapture(waitDays.text, input.projects).projectId ?? null;
      const project = projectId ? input.projects.find((p) => p.id === projectId) : undefined;
      const targetDeadline = target?.kind === 'deadline' ? deadlines.find((d) => d.id === target.id) : undefined;
      const targetTask = target?.kind === 'task' ? tasks.find((t) => t.id === target.id) : undefined;
      const paper =
        (targetDeadline?.paperId ? input.papers.find((p) => p.id === targetDeadline.paperId) : undefined) ??
        (projectId ? input.papers.find((p) => p.projectId === projectId) : undefined);
      let title = stripRequestVerbs(stripTokens(stripSpans(waitDays.text, wp.spans)));
      // Only particles/verbs left ("에서 답 오면"): a sender or project name makes a better title.
      if (!title || FILLER_ONLY.test(title)) title = from ? `${from} 답장` : (paper?.shortName ?? project?.name ?? title);
      if (!title) return fail('제목을 찾지 못했어요');
      // Gmail ANDs from+subject: a known sender alone is the safer search, so only guess a subject without one.
      const subject = from ? undefined : (paper?.shortName ?? project?.name);
      return {
        ok: true,
        proposal: {
          kind: 'waiting_reply',
          title,
          projectId: projectId ?? targetTask?.projectId ?? targetDeadline?.projectId ?? null,
          match: { ...(from ? { from } : {}), ...(subject ? { subject } : {}) },
          nudgeAfterDays: waitDays.days ?? (wp.shift?.unit === 'day' ? wp.shift.n : 7),
          taskId: targetTask?.id ?? null,
          deadlineId: targetDeadline?.id ?? null,
        },
      };
    }
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
    case 'task_create': {
      const due = p.dueDate ? ` · 마감 ${Number(p.dueDate.slice(5, 7))}/${Number(p.dueDate.slice(8))}` : '';
      return `➕ 할 일 추가 · ${escapeHtml(p.projectName ?? '프로젝트 없음')} · <b>${escapeHtml(p.title)}</b>${due}`;
    }
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
    case 'send_memo':
      return `📨 ${escapeHtml(p.projectName)} 세션에 메모 전달
<b>${escapeHtml(p.body)}</b>`;
    case 'deadline_create': {
      const time = p.dueTime ? ` ${p.dueTime}` : '';
      return `➕ 마감 추가
<b>${escapeHtml(p.title)}</b>
${day(p.dueDate)}${time}`;
    }
    case 'waiting_reply':
      return [
        '⏳ 답장 대기 등록',
        `<b>${escapeHtml(p.title)}</b>`,
        `보낸이: ${p.match.from ? escapeHtml(p.match.from) : '(미지정 — /wait n from:주소 로 설정)'}`,
        ...(p.match.subject ? [`제목 키워드: ${escapeHtml(p.match.subject)}`] : []),
        `${p.nudgeAfterDays}일 지나도 답이 없으면 알려드려요`,
      ].join('\n');
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
  | { t: 'w'; id: string; i: number; a: 'd' | 'p' | 'x' }
  // mail alert buttons: p = 작업 준비 요청, r = 답장 초안, s = project pick #i
  | { t: 'm'; id: string; a: 'p' | 'r' }
  | { t: 'm'; id: string; a: 's'; i: number }
  // /send: c = cancel (unsend), s = project pick #i; /remind: c = cancel the calendar event
  | { t: 's'; id: string; a: 'c' }
  | { t: 's'; id: string; a: 's'; i: number }
  | { t: 'r'; id: string; a: 'c' };

export function encodeCallback(c: CallbackData): string {
  if (c.t === 'p') return `p:${c.id}:${c.a}`;
  if (c.t === 's') return c.a === 's' ? `s:${c.id}:s${c.i}` : `s:${c.id}:c`;
  if (c.t === 'r') return `r:${c.id}:c`;
  if (c.t === 'm') return c.a === 's' ? `m:${c.id}:s${c.i}` : `m:${c.id}:${c.a}`;
  return `w:${c.id}:${c.i}:${c.a}`;
}

export function decodeCallback(str: string): CallbackData | null {
  const p = /^p:([0-9a-z]{1,16}):(ok|no|memo)$/.exec(str);
  if (p) return { t: 'p', id: p[1], a: p[2] as 'ok' | 'no' | 'memo' };
  const m = /^m:([0-9a-z]{1,16}):(p|r|s(\d{1,2}))$/.exec(str);
  if (m) return m[3] !== undefined ? { t: 'm', id: m[1], a: 's', i: Number(m[3]) } : { t: 'm', id: m[1], a: m[2] as 'p' | 'r' };
  const s = /^s:([0-9a-z]{1,16}):(c|s(\d{1,2}))$/.exec(str);
  if (s) return s[3] !== undefined ? { t: 's', id: s[1], a: 's', i: Number(s[3]) } : { t: 's', id: s[1], a: 'c' };
  const r = /^r:([0-9a-z]{1,16}):c$/.exec(str);
  if (r) return { t: 'r', id: r[1], a: 'c' };
  const w = /^w:([0-9a-z]{1,16}):(\d{1,3}):(d|p|x)$/.exec(str);
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
