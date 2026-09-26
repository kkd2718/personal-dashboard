import Link from 'next/link';
import { Lightbulb, Link2, SquareCheck, StickyNote } from 'lucide-react';
import { stripTokens } from '@/lib/logic/capture';
import { relTime } from '@/lib/logic/dates';
import { EmptyState } from '@/components/ui/empty-state';
import { projectColorClasses } from '@/lib/project-colors';
import type { Note, NoteKind, Project } from '@/lib/types';

const KIND_ICON: Record<NoteKind, typeof StickyNote> = {
  idea: Lightbulb,
  memo: StickyNote,
  todo: SquareCheck,
  link: Link2,
};

const RECENT_LIMIT = 5;

function firstLine(body: string): string {
  return stripTokens(body).split('\n')[0] ?? '';
}

/** Home "메모" strip: compact recent-notes list, click-through to /memo (§5.1). No
 * filters or per-row controls here — those live on the full /memo page. */
export function MemoPanel({ notes, projects }: { notes: Note[]; projects: Project[] }) {
  const open = notes.filter((n) => n.status === 'inbox' || n.status === 'filed');
  const recent = [...open].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, RECENT_LIMIT);
  const now = new Date().toISOString();

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">메모 · 전체 {open.length}</h2>
        <Link href="/memo" className="text-xs text-foreground/50 hover:underline">
          전체 보기 →
        </Link>
      </div>
      {recent.length === 0 ? (
        <EmptyState>아직 메모가 없어요. 떠오른 생각을 적어보세요.</EmptyState>
      ) : (
        <ul className="flex flex-col">
          {recent.map((note) => {
            const Icon = KIND_ICON[note.kind];
            const project = projects.find((p) => p.id === note.projectId);
            const colors = projectColorClasses(project?.color);
            return (
              <li key={note.id} className="border-b border-border py-1.5 last:border-0">
                <Link href="/memo" className="flex items-center gap-2 text-xs hover:opacity-80">
                  <Icon size={13} className="shrink-0 text-foreground/40" />
                  <span className="min-w-0 flex-1 truncate text-foreground/80">{firstLine(note.body)}</span>
                  {project && (
                    <span className="flex shrink-0 items-center gap-1 rounded-full bg-foreground/5 px-1.5 py-0.5 text-foreground/60">
                      <span className={`h-1.5 w-1.5 rounded-full ${colors.dot}`} />
                      {project.name}
                    </span>
                  )}
                  <span className="shrink-0 text-foreground/40" suppressHydrationWarning>
                    {relTime(note.createdAt, now)}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
