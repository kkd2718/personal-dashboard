'use server';

import { z } from 'zod';
import { getRepo } from '@/lib/repo';
import type { Note } from '@/lib/types';
import { revalidateAll } from '@/app/actions/revalidate';

const createSchema = z.object({
  body: z.string().trim().min(1),
  kind: z.enum(['idea', 'memo', 'todo', 'link']).default('memo'),
  projectId: z.string().min(1).nullable().optional(),
  source: z
    .enum(['web', 'share', 'telegram', 'obsidian', 'gmail', 'collector'])
    .default('web'),
});

export async function createNoteAction(input: unknown): Promise<Note> {
  const parsed = createSchema.parse(input);
  const note = await getRepo().createNote(parsed);
  revalidateAll();
  return note;
}

const updateSchema = z.object({
  id: z.string().min(1),
  body: z.string().trim().min(1).optional(),
  kind: z.enum(['idea', 'memo', 'todo', 'link']).optional(),
  status: z.enum(['inbox', 'filed', 'sent', 'done', 'archived']).optional(),
  projectId: z.string().min(1).nullable().optional(),
  tags: z.array(z.string()).optional(),
  pinned: z.boolean().optional(),
});

export async function updateNoteAction(input: unknown): Promise<Note> {
  const { id, ...patch } = updateSchema.parse(input);
  const note = await getRepo().updateNote(id, patch);
  revalidateAll();
  return note;
}

/** Assign a note to a project; moves it out of the raw inbox. */
export async function assignNoteToProjectAction(id: string, projectId: string): Promise<Note> {
  return updateNoteAction({ id, projectId, status: 'filed' });
}
