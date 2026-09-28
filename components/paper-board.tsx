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
import { paperCardLine } from '@/lib/logic/papers';
import { checklistLine, checklistSummary } from '@/lib/logic/project-detail';
import { todayKST } from '@/lib/logic/dates';
import { PaperDetail } from '@/components/papers/paper-detail';
import type { Deadline, Paper, PaperStage, Project, ProjectDetail } from '@/lib/types';

/** Card line: the project's checklist summary when it has one, else the stage-specific line. */
function cardLine(paper: Paper, deadlines: Deadline[], today: string, details: Record<string, ProjectDetail>): string | null {
  const detail = paper.projectId ? details[paper.projectId] : undefined;
  const summary = checklistSummary(detail?.status ?? null, today);
  return paperCardLine(paper, deadlines, today, summary ? checklistLine(summary) : null);
}

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

function adjacentStage(stage: PaperStage, dir: -1 | 1): PaperStage | null {
  const i = STAGES.findIndex((s) => s.key === stage);
  const next = STAGES[i + dir];
  return next ? next.key : null;
}

function Card({
  paper,
  deadlines,
  today,
  details,
  onSelect,
  onKeyboardMove,
}: {
  paper: Paper;
  deadlines: Deadline[];
  today: string;
  details: Record<string, ProjectDetail>;
  onSelect: () => void;
  onKeyboardMove: (dir: -1 | 1) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: paper.id,
  });
  const line = cardLine(paper, deadlines, today, details);
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onSelect();
        if (e.key === 'ArrowRight') onKeyboardMove(1);
        if (e.key === 'ArrowLeft') onKeyboardMove(-1);
      }}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`cursor-grab rounded-lg border border-border bg-surface p-2.5 text-xs shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-accent active:cursor-grabbing ${
        isDragging ? 'opacity-40' : ''
      }`}
    >
      <p className="truncate font-medium" title={paper.title}>
        {paper.shortName}
      </p>
      <p className="mt-0.5 truncate text-[10px] text-foreground/50">
        {paper.track}
        {paper.journal ? ` · ${paper.journal}` : paper.targetJournals[0] ? ` · 목표: ${paper.targetJournals[0]}` : ''}
      </p>
      {line && <p className="mt-1 truncate text-[11px] text-foreground/70">{line}</p>}
    </div>
  );
}

function Column({
  stage,
  label,
  papers,
  deadlines,
  today,
  details,
  onSelect,
  onKeyboardMove,
}: {
  stage: PaperStage;
  label: string;
  papers: Paper[];
  deadlines: Deadline[];
  today: string;
  details: Record<string, ProjectDetail>;
  onSelect: (p: Paper) => void;
  onKeyboardMove: (p: Paper, dir: -1 | 1) => void;
}) {
  return (
    <div className="flex min-w-[180px] flex-1 flex-col gap-2 overflow-hidden rounded-xl bg-foreground/[0.03] p-2">
      <div className="flex shrink-0 items-center justify-between px-1 pt-1 text-xs font-medium text-foreground/60">
        <span>{label}</span>
        <span>{papers.length}</span>
      </div>
      <SortableContext items={papers.map((p) => p.id)} strategy={verticalListSortingStrategy}>
        <div id={`col-${stage}`} className="flex min-h-12 flex-col gap-2 overflow-y-auto">
          {papers.map((p) => (
            <Card
              key={p.id}
              paper={p}
              deadlines={deadlines.filter((d) => d.paperId === p.id)}
              today={today}
              details={details}
              onSelect={() => onSelect(p)}
              onKeyboardMove={(dir) => onKeyboardMove(p, dir)}
            />
          ))}
        </div>
      </SortableContext>
    </div>
  );
}

/** Empty-stage footer chip (ux-advice.md §2): droppable target, expands into a full
 * column (handled by the caller re-classifying it as non-empty) only during drag. */
function EmptyStageChip({ stage, label }: { stage: PaperStage; label: string }) {
  const { setNodeRef } = useDroppable({ id: `col-${stage}` });
  return (
    <div
      ref={setNodeRef}
      className="flex shrink-0 items-center gap-1.5 rounded-full border border-dashed border-border px-3 py-1.5 text-xs text-foreground/40"
    >
      {label}
    </div>
  );
}

export function PaperBoard({
  initialPapers,
  deadlines = [],
  projects = [],
  details = {},
  initialSelectedId,
}: {
  initialPapers: Paper[];
  deadlines?: Deadline[];
  projects?: Project[];
  details?: Record<string, ProjectDetail>;
  initialSelectedId?: string;
}) {
  const router = useRouter();
  const [papers, setPapers] = useState(initialPapers);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [dragOverStage, setDragOverStage] = useState<PaperStage | null>(null);
  const [selected, setSelected] = useState<Paper | null>(
    () => initialPapers.find((p) => p.id === initialSelectedId) ?? null
  );
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const columns = useMemo(() => byStage(papers), [papers]);
  const today = todayKST();

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

  function keyboardMove(p: Paper, dir: -1 | 1) {
    const toStage = adjacentStage(p.stage, dir);
    if (!toStage) return;
    const toIndex = byStage(papers)[toStage].length;
    movePaperAction({ id: p.id, toStage, toIndex })
      .then((serverPapers) => setPapers(serverPapers))
      .catch(() => router.refresh());
  }

  const activePaper = activeId ? papers.find((p) => p.id === activeId) : null;
  const nonEmpty = STAGES.filter((s) => columns[s.key].length > 0 || dragOverStage === s.key);
  const empty = STAGES.filter((s) => columns[s.key].length === 0 && dragOverStage !== s.key);

  return (
    <div className="flex flex-col gap-2">
      {/* Mobile: no kanban drag (ux-advice.md §7) — a stage-grouped list instead. */}
      <div className="flex flex-col gap-3 md:hidden">
        {STAGES.filter((s) => columns[s.key].length > 0).map(({ key, label }) => (
          <section key={key} className="flex flex-col gap-1.5">
            <h3 className="text-xs font-medium text-foreground/50">
              {label} {columns[key].length}
            </h3>
            <div className="flex flex-col gap-1.5">
              {columns[key].map((p) => {
                const line = cardLine(p, deadlines.filter((d) => d.paperId === p.id), today, details);
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setSelected(p)}
                    className="flex flex-col gap-0.5 rounded-lg border border-border bg-surface p-2.5 text-left text-xs"
                  >
                    <span className="font-medium">{p.shortName}</span>
                    {line && <span className="text-foreground/60">{line}</span>}
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      <div className="hidden md:flex md:flex-col md:gap-2">
      <DndContext id="paper-board"
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
        <div className="flex max-h-[calc(100dvh-16rem)] w-full items-start gap-2">
          {nonEmpty.map(({ key, label }) => (
            <Column
              key={key}
              stage={key}
              label={label}
              papers={columns[key]}
              deadlines={deadlines}
              today={today}
              details={details}
              onSelect={setSelected}
              onKeyboardMove={keyboardMove}
            />
          ))}
        </div>
        <DragOverlay>
          {activePaper ? (
            <Card
              paper={activePaper}
              deadlines={deadlines.filter((d) => d.paperId === activePaper.id)}
              today={today}
              details={details}
              onSelect={() => {}}
              onKeyboardMove={() => {}}
            />
          ) : null}
        </DragOverlay>
      </DndContext>

      {empty.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-foreground/40">빈 단계:</span>
          {empty.map(({ key, label }) => (
            <EmptyStageChip key={key} stage={key} label={label} />
          ))}
        </div>
      )}
      </div>

      {selected && (
        <PaperDetail
          paper={papers.find((p) => p.id === selected.id) ?? selected}
          project={projects.find((pr) => pr.id === selected.projectId)}
          deadlines={deadlines.filter((d) => d.paperId === selected.id && !d.done)}
          detail={selected.projectId ? details[selected.projectId] : undefined}
          open={selected != null}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}
