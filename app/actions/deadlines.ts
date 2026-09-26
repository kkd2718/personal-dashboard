'use server';

import { z } from 'zod';
import { getRepo } from '@/lib/repo';
import type { Deadline } from '@/lib/types';
import { revalidateAll } from '@/app/actions/revalidate';
import { requireUser } from '@/lib/auth/require-user';

const kindSchema = z.enum([
  'paper',
  'review',
  'grant',
  'thesis',
  'interview',
  'date',
  'personal',
  'other',
]);

const createSchema = z.object({
  title: z.string().trim().min(1),
  kind: kindSchema,
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD 형식이어야 합니다'),
  dueTime: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .nullable()
    .optional(),
  projectId: z.string().min(1).nullable().optional(),
});

export async function createDeadlineAction(input: unknown): Promise<Deadline> {
  await requireUser();
  const parsed = createSchema.parse(input);
  const deadline = await getRepo().createDeadline(parsed);
  revalidateAll();
  return deadline;
}

const updateSchema = z.object({
  id: z.string().min(1),
  title: z.string().trim().min(1).optional(),
  dueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  dueTime: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .nullable()
    .optional(),
  done: z.boolean().optional(),
});

export async function updateDeadlineAction(input: unknown): Promise<Deadline> {
  await requireUser();
  const { id, ...patch } = updateSchema.parse(input);
  const deadline = await getRepo().updateDeadline(id, patch);
  revalidateAll();
  return deadline;
}

export async function toggleDeadlineDoneAction(id: string, done: boolean): Promise<Deadline> {
  return updateDeadlineAction({ id, done });
}
