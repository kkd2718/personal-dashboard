'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Send, X } from 'lucide-react';
import { createNoteAction } from '@/app/actions/notes';
import { createTaskAction } from '@/app/actions/tasks';
import { parseCapture } from '@/lib/logic/capture';
import { MentionTextarea } from '@/components/mention-textarea';
import { projectColorClasses } from '@/lib/project-colors';
import type { NoteKind, Project } from '@/lib/types';

const KIND_OPTIONS: { value: NoteKind; label: string }[] = [
  { value: 'memo', label: '메모' },
  { value: 'idea', label: '아이디어' },
  { value: 'todo', label: '할 일' },
];

function ProjectPicker({
  projects,
  value,
  onChange,
}: {
  projects: Project[];
  value: string | null;
  onChange: (id: string | null) => void;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const selected = projects.find((p) => p.id === value);
  const filtered = query
    ? projects.filter((p) => p.name.toLowerCase().includes(query.toLowerCase()))
    : projects;

  return (
    <div className="relative">
      <input
        value={open ? query : (selected?.name ?? '')}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => {
          setQuery('');
          setOpen(true);
        }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="프로젝트 검색..."
        className="w-40 rounded-md border border-border bg-transparent px-2 py-1 text-xs"
      />
      {open && (
        <ul className="absolute z-10 mt-1 max-h-48 w-56 overflow-y-auto rounded-md border border-border bg-surface p-1 text-xs shadow-lg">
          <li>
            <button
              type="button"
              onMouseDown={() => {
                onChange(null);
                setOpen(false);
              }}
              className="w-full rounded px-2 py-1 text-left text-foreground/50 hover:bg-foreground/5"
            >
              프로젝트 없음
            </button>
          </li>
          {filtered.map((p) => {
            const colors = projectColorClasses(p.color);
            return (
              <li key={p.id}>
                <button
                  type="button"
                  onMouseDown={() => {
                    onChange(p.id);
                    setOpen(false);
                  }}
                  className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left hover:bg-foreground/5"
                >
                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${colors.dot}`} />
                  {p.name}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** Grows into a full capture form on focus: project/kind/tags/date + live @/# preview + autocomplete. */
export function QuickCapture({
  projects = [],
  existingTags = [],
  defaultProjectId = null,
  autoFocus = false,
  onSaved,
}: {
  projects?: Project[];
  existingTags?: { tag: string; count: number }[];
  defaultProjectId?: string | null;
  /** Focuses the textarea on mount — used by the mobile capture sheet (§4.6). */
  autoFocus?: boolean;
  /** Called after a successful save with the resolved project name, if any. */
  onSaved?: (projectName: string | null) => void;
}) {
  const router = useRouter();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (autoFocus) textareaRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- focus once on mount only
  }, []);
  const [value, setValue] = useState('');
  const [focused, setFocused] = useState(false);
  const [kind, setKind] = useState<NoteKind>('memo');
  const [projectId, setProjectId] = useState<string | null>(defaultProjectId);
  const [projectTouched, setProjectTouched] = useState(false);
  const [manualTags, setManualTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [date, setDate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const existingTagNames = useMemo(() => existingTags.map((t) => t.tag), [existingTags]);
  const parsed = useMemo(
    () => parseCapture(value, projects, existingTagNames),
    [value, projects, existingTagNames]
  );
  const effectiveProjectId = projectTouched ? projectId : (parsed.projectId ?? projectId);
  const allTags = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const t of [...manualTags, ...parsed.tags]) {
      const k = t.toLowerCase();
      if (!seen.has(k)) {
        seen.add(k);
        out.push(t);
      }
    }
    return out;
  }, [manualTags, parsed.tags]);

  function reset() {
    setValue('');
    setKind('memo');
    setProjectId(defaultProjectId);
    setProjectTouched(false);
    setManualTags([]);
    setTagInput('');
    setDate('');
    setFocused(false);
  }

  function addTagFromInput() {
    const t = tagInput.trim().replace(/^#/, '');
    if (t) setManualTags((prev) => [...prev, t]);
    setTagInput('');
  }

  function submit() {
    const body = value.trim();
    if (!body) return;
    startTransition(async () => {
      try {
        if (kind === 'todo' && effectiveProjectId) {
          await createTaskAction({
            title: body,
            projectId: effectiveProjectId,
            dueDate: date || null,
            assignee: 'me',
          });
        } else {
          await createNoteAction({
            body,
            kind,
            projectId: effectiveProjectId,
            tags: allTags,
            date: date || null,
            source: 'web',
          });
        }
        const projectName = projects.find((p) => p.id === effectiveProjectId)?.name ?? null;
        reset();
        setError(null);
        router.refresh();
        onSaved?.(projectName);
      } catch {
        setError('저장하지 못했습니다. 다시 시도해 주세요.');
      }
    });
  }

  function onKeyDownExtra(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      submit();
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-xl border border-border bg-surface p-2 shadow-sm">
      <div className="flex items-start gap-2">
        <MentionTextarea
          textareaRef={textareaRef}
          value={value}
          onChange={setValue}
          onAcceptProject={(p) => {
            setProjectId(p.id);
            setProjectTouched(true);
          }}
          projects={projects}
          existingTags={existingTags}
          onFocus={() => setFocused(true)}
          onKeyDownExtra={onKeyDownExtra}
          placeholder="빠르게 메모나 아이디어를 적어보세요... @프로젝트 #태그"
          rows={focused ? 2 : 1}
          wrapperClassName="min-w-0 flex-1"
          className="w-full resize-none bg-transparent px-2 py-2 text-sm outline-none placeholder:text-foreground/40"
        />
        <button
          type="button"
          onClick={submit}
          disabled={pending || !value.trim()}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-600 text-white transition disabled:opacity-40"
          aria-label="저장 (Ctrl+Enter)"
        >
          {pending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
        </button>
      </div>

      {focused && (
        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-2 text-xs">
          <div className="flex gap-1 rounded-lg border border-border p-0.5">
            {KIND_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setKind(opt.value)}
                className={`rounded-md px-2 py-1 ${kind === opt.value ? 'bg-blue-600 text-white' : 'text-foreground/60'}`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <ProjectPicker
            projects={projects}
            value={effectiveProjectId}
            onChange={(id) => {
              setProjectId(id);
              setProjectTouched(true);
            }}
          />

          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="rounded-md border border-border bg-transparent px-2 py-1"
          />

          <div className="flex flex-wrap items-center gap-1">
            {allTags.map((t) => (
              <span
                key={t}
                className="flex items-center gap-1 rounded-full bg-foreground/5 px-2 py-0.5 text-foreground/70"
              >
                #{t}
                {manualTags.some((m) => m.toLowerCase() === t.toLowerCase()) && (
                  <button
                    type="button"
                    onClick={() => setManualTags((prev) => prev.filter((m) => m.toLowerCase() !== t.toLowerCase()))}
                    aria-label={`${t} 태그 제거`}
                  >
                    <X size={10} />
                  </button>
                )}
              </span>
            ))}
            <input
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addTagFromInput();
                }
              }}
              onBlur={addTagFromInput}
              placeholder="+태그"
              className="w-16 rounded-md border border-border bg-transparent px-1.5 py-0.5"
            />
          </div>
        </div>
      )}
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}
