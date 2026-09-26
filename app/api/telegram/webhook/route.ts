import { NextResponse } from 'next/server';
import { constantTimeEqual } from '@/lib/auth/bearer';
import { telegramConfig, sendMessage } from '@/lib/telegram/client';
import { formatCaptureReply, formatToday, formatUpcomingList, parseUpdate, route } from '@/lib/telegram/format';
import { createNoteFromText } from '@/lib/create-note';
import { getRepo } from '@/lib/repo';
import { checklist } from '@/lib/logic/checklist';
import { upcoming } from '@/lib/logic/upcoming';
import { todayKST } from '@/lib/logic/dates';
import { CALENDAR_VISIBLE_META_KEY, filterVisibleEvents } from '@/lib/logic/calendar';

export const dynamic = 'force-dynamic';

const HELP_TEXT = '메모는 그냥 보내면 저장돼요. @프로젝트 #태그 지원 · /today · /deadlines';

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

  const update = parseUpdate(json);
  // Wrong chat: silence — never reveal the bot exists to anyone else.
  if (!update || String(update.chatId) !== config.chatId) {
    return NextResponse.json({ ok: true });
  }

  try {
    await handle(update.text);
  } catch {
    await sendMessage('저장 실패: 잠시 후 다시 시도해 주세요');
  }
  return NextResponse.json({ ok: true });
}

async function handle(text: string): Promise<void> {
  const parsed = route(text);
  if (parsed.kind === 'capture') {
    const note = await createNoteFromText(parsed.text, null, 'telegram');
    const projectName = note.projectId
      ? (await getRepo().listProjects()).find((p) => p.id === note.projectId)?.name ?? null
      : null;
    await sendMessage(formatCaptureReply(note, projectName));
    return;
  }

  switch (parsed.name) {
    case 'today':
      await sendMessage(await buildToday());
      return;
    case 'deadlines':
      await sendMessage(await buildDeadlines());
      return;
    case 'help':
    case 'start':
    case 'unknown':
      await sendMessage(HELP_TEXT);
  }
}

async function buildToday(): Promise<string> {
  const repo = getRepo();
  const today = todayKST();
  const [tasks, deadlines, reviews, notes, snapshot, rawTodayEvents, visibleCalendars] = await Promise.all([
    repo.listTasks(),
    repo.listDeadlines(),
    repo.listReviews(),
    repo.listNotes(),
    repo.getStatusSnapshot(),
    repo.listCalendarEvents(today, today),
    repo.getMeta<string[]>(CALENDAR_VISIBLE_META_KEY),
  ]);
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
  });
}

async function buildDeadlines(): Promise<string> {
  const repo = getRepo();
  const [deadlines, reviews] = await Promise.all([repo.listDeadlines(), repo.listReviews()]);
  const today = todayKST();
  return formatUpcomingList(upcoming(deadlines, reviews, today, 14));
}
