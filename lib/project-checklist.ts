// Server-side core of "resolve a project-checklist item" (no auth, no revalidate): shared
// by the home-lane server action and the Telegram weekly review. The item lives in that
// project's own docs/cc-status.json, so the dashboard hides it here and sends a memo to
// the project's SessionStart inbox so the next session there updates the file.
import {
  pruneResolved,
  RESOLVED_PROJECT_ITEMS_META_KEY,
  resolvedItemKey,
  type ResolvedProjectItem,
  type ResolvedProjectItems,
} from '@/lib/logic/project-detail';
import type { Repo } from '@/lib/repo';
import type { Note } from '@/lib/types';

export type ChecklistRepo = Pick<Repo, 'createNote' | 'updateNote' | 'getMeta' | 'setMeta'>;

function memoBody(state: ResolvedProjectItem['state'], text: string, until?: string): string {
  if (state === 'done') {
    return `[대시보드] 사용자가 완료로 표시함: "${text}" — docs/cc-status.json 체크리스트에서 done 으로 바꿔 주세요.`;
  }
  if (state === 'snooze') {
    return `[대시보드] 사용자가 "${text}" 마감을 ${until}로 미뤘어요 — docs/cc-status.json 체크리스트의 due 를 ${until}로 바꿔 주세요.`;
  }
  return `[대시보드] 사용자가 "안 함"으로 표시함: "${text}" — 하지 않기로 한 항목이니 체크리스트에서 지우거나 done(사유: 안 함)으로 정리해 주세요.`;
}

export async function resolveProjectItem(
  repo: ChecklistRepo,
  input: { projectId: string; text: string; state: ResolvedProjectItem['state']; until?: string },
  today: string,
  source: Note['source']
): Promise<void> {
  const { projectId, text, state, until } = input;
  const note = await repo.createNote({ body: memoBody(state, text, until), kind: 'todo', projectId, source });
  await repo.updateNote(note.id, { status: 'sent' });
  const current = (await repo.getMeta<ResolvedProjectItems>(RESOLVED_PROJECT_ITEMS_META_KEY)) ?? {};
  await repo.setMeta(RESOLVED_PROJECT_ITEMS_META_KEY, {
    ...pruneResolved(current, today),
    [resolvedItemKey(projectId, text)]: { state, at: today, noteId: note.id, ...(until ? { until } : {}) },
  });
}

/** Undo: shows the item again and archives the memo. */
export async function unresolveProjectItem(
  repo: ChecklistRepo,
  input: { projectId: string; text: string }
): Promise<void> {
  const current = (await repo.getMeta<ResolvedProjectItems>(RESOLVED_PROJECT_ITEMS_META_KEY)) ?? {};
  const key = resolvedItemKey(input.projectId, input.text);
  const entry = current[key];
  if (!entry) return;
  const rest = { ...current };
  delete rest[key];
  await repo.setMeta(RESOLVED_PROJECT_ITEMS_META_KEY, rest);
  if (entry.noteId) await repo.updateNote(entry.noteId, { status: 'archived' });
}
