import type { Note, NoteStatus } from '@/lib/types';
import { addDaysStr, startOfIsoWeek } from '@/lib/logic/dates';

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

export interface NoteGroup {
  label: string;
  notes: Note[];
}

/**
 * Groups notes for the /memo page (ux-advice.md §5.2): pinned notes float in a
 * "고정" group at the top regardless of date, then 오늘/어제/이번 주/이전 by
 * createdAt (KST calendar day). Empty groups are omitted.
 */
export function groupNotesByDate(notes: Note[], today: string): NoteGroup[] {
  const pinned = notes.filter((n) => n.pinned);
  const rest = notes.filter((n) => !n.pinned);

  const yesterday = addDaysStr(today, -1);
  const weekStart = startOfIsoWeek(today);
  const buckets: Record<string, Note[]> = { 오늘: [], 어제: [], '이번 주': [], 이전: [] };
  for (const n of rest) {
    const day = n.createdAt.slice(0, 10);
    if (day === today) buckets['오늘'].push(n);
    else if (day === yesterday) buckets['어제'].push(n);
    else if (day >= weekStart) buckets['이번 주'].push(n);
    else buckets['이전'].push(n);
  }

  const groups: NoteGroup[] = [];
  if (pinned.length > 0) groups.push({ label: '고정', notes: pinned });
  for (const [label, list] of Object.entries(buckets)) {
    if (list.length > 0) groups.push({ label, notes: list });
  }
  return groups;
}
