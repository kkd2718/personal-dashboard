// Sunday weekly review (docs/PLAN_AX.md §8), run from the evening cron: one message
// listing slipped/stale items with per-item buttons (완료 / +1주 / 안 함).
import { JEV_DAILY_LIMIT_AX, takeJevBudget } from '@/lib/ai/jev-budget';
import type { Jev, JevQuestion } from '@/lib/ai/jev';
import { savePending, type PendingRepo } from '@/lib/ax/pending';
import { confident } from '@/lib/logic/ax-intent';
import { newShortId } from '@/lib/logic/ax-proposal';
import { addDaysStr } from '@/lib/logic/dates';
import { applyShift, rescheduleBase } from '@/lib/logic/ko-datetime';
import {
  buildWeeklyReview,
  formatWeekly,
  isSunday,
  weeklyKeyboard,
  type PendingWeekly,
  type WeeklyItem,
  type WeeklyReview,
} from '@/lib/logic/weekly-review';
import { resolveProjectItem, type ChecklistRepo } from '@/lib/project-checklist';
import type { Repo } from '@/lib/repo';
import type { InlineKeyboard } from '@/lib/telegram/client';
import { loadProjectDue } from '@/lib/telegram/digest';

export type WeeklyResult = 'sent' | 'skipped-empty' | 'skipped-already' | 'skipped-weekday' | 'failed';

const META_KEY = 'telegram:weekly:lastSent';
const PROJECT_OVERDUE_DAYS = 30;

export type WeeklyRepo = PendingRepo &
  ChecklistRepo &
  Pick<Repo, 'listTasks' | 'updateTask' | 'listDeadlines' | 'updateDeadline' | 'listProjects'>;

type SendWithMarkup = (text: string, markup: InlineKeyboard) => Promise<{ ok: boolean }>;

const HINT_CRITERIA = {
  keep: '계속 유지: 아직 유효하고 곧 할 일',
  postpone: '1주 미루기: 지금은 어렵지만 여전히 필요',
  drop: '버리기: 더 이상 필요 없음',
};

/** One Jev request, one choice question per item; a hint is kept only when confident. */
async function addHints(repo: WeeklyRepo, jev: Jev, review: WeeklyReview, today: string): Promise<void> {
  if (review.items.length === 0 || !(await takeJevBudget(repo, 'ax', today, JEV_DAILY_LIMIT_AX))) return;
  const questions: Record<string, JevQuestion> = {};
  review.items.forEach((item, i) => {
    const due = item.due ? `마감 ${item.due}` : '마감 없음';
    questions[`q${i}`] = {
      type: 'choice',
      instructions: `"${item.title}" (${item.project ?? '프로젝트 없음'}, ${due}) 항목을 어떻게 할까요?`,
      criteria: HINT_CRITERIA,
    };
  });
  const answers = await jev.ask(`오늘: ${today}\n주간 점검 항목 ${review.items.length}개`, questions);
  review.items.forEach((item, i) => {
    const a = answers?.[`q${i}`];
    if (a?.type === 'choice' && confident(a) && a.choice in HINT_CRITERIA) item.hint = a.choice as WeeklyItem['hint'];
  });
}

/** At most once per KST day, Sundays only (`force` bypasses both). Nothing to review: no message,
 * but the day is still recorded. */
export async function runWeekly(
  repo: WeeklyRepo,
  sendWithMarkup: SendWithMarkup,
  today: string,
  opts: { force: boolean; jev: Jev | null; now?: () => Date }
): Promise<WeeklyResult> {
  if (!opts.force && (await repo.getMeta<string>(META_KEY)) === today) return 'skipped-already';
  if (!opts.force && !isSunday(today)) return 'skipped-weekday';

  const [tasks, deadlines, projects, projectDue] = await Promise.all([
    repo.listTasks(),
    repo.listDeadlines(),
    repo.listProjects(),
    loadProjectDue(repo, today, PROJECT_OVERDUE_DAYS),
  ]);
  const review = buildWeeklyReview({ today, tasks, deadlines, projectDue, projects });
  if (review.items.length === 0 && review.clusters.length === 0) {
    await repo.setMeta(META_KEY, today);
    return 'skipped-empty';
  }

  if (opts.jev) {
    try {
      await addHints(repo, opts.jev, review, today);
    } catch {
      // hints are optional
    }
  }

  const createdAt = (opts.now?.() ?? new Date()).toISOString();
  const record: PendingWeekly = { type: 'weekly', id: newShortId(), createdAt, today, review };
  await savePending(repo, record, createdAt);
  const sent = await sendWithMarkup(formatWeekly(review, today), weeklyKeyboard(record.id, review.items));
  if (!sent.ok) return 'failed';
  await repo.setMeta(META_KEY, today);
  return 'sent';
}

const NOT_FOUND = '대상을 찾을 수 없어요 (삭제됨?)';

/** Applies one button to item `index`; returns the updated record and a short result line.
 * An item that is no longer open is left alone (`이미 처리됨`). */
export async function applyWeeklyAction(
  repo: WeeklyRepo,
  record: PendingWeekly,
  index: number,
  action: 'd' | 'p' | 'x',
  today: string
): Promise<{ record: PendingWeekly; result: string }> {
  const item = record.review.items[index];
  if (!item || item.state !== 'open') return { record, result: '이미 처리됨' };

  const nextState: WeeklyItem['state'] = action === 'd' ? 'done' : action === 'p' ? 'postponed' : 'dropped';
  const nextDue = (due: string | null) => applyShift(rescheduleBase(due, today), { unit: 'day', n: 7 });
  const week = addDaysStr(today, 7);

  const ref = item.ref;
  if (ref.kind === 'task') {
    const task = (await repo.listTasks()).find((t) => t.id === ref.id);
    if (!task) return { record, result: NOT_FOUND };
    if (action === 'd') await repo.updateTask(task.id, { status: 'done' });
    else if (action === 'p') await repo.updateTask(task.id, { dueDate: nextDue(task.dueDate) });
    else await repo.updateTask(task.id, { status: 'done', description: `${task.description ?? ''}\n[안 함 ${today}]` });
  } else if (ref.kind === 'deadline') {
    const dl = (await repo.listDeadlines()).find((d) => d.id === ref.id);
    if (!dl) return { record, result: NOT_FOUND };
    if (action === 'p') await repo.updateDeadline(dl.id, { dueDate: nextDue(dl.dueDate) });
    else await repo.updateDeadline(dl.id, { done: true });
  } else {
    const state = action === 'd' ? 'done' : action === 'p' ? 'snooze' : 'skip';
    await resolveProjectItem(
      repo,
      { projectId: ref.projectId, text: ref.text, state, ...(action === 'p' ? { until: week } : {}) },
      today,
      'telegram'
    );
  }

  const items = record.review.items.map((it, i) => (i === index ? { ...it, state: nextState } : it));
  const result = action === 'd' ? '✅ 완료 처리했어요' : action === 'p' ? '⏩ 1주 미뤘어요' : '✖ 안 함으로 정리했어요';
  return { record: { ...record, review: { ...record.review, items } }, result };
}
