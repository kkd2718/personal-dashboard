// Daily digest orchestration (phase 2b), extracted from app/api/cron/daily so it
// can be unit-tested with a fake repo + fake sender (no Next.js route needed).
import type { CalendarEvent, Deadline, Project, ProjectDetail, ReviewJob, Task, TradingSummary } from '@/lib/types';
import { staleGoogleAccounts } from '@/lib/logic/integrations';
import {
  meChecklistDue,
  projectDetailMetaKey,
  hiddenProjectItemKeys,
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
import { loadRoutineCounts, loadRoutineDone, loadRoutineItems } from '@/lib/routines-data';
import { formatDigest } from '@/lib/telegram/format';
import { waitingNudges } from '@/lib/logic/waiting';
import { loadWaiting } from '@/lib/waiting-data';
import type { SendResult } from '@/lib/telegram/client';
import type { AskClient } from '@/lib/ask/client';
import type { SpendRepo } from '@/lib/ask/spend';
import { loadBriefs } from '@/lib/market-brief-data';
import { formatMacroBlock, macroSentence } from '@/lib/telegram/macro';
import { splitTelegram } from '@/lib/logic/ask-text';

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
  listMetaByPrefix?(prefix: string): Promise<Record<string, unknown>>;
}

export type Sender = (text: string) => Promise<SendResult>;

/** My overdue/today/tomorrow items across every non-archived project's cc-status
 * checklist (shared by the digest and /today). */
export async function loadProjectDue(
  repo: Pick<DigestRepo, 'listProjects' | 'getMeta'>,
  today: string,
  overdueDays = 7
): Promise<DueChecklist> {
  const projects = (await repo.listProjects()).filter((p) => p.status !== 'archived');
  const [details, resolved] = await Promise.all([
    Promise.all(projects.map((p) => repo.getMeta<ProjectDetail>(projectDetailMetaKey(p.id)))),
    repo.getMeta<ResolvedProjectItems>(RESOLVED_PROJECT_ITEMS_META_KEY),
  ]);
  return meChecklistDue(
    projects.map((p, i) => ({ projectId: p.id, projectName: p.name, status: details[i]?.status ?? null })),
    today,
    overdueDays,
    hiddenProjectItemKeys(resolved, today)
  );
}

/** At most once per KST day (`force` bypasses the guard, still requires cron auth
 * upstream). Empty digest -> no message, no `lastSent` write. */
export async function runDigest(
  repo: DigestRepo,
  sender: Sender,
  today: string,
  force: boolean,
  cloudUrl: string | null,
  /** Enables the Haiku "what changed vs yesterday" sentence of the 📈 매크로 block. */
  ai?: { client: AskClient | null; repo: SpendRepo }
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
  const routines = routineStatus(routineItems, routineDone, today, await loadRoutineCounts(repo, today));
  const waiting = waitingNudges(await loadWaiting(repo), today).map((n) => ({ title: n.item.title, days: n.days }));
  const googleMeta = repo.listMetaByPrefix ? await repo.listMetaByPrefix('integration:google:') : {};
  const message = formatDigest({
    staleSyncs: staleGoogleAccounts(googleMeta, new Date().toISOString()),
    routines,
    waiting,
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
  const nowIso = new Date().toISOString();
  const { current: market, prev: marketPrev } = await loadBriefs(repo).catch(() => ({ current: null, prev: null }));
  const sentence = ai ? await macroSentence({ client: ai.client, repo: ai.repo, today }, market, marketPrev, nowIso).catch(() => null) : null;
  const macroBlock = formatMacroBlock(market, today, nowIso, sentence?.text ?? null);
  const base = message ?? (macroBlock ? '<b>☀️ 브리핑</b>' : null);
  if (!base) return 'skipped-empty';
  // Account summary line, only when the collector refreshed it within ~a day (the PC
  // may be off; a stale total would read as today's).
  const tradingLine =
    trading && Date.now() - new Date(trading.collectedAt).getTime() < 30 * 3_600_000
      ? `

💰 계좌 ${tradingOneLine(trading, today)}`
      : '';

  // One message when it fits; otherwise the macro block goes separately (split if needed).
  const main = base + tradingLine;
  const parts = !macroBlock ? splitTelegram(main) : main.length + macroBlock.length + 2 <= 4000 ? [`${main}

${macroBlock}`] : [...splitTelegram(main), ...splitTelegram(macroBlock)];
  for (const part of parts) {
    if (!(await sender(part)).ok) return 'failed';
  }

  await repo.setMeta(META_KEY, today);
  // Settings §5.8 연동 상태 rows read this back (PLAN_UX.md decision 3).
  await repo.setMeta('integration:telegram', { at: new Date().toISOString(), detail: '다이제스트 전송' });
  return 'sent';
}
