// Daily digest orchestration (phase 2b), extracted from app/api/cron/daily so it
// can be unit-tested with a fake repo + fake sender (no Next.js route needed).
import type { CalendarEvent, Deadline, Project, ProjectDetail, ReviewJob, Task, TradingSummary } from '@/lib/types';
import {
  meChecklistDue,
  projectDetailMetaKey,
  RESOLVED_PROJECT_ITEMS_META_KEY,
  type DueChecklist,
  type ResolvedProjectItems,
} from '@/lib/logic/project-detail';
import { TRADING_SUMMARY_META_KEY, tradingOneLine } from '@/lib/logic/trading';
import type { StatusItem } from '@/lib/status/types';
import { checklist } from '@/lib/logic/checklist';
import { CALENDAR_VISIBLE_META_KEY, filterVisibleEvents } from '@/lib/logic/calendar';
import { WORK_SHIFTS_META_KEY, type WorkShiftsMeta } from '@/lib/logic/work';
import { routineStatus } from '@/lib/logic/routines';
import { loadRoutineDone, loadRoutineItems } from '@/lib/routines-data';
import { formatDigest } from '@/lib/telegram/format';
import type { SendResult } from '@/lib/telegram/client';

export type DigestResult = 'sent' | 'skipped-empty' | 'skipped-already' | 'failed';

const META_KEY = 'telegram:digest:lastSent';

export interface DigestRepo {
  listProjects(): Promise<Project[]>;
  listTasks(): Promise<Task[]>;
  listDeadlines(): Promise<Deadline[]>;
  listReviews(): Promise<ReviewJob[]>;
  getStatusSnapshot(): Promise<{ items: StatusItem[] } | null>;
  listCalendarEvents(from: string, to: string): Promise<CalendarEvent[]>;
  getMeta<T>(key: string): Promise<T | null>;
  setMeta(key: string, value: unknown): Promise<void>;
}

export type Sender = (text: string) => Promise<SendResult>;

/** My overdue/today/tomorrow items across every non-archived project's cc-status
 * checklist (shared by the digest and /today). */
export async function loadProjectDue(
  repo: Pick<DigestRepo, 'listProjects' | 'getMeta'>,
  today: string
): Promise<DueChecklist> {
  const projects = (await repo.listProjects()).filter((p) => p.status !== 'archived');
  const [details, resolved] = await Promise.all([
    Promise.all(projects.map((p) => repo.getMeta<ProjectDetail>(projectDetailMetaKey(p.id)))),
    repo.getMeta<ResolvedProjectItems>(RESOLVED_PROJECT_ITEMS_META_KEY),
  ]);
  return meChecklistDue(
    projects.map((p, i) => ({ projectId: p.id, projectName: p.name, status: details[i]?.status ?? null })),
    today,
    7,
    new Set(Object.keys(resolved ?? {}))
  );
}

/** At most once per KST day (`force` bypasses the guard, still requires cron auth
 * upstream). Empty digest -> no message, no `lastSent` write. */
export async function runDigest(
  repo: DigestRepo,
  sender: Sender,
  today: string,
  force: boolean,
  cloudUrl: string | null
): Promise<DigestResult> {
  if (!force) {
    const lastSent = await repo.getMeta<string>(META_KEY);
    if (lastSent === today) return 'skipped-already';
  }

  const [tasks, deadlines, reviews, snapshot, rawTodayEvents, visibleCalendars, trading, work, projectDue, routineItems, routineDone] = await Promise.all([
    repo.listTasks(),
    repo.listDeadlines(),
    repo.listReviews(),
    repo.getStatusSnapshot(),
    repo.listCalendarEvents(today, today),
    repo.getMeta<string[]>(CALENDAR_VISIBLE_META_KEY),
    repo.getMeta<TradingSummary>(TRADING_SUMMARY_META_KEY),
    repo.getMeta<WorkShiftsMeta>(WORK_SHIFTS_META_KEY),
    loadProjectDue(repo, today),
    loadRoutineItems(repo),
    loadRoutineDone(repo, today),
  ]);
  const me = checklist(tasks, deadlines, reviews, today).me;
  const routines = routineStatus(routineItems, routineDone, today);
  const message = formatDigest({
    routines,
    projectDue,
    today,
    deadlines,
    reviews,
    checklist: me,
    todayEvents: filterVisibleEvents(rawTodayEvents, visibleCalendars),
    statusItems: snapshot?.items ?? [],
    cloudUrl,
    workShift: work?.shifts.find((s) => s.date === today) ?? null,
  });
  if (!message) return 'skipped-empty';
  // Account summary line, only when the collector refreshed it within ~a day (the PC
  // may be off; a stale total would read as today's).
  const tradingLine =
    trading && Date.now() - new Date(trading.collectedAt).getTime() < 30 * 3_600_000
      ? `

💰 계좌 ${tradingOneLine(trading, today)}`
      : '';

  const result = await sender(message + tradingLine);
  if (!result.ok) return 'failed';

  await repo.setMeta(META_KEY, today);
  // Settings §5.8 연동 상태 rows read this back (PLAN_UX.md decision 3).
  await repo.setMeta('integration:telegram', { at: new Date().toISOString(), detail: '다이제스트 전송' });
  return 'sent';
}
