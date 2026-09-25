'use server';

import { z } from 'zod';
import { getRepo } from '@/lib/repo';
import type { Milestone } from '@/lib/types';
import { revalidateAll } from '@/app/actions/revalidate';

const statusSchema = z.enum(['planned', 'active', 'done']);
const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .nullable()
  .optional();

const createSchema = z.object({
  projectId: z.string().min(1),
  title: z.string().trim().min(1),
  startDate: dateSchema,
  endDate: dateSchema,
  status: statusSchema.optional(),
});

export async function createMilestoneAction(input: unknown): Promise<Milestone> {
  const parsed = createSchema.parse(input);
  const milestone = await getRepo().createMilestone(parsed);
  revalidateAll();
  return milestone;
}

const updateSchema = z.object({
  id: z.string().min(1),
  title: z.string().trim().min(1).optional(),
  startDate: dateSchema,
  endDate: dateSchema,
  status: statusSchema.optional(),
  sort: z.number().int().min(0).optional(),
});

export async function updateMilestoneAction(input: unknown): Promise<Milestone> {
  const { id, ...patch } = updateSchema.parse(input);
  const milestone = await getRepo().updateMilestone(id, patch);
  revalidateAll();
  return milestone;
}
