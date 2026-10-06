'use server';

import { z } from 'zod';
import { getRepo } from '@/lib/repo';
import { revalidateAll } from '@/app/actions/revalidate';
import { requireUser } from '@/lib/auth/require-user';
import { todayKST } from '@/lib/logic/dates';
import {
  pruneResolved,
  RESOLVED_PROJECT_ITEMS_META_KEY,
  resolvedItemKey,
  type ResolvedProjectItems,
} from '@/lib/logic/project-detail';

const resolveSchema = z.object({
  projectId: z.string().min(1),
  text: z.string().min(1).max(500),
  state: z.enum(['done', 'skip']),
});

/**
 * Resolves one of the owner's project-checklist items from the home lane. The item lives
 * in that project's docs/cc-status.json (its own repo), so the dashboard can't edit it:
 * it hides the item here (home + Telegram) and sends a memo to the project's SessionStart
 * inbox so the next session there marks it done / drops it in the file.
 */
export async function resolveProjectItemAction(input: unknown): Promise<void> {
  await requireUser();
  const { projectId, text, state } = resolveSchema.parse(input);
  const repo = getRepo();
  const today = todayKST();
  const body =
    state === 'done'
      ? `[대시보드] 사용자가 완료로 표시함: "${text}" — docs/cc-status.json 체크리스트에서 done 으로 바꿔 주세요.`
      : `[대시보드] 사용자가 "안 함"으로 표시함: "${text}" — 하지 않기로 한 항목이니 체크리스트에서 지우거나 done(사유: 안 함)으로 정리해 주세요.`;
  const note = await repo.createNote({ body, kind: 'todo', projectId, source: 'web' });
  await repo.updateNote(note.id, { status: 'sent' });
  const current = (await repo.getMeta<ResolvedProjectItems>(RESOLVED_PROJECT_ITEMS_META_KEY)) ?? {};
  await repo.setMeta(RESOLVED_PROJECT_ITEMS_META_KEY, {
    ...pruneResolved(current, today),
    [resolvedItemKey(projectId, text)]: { state, at: today, noteId: note.id },
  });
  revalidateAll();
}

const undoSchema = z.object({ projectId: z.string().min(1), text: z.string().min(1).max(500) });

/** Undo for resolveProjectItemAction: shows the item again and archives the memo. */
export async function unresolveProjectItemAction(input: unknown): Promise<void> {
  await requireUser();
  const { projectId, text } = undoSchema.parse(input);
  const repo = getRepo();
  const current = (await repo.getMeta<ResolvedProjectItems>(RESOLVED_PROJECT_ITEMS_META_KEY)) ?? {};
  const key = resolvedItemKey(projectId, text);
  const entry = current[key];
  if (!entry) return;
  const { [key]: _removed, ...rest } = current;
  await repo.setMeta(RESOLVED_PROJECT_ITEMS_META_KEY, rest);
  if (entry.noteId) await repo.updateNote(entry.noteId, { status: 'archived' });
  revalidateAll();
}
