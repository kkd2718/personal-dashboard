'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { filterNotes, tagCounts } from '@/lib/logic/notes';
import { relTime } from '@/lib/logic/dates';
import { NoteItem } from '@/components/note-item';
import { projectColorClasses } from '@/lib/project-colors';
import type { Milestone, Note, Project } from '@/lib/types';

const RECENT_LIMIT = 12;

/** Home panel: recent open memos with project/tag filter chips. */
export function MemoPanel({
  notes,
  projects,
  milestones,
}: {
  notes: Note[];
  projects: Project[];
  milestones: Milestone[];
}) {
  const [projectFilter, setProjectFilter] = useState<string | null>(null);
  const [tagFilter, setTagFilter] = useState<string>('');

  const open = useMemo(
    () => notes.filter((n) => n.status === 'inbox' || n.status === 'filed'),
    [notes]
  );
  const projectsWithMemos = useMemo(() => {
    const ids = new Set(open.map((n) => n.projectId).filter(Boolean) as string[]);
    return projects.filter((p) => ids.has(p.id));
  }, [open, projects]);
  const tags = useMemo(() => tagCounts(open), [open]);

  const filtered = useMemo(
    () =>
      filterNotes(open, { projectId: projectFilter, tag: tagFilter || null })
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
        .slice(0, RECENT_LIMIT),
    [open, projectFilter, tagFilter]
  );

  return (
    <div className="flex h-full flex-col gap-3 rounded-xl border border-border bg-surface p-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">메모</h2>
        <Link href="/memo" className="text-xs text-foreground/50 hover:underline">
          전체 보기 →
        </Link>
      </div>

      {(projectsWithMemos.length > 0 || tags.length > 0) && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <button
            type="button"
            onClick={() => setProjectFilter(null)}
            className={`rounded-full px-2 py-0.5 ${projectFilter === null ? 'bg-blue-600 text-white' : 'bg-foreground/5 text-foreground/60'}`}
          >
            전체
          </button>
          {projectsWithMemos.map((p) => {
            const colors = projectColorClasses(p.color);
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setProjectFilter(p.id === projectFilter ? null : p.id)}
                className={`flex items-center gap-1 rounded-full px-2 py-0.5 ${
                  projectFilter === p.id ? 'bg-blue-600 text-white' : 'bg-foreground/5 text-foreground/60'
                }`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${colors.dot}`} />
                {p.name}
              </button>
            );
          })}
          {tags.length > 0 && (
            <select
              value={tagFilter}
              onChange={(e) => setTagFilter(e.target.value)}
              className="rounded-full border border-border bg-transparent px-2 py-0.5"
            >
              <option value="">태그</option>
              {tags.map(({ tag, count }) => (
                <option key={tag} value={tag}>
                  #{tag} ({count})
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
      {filtered.length === 0 ? (
        <p className="text-xs text-foreground/40">조건에 맞는 메모가 없습니다.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.map((note) => (
            <div key={note.id} className="flex flex-col gap-1">
              {/* relative time differs between server render and hydration by design */}
              <span className="text-[11px] text-foreground/40" suppressHydrationWarning>
                {relTime(note.createdAt, new Date().toISOString())}
              </span>
              {/* NoteItem renders an <li>; give it a list parent without nesting <li> */}
              <ul>
                <NoteItem note={note} projects={projects} milestones={milestones} />
              </ul>
            </div>
          ))}
        </div>
      )}
      </div>
    </div>
  );
}
