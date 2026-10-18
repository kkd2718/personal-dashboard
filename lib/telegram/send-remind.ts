// Owner commands /send (dispatch a memo into a project's Claude session) and /remind (Google Calendar
// popup at an exact time). Explicit commands: no AI, no confirmation; each reply carries a cancel button.
import { claimPending, loadPendingRaw, savePending } from '@/lib/ax/pending';
import { deleteCalendarEvent, getEventKind, insertCalendarEvent, optimisticCalendarEvent, type GoogleCalendarConfig } from '@/lib/google/calendar';
import { GOOGLE_AUTH_EXPIRED } from '@/lib/google/calendar-write';
import { newShortId, type CallbackData } from '@/lib/logic/ax-proposal';
import { addDaysStr, kstDateTime } from '@/lib/logic/dates';
import {
  REMIND_USAGE,
  SEND_USAGE,
  googleEventId,
  parseRemindArg,
  parseSendArg,
  recentActiveProjects,
  remindExpiry,
  reminderEvent,
  reminderText,
  sendCancelKeyboard,
  sendNoteBody,
  sendPickKeyboard,
  upcomingReminders,
  whenLabel,
  type PendingRemind,
  type PendingSend,
} from '@/lib/logic/send-remind';
import type { AxDeps, CallbackInput } from '@/lib/telegram/ax';
import { escapeHtml } from '@/lib/telegram/format';
import type { CalendarEvent, Project } from '@/lib/types';

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

// ---------------------------------------------------------------- /send

export async function handleSend(deps: AxDeps, arg: string, replyToText: string | null): Promise<void> {
  const projects = await deps.repo.listProjects();
  const { content, projectId } = parseSendArg(arg, projects, replyToText);
  if (!content) return void (await deps.send(escapeHtml(SEND_USAGE)));
  const nowIso = deps.now().toISOString();
  const project = projects.find((p) => p.id === projectId);

  if (project) {
    const record: PendingSend = { type: 'send', id: newShortId(), createdAt: nowIso, content };
    const sent = await dispatchSend(deps, record, project, nowIso);
    return void (await deps.sendWithMarkup(sent.text, sendCancelKeyboard(record.id)));
  }

  const choices = recentActiveProjects(projects, await deps.repo.listProjectActivity());
  if (choices.length === 0) return void (await deps.send('프로젝트가 없어요'));
  const record: PendingSend = { type: 'send', id: newShortId(), createdAt: nowIso, content, choices: choices.map((p) => p.id) };
  await savePending(deps.repo, record, nowIso);
  await deps.sendWithMarkup(`📂 어느 프로젝트에 보낼까요?\n<i>${escapeHtml(clip(content, 80))}</i>`, sendPickKeyboard(record.id, choices));
}

/** Creates the 'sent' memo and stores the record (with the note id) the cancel button reads. */
async function dispatchSend(deps: AxDeps, record: PendingSend, project: Project, nowIso: string): Promise<{ text: string }> {
  const note = await deps.repo.createNote({ body: sendNoteBody(record.content), kind: 'memo', projectId: project.id, source: 'telegram' });
  await deps.repo.updateNote(note.id, { status: 'sent' });
  await savePending(deps.repo, { ...record, noteId: note.id, projectName: project.name }, nowIso);
  deps.onApplied?.();
  return { text: `📨 ${escapeHtml(project.name)} 세션에 전달 예약됨 — 다음 세션 입력 때 들어가요` };
}

type SendCb = Extract<CallbackData, { t: 's' }>;

export async function handleSendCallback(deps: AxDeps, cb: CallbackInput, decoded: SendCb): Promise<void> {
  const raw = await loadPendingRaw(deps.repo, decoded.id);
  if (!raw || raw.type !== 'send') return void (await deps.answer(cb.callbackId, '만료됨'));
  const record = raw as PendingSend;
  const nowIso = deps.now().toISOString();

  if (decoded.a === 's') {
    const projectId = record.choices?.[decoded.i];
    const project = projectId ? (await deps.repo.listProjects()).find((p) => p.id === projectId) : undefined;
    if (!project) return void (await deps.answer(cb.callbackId, '프로젝트를 찾을 수 없어요'));
    if (!(await claimPending(deps.repo, `${record.id}:s`, nowIso))) return void (await deps.answer(cb.callbackId, '이미 처리됨'));
    try {
      const sent = await dispatchSend(deps, record, project, nowIso);
      await deps.edit(cb.messageId, sent.text, sendCancelKeyboard(record.id));
      await deps.answer(cb.callbackId, '보냈어요');
    } catch {
      await deps.repo.deleteMeta(`ax:applied:${record.id}:s`).catch(() => {});
      await deps.answer(cb.callbackId, '⚠️ 처리하지 못했어요');
    }
    return;
  }

  const name = escapeHtml(record.projectName ?? '');
  if (!record.noteId) return void (await deps.answer(cb.callbackId, '아직 전달 전이에요'));
  if (!(await claimPending(deps.repo, `${record.id}:c`, nowIso))) return void (await deps.answer(cb.callbackId, '이미 처리됨'));
  const note = (await deps.repo.listNotes()).find((n) => n.id === record.noteId);
  if (!note || note.status !== 'sent') {
    await deps.edit(cb.messageId, `📨 ${name} 세션 전달 — 이미 처리됨`, null);
    return void (await deps.answer(cb.callbackId, '이미 처리됨'));
  }
  if (note.deliveredAt) {
    await deps.edit(cb.messageId, `📨 ${name} 세션에 이미 전달됨`, null);
    return void (await deps.answer(cb.callbackId, '이미 전달됨'));
  }
  await deps.repo.updateNote(note.id, { status: 'archived' });
  deps.onApplied?.();
  await deps.edit(cb.messageId, `✖ ${name} 세션 전달을 취소했어요`, null);
  await deps.answer(cb.callbackId, '취소했어요');
}

// -------------------------------------------------------------- /remind

const NO_CONFIG = '구글 캘린더 연동(GOOGLE_OAUTH_*)이 없어요';
const NO_CONFIG_LIST = `${NO_CONFIG} — 알림을 보거나 취소할 수 없어요`;
const scopeOf = (cfg: GoogleCalendarConfig) => ({ account: cfg.account, calendar: cfg.calendarId });

export async function handleRemind(deps: AxDeps, arg: string): Promise<void> {
  const text = arg.trim();
  if (!text) return void (await deps.send(escapeHtml(REMIND_USAGE)));
  const cfg = deps.calendarCfg;
  const nowIso = deps.now().toISOString();
  const { date: today, time: nowTime } = kstDateTime(nowIso);
  const cmd = parseRemindArg(text, today, nowTime);
  if (!cfg) {
    if (cmd.kind === 'cancel') return void (await deps.send(NO_CONFIG_LIST));
    await deps.createNote(text);
    return void (await deps.send(`${NO_CONFIG} — 메모로 저장했어요`));
  }

  if (cmd.kind === 'usage') return void (await deps.send(escapeHtml(REMIND_USAGE)));
  if (cmd.kind === 'past') return void (await deps.send('과거 시각이에요'));
  if (cmd.kind === 'cancel') return void (await deps.send(await cancelByNumber(deps, cfg, cmd.n, today, nowTime)));

  const ev = reminderEvent(cmd.content, cmd.date, cmd.time);
  const res = await insertCalendarEvent(cfg, ev, deps.fetchImpl);
  if (!res.ok) return void (await deps.send(res.error === 'invalid_grant' ? GOOGLE_AUTH_EXPIRED : '구글 캘린더에 추가하지 못했어요'));

  let rowId: string | null = null;
  if (cfg.account) {
    try {
      const seg = cfg.calendarId === 'primary' ? 'primary' : cfg.calendarId;
      const known = (await deps.repo.listCalendarEvents(addDaysStr(today, -7), addDaysStr(today, 60))).find(
        (r) => r.account === cfg.account && r.id.split(':')[1] === seg
      );
      const row = optimisticCalendarEvent(cfg.account, seg, known?.calendarName ?? res.value.organizerEmail ?? 'Google', res.value.eventId, ev, nowIso);
      await deps.repo.upsertCalendarEvent(row);
      rowId = row.id;
    } catch {
      // the event exists in Google; the hourly sync mirrors it
    }
  }
  deps.onApplied?.();

  const summary = `🔔 ${cmd.rolled ? '내일 ' : ''}${whenLabel(cmd.date, cmd.time)} 알림 설정 — 구글 캘린더 알림으로 와요\n${escapeHtml(cmd.content)}`;
  const id = newShortId();
  const record: PendingRemind = { type: 'remind', id, createdAt: nowIso, eventId: res.value.eventId, date: cmd.date, rowId, account: cfg.account, summary, expiresAt: remindExpiry(cmd.date, cmd.time) };
  await savePending(deps.repo, record, nowIso);
  await deps.sendWithMarkup(summary, { inline_keyboard: [[{ text: '취소', callback_data: `r:${id}:c` }]] });
}

export async function handleReminds(deps: AxDeps): Promise<void> {
  const cfg = deps.calendarCfg;
  if (!cfg) return void (await deps.send(NO_CONFIG_LIST));
  const { date: today, time: nowTime } = kstDateTime(deps.now().toISOString());
  const rows = upcomingReminders(await deps.repo.listCalendarEvents(today, addDaysStr(today, 14)), today, nowTime, scopeOf(cfg));
  if (rows.length === 0) return void (await deps.send('예정된 알림이 없어요'));
  const lines = rows.map((r, i) => `${i + 1}. ${whenLabel(r.startDate, r.startTime as string)} ${escapeHtml(clip(reminderText(r), 60))}`);
  await deps.send([`<b>🔔 예정된 알림 ${rows.length}건</b>`, ...lines, '<i>취소: /remind 취소 번호</i>'].join('\n'));
}

async function cancelByNumber(deps: AxDeps, cfg: GoogleCalendarConfig, n: number, today: string, nowTime: string): Promise<string> {
  const rows = upcomingReminders(await deps.repo.listCalendarEvents(today, addDaysStr(today, 14)), today, nowTime, scopeOf(cfg));
  const row = rows[n - 1];
  if (!row) return '그 번호의 알림이 없어요 (/reminds)';
  const eventId = googleEventId(row.id);
  if (!eventId) return '이 알림은 취소할 수 없어요';
  // Deleting a recurring event by id removes the whole series: refuse it.
  const kind = await getEventKind(cfg, eventId, deps.fetchImpl);
  if (!kind.ok) return kind.error === 'invalid_grant' ? GOOGLE_AUTH_EXPIRED : '구글 캘린더에서 확인하지 못했어요';
  if (kind.value.recurring) return '반복 일정은 캘린더에서 지워 주세요';
  const res = await deleteCalendarEvent(cfg, eventId, deps.fetchImpl);
  if (!res.ok) return res.error === 'invalid_grant' ? GOOGLE_AUTH_EXPIRED : '구글 캘린더에서 지우지 못했어요';
  await dropRow(deps, row.account, row.startDate, row.id);
  deps.onApplied?.();
  return `🗑 알림 취소: ${whenLabel(row.startDate, row.startTime as string)} ${escapeHtml(clip(reminderText(row), 60))}`;
}

/** Removes one mirrored row until the next sync would (replace is per account and day). */
async function dropRow(deps: AxDeps, account: string, date: string, rowId: string): Promise<void> {
  try {
    const rows: CalendarEvent[] = await deps.repo.listCalendarEvents(date, date);
    await deps.repo.replaceCalendarEvents(account, date, date, rows.filter((r) => r.account === account && r.id !== rowId));
  } catch {
    // best-effort: the hourly sync removes it
  }
}

type RemindCb = Extract<CallbackData, { t: 'r' }>;

export async function handleRemindCallback(deps: AxDeps, cb: CallbackInput, decoded: RemindCb): Promise<void> {
  const raw = await loadPendingRaw(deps.repo, decoded.id);
  if (!raw || raw.type !== 'remind') return void (await deps.answer(cb.callbackId, '만료됨'));
  const record = raw as PendingRemind;
  const cfg = deps.calendarCfg;
  if (!cfg) return void (await deps.answer(cb.callbackId, NO_CONFIG));
  const nowIso = deps.now().toISOString();
  if (!(await claimPending(deps.repo, `${record.id}:c`, nowIso))) return void (await deps.answer(cb.callbackId, '이미 처리됨'));
  const res = await deleteCalendarEvent(cfg, record.eventId, deps.fetchImpl);
  if (!res.ok) {
    await deps.repo.deleteMeta(`ax:applied:${record.id}:c`).catch(() => {}); // let the owner retry
    return void (await deps.answer(cb.callbackId, res.error === 'invalid_grant' ? '구글 인증 만료' : '⚠️ 지우지 못했어요'));
  }
  if (record.rowId && record.account) await dropRow(deps, record.account, record.date, record.rowId);
  deps.onApplied?.();
  await deps.edit(cb.messageId, `${record.summary}\n<i>취소했어요 (캘린더에서 삭제)</i>`, null);
  await deps.answer(cb.callbackId, '취소했어요');
}
