// Applies a confirmed Proposal and returns a short Korean (HTML-safe) result line.
import { createCalendarEvents } from '@/lib/google/calendar-write';
import type { GoogleCalendarConfig } from '@/lib/google/calendar';
import type { Proposal } from '@/lib/logic/ax-proposal';
import { absoluteDateLabel } from '@/lib/logic/dates';
import { escapeHtml, formatCalReply } from '@/lib/telegram/format';
import { newWaitingId, newWaitingItem } from '@/lib/logic/waiting';
import { addWaitingItem } from '@/lib/waiting-data';
import type { Repo } from '@/lib/repo';

export type ApplyRepo = Pick<
  Repo,
  | 'listTasks'
  | 'updateTask'
  | 'listDeadlines'
  | 'updateDeadline'
  | 'listCalendarEvents'
  | 'upsertCalendarEvent'
  | 'getMeta'
  | 'setMeta'
>;

export interface ApplyDeps {
  today: string;
  calendarCfg: GoogleCalendarConfig | null;
  fetchImpl?: typeof fetch;
}

const MISSING = '대상을 찾을 수 없어요 (삭제됨?)';
const ALREADY = '이미 완료돼 있어요';

export async function applyProposal(repo: ApplyRepo, deps: ApplyDeps, p: Proposal): Promise<string> {
  const day = (d: string) => escapeHtml(absoluteDateLabel(d, deps.today));
  switch (p.kind) {
    case 'task_done': {
      const task = (await repo.listTasks()).find((t) => t.id === p.taskId);
      if (!task) return MISSING;
      if (task.status === 'done') return ALREADY;
      await repo.updateTask(task.id, { status: 'done' });
      return '✅ 완료 처리했어요';
    }
    case 'task_reschedule': {
      const task = (await repo.listTasks()).find((t) => t.id === p.taskId);
      if (!task) return MISSING;
      if (task.status === 'done') return ALREADY;
      await repo.updateTask(task.id, { dueDate: p.to });
      return `✅ 마감을 ${day(p.to)}로 바꿨어요`;
    }
    case 'deadline_done': {
      const dl = (await repo.listDeadlines()).find((d) => d.id === p.deadlineId);
      if (!dl) return MISSING;
      if (dl.done) return ALREADY;
      await repo.updateDeadline(dl.id, { done: true });
      return '✅ 완료 처리했어요';
    }
    case 'deadline_reschedule': {
      const dl = (await repo.listDeadlines()).find((d) => d.id === p.deadlineId);
      if (!dl) return MISSING;
      if (dl.done) return ALREADY;
      await repo.updateDeadline(dl.id, { dueDate: p.to, ...(p.dueTime ? { dueTime: p.dueTime } : {}) });
      return `✅ 마감을 ${day(p.to)}${p.dueTime ? ` ${p.dueTime}` : ''}로 바꿨어요`;
    }
    case 'calendar_event': {
      if (!deps.calendarCfg) return '캘린더 연동 미설정';
      const { created, error } = await createCalendarEvents(repo, deps.calendarCfg, p.events, deps.fetchImpl);
      return [created.length > 0 ? formatCalReply(created) : null, error ? escapeHtml(error) : null]
        .filter(Boolean)
        .join('\n');
    }
    case 'waiting_reply': {
      await addWaitingItem(repo, newWaitingItem(p, deps.today, new Date().toISOString(), newWaitingId()));
      return '⏳ 답장 대기에 등록했어요 (/waits)';
    }
  }
}
