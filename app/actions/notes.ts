'use server';

import { z } from 'zod';
import { getRepo } from '@/lib/repo';
import type { Note } from '@/lib/types';
import { revalidateAll } from '@/app/actions/revalidate';
import { requireUser } from '@/lib/auth/require-user';

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .nullable()
  .optional();

const createSchema = z.object({
  body: z.string().trim().min(1),
  kind: z.enum(['idea', 'memo', 'todo', 'link']).default('memo'),
  projectId: z.string().min(1).nullable().optional(),
  tags: z.array(z.string()).optional(),
  date: dateSchema,
  source: z
    .enum(['web', 'share', 'shortcut', 'telegram', 'obsidian', 'gmail', 'collector'])
    .default('web'),
});

export async function createNoteAction(input: unknown): Promise<Note> {
  await requireUser();
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
  date: dateSchema,
  pinned: z.boolean().optional(),
});

export async function updateNoteAction(input: unknown): Promise<Note> {
  await requireUser();
  const { id, ...patch } = updateSchema.parse(input);
  const note = await getRepo().updateNote(id, patch);
  revalidateAll();
  return note;
}

/** Assign a note to a project; moves it out of the raw inbox. */
export async function assignNoteToProjectAction(id: string, projectId: string): Promise<Note> {
  return updateNoteAction({ id, projectId, status: 'filed' });
}

const mergeTagSchema = z.object({ from: z.string().trim().min(1), to: z.string().trim().min(1) });

/** Rename a tag, or merge it into an existing one, across every note. */
export async function mergeTagAction(input: unknown): Promise<number> {
  await requireUser();
  const { from, to } = mergeTagSchema.parse(input);
  const count = await getRepo().mergeTag(from, to);
  revalidateAll();
  return count;
}
