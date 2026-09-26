'use client';

import { useMemo, useState, useTransition } from 'react';
import { Archive, Bot, Check, Pencil, Pin, Repeat, Send } from 'lucide-react';
import { sendNoteToProjectAction, updateNoteAction } from '@/app/actions/notes';
import { convertNoteToTaskAction } from '@/app/actions/tasks';
import type { Milestone, Note, Project } from '@/lib/types';

const KIND_LABEL: Record<Note['kind'], string> = {
  idea: '아이디어',
  memo: '메모',
  todo: '할 일',
  link: '링크',
};

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
  const firstLine = note.body.split('\n')[0]?.slice(0, 120) ?? '';
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
  const [editing, setEditing] = useState(false);
  const [converting, setConverting] = useState(false);
  const [body, setBody] = useState(note.body);
  const [tagsText, setTagsText] = useState(note.tags.join(', '));
  const [date, setDate] = useState(note.date ?? '');
  const [pending, startTransition] = useTransition();

  function run(patch: Parameters<typeof updateNoteAction>[0]) {
    startTransition(async () => {
      await updateNoteAction(patch);
    });
  }

  function sendToProject() {
    startTransition(async () => {
      await sendNoteToProjectAction(note.id);
    });
  }

  const project = projects.find((p) => p.id === note.projectId);

  return (
    <li className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-3">
      <div className="flex items-start justify-between gap-2">
        <span className="rounded-full bg-foreground/5 px-2 py-0.5 text-[11px] text-foreground/60">
          {KIND_LABEL[note.kind]}
        </span>
        <div className="flex shrink-0 gap-1">
          <button
            type="button"
            title="고정"
            onClick={() => run({ id: note.id, pinned: !note.pinned })}
            className={`rounded p-1 hover:bg-foreground/5 ${note.pinned ? 'text-amber-500' : 'text-foreground/40'}`}
          >
            <Pin size={14} />
          </button>
          <button
            type="button"
            title="수정"
            onClick={() => setEditing((v) => !v)}
            className="rounded p-1 text-foreground/40 hover:bg-foreground/5"
          >
            <Pencil size={14} />
          </button>
          {note.status !== 'done' && (
            <button
              type="button"
              title="완료"
              onClick={() => run({ id: note.id, status: 'done' })}
              className="rounded p-1 text-foreground/40 hover:bg-foreground/5"
            >
              <Check size={14} />
            </button>
          )}
          {note.status !== 'archived' && (
            <button
              type="button"
              title="보관"
              onClick={() => run({ id: note.id, status: 'archived' })}
              className="rounded p-1 text-foreground/40 hover:bg-foreground/5"
            >
              <Archive size={14} />
            </button>
          )}
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
        <p className="whitespace-pre-wrap text-sm">{note.body}</p>
      )}

      {(note.tags.length > 0 || note.date) && (
        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-foreground/50">
          {note.tags.map((t) => (
            <span key={t} className="rounded-full bg-foreground/5 px-2 py-0.5">
              #{t}
            </span>
          ))}
          {note.date && <span className="rounded-full bg-foreground/5 px-2 py-0.5">{note.date}</span>}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 text-xs text-foreground/60">
        <select
          value={note.projectId ?? ''}
          onChange={(e) => run({ id: note.id, projectId: e.target.value || null, status: e.target.value ? 'filed' : note.status })}
          disabled={pending}
          className="rounded-md border border-border bg-transparent px-2 py-1"
        >
          <option value="">프로젝트 지정...</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        {project && <span>→ {project.name}</span>}
        {project && note.status === 'sent' ? (
          <span className="flex items-center gap-1 rounded-full bg-foreground/5 px-2 py-0.5 text-[11px] text-foreground/50">
            <Bot size={11} />
            에이전트에게 보냄
            {note.deliveredAt &&
              ` · 전달됨 ${new Date(note.deliveredAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}`}
          </span>
        ) : (
          project && (
            <button
              type="button"
              onClick={sendToProject}
              disabled={pending}
              className="flex items-center gap-1 rounded-md border border-border px-2 py-1 hover:bg-foreground/5"
            >
              <Send size={12} />
              프로젝트로 보내기
            </button>
          )
        )}
        {note.taskId ? (
          <span className="ml-auto text-foreground/40">할 일로 전환됨</span>
        ) : (
          !converting && (
            <button
              type="button"
              onClick={() => setConverting(true)}
              className="ml-auto flex items-center gap-1 rounded-md border border-border px-2 py-1 hover:bg-foreground/5"
            >
              <Repeat size={12} />
              할 일로 전환
            </button>
          )
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
    </li>
  );
}
