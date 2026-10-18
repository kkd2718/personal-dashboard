// `propose_change`: the only write path of /ask. It builds an AX Proposal that is stored
// as a pending record and applied only when the owner presses 적용 (docs/PLAN_ASK.md §4).
import { z } from 'zod';
import type { Proposal } from '@/lib/logic/ax-proposal';
import { addMinutesKst } from '@/lib/logic/ko-datetime';
import { extractEmailOrDomain } from '@/lib/logic/waiting';
import type { Deadline, DeadlineKind, Project, Task } from '@/lib/types';
import { ToolError, defineTool, findProject, type AskToolDef } from '@/lib/ask/tools';

export const MAX_PROPOSALS = 3;
const MAX_BODY = 1000;

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:mm');
const title = z.string().trim().min(1).max(120);
const KINDS = ['paper', 'review', 'grant', 'thesis', 'interview', 'date', 'personal', 'other'] as const;

export const proposeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('task_create'), title, project: z.string().optional(), dueDate: date.optional() }),
  z.object({ kind: z.literal('task_done'), taskId: z.string().min(1) }),
  z.object({ kind: z.literal('task_reschedule'), taskId: z.string().min(1), to: date }),
  z.object({
    kind: z.literal('deadline_create'),
    title,
    dueDate: date,
    dueTime: time.optional(),
    project: z.string().optional(),
    deadlineKind: z.enum(KINDS).optional(),
  }),
  z.object({ kind: z.literal('deadline_done'), deadlineId: z.string().min(1) }),
  z.object({ kind: z.literal('deadline_reschedule'), deadlineId: z.string().min(1), to: date, dueTime: time.optional() }),
  z.object({ kind: z.literal('calendar_event'), title, date, startTime: time.optional(), endTime: time.optional() }),
  z.object({
    kind: z.literal('waiting_reply'),
    title,
    from: z.string().optional(),
    subject: z.string().max(100).optional(),
    nudgeAfterDays: z.number().int().min(1).max(60).optional(),
    project: z.string().optional(),
  }),
  z.object({ kind: z.literal('send_memo'), project: z.string().min(1), body: z.string().trim().min(1).max(MAX_BODY) }),
]);

export type ProposeInput = z.infer<typeof proposeSchema>;

/** Top-level `type: object` is required by the API, so it sees one flat shape; `proposeSchema` validates strictly. */
const FLAT_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    kind: { type: 'string', enum: proposeSchema.options.map((o) => o.shape.kind.value) },
    title: { type: 'string', description: '제목 (task_create/deadline_create/calendar_event/waiting_reply)' },
    project: { type: 'string', description: '프로젝트 slug/이름 (task_create/deadline_create/waiting_reply/send_memo)' },
    dueDate: { type: 'string', description: 'YYYY-MM-DD (task_create 선택, deadline_create 필수)' },
    taskId: { type: 'string', description: 'task_done/task_reschedule 대상 id (list_tasks에서)' },
    deadlineId: { type: 'string', description: 'deadline_done/deadline_reschedule 대상 id (list_deadlines에서)' },
    to: { type: 'string', description: '새 날짜 YYYY-MM-DD (task_reschedule/deadline_reschedule)' },
    dueTime: { type: 'string', description: 'HH:mm (deadline_create/deadline_reschedule)' },
    deadlineKind: { type: 'string', enum: [...KINDS], description: 'deadline_create 종류 (기본 other)' },
    date: { type: 'string', description: 'YYYY-MM-DD (calendar_event)' },
    startTime: { type: 'string', description: 'HH:mm, 없으면 종일 (calendar_event)' },
    endTime: { type: 'string', description: 'HH:mm, 시작이 있을 때만 (calendar_event)' },
    from: { type: 'string', description: '답장을 기다리는 상대 메일 주소/도메인 (waiting_reply)' },
    subject: { type: 'string', description: '메일 제목 키워드 (waiting_reply)' },
    nudgeAfterDays: { type: 'integer', description: '이 일수가 지나도 답이 없으면 알림 (기본 7)' },
    body: { type: 'string', description: '프로젝트 Claude 세션에 전달할 메모 (send_memo, <=1000자)' },
  },
  required: ['kind'],
};

export interface ProposeCtx {
  today: string;
  tasks: Task[];
  deadlines: Deadline[];
  projects: Project[];
}

export type ProposeResult = { ok: true; proposal: Proposal } | { ok: false; reason: string };

/** Maps tool input to an AX Proposal after checking ids exist and are open, and dates are not in the past. */
export function proposalFromInput(input: ProposeInput, ctx: ProposeCtx): ProposeResult {
  const fail = (reason: string): ProposeResult => ({ ok: false, reason });
  const notPast = (d: string | undefined): boolean => d === undefined || d >= ctx.today;
  const project = (q: string | undefined): Project | null | undefined => (q ? findProject(ctx.projects, q) : undefined);

  switch (input.kind) {
    case 'task_create': {
      const p = project(input.project);
      if (p === null) return fail('프로젝트를 찾을 수 없어요');
      if (!notPast(input.dueDate)) return fail('과거 날짜예요');
      return {
        ok: true,
        proposal: { kind: 'task_create', title: input.title, projectId: p?.id ?? null, projectName: p?.name ?? null, dueDate: input.dueDate ?? null },
      };
    }
    case 'task_done':
    case 'task_reschedule': {
      const task = ctx.tasks.find((t) => t.id === input.taskId);
      if (!task) return fail('할 일을 찾을 수 없어요');
      if (task.status === 'done') return fail('이미 완료된 할 일이에요');
      if (input.kind === 'task_done') return { ok: true, proposal: { kind: 'task_done', taskId: task.id, title: task.title } };
      if (!notPast(input.to)) return fail('과거 날짜예요');
      if (input.to === task.dueDate) return fail('이미 그 날짜예요');
      return { ok: true, proposal: { kind: 'task_reschedule', taskId: task.id, title: task.title, from: task.dueDate, to: input.to } };
    }
    case 'deadline_create': {
      const p = project(input.project);
      if (p === null) return fail('프로젝트를 찾을 수 없어요');
      if (!notPast(input.dueDate)) return fail('과거 날짜예요');
      return {
        ok: true,
        proposal: {
          kind: 'deadline_create',
          title: input.title,
          dueDate: input.dueDate,
          dueTime: input.dueTime ?? null,
          projectId: p?.id ?? null,
          deadlineKind: (input.deadlineKind ?? 'other') as DeadlineKind,
        },
      };
    }
    case 'deadline_done':
    case 'deadline_reschedule': {
      const dl = ctx.deadlines.find((d) => d.id === input.deadlineId);
      if (!dl) return fail('마감을 찾을 수 없어요');
      if (dl.done) return fail('이미 완료된 마감이에요');
      if (input.kind === 'deadline_done') return { ok: true, proposal: { kind: 'deadline_done', deadlineId: dl.id, title: dl.title } };
      if (!notPast(input.to)) return fail('과거 날짜예요');
      if (input.to === dl.dueDate && (!input.dueTime || input.dueTime === dl.dueTime)) return fail('이미 그 날짜예요');
      return {
        ok: true,
        proposal: {
          kind: 'deadline_reschedule',
          deadlineId: dl.id,
          title: dl.title,
          from: dl.dueDate,
          to: input.to,
          ...(input.dueTime ? { dueTime: input.dueTime } : {}),
        },
      };
    }
    case 'calendar_event': {
      if (!notPast(input.date)) return fail('과거 날짜예요');
      if (input.endTime && !input.startTime) return fail('종료 시간만 있을 수 없어요');
      let endTime = input.endTime ?? null;
      if (input.startTime && !endTime) {
        const end = addMinutesKst(input.date, input.startTime, 60);
        endTime = end.date === input.date ? end.time : '23:59';
      }
      if (input.startTime && endTime && endTime <= input.startTime) return fail('종료 시간이 시작보다 빨라요');
      return {
        ok: true,
        proposal: { kind: 'calendar_event', events: [{ title: input.title, date: input.date, startTime: input.startTime ?? null, endTime }] },
      };
    }
    case 'waiting_reply': {
      const p = project(input.project);
      if (p === null) return fail('프로젝트를 찾을 수 없어요');
      const from = input.from ? extractEmailOrDomain(input.from) : null;
      if (input.from && !from) return fail('보낸이는 메일 주소나 도메인이어야 해요');
      const subject = input.subject?.trim();
      return {
        ok: true,
        proposal: {
          kind: 'waiting_reply',
          title: input.title,
          projectId: p?.id ?? null,
          match: { ...(from ? { from } : {}), ...(subject ? { subject } : {}) },
          nudgeAfterDays: input.nudgeAfterDays ?? 7,
          taskId: null,
          deadlineId: null,
        },
      };
    }
    case 'send_memo': {
      const p = findProject(ctx.projects, input.project);
      if (!p) return fail('프로젝트를 찾을 수 없어요');
      return { ok: true, proposal: { kind: 'send_memo', projectId: p.id, projectName: p.name, body: input.body } };
    }
  }
}

/** Per-request tool that collects proposals into `out` (max 3). Nothing is written here. */
export function createProposeTool(out: Proposal[]): AskToolDef<unknown> {
  // Parallel tool_use blocks run concurrently: reserve the slot before the first await.
  let reserved = 0;
  return defineTool({
    name: 'propose_change',
    description:
      '대시보드 변경을 "제안"한다(직접 반영되지 않음 — 사용자가 [적용] 버튼을 눌러야 반영). 한 번의 질문에 최대 3개. ' +
      'kind: task_create/task_done/task_reschedule/deadline_create/deadline_done/deadline_reschedule/calendar_event/waiting_reply/send_memo. ' +
      'id는 먼저 조회 도구로 확인할 것. 캘린더 추가는 연동 설정이 있어야 적용된다.',
    schema: proposeSchema,
    inputSchema: FLAT_INPUT_SCHEMA,
    async run(repo, input: ProposeInput, ctx) {
      if (reserved >= MAX_PROPOSALS) throw new ToolError(`한 번에 ${MAX_PROPOSALS}개까지만 제안할 수 있어요`);
      reserved++;
      try {
        const [tasks, deadlines, projects] = await Promise.all([repo.listTasks(), repo.listDeadlines(), repo.listProjects()]);
        const built = proposalFromInput(input, { today: ctx.today, tasks, deadlines, projects });
        if (!built.ok) throw new ToolError(built.reason);
        out.push(built.proposal);
        return `제안 #${out.length} 생성 — 사용자가 [적용]을 눌러야 반영됩니다`;
      } catch (e) {
        reserved--;
        throw e;
      }
    },
  });
}
