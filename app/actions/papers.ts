'use server';

import { z } from 'zod';
import { getRepo } from '@/lib/repo';
import type { Paper } from '@/lib/types';
import { revalidateAll } from '@/app/actions/revalidate';
import { requireUser } from '@/lib/auth/require-user';

const stageSchema = z.enum([
  'idea',
  'writing',
  'submitted',
  'under_review',
  'revision',
  'accepted',
  'published',
]);

const moveSchema = z.object({
  id: z.string().min(1),
  toStage: stageSchema,
  toIndex: z.number().int().min(0),
});

export async function movePaperAction(input: unknown): Promise<Paper[]> {
  await requireUser();
  const { id, toStage, toIndex } = moveSchema.parse(input);
  const papers = await getRepo().movePaper(id, toStage, toIndex);
  revalidateAll();
  return papers;
}

const submissionSchema = z.object({
  journal: z.string().trim().min(1),
  submittedAt: z.string().nullable(),
  decision: z.enum(['pending', 'desk_reject', 'reject', 'major', 'minor', 'accept']).nullable(),
  decidedAt: z.string().nullable(),
});

const updateSchema = z.object({
  id: z.string().min(1),
  journal: z.string().nullable().optional(),
  manuscriptId: z.string().nullable().optional(),
  targetJournals: z.array(z.string()).optional(),
  folderPath: z.string().nullable().optional(),
  nextAction: z.string().nullable().optional(),
  projectId: z.string().nullable().optional(),
  submissions: z.array(submissionSchema).optional(),
});

export async function updatePaperAction(input: unknown): Promise<Paper> {
  await requireUser();
  const { id, ...patch } = updateSchema.parse(input);
  const paper = await getRepo().updatePaper(id, patch);
  revalidateAll();
  return paper;
}
