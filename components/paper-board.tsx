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
import { useDroppable } from '@dnd-kit/core';
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
      className={`cursor-grab rounded-lg border border-border bg-surface p-2.5 text-xs shadow-sm active:cursor-grabbing ${
        isDragging ? 'opacity-40' : ''
      }`}
    >
      <p className="font-medium">{paper.shortName}</p>
      <div className="mt-1 flex flex-wrap items-center gap-1 text-[10px] text-foreground/50">
        <span className="rounded-full bg-foreground/5 px-1.5 py-0.5">{paper.track}</span>
        {paper.journal && <span className="truncate">{paper.journal}</span>}
        {paper.submissions.length > 0 && <span>투고 {paper.submissions.length}회</span>}
      </div>
      {paper.nextAction && <p className="mt-1 truncate text-[11px] text-foreground/60">{paper.nextAction}</p>}
    </div>
  );
}

function Column({
  stage,
  label,
  papers,
  forceExpand,
}: {
  stage: PaperStage;
  label: string;
  papers: Paper[];
  forceExpand: boolean;
}) {
  const [hover, setHover] = useState(false);
  const { setNodeRef: setDropRef } = useDroppable({ id: `col-${stage}` });
  const collapsed = papers.length === 0 && !hover && !forceExpand;

  if (collapsed) {
    return (
      <div
        ref={setDropRef}
        onMouseEnter={() => setHover(true)}
        className="flex w-11 shrink-0 flex-col items-center justify-start gap-2 rounded-xl bg-foreground/[0.03] py-3"
        title={label}
      >
        <span className="text-xs font-medium text-foreground/50">{papers.length}</span>
        <span
          className="text-xs font-medium text-foreground/60"
          style={{ writingMode: 'vertical-rl' }}
        >
          {label}
        </span>
      </div>
    );
  }

  return (
    <div
      onMouseLeave={() => setHover(false)}
      className="flex min-w-[180px] flex-1 flex-col gap-2 overflow-hidden rounded-xl bg-foreground/[0.03] p-2"
    >
      <div className="flex shrink-0 items-center justify-between px-1 pt-1 text-xs font-medium text-foreground/60">
        <span>{label}</span>
        <span>{papers.length}</span>
      </div>
      <SortableContext items={papers.map((p) => p.id)} strategy={verticalListSortingStrategy}>
        <div id={`col-${stage}`} className="flex min-h-12 flex-1 flex-col gap-2 overflow-y-auto">
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
  const [dragOverStage, setDragOverStage] = useState<PaperStage | null>(null);
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
    setDragOverStage(overStage ?? null);
    if (!activeStage || !overStage || activeStage === overStage) return;
    setPapers((prev) => prev.map((p) => (p.id === active.id ? { ...p, stage: overStage } : p)));
  }

  function handleDragEnd(e: DragEndEvent) {
    setActiveId(null);
    setDragOverStage(null);
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
      <div className="flex h-[calc(100dvh-14rem)] min-h-[420px] w-full gap-2">
        {STAGES.map(({ key, label }) => (
          <Column key={key} stage={key} label={label} papers={columns[key]} forceExpand={dragOverStage === key} />
        ))}
      </div>
      <DragOverlay>{activePaper ? <Card paper={activePaper} /> : null}</DragOverlay>
    </DndContext>
  );
}
