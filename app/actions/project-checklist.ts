'use server';

import { z } from 'zod';
import { getRepo } from '@/lib/repo';
import { revalidateAll } from '@/app/actions/revalidate';
import { requireUser } from '@/lib/auth/require-user';
import { todayKST } from '@/lib/logic/dates';
import { resolveProjectItem, unresolveProjectItem } from '@/lib/project-checklist';

const resolveSchema = z.object({
  projectId: z.string().min(1),
  text: z.string().min(1).max(500),
  state: z.enum(['done', 'skip']),
});

/**
 * Resolves one of the owner's project-checklist items from the home lane (see
 * lib/project-checklist.ts for what that does).
 */
export async function resolveProjectItemAction(input: unknown): Promise<void> {
  await requireUser();
  const { projectId, text, state } = resolveSchema.parse(input);
  await resolveProjectItem(getRepo(), { projectId, text, state }, todayKST(), 'web');
  revalidateAll();
}

const undoSchema = z.object({ projectId: z.string().min(1), text: z.string().min(1).max(500) });

/** Undo for resolveProjectItemAction: shows the item again and archives the memo. */
export async function unresolveProjectItemAction(input: unknown): Promise<void> {
  await requireUser();
  await unresolveProjectItem(getRepo(), undoSchema.parse(input));
  revalidateAll();
}
