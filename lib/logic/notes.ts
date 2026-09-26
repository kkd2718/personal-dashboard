import type { Note, NoteStatus } from '@/lib/types';

export interface NoteFilter {
  projectId?: string | null;
  tag?: string | null; // compared case-insensitively
  status?: NoteStatus | null;
}

/** Filters notes for the home memo panel / /memo page. Excludes archived unless status='archived' asked for. */
export function filterNotes(notes: Note[], filter: NoteFilter = {}): Note[] {
  const tagLower = filter.tag?.toLowerCase();
  return notes.filter((n) => {
    if (filter.status) {
      if (n.status !== filter.status) return false;
    } else if (n.status === 'archived') {
      return false;
    }
    if (filter.projectId && n.projectId !== filter.projectId) return false;
    if (tagLower && !n.tags.some((t) => t.toLowerCase() === tagLower)) return false;
    return true;
  });
}

/** Distinct tags across notes with counts, case-insensitive (first-seen casing kept). */
export function tagCounts(notes: Note[]): { tag: string; count: number }[] {
  const counts = new Map<string, { tag: string; count: number }>();
  for (const n of notes) {
    for (const tag of n.tags) {
      const key = tag.toLowerCase();
      const entry = counts.get(key);
      if (entry) entry.count += 1;
      else counts.set(key, { tag, count: 1 });
    }
  }
  return [...counts.values()].sort((a, b) => b.count - a.count);
}
