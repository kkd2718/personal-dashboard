'use client';

import { useState, useTransition } from 'react';
import { Archive, Check, Pencil, Pin, Send } from 'lucide-react';
import { updateNoteAction } from '@/app/actions/notes';
import type { Note, Project } from '@/lib/types';

const KIND_LABEL: Record<Note['kind'], string> = {
  idea: '아이디어',
  memo: '메모',
  todo: '할 일',
  link: '링크',
};

export function NoteItem({ note, projects }: { note: Note; projects: Project[] }) {
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(note.body);
  const [pending, startTransition] = useTransition();

  function run(patch: Parameters<typeof updateNoteAction>[0]) {
    startTransition(async () => {
      await updateNoteAction(patch);
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
              run({ id: note.id, body });
              setEditing(false);
            }}
            className="rounded-lg bg-blue-600 px-3 text-sm text-white"
          >
            저장
          </button>
        </div>
      ) : (
        <p className="whitespace-pre-wrap text-sm">{note.body}</p>
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
        <button
          type="button"
          title="프로젝트로 보내기 (준비 중)"
          disabled
          className="ml-auto flex items-center gap-1 rounded-md border border-border px-2 py-1 opacity-50"
        >
          <Send size={12} />
          프로젝트로 보내기
        </button>
      </div>
    </li>
  );
}
