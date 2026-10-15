import { NextResponse } from 'next/server';
import { constantTimeEqual } from '@/lib/auth/bearer';
import { answerCallbackQuery, editMessageText, sendMessage, telegramConfig } from '@/lib/telegram/client';
import { handleCallback, handleFreeText, type AxDeps } from '@/lib/telegram/ax';
import {
  MAIL_TRIAGE_CONFIG_KEY,
  applyMailRule,
  normalizeTriageConfig,
  parseMailRule,
} from '@/lib/logic/mail-triage';
import { openWaitingList, parseWaitCommand, resolveWaitTarget } from '@/lib/logic/waiting';
import { loadWaiting, patchWaitingItem } from '@/lib/waiting-data';
import { createJev, jevToken } from '@/lib/ai/jev';
import { rememberUpdate } from '@/lib/logic/ax-proposal';
import { WORK_SHIFTS_META_KEY, type WorkShiftsMeta } from '@/lib/logic/work';
import {
  escapeHtml,
  WAIT_USAGE,
  formatCalReply,
  formatWaitList,
  formatRoutineList,
  formatToday,
  formatUpcomingList,
  parseTelegramUpdate,
  route,
} from '@/lib/telegram/format';
import {
  formatRoutineCount,
  isCountRoutine,
  matchRoutine,
  parseDoneArg,
  routineDoneMetaKey,
  routineStatus,
  routineStreak,
} from '@/lib/logic/routines';
import {
  changeRoutineCount,
  loadRoutineCounts,
  loadRoutineDone,
  loadRoutineDoneHistory,
  loadRoutineItems,
} from '@/lib/routines-data';
import { loadProjectDue } from '@/lib/telegram/digest';
import { createNoteFromText } from '@/lib/create-note';
import { getRepo } from '@/lib/repo';
import { checklist } from '@/lib/logic/checklist';
import { upcoming } from '@/lib/logic/upcoming';
import { nowKstTime, todayKST } from '@/lib/logic/dates';
import { stripTokens } from '@/lib/logic/capture';
import { parseKoDateTime, stripRequestVerbs, stripSpans } from '@/lib/logic/ko-datetime';
import { eventsFromParsed, googleCalendarConfig } from '@/lib/google/calendar';
import { createCalendarEvents } from '@/lib/google/calendar-write';
import { revalidateAll } from '@/app/actions/revalidate';
import { CALENDAR_VISIBLE_META_KEY, filterVisibleEvents } from '@/lib/logic/calendar';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const RECENT_UPDATES_KEY = 'telegram:updates:recent';

const HELP_TEXT = '메모는 그냥 보내면 저장돼요. @프로젝트 #태그 지원 · /today · /deadlines · /done 1 (루틴 완료, /done 알렌 5 = 개수) · /cal 내일 오후 3시 치과 (캘린더에 바로 추가) · /waits (답장 대기 목록)';

/** Telegram Bot API webhook (phase 2b). Always 200s (Telegram retries non-2xx) —
 * failures are reported to the chat, not via the HTTP status. */
export async function POST(request: Request) {
  const config = telegramConfig();
  if (!config) {
    return NextResponse.json({ ok: false, error: 'telegram not configured' }, { status: 503 });
  }

  const header = request.headers.get('x-telegram-bot-api-secret-token') ?? '';
  if (!constantTimeEqual(header, config.secret)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ ok: true });
  }

  const update = parseTelegramUpdate(json);
  // Wrong chat: silence — never reveal the bot exists to anyone else.
  if (!update || String(update.chatId) !== config.chatId) {
    return NextResponse.json({ ok: true });
  }

  // Telegram re-sends an update when the webhook is slow; handle each update_id once.
  const updateId = update.updateId;
  if (updateId !== null) {
    try {
      const repo = getRepo();
      const { seen, next } = rememberUpdate((await repo.getMeta<number[]>(RECENT_UPDATES_KEY)) ?? [], updateId);
      if (seen) return NextResponse.json({ ok: true });
      await repo.setMeta(RECENT_UPDATES_KEY, next);
    } catch {
      // dedupe is best-effort — never drop a message because the ring failed
    }
  }

  try {
    const deps = axDeps(request);
    if (update.kind === 'callback') await handleCallback(deps, update);
    else await handle(update.text, deps);
    // Settings §5.8 연동 상태 rows read this back (PLAN_UX.md decision 3).
    await getRepo().setMeta('integration:telegram', { at: new Date().toISOString(), detail: '메시지 수신' });
  } catch {
    await sendMessage('저장 실패: 잠시 후 다시 시도해 주세요');
  }
  return NextResponse.json({ ok: true });
}

function axDeps(request: Request): AxDeps {
  return {
    repo: getRepo(),
    jev: createJev({ token: jevToken(process.env, request.headers) }),
    send: sendMessage,
    sendWithMarkup: (text, markup) => sendMessage(text, { replyMarkup: markup }),
    edit: editMessageText,
    answer: answerCallbackQuery,
    createNote: (text) => createNoteFromText(text, null, 'telegram'),
    calendarCfg: googleCalendarConfig(),
    now: () => new Date(),
    onApplied: revalidateAll,
  };
}

async function handle(text: string, deps: AxDeps): Promise<void> {
  const parsed = route(text);
  if (parsed.kind === 'capture') {
    await handleFreeText(deps, parsed.text);
    return;
  }

  switch (parsed.name) {
    case 'today':
      await sendMessage(await buildToday());
      return;
    case 'deadlines':
      await sendMessage(await buildDeadlines());
      return;
    case 'done':
      await sendMessage(await handleDone(parsed.arg));
      return;
    case 'cal':
      await sendMessage(await handleCal(parsed.arg));
      return;
    case 'waits':
      await sendMessage(formatWaitList(openWaitingList(await loadWaiting(getRepo())), todayKST()));
      return;
    case 'wait':
      await sendMessage(await handleWait(parsed.arg));
      return;
    case 'mailrule':
      await sendMessage(await handleMailRule(parsed.arg));
      return;
    case 'help':
    case 'start':
    case 'unknown':
      await sendMessage(HELP_TEXT);
  }
}

const MAIL_RULE_USAGE = '사용법: /mailrule list · /mailrule allow a@b.com · /mailrule deny @b.com · /mailrule remove a@b.com';

/** `/mailrule`: edits the mail-triage allow/deny lists (always alert / never alert). */
async function handleMailRule(arg: string): Promise<string> {
  const repo = getRepo();
  const cmd = parseMailRule(arg);
  if (cmd.kind === 'invalid') return escapeHtml(MAIL_RULE_USAGE);
  let cfg = normalizeTriageConfig(await repo.getMeta(MAIL_TRIAGE_CONFIG_KEY));
  if (cmd.kind !== 'list') {
    cfg = applyMailRule(cfg, cmd);
    await repo.setMeta(MAIL_TRIAGE_CONFIG_KEY, cfg);
  }
  const show = (list: string[]) => (list.length > 0 ? list.map(escapeHtml).join(', ') : '(없음)');
  return `<b>📧 메일 규칙</b>
항상 알림: ${show(cfg.allow)}
알림 안 함: ${show(cfg.deny)}`;
}

/** `/wait`: lists, edits (from/subject/days) closes or reopens a reply-wait by list number or id. */
async function handleWait(arg: string): Promise<string> {
  const repo = getRepo();
  const cmd = parseWaitCommand(arg);
  if (cmd.kind === 'invalid') return escapeHtml(WAIT_USAGE);
  if (cmd.kind === 'list') return formatWaitList(openWaitingList(await loadWaiting(repo)), todayKST());

  const item = resolveWaitTarget(await loadWaiting(repo), cmd.target);
  if (!item) return '그 번호/ID의 대기 항목을 찾을 수 없어요';
  if (cmd.kind === 'close') {
    await patchWaitingItem(repo, item.id, (it) => ({ ...it, status: 'closed' }));
    return `✅ 대기 종료: ${escapeHtml(item.title)}`;
  }
  if (cmd.kind === 'reopen') {
    // Fresh createdAt/since so the reply that closed it can't match again.
    await patchWaitingItem(repo, item.id, (it) => ({
      ...it,
      reply: undefined,
      status: 'open',
      since: todayKST(),
      createdAt: new Date().toISOString(),
    }));
    return `🔄 다시 대기: ${escapeHtml(item.title)}`;
  }
  const { from, subject, nudgeAfterDays } = cmd.patch;
  await patchWaitingItem(repo, item.id, (it) => {
    const match = { ...it.match };
    if (from === null) delete match.from;
    else if (from !== undefined) match.from = from;
    if (subject === null) delete match.subject;
    else if (subject !== undefined) match.subject = subject;
    return { ...it, match, ...(nudgeAfterDays !== undefined ? { nudgeAfterDays } : {}) };
  });
  return `✏️ 수정했어요: ${escapeHtml(item.title)}`;
}

/** `/cal <text>`: parses a Korean date/time phrase and inserts the event into Google
 * Calendar immediately. Without OAuth config the text is saved as a memo instead. */
async function handleCal(arg: string): Promise<string> {
  const text = arg.trim();
  if (!text) return '사용법: /cal 내일 오후 3시 치과';
  const cfg = googleCalendarConfig();
  if (!cfg) {
    await createNoteFromText(text, null, 'telegram');
    return '캘린더 연동 미설정 — 메모로 저장했어요';
  }
  const today = todayKST();
  const parsed = parseKoDateTime(text, today);
  const events = eventsFromParsed(parsed, today, nowKstTime());
  if ('error' in events) return events.error;
  const title = stripRequestVerbs(stripTokens(stripSpans(text, parsed.spans)));
  if (!title) return '제목을 찾지 못했어요';
  const { created, error } = await createCalendarEvents(
    getRepo(),
    cfg,
    events.map((e) => ({ ...e, title }))
  );
  if (created.length > 0) revalidateAll();
  return [created.length > 0 ? formatCalReply(created) : null, error ? escapeHtml(error) : null]
    .filter(Boolean)
    .join('\n');
}

/** `/done <n|이름> [개수]`: marks today's matching routine done (count routines: adds
 * the count, or `=N` sets it); no/unknown argument lists them. */
async function handleDone(arg: string): Promise<string> {
  const repo = getRepo();
  const today = todayKST();
  const [items, doneIds, counts] = await Promise.all([
    loadRoutineItems(repo),
    loadRoutineDone(repo, today),
    loadRoutineCounts(repo, today),
  ]);
  const rows = routineStatus(items, doneIds, today, counts);
  const { query, change } = parseDoneArg(arg);
  const match = query ? matchRoutine(rows.map((r) => r.item), query) : null;
  if (!match) return formatRoutineList(rows);

  if (isCountRoutine(match)) {
    if (!change) {
      const current = formatRoutineCount(match, counts[match.id] ?? 0);
      return `${escapeHtml(match.label)}: 오늘 ${escapeHtml(current)} — 개수를 붙여 보내세요 (예: /done ${escapeHtml(query)} 5)`;
    }
    const count = await changeRoutineCount(repo, match.id, today, change);
    const history = await loadRoutineDoneHistory(repo);
    const streak = routineStreak(history, match.id, today);
    return `${count > 0 ? '✅' : '⬜'} ${escapeHtml(match.label)} 오늘 ${escapeHtml(formatRoutineCount(match, count))}${streak > 1 ? ` (🔥${streak})` : ''}`;
  }

  const nextDone = doneIds.includes(match.id) ? doneIds : [...doneIds, match.id];
  await repo.setMeta(routineDoneMetaKey(today), nextDone);
  const history = await loadRoutineDoneHistory(repo);
  history[today] = nextDone;
  const streak = routineStreak(history, match.id, today);
  return `✅ ${escapeHtml(match.label)} 완료${streak > 1 ? ` (🔥${streak})` : ''}`;
}

async function buildToday(): Promise<string> {
  const repo = getRepo();
  const today = todayKST();
  const [tasks, deadlines, reviews, notes, snapshot, rawTodayEvents, visibleCalendars, work, projectDue, routineItems, routineDone] = await Promise.all([
    repo.listTasks(),
    repo.listDeadlines(),
    repo.listReviews(),
    repo.listNotes(),
    repo.getStatusSnapshot(),
    repo.listCalendarEvents(today, today),
    repo.getMeta<string[]>(CALENDAR_VISIBLE_META_KEY),
    repo.getMeta<WorkShiftsMeta>(WORK_SHIFTS_META_KEY),
    loadProjectDue(repo, today),
    loadRoutineItems(repo),
    loadRoutineDone(repo, today),
  ]);
  const routineCounts = await loadRoutineCounts(repo, today);
  const me = checklist(tasks, deadlines, reviews, today).me;
  const dayMemos = notes.filter((n) => n.date === today && n.status !== 'archived');
  return formatToday({
    today,
    checklist: me,
    upcoming: upcoming(deadlines, reviews, today, 7),
    dayMemos,
    todayEvents: filterVisibleEvents(rawTodayEvents, visibleCalendars),
    statusItems: snapshot?.items ?? [],
    cloudUrl: process.env.CLOUD_URL ?? null,
    workShift: work?.shifts.find((s) => s.date === today) ?? null,
    projectDue,
    routines: routineStatus(routineItems, routineDone, today, routineCounts),
  });
}

async function buildDeadlines(): Promise<string> {
  const repo = getRepo();
  const [deadlines, reviews] = await Promise.all([repo.listDeadlines(), repo.listReviews()]);
  const today = todayKST();
  return formatUpcomingList(upcoming(deadlines, reviews, today, 14));
}
