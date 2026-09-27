'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { createMilestoneAction, updateMilestoneAction } from '@/app/actions/milestones';
import { milestoneProgress } from '@/lib/logic/progress';
import type { Milestone, MilestoneStatus, Task } from '@/lib/types';

const STATUS_LABEL: Record<MilestoneStatus, string> = { planned: '예정', active: '진행중', done: '완료' };

function QueueChip({ milestone, tasks, onEdit }: { milestone: Milestone; tasks: Task[]; onEdit: () => void }) {
  const progress = milestoneProgress(milestone, tasks);
  return (
    <button
      type="button"
      onClick={onEdit}
      className="flex shrink-0 flex-col gap-1 rounded-lg border border-border bg-surface px-3 py-2 text-left text-xs hover:bg-foreground/5"
    >
      <div className="flex items-center gap-2">
        <span className="font-medium">{milestone.title}</span>
        <span className="rounded-full bg-foreground/5 px-1.5 py-0.5 text-[10px] text-foreground/50">
          {STATUS_LABEL[milestone.status]}
        </span>
      </div>
      {(milestone.startDate || milestone.endDate) && (
        <span className="text-foreground/40">
          {/* one-sided ranges read as '~ 10-01' / '09-20 ~', never '? ~' */}
          {milestone.startDate && milestone.endDate
            ? `${milestone.startDate} ~ ${milestone.endDate}`
            : milestone.endDate
              ? `~ ${milestone.endDate}`
              : `${milestone.startDate} ~`}
        </span>
      )}
      {progress.total > 0 && (
        <div className="flex items-center gap-1.5">
          <div className="h-1 w-16 overflow-hidden rounded-full bg-foreground/10">
            <div className="h-full rounded-full bg-blue-500" style={{ width: `${progress.pct ?? 0}%` }} />
          </div>
          <span className="text-foreground/40">
            {progress.done}/{progress.total}
          </span>
        </div>
      )}
    </button>
  );
}

function QueueForm({
  projectId,
  milestone,
  onDone,
}: {
  projectId: string;
  milestone: Milestone | null;
  onDone: () => void;
}) {
  const [title, setTitle] = useState(milestone?.title ?? '');
  const [startDate, setStartDate] = useState(milestone?.startDate ?? '');
  const [endDate, setEndDate] = useState(milestone?.endDate ?? '');
  const [status, setStatus] = useState<MilestoneStatus>(milestone?.status ?? 'planned');
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    startTransition(async () => {
      if (milestone) {
        await updateMilestoneAction({
          id: milestone.id,
          title: title.trim(),
          startDate: startDate || null,
          endDate: endDate || null,
          status,
        });
      } else {
        await createMilestoneAction({
          projectId,
          title: title.trim(),
          startDate: startDate || null,
          endDate: endDate || null,
          status,
        });
      }
      router.refresh();
      onDone();
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-border p-2 text-xs">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="큐 제목"
        className="min-w-0 flex-1 rounded-md border border-border bg-transparent px-2 py-1.5"
      />
      <input
        type="date"
        value={startDate}
        onChange={(e) => setStartDate(e.target.value)}
        className="rounded-md border border-border bg-transparent px-2 py-1.5"
      />
      <input
        type="date"
        value={endDate}
        onChange={(e) => setEndDate(e.target.value)}
        className="rounded-md border border-border bg-transparent px-2 py-1.5"
      />
      <select
        value={status}
        onChange={(e) => setStatus(e.target.value as MilestoneStatus)}
        className="rounded-md border border-border bg-transparent px-2 py-1.5"
      >
        {Object.entries(STATUS_LABEL).map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
      <button type="submit" disabled={pending || !title.trim()} className="rounded-md bg-blue-600 px-3 py-1.5 text-white disabled:opacity-40">
        저장
      </button>
      <button type="button" onClick={onDone} className="rounded-md border border-border px-3 py-1.5">
        취소
      </button>
    </form>
  );
}

export function QueueStrip({
  projectId,
  milestones,
  tasks,
}: {
  projectId: string;
  milestones: Milestone[];
  tasks: Task[];
}) {
  const [editing, setEditing] = useState<Milestone | 'new' | null>(null);
  const sorted = [...milestones].sort((a, b) => a.sort - b.sort);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-foreground/60">큐</h2>
        {editing !== 'new' && (
          <button
            type="button"
            onClick={() => setEditing('new')}
            className="flex items-center gap-1 rounded-md border border-dashed border-border px-2 py-1 text-xs text-foreground/50 hover:bg-foreground/5"
          >
            <Plus size={12} /> 큐 추가
          </button>
        )}
      </div>
      {sorted.length === 0 && editing !== 'new' ? (
        <p className="text-sm text-foreground/40">등록된 큐가 없습니다.</p>
      ) : (
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          {sorted.map((m) =>
            editing !== 'new' && editing?.id === m.id ? (
              <div key={m.id} className="min-w-72">
                <QueueForm projectId={projectId} milestone={m} onDone={() => setEditing(null)} />
              </div>
            ) : (
              <QueueChip key={m.id} milestone={m} tasks={tasks} onEdit={() => setEditing(m)} />
            )
          )}
        </div>
      )}
      {editing === 'new' && <QueueForm projectId={projectId} milestone={null} onDone={() => setEditing(null)} />}
    </div>
  );
}
