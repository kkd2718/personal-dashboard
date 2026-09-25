'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  DndContext,
  type DragEndEvent,
  type DragOverEvent,
  DragOverlay,
  type DragStartEvent,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Plus, X } from 'lucide-react';
import { moveTaskAction, createTaskAction, updateTaskAction } from '@/app/actions/tasks';
import { dday, todayKST } from '@/lib/logic/dates';
import { DdayChip } from '@/components/dday-chip';
import type { Milestone, Project, Task, TaskStatus } from '@/lib/types';

const COLUMNS: { key: TaskStatus; label: string }[] = [
  { key: 'todo', label: '할 일' },
  { key: 'doing', label: '진행 중' },
  { key: 'done', label: '완료' },
];

function byStatus(tasks: Task[]): Record<TaskStatus, Task[]> {
  const columns = Object.fromEntries(COLUMNS.map((c) => [c.key, [] as Task[]])) as Record<TaskStatus, Task[]>;
  for (const t of [...tasks].sort((a, b) => a.sort - b.sort)) columns[t.status].push(t);
  return columns;
}

function Card({
  task,
  milestone,
  onEdit,
}: {
  task: Task;
  milestone: Milestone | undefined;
  onEdit: (task: Task) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id });
  const today = todayKST();
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={() => onEdit(task)}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex cursor-grab flex-col gap-1 rounded-lg border border-border bg-surface p-2.5 text-sm shadow-sm active:cursor-grabbing ${
        isDragging ? 'opacity-40' : ''
      }`}
    >
      <p className={task.status === 'done' ? 'text-foreground/50 line-through' : ''}>{task.title}</p>
      <div className="flex flex-wrap items-center gap-1.5">
        {milestone && (
          <span className="rounded-full bg-foreground/5 px-1.5 py-0.5 text-[10px] text-foreground/50">
            {milestone.title}
          </span>
        )}
        {task.dueDate && <DdayChip n={dday(task.dueDate, today)} />}
      </div>
    </div>
  );
}

function Column({
  status,
  label,
  tasks,
  milestoneById,
  onEdit,
}: {
  status: TaskStatus;
  label: string;
  tasks: Task[];
  milestoneById: Map<string, Milestone>;
  onEdit: (task: Task) => void;
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-2 rounded-xl bg-foreground/[0.03] p-2">
      <div className="flex items-center justify-between px-1 pt-1 text-xs font-medium text-foreground/60">
        <span>{label}</span>
        <span>{tasks.length}</span>
      </div>
      <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
        <div id={`col-${status}`} className="flex min-h-12 flex-col gap-2">
          {tasks.map((t) => (
            <Card key={t.id} task={t} milestone={t.milestoneId ? milestoneById.get(t.milestoneId) : undefined} onEdit={onEdit} />
          ))}
        </div>
      </SortableContext>
    </div>
  );
}

function EditPanel({
  task,
  milestones,
  onClose,
}: {
  task: Task;
  milestones: Milestone[];
  onClose: () => void;
}) {
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? '');
  const [dueDate, setDueDate] = useState(task.dueDate ?? '');
  const [milestoneId, setMilestoneId] = useState(task.milestoneId ?? '');
  const router = useRouter();

  function save() {
    updateTaskAction({
      id: task.id,
      title: title.trim() || task.title,
      description: description || null,
      dueDate: dueDate || null,
      milestoneId: milestoneId || null,
    }).then(() => router.refresh());
    onClose();
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-3 text-sm">
      <div className="flex items-center justify-between">
        <h3 className="font-medium">할 일 수정</h3>
        <button type="button" onClick={onClose} aria-label="닫기">
          <X size={14} />
        </button>
      </div>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        className="rounded-md border border-border bg-transparent px-2 py-1.5"
      />
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        rows={2}
        placeholder="설명"
        className="rounded-md border border-border bg-transparent px-2 py-1.5"
      />
      <div className="flex flex-wrap gap-2">
        <input
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
          className="rounded-md border border-border bg-transparent px-2 py-1.5"
        />
        <select
          value={milestoneId}
          onChange={(e) => setMilestoneId(e.target.value)}
          className="rounded-md border border-border bg-transparent px-2 py-1.5"
        >
          <option value="">큐 없음</option>
          {milestones.map((m) => (
            <option key={m.id} value={m.id}>
              {m.title}
            </option>
          ))}
        </select>
      </div>
      <button type="button" onClick={save} className="self-start rounded-md bg-blue-600 px-3 py-1.5 text-white">
        저장
      </button>
    </div>
  );
}

export function TaskBoard({
  project,
  initialTasks,
  milestones,
}: {
  project: Project;
  initialTasks: Task[];
  milestones: Milestone[];
}) {
  const router = useRouter();
  const [tasks, setTasks] = useState(initialTasks);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>('all');
  const [editing, setEditing] = useState<Task | null>(null);
  const [adding, setAdding] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const milestoneById = useMemo(() => new Map(milestones.map((m) => [m.id, m])), [milestones]);

  const visible = filter === 'all' ? tasks : tasks.filter((t) => t.milestoneId === filter);
  const columns = byStatus(visible);

  function statusOf(id: string): TaskStatus | undefined {
    return tasks.find((t) => t.id === id)?.status;
  }

  function handleDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id));
  }

  function handleDragOver(e: DragOverEvent) {
    const { active, over } = e;
    if (!over) return;
    const activeStatus = statusOf(String(active.id));
    const overId = String(over.id);
    const overStatus = overId.startsWith('col-') ? (overId.slice(4) as TaskStatus) : statusOf(overId);
    if (!activeStatus || !overStatus || activeStatus === overStatus) return;
    setTasks((prev) => prev.map((t) => (t.id === active.id ? { ...t, status: overStatus } : t)));
  }

  function handleDragEnd(e: DragEndEvent) {
    setActiveId(null);
    const { active, over } = e;
    if (!over) return;
    const id = String(active.id);
    const finalStatus = statusOf(id);
    if (!finalStatus) return;
    const overId = String(over.id);
    const column = byStatus(tasks)[finalStatus];
    const overIndex = overId.startsWith('col-') ? column.length - 1 : column.findIndex((t) => t.id === overId);
    const toIndex = overIndex < 0 ? column.length - 1 : overIndex;

    moveTaskAction({ id, toStatus: finalStatus, toIndex })
      .then((serverTasks) => setTasks(serverTasks.filter((t) => t.projectId === project.id)))
      .catch(() => router.refresh());
  }

  function addTask(e: React.FormEvent) {
    e.preventDefault();
    if (!newTitle.trim()) return;
    createTaskAction({
      projectId: project.id,
      milestoneId: filter === 'all' ? null : filter,
      title: newTitle.trim(),
    }).then(() => router.refresh());
    setNewTitle('');
    setAdding(false);
  }

  const activeTask = activeId ? tasks.find((t) => t.id === activeId) : null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <button
          type="button"
          onClick={() => setFilter('all')}
          className={`rounded-full px-2.5 py-1 ${filter === 'all' ? 'bg-blue-600 text-white' : 'border border-border text-foreground/60'}`}
        >
          전체
        </button>
        {milestones.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => setFilter(m.id)}
            className={`rounded-full px-2.5 py-1 ${filter === m.id ? 'bg-blue-600 text-white' : 'border border-border text-foreground/60'}`}
          >
            {m.title}
          </button>
        ))}
        {!adding ? (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="ml-auto flex items-center gap-1 rounded-full border border-dashed border-border px-2.5 py-1 text-foreground/50 hover:bg-foreground/5"
          >
            <Plus size={12} /> 할 일
          </button>
        ) : (
          <form onSubmit={addTask} className="ml-auto flex gap-1.5">
            <input
              autoFocus
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="새 할 일"
              className="rounded-md border border-border bg-transparent px-2 py-1"
            />
            <button type="submit" className="rounded-md bg-blue-600 px-2 py-1 text-white">
              추가
            </button>
          </form>
        )}
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
        <div className="flex w-full gap-3">
          {COLUMNS.map(({ key, label }) => (
            <Column key={key} status={key} label={label} tasks={columns[key]} milestoneById={milestoneById} onEdit={setEditing} />
          ))}
        </div>
        <DragOverlay>
          {activeTask ? (
            <Card task={activeTask} milestone={activeTask.milestoneId ? milestoneById.get(activeTask.milestoneId) : undefined} onEdit={() => {}} />
          ) : null}
        </DragOverlay>
      </DndContext>

      {editing && <EditPanel task={editing} milestones={milestones} onClose={() => setEditing(null)} />}
    </div>
  );
}
