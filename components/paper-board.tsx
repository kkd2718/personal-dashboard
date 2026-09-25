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
import { movePaperAction } from '@/app/actions/papers';
import type { Paper, PaperStage } from '@/lib/types';

const STAGES: { key: PaperStage; label: string }[] = [
  { key: 'idea', label: '아이디어' },
  { key: 'writing', label: '작성중' },
  { key: 'submitted', label: '투고' },
  { key: 'under_review', label: '심사중' },
  { key: 'revision', label: '수정' },
  { key: 'accepted', label: '게재확정' },
  { key: 'published', label: '출판' },
];

function byStage(papers: Paper[]): Record<PaperStage, Paper[]> {
  const columns = Object.fromEntries(STAGES.map((s) => [s.key, [] as Paper[]])) as Record<
    PaperStage,
    Paper[]
  >;
  for (const p of [...papers].sort((a, b) => a.sort - b.sort)) columns[p.stage].push(p);
  return columns;
}

function Card({ paper }: { paper: Paper }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: paper.id,
  });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`cursor-grab rounded-lg border border-border bg-surface p-3 text-sm shadow-sm active:cursor-grabbing ${
        isDragging ? 'opacity-40' : ''
      }`}
    >
      <p className="font-medium">{paper.shortName}</p>
      {paper.nextAction && <p className="mt-1 text-xs text-foreground/60">{paper.nextAction}</p>}
      {paper.manuscriptId && <p className="mt-1 text-[11px] text-foreground/40">{paper.manuscriptId}</p>}
    </div>
  );
}

function Column({ stage, label, papers }: { stage: PaperStage; label: string; papers: Paper[] }) {
  return (
    <div className="flex w-64 shrink-0 flex-col gap-2 rounded-xl bg-foreground/[0.03] p-2">
      <div className="flex items-center justify-between px-1 pt-1 text-xs font-medium text-foreground/60">
        <span>{label}</span>
        <span>{papers.length}</span>
      </div>
      <SortableContext items={papers.map((p) => p.id)} strategy={verticalListSortingStrategy}>
        <div id={`col-${stage}`} className="flex min-h-12 flex-col gap-2">
          {papers.map((p) => (
            <Card key={p.id} paper={p} />
          ))}
        </div>
      </SortableContext>
    </div>
  );
}

export function PaperBoard({ initialPapers }: { initialPapers: Paper[] }) {
  const router = useRouter();
  const [papers, setPapers] = useState(initialPapers);
  const [activeId, setActiveId] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const columns = useMemo(() => byStage(papers), [papers]);

  function stageOf(id: string): PaperStage | undefined {
    return papers.find((p) => p.id === id)?.stage;
  }

  function handleDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id));
  }

  function handleDragOver(e: DragOverEvent) {
    const { active, over } = e;
    if (!over) return;
    const activeStage = stageOf(String(active.id));
    const overId = String(over.id);
    const overStage = overId.startsWith('col-') ? (overId.slice(4) as PaperStage) : stageOf(overId);
    if (!activeStage || !overStage || activeStage === overStage) return;
    setPapers((prev) => prev.map((p) => (p.id === active.id ? { ...p, stage: overStage } : p)));
  }

  function handleDragEnd(e: DragEndEvent) {
    setActiveId(null);
    const { active, over } = e;
    if (!over) return;
    const id = String(active.id);
    const finalStage = stageOf(id);
    if (!finalStage) return;
    const overId = String(over.id);
    const column = byStage(papers)[finalStage];
    const overIndex = overId.startsWith('col-')
      ? column.length - 1
      : column.findIndex((p) => p.id === overId);
    const toIndex = overIndex < 0 ? column.length - 1 : overIndex;

    movePaperAction({ id, toStage: finalStage, toIndex })
      .then((serverPapers) => setPapers(serverPapers))
      .catch(() => router.refresh());
  }

  const activePaper = activeId ? papers.find((p) => p.id === activeId) : null;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-3 md:mx-0 md:px-0">
        {STAGES.map(({ key, label }) => (
          <Column key={key} stage={key} label={label} papers={columns[key]} />
        ))}
      </div>
      <DragOverlay>{activePaper ? <Card paper={activePaper} /> : null}</DragOverlay>
    </DndContext>
  );
}
