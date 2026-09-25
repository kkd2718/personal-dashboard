'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { checklist, type ChecklistItem } from '@/lib/logic/checklist';
import { dday, todayKST } from '@/lib/logic/dates';
import { createTaskAction, toggleTaskDoneAction } from '@/app/actions/tasks';
import { DdayChip } from '@/components/dday-chip';
import { projectColorClasses } from '@/lib/project-colors';
import type { Deadline, Project, ReviewJob, Task } from '@/lib/types';

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
}: {
  item: ChecklistItem;
  projects: Project[];
  today: string;
  onToggle: (id: string, done: boolean) => void;
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
          onChange={(e) => onToggle(item.id, e.target.checked)}
          className="shrink-0"
        />
      ) : (
        <span
          className="h-3.5 w-3.5 shrink-0 rounded-full border border-border"
          title={label ?? item.kind}
        />
      )}
      {project && <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${colors.dot}`} />}
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
      });
      setTitle('');
      setDueDate('');
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
      <button type="submit" disabled={pending || !title.trim()} className="rounded-md bg-blue-600 px-2 py-1 text-white disabled:opacity-40">
        추가
      </button>
    </form>
  );
}

export function ChecklistPanel({
  initialTasks,
  deadlines,
  reviews,
  projects,
  activeMilestoneIds,
}: {
  initialTasks: Task[];
  activeMilestoneIds: string[];
  deadlines: Deadline[];
  reviews: ReviewJob[];
  projects: Project[];
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
  const result = checklist(tasks, deadlines, reviews, today, new Set(activeMilestoneIds));

  function handleToggle(id: string, done: boolean) {
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
    { key: 'next', label: '다음 할 일 (진행 중인 큐)' },
  ];

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-3">
      <h2 className="text-sm font-semibold">체크리스트</h2>
      {sections.map(({ key, label }) => (
        <section key={key} className="flex flex-col gap-1.5">
          <h3 className="text-xs font-medium text-foreground/50">
            {label} ({result[key].length})
          </h3>
          {result[key].length === 0 ? (
            <p className="text-xs text-foreground/30">없음</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {result[key].map((item) => (
                <Row key={item.id} item={item} projects={projects} today={today} onToggle={handleToggle} />
              ))}
            </ul>
          )}
        </section>
      ))}
      <AddTaskForm projects={projects} onAdded={() => router.refresh()} />
    </div>
  );
}
