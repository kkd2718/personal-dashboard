'use server';

import { z } from 'zod';
import { getRepo } from '@/lib/repo';
import type { Deadline, Paper } from '@/lib/types';
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

const createSchema = z.object({
  shortName: z.string().trim().min(1),
  title: z.string().trim().min(1),
  track: z.enum(['AI', '역학', '개인연구', '기타']),
  stage: stageSchema.optional(),
  projectId: z.string().nullable().optional(),
});

export async function createPaperAction(input: unknown): Promise<Paper> {
  await requireUser();
  const parsed = createSchema.parse(input);
  const paper = await getRepo().createPaper(parsed);
  revalidateAll();
  return paper;
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

const revisionDeadlineSchema = z.object({
  paperId: z.string().min(1),
  title: z.string().trim().min(1),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD 형식이어야 합니다'),
});

/** "+ 리비전 마감" shortcut in the paper detail panel (ux-advice.md §5.5): creates a
 * `kind: 'paper'` Deadline linked to this paper. Lives here (not app/actions/deadlines.ts,
 * owned by another slice) since it's just a thin wrapper over the existing repo method. */
export async function createRevisionDeadlineAction(input: unknown): Promise<Deadline> {
  await requireUser();
  const { paperId, title, dueDate } = revisionDeadlineSchema.parse(input);
  const deadline = await getRepo().createDeadline({ title, kind: 'paper', paperId, dueDate });
  revalidateAll();
  return deadline;
}
