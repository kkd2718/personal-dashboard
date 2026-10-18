// Read-only dashboard tools for /ask (docs/PLAN_ASK.md §3.3). Every input is zod-validated,
// outputs are compact and carry ids. Nothing here writes, and nothing reads env, tokens,
// arbitrary meta keys, trading accounts or `#비공개` memos.
import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { CALENDAR_VISIBLE_META_KEY, filterVisibleEvents } from '@/lib/logic/calendar';
import { normalize } from '@/lib/logic/capture';
import { checklist, type ChecklistItem } from '@/lib/logic/checklist';
import { dday } from '@/lib/logic/dates';
import { projectDetailMetaKey } from '@/lib/logic/project-detail';
import { ROUTINE_DONE_PREFIX, ROUTINE_ITEMS_META_KEY, SEED_ROUTINES, routineCountMetaKey, routineDoneMetaKey, routineStatus, routineStreak, type RoutineItem } from '@/lib/logic/routines';
import { TRADING_SUMMARY_META_KEY } from '@/lib/logic/trading';
import { upcoming } from '@/lib/logic/upcoming';
import { WAITING_META_KEY, type WaitingItem } from '@/lib/logic/waiting';
import type { Repo } from '@/lib/repo';
import type { Project, ProjectDetail, TradingSummary } from '@/lib/types';

export type AskRepo = Pick<
  Repo,
  | 'listTasks'
  | 'listDeadlines'
  | 'listProjects'
  | 'listPapers'
  | 'listReviews'
  | 'listNotes'
  | 'listCalendarEvents'
  | 'listProjectActivity'
  | 'getStatusSnapshot'
  | 'getMeta'
  | 'listMetaByPrefix'
>;

export interface AskToolCtx {
  today: string;
}

export interface AskToolDef<I> {
  name: string;
  description: string;
  schema: z.ZodType<I>;
  inputSchema: Record<string, unknown>;
  run(repo: AskRepo, input: I, ctx: AskToolCtx): Promise<unknown>;
}

/** An error whose message is safe to show the model verbatim. */
export class ToolError extends Error {}

const MAX_RESULT_CHARS = 6000;

/** Registers a tool: derives the API JSON schema from the zod schema. */
export function defineTool<I>(
  def: Omit<AskToolDef<I>, 'inputSchema'> & { inputSchema?: Record<string, unknown> }
): AskToolDef<unknown> {
  const json = def.inputSchema ?? (z.toJSONSchema(def.schema, { io: 'input' }) as Record<string, unknown>);
  delete json.$schema;
  return { ...def, inputSchema: json } as unknown as AskToolDef<unknown>;
}

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');
const clip = (s: string | null | undefined, n: number): string => (s && s.length > n ? `${s.slice(0, n - 1)}…` : (s ?? ''));

/** Project by id/slug/name/alias (normalized; exact first, then prefix). */
export function findProject(projects: Project[], query: string): Project | null {
  const q = normalize(query);
  const keys = (p: Project) => [p.id, p.slug, p.name, ...p.aliases].map(normalize);
  return (
    projects.find((p) => keys(p).includes(q)) ??
    projects.find((p) => keys(p).some((k) => q.length >= 2 && (k.startsWith(q) || q.startsWith(k)))) ??
    null
  );
}

function resolveProject(projects: Project[], query: string): Project {
  const hit = findProject(projects, query);
  if (!hit) throw new ToolError(`프로젝트를 찾을 수 없어요: ${clip(query, 40)}`);
  return hit;
}

const nameOf = (projects: Project[], id: string | null | undefined): string | null =>
  (id && projects.find((p) => p.id === id)?.name) || null;

const item = (c: ChecklistItem) => ({ id: c.id, title: c.title, kind: c.kind, due: c.dueDate, done: c.done || undefined });

async function visibleEvents(repo: AskRepo, from: string, to: string) {
  const [events, visible] = await Promise.all([
    repo.listCalendarEvents(from, to),
    repo.getMeta<string[]>(CALENDAR_VISIBLE_META_KEY),
  ]);
  return filterVisibleEvents(events, visible);
}

async function routineRows(repo: AskRepo, day: string) {
  const [items, done, counts, history] = await Promise.all([
    repo.getMeta<RoutineItem[]>(ROUTINE_ITEMS_META_KEY),
    repo.getMeta<string[]>(routineDoneMetaKey(day)),
    repo.getMeta<Record<string, number>>(routineCountMetaKey(day)),
    repo.listMetaByPrefix(ROUTINE_DONE_PREFIX),
  ]);
  const byDate: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(history)) if (Array.isArray(v)) byDate[k.slice(ROUTINE_DONE_PREFIX.length)] = v as string[];
  byDate[day] = done ?? [];
  return routineStatus(items ?? SEED_ROUTINES, done ?? [], day, counts ?? {}).map((r) => ({
    id: r.item.id,
    label: r.item.label,
    done: r.done,
    ...(r.count !== undefined ? { count: r.count, unit: r.item.unit ?? null } : {}),
    streak: routineStreak(byDate, r.item.id, day),
  }));
}

const overview = defineTool({
  name: 'get_overview',
  description: '오늘 기준 요약: 내 체크리스트(지연/오늘/이번 주/진행 중/다음), 14일 내 마감, 오늘 일정, 오늘 루틴.',
  schema: z.object({ date: date.optional() }),
  async run(repo, input: { date?: string }, ctx) {
    const day = input.date ?? ctx.today;
    const [tasks, deadlines, reviews, events, routines] = await Promise.all([
      repo.listTasks(),
      repo.listDeadlines(),
      repo.listReviews(),
      visibleEvents(repo, day, day),
      routineRows(repo, day),
    ]);
    const me = checklist(tasks, deadlines, reviews, day).me;
    const cap = (l: ChecklistItem[]) => l.slice(0, 15).map(item);
    return {
      date: day,
      overdue: cap(me.overdue),
      today: cap(me.today),
      thisWeek: cap(me.thisWeek),
      doing: cap(me.doing),
      next: cap(me.next),
      upcoming: upcoming(deadlines, reviews, day, 14).map((u) => ({
        id: u.originId,
        origin: u.origin,
        title: u.title,
        due: u.dueDate,
        time: u.dueTime,
        dday: u.dday,
      })),
      events: events.map((e) => ({ title: e.title, start: e.startTime, end: e.endTime })),
      routines,
    };
  },
});

const listTasks = defineTool({
  name: 'list_tasks',
  description: '할 일 목록. status: open(기본)/done/all, project, assignee(me|agent), query(제목 부분 일치).',
  schema: z.object({
    status: z.enum(['open', 'done', 'all']).default('open'),
    project: z.string().optional(),
    assignee: z.enum(['me', 'agent']).optional(),
    query: z.string().optional(),
    limit: z.number().int().min(1).max(50).default(30),
  }),
  async run(repo, input: { status: 'open' | 'done' | 'all'; project?: string; assignee?: 'me' | 'agent'; query?: string; limit: number }) {
    const [tasks, projects] = await Promise.all([repo.listTasks(), repo.listProjects()]);
    const projectId = input.project ? resolveProject(projects, input.project).id : null;
    const q = input.query?.toLowerCase();
    return tasks
      .filter((t) => (input.status === 'all' ? true : input.status === 'done' ? t.status === 'done' : t.status !== 'done'))
      .filter((t) => !projectId || t.projectId === projectId)
      .filter((t) => !input.assignee || t.assignee === input.assignee)
      .filter((t) => !q || t.title.toLowerCase().includes(q))
      .sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') || b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, input.limit)
      .map((t) => ({
        id: t.id,
        title: t.title,
        project: nameOf(projects, t.projectId),
        status: t.status,
        dueDate: t.dueDate,
        assignee: t.assignee,
        updatedAt: t.updatedAt,
      }));
  },
});

const listDeadlines = defineTool({
  name: 'list_deadlines',
  description: '마감 목록(기본: 미완료). from/to(YYYY-MM-DD), query, includeDone.',
  schema: z.object({
    includeDone: z.boolean().default(false),
    from: date.optional(),
    to: date.optional(),
    query: z.string().optional(),
  }),
  async run(repo, input: { includeDone: boolean; from?: string; to?: string; query?: string }) {
    const [deadlines, projects] = await Promise.all([repo.listDeadlines(), repo.listProjects()]);
    const q = input.query?.toLowerCase();
    return deadlines
      .filter((d) => input.includeDone || !d.done)
      .filter((d) => (!input.from || d.dueDate >= input.from) && (!input.to || d.dueDate <= input.to))
      .filter((d) => !q || d.title.toLowerCase().includes(q))
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || (a.dueTime ?? '').localeCompare(b.dueTime ?? ''))
      .slice(0, 60)
      .map((d) => ({
        id: d.id,
        title: d.title,
        kind: d.kind,
        dueDate: d.dueDate,
        dueTime: d.dueTime,
        project: nameOf(projects, d.projectId),
        done: d.done,
      }));
  },
});

const listProjects = defineTool({
  name: 'list_projects',
  description: '프로젝트 목록(status: active|paused|done|archived).',
  schema: z.object({ status: z.enum(['active', 'paused', 'done', 'archived']).optional() }),
  async run(repo, input: { status?: string }) {
    return (await repo.listProjects())
      .filter((p) => !input.status || p.status === input.status)
      .map((p) => ({ id: p.id, slug: p.slug, name: p.name, status: p.status, summary: clip(p.summary, 160), nextAction: p.nextAction }));
  },
});

const projectDetail = defineTool({
  name: 'get_project_detail',
  description: '프로젝트 하나의 최근 활동(브랜치/마지막 커밋)과 cc-status(focus/next/blockers/체크리스트), 백로그 열린 항목.',
  schema: z.object({ project: z.string().min(1) }),
  async run(repo, input: { project: string }) {
    const projects = await repo.listProjects();
    const p = resolveProject(projects, input.project);
    const [detail, activity] = await Promise.all([
      repo.getMeta<ProjectDetail>(projectDetailMetaKey(p.id)),
      repo.listProjectActivity(),
    ]);
    const act = activity.find((a) => a.projectId === p.id);
    const status = detail?.status ?? null;
    return {
      project: { id: p.id, slug: p.slug, name: p.name, status: p.status, summary: clip(p.summary, 200), nextAction: p.nextAction },
      activity: act ? { branch: act.branch, lastCommitAt: act.lastCommitAt, lastCommitMsg: clip(act.lastCommitMsg, 120) } : null,
      status: status && {
        updatedAt: status.updatedAt,
        focus: status.focus,
        next: status.next,
        blockers: status.blockers,
        checklist: status.checklist
          .filter((c) => c.status !== 'done')
          .slice(0, 30)
          .map((c) => ({ text: clip(c.text, 100), status: c.status, owner: c.owner, due: c.due ?? null })),
      },
      openItems: Object.fromEntries(Object.entries(detail?.openItems ?? {}).map(([k, v]) => [k, v.slice(0, 15).map((t) => clip(t, 100))])),
    };
  },
});

const listPapers = defineTool({
  name: 'list_papers',
  description: '논문 목록(stage: idea|writing|submitted|under_review|revision|accepted|published).',
  schema: z.object({ stage: z.enum(['idea', 'writing', 'submitted', 'under_review', 'revision', 'accepted', 'published']).optional() }),
  async run(repo, input: { stage?: string }) {
    const [papers, projects] = await Promise.all([repo.listPapers(), repo.listProjects()]);
    return papers
      .filter((p) => !input.stage || p.stage === input.stage)
      .slice(0, 40)
      .map((p) => ({
        id: p.id,
        shortName: p.shortName,
        title: clip(p.title, 100),
        stage: p.stage,
        journal: p.journal,
        nextAction: p.nextAction,
        project: nameOf(projects, p.projectId),
      }));
  },
});

const listReviews = defineTool({
  name: 'list_reviews',
  description: '심사(리뷰) 요청 목록(status: invited|accepted|submitted|declined).',
  schema: z.object({ status: z.enum(['invited', 'accepted', 'submitted', 'declined']).optional() }),
  async run(repo, input: { status?: string }) {
    return (await repo.listReviews())
      .filter((r) => !input.status || r.status === input.status)
      .slice(0, 40)
      .map((r) => ({ id: r.id, journal: r.journal, manuscriptId: r.manuscriptId, status: r.status, dueDate: r.dueDate }));
  },
});

const listEvents = defineTool({
  name: 'list_calendar_events',
  description: '캘린더 일정(보이는 캘린더만). from/to(YYYY-MM-DD), 최대 62일.',
  schema: z.object({ from: date, to: date }),
  async run(repo, input: { from: string; to: string }) {
    const span = dday(input.to, input.from);
    if (span < 0 || span > 62) throw new ToolError('기간은 0~62일이어야 해요');
    return (await visibleEvents(repo, input.from, input.to)).slice(0, 100).map((e) => ({
      title: e.title,
      start: e.startDate,
      end: e.endDate,
      startTime: e.startTime,
      endTime: e.endTime,
      location: e.location,
      calendar: e.calendarName,
    }));
  },
});

const listWaiting = defineTool({
  name: 'list_waiting',
  description: '답장 대기 목록(status: open 기본|replied|closed|all). 도착한 답장은 짧은 발췌 포함.',
  schema: z.object({ status: z.enum(['open', 'replied', 'closed', 'all']).default('open') }),
  async run(repo, input: { status: string }) {
    const [items, projects] = await Promise.all([repo.getMeta<WaitingItem[]>(WAITING_META_KEY), repo.listProjects()]);
    return (items ?? [])
      .filter((w) => input.status === 'all' || w.status === input.status)
      .slice(0, 40)
      .map((w) => ({
        id: w.id,
        title: w.title,
        project: nameOf(projects, w.projectId),
        status: w.status,
        since: w.since,
        nudgeAfterDays: w.nudgeAfterDays,
        match: w.match,
        reply: w.reply
          ? { from: w.reply.from, subject: clip(w.reply.subject, 80), snippet: clip(w.reply.snippet, 300), date: w.reply.date, category: w.reply.category ?? null }
          : null,
      }));
  },
});

const getRoutines = defineTool({
  name: 'get_routines',
  description: '그날의 루틴 완료 현황(개수 루틴은 count)과 연속 일수.',
  schema: z.object({ date: date.optional() }),
  async run(repo, input: { date?: string }, ctx) {
    return routineRows(repo, input.date ?? ctx.today);
  },
});

const PRIVATE_TAG = /^(비공개|private)$/i;
const PRIVATE_IN_BODY = /#(비공개|private)(?![\p{L}\p{N}_-])/iu;

const searchMemos = defineTool({
  name: 'search_memos',
  description: '메모 본문 검색(보관됨·#비공개 메모는 제외). query 필수, project/limit(<=20) 선택.',
  schema: z.object({
    query: z.string().min(1),
    project: z.string().optional(),
    limit: z.number().int().min(1).max(20).default(10),
  }),
  async run(repo, input: { query: string; project?: string; limit: number }) {
    const [notes, projects] = await Promise.all([repo.listNotes(), repo.listProjects()]);
    const projectId = input.project ? resolveProject(projects, input.project).id : null;
    const q = input.query.toLowerCase();
    return notes
      .filter((n) => n.status !== 'archived')
      .filter((n) => !n.tags.some((t) => PRIVATE_TAG.test(t)) && !PRIVATE_IN_BODY.test(n.body))
      .filter((n) => !projectId || n.projectId === projectId)
      .filter((n) => n.body.toLowerCase().includes(q))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, input.limit)
      .map((n) => ({
        id: n.id,
        body: clip(n.body, 300),
        project: nameOf(projects, n.projectId),
        tags: n.tags,
        date: n.date,
        status: n.status,
        createdAt: n.createdAt,
      }));
  },
});

const getStatus = defineTool({
  name: 'get_status',
  description: '상태 패널 항목(트레이딩/깃 경고 등): 제목, 상세, 심각도.',
  schema: z.object({}),
  async run(repo) {
    const snap = await repo.getStatusSnapshot();
    return { collectedAt: snap?.collectedAt ?? null, items: (snap?.items ?? []).slice(0, 30).map((i) => ({ title: i.title, detail: clip(i.detail, 160), severity: i.severity, source: i.source })) };
  },
});

const getTradingTotal = defineTool({
  name: 'get_trading_total',
  description: '트레이딩 계좌 합계 하나(총액/일간 변동)만. 계좌별·종목별 정보는 제공하지 않아요.',
  schema: z.object({}),
  async run(repo) {
    const s = await repo.getMeta<TradingSummary>(TRADING_SUMMARY_META_KEY);
    if (!s) return { totalKrw: null, dayChangeKrw: null, dayChangePct: null, collectedAt: null };
    return { totalKrw: s.totalKrw, dayChangeKrw: s.dayChangeKrw, dayChangePct: s.dayChangePct, collectedAt: s.collectedAt };
  },
});

export const READ_TOOLS: AskToolDef<unknown>[] = [
  overview,
  listTasks,
  listDeadlines,
  listProjects,
  projectDetail,
  listPapers,
  listReviews,
  listEvents,
  listWaiting,
  getRoutines,
  searchMemos,
  getStatus,
  getTradingTotal,
];

/** API tool definitions; the last one carries the cache breakpoint (tools + system are the stable prefix). */
export function toolDefsForApi(tools: AskToolDef<unknown>[]): Anthropic.Messages.Tool[] {
  return tools.map((t, i) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema as Anthropic.Messages.Tool.InputSchema,
    ...(i === tools.length - 1 ? { cache_control: { type: 'ephemeral' as const } } : {}),
  }));
}

export interface ToolOutcome {
  content: string;
  isError: boolean;
}

/** Validates, runs and serializes one tool call. Never throws; failures are short Korean strings for the model. */
export async function runTool(
  repo: AskRepo,
  name: string,
  rawInput: unknown,
  ctx: AskToolCtx,
  tools: AskToolDef<unknown>[] = READ_TOOLS
): Promise<ToolOutcome> {
  const tool = tools.find((t) => t.name === name);
  if (!tool) return { content: `알 수 없는 도구: ${clip(name, 40)}`, isError: true };
  const parsed = tool.schema.safeParse(rawInput ?? {});
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { content: `입력 오류: ${issue?.path.join('.') || '입력'} ${clip(issue?.message, 80)}`, isError: true };
  }
  try {
    const out = JSON.stringify(await tool.run(repo, parsed.data, ctx)) ?? 'null';
    return { content: out.length > MAX_RESULT_CHARS ? `${out.slice(0, MAX_RESULT_CHARS)}…(생략)` : out, isError: false };
  } catch (e) {
    return { content: e instanceof ToolError ? e.message : '도구 실행에 실패했어요', isError: true };
  }
}
