'use client';

import { useMemo, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { X } from 'lucide-react';
import { NoteItem } from '@/components/note-item';
import { TagManager } from '@/components/tag-manager';
import { EmptyState } from '@/components/ui/empty-state';
import { groupNotesByDate } from '@/lib/logic/notes';
import { todayKST } from '@/lib/logic/dates';
import type { Milestone, Note, NoteKind, NoteStatus, Project } from '@/lib/types';

const KIND_LABEL: Record<NoteKind, string> = { idea: '아이디어', memo: '메모', todo: '할 일', link: '링크' };
const STATUS_LABEL: Record<NoteStatus, string> = {
  inbox: '인박스',
  filed: '분류됨',
  sent: '전달됨',
  done: '완료',
  archived: '보관됨',
};

interface Filters {
  kind: string;
  status: string;
  project: string;
  tag: string;
}

/**
 * /memo board: instant filters (no submit button — every change updates the
 * list immediately and syncs the URL via router.replace, ux-advice.md §5.2)
 * over the already-loaded note list, plus the grouped list itself.
 */
export function MemoBoard({
  notes,
  projects,
  milestones,
  tags,
  initial,
}: {
  notes: Note[];
  projects: Project[];
  milestones: Milestone[];
  tags: { tag: string; count: number }[];
  initial: Filters;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [filters, setFilters] = useState<Filters>(initial);

  function update(patch: Partial<Filters>) {
    const next = { ...filters, ...patch };
    setFilters(next);
    const params = new URLSearchParams();
    if (next.kind) params.set('kind', next.kind);
    if (next.status) params.set('status', next.status);
    if (next.project) params.set('project', next.project);
    if (next.tag) params.set('tag', next.tag);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  const filtered = useMemo(
    () =>
      notes
        .filter((n) => (filters.status ? n.status === filters.status : n.status !== 'archived'))
        .filter((n) => (filters.kind ? n.kind === filters.kind : true))
        .filter((n) => (filters.project ? n.projectId === filters.project : true))
        .filter((n) => (filters.tag ? n.tags.some((t) => t.toLowerCase() === filters.tag.toLowerCase()) : true))
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
    [notes, filters]
  );

  const groups = useMemo(() => groupNotesByDate(filtered, todayKST()), [filtered]);
  const hasActiveFilters = Boolean(filters.kind || filters.status || filters.project || filters.tag);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <select
          value={filters.kind}
          onChange={(e) => update({ kind: e.target.value })}
          className="rounded-md border border-border bg-transparent px-2 py-1.5 text-xs"
        >
          <option value="">모든 종류</option>
          {Object.entries(KIND_LABEL).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <select
          value={filters.status}
          onChange={(e) => update({ status: e.target.value })}
          className="rounded-md border border-border bg-transparent px-2 py-1.5 text-xs"
        >
          <option value="">보관 제외 전체</option>
          {Object.entries(STATUS_LABEL).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <select
          value={filters.project}
          onChange={(e) => update({ project: e.target.value })}
          className="rounded-md border border-border bg-transparent px-2 py-1.5 text-xs"
        >
          <option value="">모든 프로젝트</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <TagManager tags={tags} />
      </div>

      {hasActiveFilters && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          {filters.kind && (
            <FilterChip label={KIND_LABEL[filters.kind as NoteKind]} onRemove={() => update({ kind: '' })} />
          )}
          {filters.status && (
            <FilterChip label={STATUS_LABEL[filters.status as NoteStatus]} onRemove={() => update({ status: '' })} />
          )}
          {filters.project && (
            <FilterChip
              label={projects.find((p) => p.id === filters.project)?.name ?? filters.project}
              onRemove={() => update({ project: '' })}
            />
          )}
          {filters.tag && <FilterChip label={`#${filters.tag}`} onRemove={() => update({ tag: '' })} />}
          <button
            type="button"
            onClick={() => update({ kind: '', status: '', project: '', tag: '' })}
            className="text-foreground/40 hover:underline"
          >
            초기화
          </button>
        </div>
      )}

      {groups.length === 0 ? (
        <EmptyState>조건에 맞는 메모가 없어요.</EmptyState>
      ) : (
        groups.map(({ label, notes: groupNotes }) => (
          <section key={label} className="flex flex-col gap-2">
            <h2 className="text-xs font-medium text-foreground/50">{label}</h2>
            <ul className="flex flex-col gap-2">
              {groupNotes.map((note) => (
                <NoteItem key={note.id} note={note} projects={projects} milestones={milestones} />
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}

function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <button
      type="button"
      onClick={onRemove}
      className="flex items-center gap-1 rounded-full bg-foreground/5 px-2 py-0.5 text-foreground/70 hover:bg-foreground/10"
    >
      {label}
      <X size={11} />
    </button>
  );
}
