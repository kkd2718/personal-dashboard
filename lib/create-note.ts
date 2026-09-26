// Server-only. Shared note-creation path for POST /api/capture (iOS Shortcut) and
// the Telegram webhook (phase 2b) — one implementation, only `source` differs.
import { getRepo } from '@/lib/repo';
import { captureNoteInput } from '@/lib/logic/capture';
import { tagCounts } from '@/lib/logic/notes';
import type { Note } from '@/lib/types';

export async function createNoteFromText(
  text: string,
  date: string | null | undefined,
  source: Note['source']
): Promise<Note> {
  const repo = getRepo();
  const [projects, notes] = await Promise.all([repo.listProjects(), repo.listNotes()]);
  const input = captureNoteInput(text, date, projects, tagCounts(notes).map((t) => t.tag), source);
  return repo.createNote(input);
}
