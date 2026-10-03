'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Bot, CalendarDays, Plus } from 'lucide-react';
import { checklist, checklistItemCount, type ChecklistItem } from '@/lib/logic/checklist';
import { dday, todayKST } from '@/lib/logic/dates';
import { createTaskAction, toggleTaskDoneAction } from '@/app/actions/tasks';
import { toggleDeadlineDoneAction } from '@/app/actions/deadlines';
import { updateReviewAction } from '@/app/actions/reviews';
import { useToast } from '@/components/ui/toast';
import { DdayChip } from '@/components/dday-chip';
import { EmptyState } from '@/components/ui/empty-state';
import { projectColorClasses } from '@/lib/project-colors';
import type { CalendarEvent, Deadline, Project, ReviewJob, Task } from '@/lib/types';

const DEADLINE_KIND_LABEL: Record<string, string> = {
  paper: '논문',
  review: '리뷰',
  grant: '과제',
  thesis: '학위',
  interview: '면접',
  date: '일정',
  personal: '개인',
  other: '기타',
};

function Row({
  item,
  projects,
  today,
  onToggle,
  isAgent = false,
}: {
  item: ChecklistItem;
  projects: Project[];
  today: string;
  onToggle: (item: ChecklistItem, done: boolean) => void;
  isAgent?: boolean;
}) {
  const project = projects.find((p) => p.id === item.projectId);
  const colors = projectColorClasses(project?.color);
  const label =
    item.kind === 'deadline' && item.deadlineKind ? DEADLINE_KIND_LABEL[item.deadlineKind] : null;

  return (
    <li className="flex items-center gap-2 rounded-lg border border-border bg-surface px-2.5 py-2 text-sm">
      {item.kind === 'task' ? (
        <input
          type="checkbox"
          checked={item.done}
          onChange={(e) => onToggle(item, e.target.checked)}
          className="shrink-0"
        />
      ) : (
        // Deadlines/reviews keep the round marker but are checkable too:
        // deadline → done, review → submitted (undo via toast).
        <input
          type="checkbox"
          checked={item.done}
          onChange={(e) => onToggle(item, e.target.checked)}
          className="h-3.5 w-3.5 shrink-0 cursor-pointer appearance-none rounded-full border border-foreground/40 checked:border-blue-600 checked:bg-blue-600"
          title={item.kind === 'review' ? '제출 완료로 표시' : '완료로 표시'}
          aria-label={`${label ?? item.kind} 완료`}
        />
      )}
      {project && <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${colors.dot}`} />}
      {isAgent && <Bot size={12} className="shrink-0 text-foreground/40" />}
      <span className={`min-w-0 flex-1 truncate ${item.done ? 'text-foreground/40 line-through' : ''}`}>
        {item.title}
      </span>
      {label && (
        <span className="shrink-0 rounded-full bg-foreground/5 px-1.5 py-0.5 text-[10px] text-foreground/50">
          {label}
        </span>
      )}
      {item.dueDate && <DdayChip n={dday(item.dueDate, today)} />}
    </li>
  );
}

function AddTaskForm({ projects, onAdded }: { projects: Project[]; onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [projectId, setProjectId] = useState(projects[0]?.id ?? '');
  const [dueDate, setDueDate] = useState('');
  const [assignee, setAssignee] = useState<'me' | 'agent'>('me');
  const [pending, startTransition] = useTransition();

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1 rounded-lg border border-dashed border-border px-2.5 py-1.5 text-xs text-foreground/50 hover:bg-foreground/5"
      >
        <Plus size={12} /> 할 일
      </button>
    );
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    startTransition(async () => {
      await createTaskAction({
        title: title.trim(),
        projectId: projectId || null,
        dueDate: dueDate || null,
        assignee,
      });
      setTitle('');
      setDueDate('');
      setAssignee('me');
      setOpen(false);
      onAdded();
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap gap-1.5 rounded-lg border border-border p-2 text-xs">
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="할 일 제목"
        className="min-w-0 flex-1 rounded-md border border-border bg-transparent px-2 py-1"
      />
      <select
        value={projectId}
        onChange={(e) => setProjectId(e.target.value)}
        className="rounded-md border border-border bg-transparent px-2 py-1"
      >
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <input
        type="date"
        value={dueDate}
        onChange={(e) => setDueDate(e.target.value)}
        className="rounded-md border border-border bg-transparent px-2 py-1"
      />
      <div className="flex gap-1 rounded-md border border-border p-0.5">
        {(['me', 'agent'] as const).map((a) => (
          <button
            key={a}
            type="button"
            onClick={() => setAssignee(a)}
            className={`rounded px-1.5 py-0.5 ${assignee === a ? 'bg-blue-600 text-white' : 'text-foreground/60'}`}
          >
            {a === 'me' ? '나' : '에이전트'}
          </button>
        ))}
      </div>
      <button type="submit" disabled={pending || !title.trim()} className="rounded-md bg-blue-600 px-2 py-1 text-white disabled:opacity-40">
        추가
      </button>
    </form>
  );
}

/** Read-only row for a today's Google Calendar event, shown at the top of 오늘 (§5.1). */
function EventRow({ event }: { event: CalendarEvent }) {
  return (
    <li className="flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-2.5 py-2 text-sm text-foreground/70">
      <CalendarDays size={14} className="shrink-0 text-foreground/40" />
      <span className="min-w-0 flex-1 truncate">
        {event.startTime && <span className="tnum mr-1">{event.startTime}</span>}
        {event.title}
      </span>
    </li>
  );
}

export function ChecklistPanel({
  initialTasks,
  deadlines,
  reviews,
  projects,
  activeMilestoneIds,
  todayEvents = [],
  bare = false,
}: {
  initialTasks: Task[];
  activeMilestoneIds: string[];
  deadlines: Deadline[];
  reviews: ReviewJob[];
  projects: Project[];
  /** Today's timed/all-day Google events, rendered as read-only rows inside 오늘 (§5.1). */
  todayEvents?: CalendarEvent[];
  /** Drops the outer card chrome + "오늘" title when embedded in the home 할 일
   * lane (PLAN_HOME2.md §Lanes 3) — the lane card supplies its own header. */
  bare?: boolean;
}) {
  const router = useRouter();
  const [tasks, setTasks] = useState(initialTasks);
  // Re-sync local (optimistic) state when the server sends fresh tasks after a revalidate.
  const [syncedFrom, setSyncedFrom] = useState(initialTasks);
  if (initialTasks !== syncedFrom) {
    setSyncedFrom(initialTasks);
    setTasks(initialTasks);
  }
  const today = todayKST();
  const [tab, setTab] = useState<'me' | 'agent'>('me');
  const { show } = useToast();
  // Deadlines/reviews ticked here are hidden optimistically until the server refresh drops them.
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const byAssignee = checklist(
    tasks,
    deadlines.filter((d) => !hidden.has(d.id)),
    reviews.filter((r) => !hidden.has(r.id)),
    today,
    new Set(activeMilestoneIds)
  );
  const result = byAssignee[tab];

  function setHiddenId(id: string, on: boolean) {
    setHidden((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function handleToggle(item: ChecklistItem, done: boolean) {
    if (item.kind === 'deadline' || item.kind === 'review') {
      const review = item.kind === 'review' ? reviews.find((r) => r.id === item.id) : undefined;
      const prevStatus = review?.status ?? 'accepted';
      const commit = (on: boolean) =>
        item.kind === 'deadline'
          ? toggleDeadlineDoneAction(item.id, on)
          : updateReviewAction({ id: item.id, status: on ? 'submitted' : prevStatus });
      setHiddenId(item.id, true);
      commit(true)
        .then(() => {
          show(item.kind === 'review' ? `제출 완료: ${item.title}` : `완료: ${item.title}`, {
            variant: 'success',
            action: {
              label: '되돌리기',
              onClick: () => {
                commit(false)
                  .then(() => setHiddenId(item.id, false))
                  .catch(() => router.refresh());
              },
            },
          });
        })
        .catch(() => {
          setHiddenId(item.id, false);
          show('저장하지 못했어요', { variant: 'danger' });
        });
      return;
    }
    const id = item.id;
    const now = new Date().toISOString();
    setTasks((prev) =>
      prev.map((t) => (t.id === id ? { ...t, status: done ? 'done' : 'todo', doneAt: done ? now : null } : t))
    );
    toggleTaskDoneAction(id, done).catch(() => router.refresh());
  }

  const sections: { key: keyof typeof result; label: string }[] = [
    { key: 'overdue', label: '지남' },
    { key: 'today', label: '오늘' },
    { key: 'thisWeek', label: '이번 주' },
    { key: 'doing', label: '진행 중' },
    { key: 'next', label: '진행 중인 큐' },
  ];
  // Empty sections are omitted entirely (ux-advice.md §5.1) — a section with
  // nothing collapses to nothing instead of an "없음" line. Today's Google
  // events count toward keeping 오늘 visible even with zero tasks.
  const visibleSections = sections.filter(
    ({ key }) => result[key].length > 0 || (key === 'today' && tab === 'me' && todayEvents.length > 0)
  );
  const isEmpty = visibleSections.length === 0;

  return (
    <div className={bare ? 'flex h-full min-h-0 flex-col gap-3' : 'flex h-full flex-col gap-3 rounded-xl border border-border bg-surface p-3'}>
      <div className="flex items-center justify-between">
        {!bare && <h2 className="text-sm font-semibold">오늘</h2>}
        <div className="flex gap-1 rounded-lg border border-border p-0.5 text-xs">
          <button
            type="button"
            onClick={() => setTab('me')}
            className={`rounded-md px-2 py-1 ${tab === 'me' ? 'bg-blue-600 text-white' : 'text-foreground/60'}`}
          >
            나 {checklistItemCount(byAssignee.me)}
          </button>
          <button
            type="button"
            onClick={() => setTab('agent')}
            className={`flex items-center gap-1 rounded-md px-2 py-1 ${tab === 'agent' ? 'bg-blue-600 text-white' : 'text-foreground/60'}`}
          >
            <Bot size={12} /> 에이전트 {checklistItemCount(byAssignee.agent)}
          </button>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto">
        {isEmpty ? (
          <EmptyState action={<AddTaskForm projects={projects} onAdded={() => router.refresh()} />}>
            오늘은 비어 있어요.
          </EmptyState>
        ) : (
          visibleSections.map(({ key, label }) => (
            <section key={key} className="flex flex-col gap-1.5">
              <h3 className="text-xs font-medium text-foreground/50">
                {label} ({result[key].length})
              </h3>
              <ul className="flex flex-col gap-1">
                {key === 'today' &&
                  tab === 'me' &&
                  todayEvents.map((e) => <EventRow key={e.id} event={e} />)}
                {result[key].map((item) => (
                  <Row
                    key={item.id}
                    item={item}
                    projects={projects}
                    today={today}
                    onToggle={handleToggle}
                    isAgent={tab === 'agent'}
                  />
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
      {!isEmpty && <AddTaskForm projects={projects} onAdded={() => router.refresh()} />}
    </div>
  );
}
