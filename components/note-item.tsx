'use client';

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { Archive, Bot, Check, MoreHorizontal, Pencil, Pin, Repeat, Send } from 'lucide-react';
import { sendNoteToProjectAction, updateNoteAction } from '@/app/actions/notes';
import { convertNoteToTaskAction } from '@/app/actions/tasks';
import { stripTokens } from '@/lib/logic/capture';
import { relTime } from '@/lib/logic/dates';
import { Chip } from '@/components/ui/chip';
import { Popover } from '@/components/ui/popover';
import { Sheet } from '@/components/ui/sheet';
import { useToast } from '@/components/ui/toast';
import { projectColorClasses } from '@/lib/project-colors';
import type { Milestone, Note, NoteStatus, Project } from '@/lib/types';

const KIND_LABEL: Record<Note['kind'], string> = {
  idea: '아이디어',
  memo: '메모',
  todo: '할 일',
  link: '링크',
};

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
}

function ProjectPickerPopover({
  projects,
  onPick,
}: {
  projects: Project[];
  onPick: (projectId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      trigger={
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center rounded-full border border-dashed border-border px-2 py-0.5 text-xs text-foreground/50 hover:bg-foreground/5"
        >
          프로젝트 지정
        </button>
      }
    >
      <ul className="flex max-h-56 w-48 flex-col gap-0.5 overflow-y-auto">
        {projects.map((p) => {
          const colors = projectColorClasses(p.color);
          return (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => {
                  onPick(p.id);
                  setOpen(false);
                }}
                className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-sm hover:bg-foreground/5"
              >
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${colors.dot}`} />
                {p.name}
              </button>
            </li>
          );
        })}
      </ul>
    </Popover>
  );
}

function ConvertToTaskForm({
  note,
  projects,
  milestones,
  onDone,
}: {
  note: Note;
  projects: Project[];
  milestones: Milestone[];
  onDone: () => void;
}) {
  const firstLine = stripTokens(note.body).split('\n')[0]?.slice(0, 120) ?? '';
  const [projectId, setProjectId] = useState(note.projectId ?? projects[0]?.id ?? '');
  const [milestoneId, setMilestoneId] = useState('');
  const [title, setTitle] = useState(firstLine);
  const [dueDate, setDueDate] = useState('');
  const [pending, startTransition] = useTransition();

  const queues = useMemo(
    () => milestones.filter((m) => m.projectId === projectId),
    [milestones, projectId]
  );

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!projectId || !title.trim()) return;
    startTransition(async () => {
      await convertNoteToTaskAction({
        noteId: note.id,
        projectId,
        milestoneId: milestoneId || null,
        title: title.trim(),
        dueDate: dueDate || null,
      });
      onDone();
    });
  }

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-2 rounded-lg border border-dashed border-border p-2 text-sm"
    >
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="할 일 제목"
        className="rounded-md border border-border bg-transparent px-2 py-1.5"
      />
      <div className="flex flex-wrap gap-2">
        <select
          value={projectId}
          onChange={(e) => {
            setProjectId(e.target.value);
            setMilestoneId('');
          }}
          required
          className="rounded-md border border-border bg-transparent px-2 py-1.5"
        >
          <option value="">프로젝트 선택</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <select
          value={milestoneId}
          onChange={(e) => setMilestoneId(e.target.value)}
          className="rounded-md border border-border bg-transparent px-2 py-1.5"
        >
          <option value="">큐 없음</option>
          {queues.map((m) => (
            <option key={m.id} value={m.id}>
              {m.title}
            </option>
          ))}
        </select>
        <input
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
          className="rounded-md border border-border bg-transparent px-2 py-1.5"
        />
      </div>
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending || !projectId || !title.trim()}
          className="rounded-md bg-blue-600 px-3 py-1.5 text-white disabled:opacity-40"
        >
          전환
        </button>
        <button type="button" onClick={onDone} className="rounded-md border border-border px-3 py-1.5">
          취소
        </button>
      </div>
    </form>
  );
}

export function NoteItem({
  note,
  projects,
  milestones = [],
}: {
  note: Note;
  projects: Project[];
  milestones?: Milestone[];
}) {
  const { show } = useToast();
  const [editing, setEditing] = useState(false);
  const [converting, setConverting] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [body, setBody] = useState(note.body);
  const [tagsText, setTagsText] = useState(note.tags.join(', '));
  const [date, setDate] = useState(note.date ?? '');
  const [pending, startTransition] = useTransition();

  function run(patch: Parameters<typeof updateNoteAction>[0]) {
    startTransition(async () => {
      await updateNoteAction(patch);
    });
  }

  /** Status change with an undo toast (archive/done are the "destructive-ish" ones, §4.4). */
  function runWithUndo(nextStatus: NoteStatus, message: string) {
    const prevStatus = note.status;
    startTransition(async () => {
      await updateNoteAction({ id: note.id, status: nextStatus });
    });
    show(message, {
      action: { label: '실행 취소', onClick: () => updateNoteAction({ id: note.id, status: prevStatus }) },
    });
    setMobileMenuOpen(false);
  }

  function sendToProject() {
    startTransition(async () => {
      await sendNoteToProjectAction(note.id);
    });
  }

  const project = projects.find((p) => p.id === note.projectId);
  const displayBody = stripTokens(note.body);

  function togglePin() {
    run({ id: note.id, pinned: !note.pinned });
  }
  function openConvert() {
    setConverting(true);
    setMobileMenuOpen(false);
  }
  function markDone() {
    runWithUndo('done', '완료했어요');
  }
  function archive() {
    runWithUndo('archived', '보관했어요');
  }

  // Desktop hover-reveal icon buttons.
  const desktopActions = (
    <>
      <button
        type="button"
        title="고정"
        onClick={togglePin}
        className={`rounded p-1.5 hover:bg-foreground/5 ${note.pinned ? 'text-amber-500' : 'text-foreground/40'}`}
      >
        <Pin size={14} />
      </button>
      {!note.taskId && (
        <button type="button" title="할 일로 전환" onClick={openConvert} className="rounded p-1.5 text-foreground/40 hover:bg-foreground/5">
          <Repeat size={14} />
        </button>
      )}
      {note.status !== 'done' && (
        <button type="button" title="완료" onClick={markDone} className="rounded p-1.5 text-foreground/40 hover:bg-foreground/5">
          <Check size={14} />
        </button>
      )}
      {note.status !== 'archived' && (
        <button type="button" title="보관" onClick={archive} className="rounded p-1.5 text-foreground/40 hover:bg-foreground/5">
          <Archive size={14} />
        </button>
      )}
    </>
  );

  // Mobile sheet: full-width labeled rows (44px tap target).
  const mobileActions = (
    <>
      <button type="button" onClick={togglePin} className="flex items-center gap-2 rounded-md px-2 py-2.5 text-left text-sm hover:bg-foreground/5">
        <Pin size={16} className={note.pinned ? 'text-amber-500' : ''} /> {note.pinned ? '고정 해제' : '고정'}
      </button>
      {!note.taskId && (
        <button type="button" onClick={openConvert} className="flex items-center gap-2 rounded-md px-2 py-2.5 text-left text-sm hover:bg-foreground/5">
          <Repeat size={16} /> 할 일로 전환
        </button>
      )}
      {note.status !== 'done' && (
        <button type="button" onClick={markDone} className="flex items-center gap-2 rounded-md px-2 py-2.5 text-left text-sm hover:bg-foreground/5">
          <Check size={16} /> 완료
        </button>
      )}
      {note.status !== 'archived' && (
        <button type="button" onClick={archive} className="flex items-center gap-2 rounded-md px-2 py-2.5 text-left text-sm hover:bg-foreground/5">
          <Archive size={16} /> 보관
        </button>
      )}
    </>
  );

  return (
    <li className="group/note flex flex-col gap-2 rounded-xl border border-border bg-surface p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <Chip>{KIND_LABEL[note.kind]}</Chip>
          {project && (
            <Chip>
              <span className={`h-1.5 w-1.5 rounded-full ${projectColorClasses(project.color).dot}`} />
              {project.name}
            </Chip>
          )}
          {note.tags.map((t) => (
            <Chip key={t}>#{t}</Chip>
          ))}
          {note.date && <Chip>{note.date}</Chip>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-[11px] text-foreground/40" suppressHydrationWarning>
            {relTime(note.createdAt, new Date().toISOString())}
          </span>
          {/* Desktop: hidden until hover/focus-within. Mobile: a single ⋯ opens a sheet. */}
          <div className="hidden items-center gap-0.5 opacity-0 transition-opacity group-hover/note:opacity-100 group-focus-within/note:opacity-100 md:flex">
            <button
              type="button"
              title="수정"
              onClick={() => setEditing((v) => !v)}
              className="rounded p-1.5 text-foreground/40 hover:bg-foreground/5"
            >
              <Pencil size={14} />
            </button>
            {desktopActions}
          </div>
          <button
            type="button"
            aria-label="더 보기"
            onClick={() => setMobileMenuOpen(true)}
            className="rounded p-1.5 text-foreground/40 hover:bg-foreground/5 md:hidden"
          >
            <MoreHorizontal size={16} />
          </button>
        </div>
      </div>

      {editing ? (
        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={2}
              className="flex-1 rounded-lg border border-border bg-transparent p-2 text-sm outline-none"
            />
            <button
              type="button"
              onClick={() => {
                const tags = tagsText
                  .split(',')
                  .map((t) => t.trim())
                  .filter(Boolean);
                run({ id: note.id, body, tags, date: date || null });
                setEditing(false);
              }}
              className="rounded-lg bg-blue-600 px-3 text-sm text-white"
            >
              저장
            </button>
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            <input
              value={tagsText}
              onChange={(e) => setTagsText(e.target.value)}
              placeholder="태그 (쉼표로 구분)"
              className="min-w-0 flex-1 rounded-md border border-border bg-transparent px-2 py-1"
            />
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="rounded-md border border-border bg-transparent px-2 py-1"
            />
          </div>
        </div>
      ) : (
        <p
          onClick={() => setEditing(true)}
          className="cursor-text whitespace-pre-wrap text-sm hover:opacity-80"
          title="클릭해서 수정"
        >
          {displayBody}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2 text-xs text-foreground/60">
        {!project ? (
          <ProjectPickerPopover projects={projects} onPick={(id) => run({ id: note.id, projectId: id, status: 'filed' })} />
        ) : note.status === 'sent' ? (
          <Chip>
            <Bot size={11} />
            에이전트에게 보냄
            {note.deliveredAt && ` · 전달됨 ${fmtTime(note.deliveredAt)}`}
          </Chip>
        ) : (
          <button
            type="button"
            onClick={sendToProject}
            disabled={pending}
            className="flex items-center gap-1 rounded-md border border-border px-2 py-1 hover:bg-foreground/5"
          >
            <Send size={12} />
            프로젝트로 보내기
          </button>
        )}
        {note.taskId && project && (
          <Link href={`/projects/${project.slug}`} className="ml-auto text-foreground/40 hover:underline">
            할 일로 전환됨 →
          </Link>
        )}
      </div>

      {converting && (
        <ConvertToTaskForm
          note={note}
          projects={projects}
          milestones={milestones}
          onDone={() => setConverting(false)}
        />
      )}

      <Sheet open={mobileMenuOpen} onClose={() => setMobileMenuOpen(false)} title="메모 동작">
        <div className="flex flex-col gap-1">
          <button
            type="button"
            onClick={() => {
              setEditing(true);
              setMobileMenuOpen(false);
            }}
            className="flex items-center gap-2 rounded-md px-2 py-2.5 text-left text-sm hover:bg-foreground/5"
          >
            <Pencil size={16} /> 수정
          </button>
          {mobileActions}
        </div>
      </Sheet>
    </li>
  );
}
