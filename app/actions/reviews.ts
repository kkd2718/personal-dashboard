'use server';

import { z } from 'zod';
import { getRepo } from '@/lib/repo';
import type { ReviewJob } from '@/lib/types';
import { revalidateAll } from '@/app/actions/revalidate';

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD 형식이어야 합니다')
  .nullable()
  .optional();

const createSchema = z.object({
  journal: z.string().trim().min(1),
  manuscriptId: z.string().trim().nullable().optional(),
  title: z.string().trim().nullable().optional(),
  dueDate: dateSchema,
});

export async function createReviewAction(input: unknown): Promise<ReviewJob> {
  const parsed = createSchema.parse(input);
  const review = await getRepo().createReview(parsed);
  revalidateAll();
  return review;
}

const updateSchema = z.object({
  id: z.string().min(1),
  status: z.enum(['invited', 'accepted', 'submitted', 'declined']).optional(),
  dueDate: dateSchema,
  link: z.string().trim().nullable().optional(),
  note: z.string().trim().nullable().optional(),
});

export async function updateReviewAction(input: unknown): Promise<ReviewJob> {
  const { id, ...patch } = updateSchema.parse(input);
  const review = await getRepo().updateReview(id, patch);
  revalidateAll();
  return review;
}
