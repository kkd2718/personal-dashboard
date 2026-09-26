'use server';

import { z } from 'zod';
import { getRepo } from '@/lib/repo';
import type { Task } from '@/lib/types';
import { revalidateAll } from '@/app/actions/revalidate';

const statusSchema = z.enum(['todo', 'doing', 'done']);
const assigneeSchema = z.enum(['me', 'agent']);
const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .nullable()
  .optional();

const createSchema = z.object({
  projectId: z.string().min(1).nullable().optional(),
  milestoneId: z.string().min(1).nullable().optional(),
  title: z.string().trim().min(1),
  description: z.string().nullable().optional(),
  dueDate: dateSchema,
  status: statusSchema.optional(),
  assignee: assigneeSchema.optional(),
});

export async function createTaskAction(input: unknown): Promise<Task> {
  const parsed = createSchema.parse(input);
  const task = await getRepo().createTask(parsed);
  revalidateAll();
  return task;
}

const updateSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1).nullable().optional(),
  milestoneId: z.string().min(1).nullable().optional(),
  title: z.string().trim().min(1).optional(),
  description: z.string().nullable().optional(),
  status: statusSchema.optional(),
  dueDate: dateSchema,
  assignee: assigneeSchema.optional(),
  sort: z.number().int().min(0).optional(),
});

export async function updateTaskAction(input: unknown): Promise<Task> {
  const { id, ...patch } = updateSchema.parse(input);
  const task = await getRepo().updateTask(id, patch);
  revalidateAll();
  return task;
}

/** Optimistic checkbox toggle from the home checklist / task board. */
export async function toggleTaskDoneAction(id: string, done: boolean): Promise<Task> {
  return updateTaskAction({ id, status: done ? 'done' : 'todo' });
}

const moveSchema = z.object({
  id: z.string().min(1),
  toStatus: statusSchema,
  toIndex: z.number().int().min(0),
});

export async function moveTaskAction(input: unknown): Promise<Task[]> {
  const { id, toStatus, toIndex } = moveSchema.parse(input);
  const tasks = await getRepo().moveTask(id, toStatus, toIndex);
  revalidateAll();
  return tasks;
}

const convertSchema = z.object({
  noteId: z.string().min(1),
  projectId: z.string().min(1),
  milestoneId: z.string().min(1).nullable().optional(),
  title: z.string().trim().min(1),
  dueDate: dateSchema,
});

/** Memo → Task: creates the task and marks the memo done+linked in one atomic write. */
export async function convertNoteToTaskAction(input: unknown): Promise<Task> {
  const { noteId, ...rest } = convertSchema.parse(input);
  const task = await getRepo().convertNoteToTask(noteId, rest);
  revalidateAll();
  return task;
}
