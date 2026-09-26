'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Pencil, Plus } from 'lucide-react';
import { movePaperAction, updatePaperAction, createRevisionDeadlineAction } from '@/app/actions/papers';
import { Sheet } from '@/components/ui/sheet';
import { Chip } from '@/components/ui/chip';
import { DdayChip } from '@/components/dday-chip';
import { PaperSubmissions } from '@/components/paper-submissions';
import { dday, todayKST } from '@/lib/logic/dates';
import type { Deadline, Paper, PaperStage, Project } from '@/lib/types';

const STAGE_LABEL: Record<PaperStage, string> = {
  idea: '아이디어',
  writing: '작성중',
  submitted: '투고',
  under_review: '심사중',
  revision: '수정',
  accepted: '게재확정',
  published: '출판',
};

function NextActionField({ paper }: { paper: Paper }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(paper.nextAction ?? '');
  const router = useRouter();

  function save() {
    setEditing(false);
    const next = value.trim() || null;
    if (next === paper.nextAction) return;
    updatePaperAction({ id: paper.id, nextAction: next }).then(() => router.refresh());
  }

  if (editing) {
    return (
      <input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === 'Enter') save();
          if (e.key === 'Escape') {
            setValue(paper.nextAction ?? '');
            setEditing(false);
          }
        }}
        className="w-full rounded-md border border-border bg-transparent px-2 py-1 text-sm"
      />
    );
  }
  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className="group flex w-full items-center gap-1.5 rounded-md px-1 py-0.5 text-left text-sm hover:bg-foreground/5"
    >
      <span className={paper.nextAction ? '' : 'text-foreground/40'}>{paper.nextAction ?? '다음 액션을 정해보세요'}</span>
      <Pencil size={12} className="shrink-0 text-foreground/30 opacity-0 group-hover:opacity-100" />
    </button>
  );
}

function RevisionDeadlineShortcut({ paper }: { paper: Paper }) {
  const [open, setOpen] = useState(false);
  const [dueDate, setDueDate] = useState('');
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1 rounded-md border border-dashed border-border px-2 py-1 text-xs text-foreground/50 hover:bg-foreground/5"
      >
        <Plus size={12} /> 리비전 마감
      </button>
    );
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!dueDate) return;
        startTransition(async () => {
          await createRevisionDeadlineAction({ paperId: paper.id, title: `${paper.shortName} 리비전 제출`, dueDate });
          router.refresh();
        });
        setOpen(false);
      }}
      className="flex items-center gap-1.5"
    >
      <input
        type="date"
        autoFocus
        value={dueDate}
        onChange={(e) => setDueDate(e.target.value)}
        className="rounded-md border border-border bg-transparent px-2 py-1 text-xs"
      />
      <button type="submit" disabled={pending || !dueDate} className="rounded-md bg-accent px-2 py-1 text-xs text-white disabled:opacity-40">
        추가
      </button>
    </form>
  );
}

export function PaperDetail({
  paper,
  project,
  deadlines,
  open,
  onClose,
}: {
  paper: Paper;
  project: Project | undefined;
  deadlines: Deadline[];
  open: boolean;
  onClose: () => void;
}) {
  const today = todayKST();
  const router = useRouter();
  const [journal, setJournal] = useState(paper.journal ?? '');
  const [manuscriptId, setManuscriptId] = useState(paper.manuscriptId ?? '');
  const [targetJournalsText, setTargetJournalsText] = useState(paper.targetJournals.join(', '));
  const [pending, startTransition] = useTransition();

  function saveField(patch: Partial<Paper>) {
    startTransition(async () => {
      await updatePaperAction({ id: paper.id, ...patch });
      router.refresh();
    });
  }

  return (
    <Sheet open={open} onClose={onClose} title={paper.shortName}>
      <div className="flex flex-col gap-3 text-sm">
        <p className="font-medium">{paper.title}</p>

        <label className="flex flex-col gap-1 text-xs text-foreground/60">
          단계
          <select
            value={paper.stage}
            disabled={pending}
            onChange={(e) => {
              const toStage = e.target.value as PaperStage;
              startTransition(async () => {
                await movePaperAction({ id: paper.id, toStage, toIndex: 0 });
                router.refresh();
              });
            }}
            className="rounded-md border border-border bg-transparent px-2 py-1.5 text-sm text-foreground"
          >
            {Object.entries(STAGE_LABEL).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>

        <div className="flex flex-wrap items-center gap-1.5">
          <Chip>{paper.track}</Chip>
          {project && (
            <Link href={`/projects/${project.slug}`} className="text-xs text-accent hover:underline">
              {project.name} →
            </Link>
          )}
        </div>

        <label className="flex flex-col gap-1 text-xs text-foreground/60">
          저널
          <input
            value={journal}
            onChange={(e) => setJournal(e.target.value)}
            onBlur={() => saveField({ journal: journal.trim() || null })}
            className="rounded-md border border-border bg-transparent px-2 py-1.5 text-sm text-foreground"
          />
        </label>

        <label className="flex flex-col gap-1 text-xs text-foreground/60">
          원고 ID
          <input
            value={manuscriptId}
            onChange={(e) => setManuscriptId(e.target.value)}
            onBlur={() => saveField({ manuscriptId: manuscriptId.trim() || null })}
            className="rounded-md border border-border bg-transparent px-2 py-1.5 font-mono text-xs text-foreground"
          />
        </label>

        <label className="flex flex-col gap-1 text-xs text-foreground/60">
          목표 저널 (쉼표로 구분)
          <input
            value={targetJournalsText}
            onChange={(e) => setTargetJournalsText(e.target.value)}
            onBlur={() =>
              saveField({ targetJournals: targetJournalsText.split(',').map((t) => t.trim()).filter(Boolean) })
            }
            className="rounded-md border border-border bg-transparent px-2 py-1.5 text-sm text-foreground"
          />
        </label>

        <div className="flex flex-col gap-1">
          <span className="text-xs text-foreground/60">다음 액션</span>
          <NextActionField paper={paper} />
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-foreground/60">투고 이력</span>
          <PaperSubmissions paper={paper} />
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <span className="text-xs text-foreground/60">마감</span>
            <RevisionDeadlineShortcut paper={paper} />
          </div>
          {deadlines.length > 0 && (
            <ul className="flex flex-col gap-1.5">
              {deadlines.map((d) => (
                <li key={d.id} className="flex items-center gap-2 rounded-md border border-border px-2 py-1.5 text-xs">
                  <span className="flex-1">{d.title}</span>
                  <DdayChip n={dday(d.dueDate, today)} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Sheet>
  );
}
