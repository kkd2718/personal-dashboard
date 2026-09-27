'use server';

import { z } from 'zod';
import { getRepo } from '@/lib/repo';
import type { ReviewCandidate, ReviewJob } from '@/lib/types';
import { revalidateAll } from '@/app/actions/revalidate';
import { requireUser } from '@/lib/auth/require-user';
import { decideAccept, decideRevisionAccept, findMatchingPaper } from '@/lib/logic/review-candidates';

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
  await requireUser();
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
  await requireUser();
  const { id, ...patch } = updateSchema.parse(input);
  const review = await getRepo().updateReview(id, patch);
  revalidateAll();
  return review;
}

// --- review candidates (phase 3: detected from Gmail via POST /api/google/sync) ---

/** Accepts a detected candidate into the ReviewJob pipeline — creates a new job or
 * updates an existing one sharing the same manuscriptId (see lib/logic/review-candidates.ts).
 * `kind === 'revision'` candidates go through acceptRevisionCandidateAction instead. */
export async function acceptReviewCandidateAction(candidateId: string): Promise<ReviewJob> {
  await requireUser();
  const repo = getRepo();
  const [candidates, reviews] = await Promise.all([repo.listReviewCandidates(), repo.listReviews()]);
  const candidate = candidates.find((c) => c.id === candidateId);
  if (!candidate) throw new Error(`ReviewCandidate not found: ${candidateId}`);
  if (candidate.kind === 'revision') throw new Error('revision candidates use acceptRevisionCandidateAction');

  const decision = decideAccept(candidate, reviews);
  let review: ReviewJob;
  if (decision.mode === 'update') {
    review = await repo.updateReview(decision.reviewId, { status: decision.status, dueDate: decision.dueDate });
  } else {
    review = await repo.createReview({
      journal: decision.journal,
      manuscriptId: decision.manuscriptId,
      title: decision.title,
      dueDate: decision.dueDate,
    });
    if (decision.status !== 'invited') {
      review = await repo.updateReview(review.id, { status: decision.status });
    }
  }
  await repo.updateReviewCandidate(candidateId, { status: 'accepted', reviewId: review.id });
  revalidateAll();
  return review;
}

export async function dismissReviewCandidateAction(candidateId: string): Promise<ReviewCandidate> {
  await requireUser();
  const candidate = await getRepo().updateReviewCandidate(candidateId, { status: 'dismissed' });
  revalidateAll();
  return candidate;
}

/** Undo for the 무시 toast (ux-advice.md §4.4) — puts a dismissed candidate back to pending. */
export async function undoDismissReviewCandidateAction(candidateId: string): Promise<ReviewCandidate> {
  await requireUser();
  const candidate = await getRepo().updateReviewCandidate(candidateId, { status: 'pending' });
  revalidateAll();
  return candidate;
}

const updateCandidateDueDateSchema = z.object({
  id: z.string().min(1),
  dueDate: dateSchema,
});

export async function updateReviewCandidateDueDateAction(input: unknown): Promise<ReviewCandidate> {
  await requireUser();
  const { id, dueDate } = updateCandidateDueDateSchema.parse(input);
  const candidate = await getRepo().updateReviewCandidate(id, { dueDate: dueDate ?? null });
  revalidateAll();
  return candidate;
}

// --- revision candidates (Addendum A: forwarded editorial decision letters) ---

const acceptRevisionSchema = z.object({
  candidateId: z.string().min(1),
  paperId: z.string().min(1).optional(), // required when no paper auto-matches (see findMatchingPaper)
});

/** Accepts a 'revision' candidate: sets the matched (or explicitly chosen) Paper's
 * latest submission decision to major/minor, and creates a matching Deadline when
 * the letter had a due date. Never touches ReviewJob. */
export async function acceptRevisionCandidateAction(input: unknown): Promise<void> {
  await requireUser();
  const { candidateId, paperId } = acceptRevisionSchema.parse(input);
  const repo = getRepo();
  const [candidates, papers] = await Promise.all([repo.listReviewCandidates(), repo.listPapers()]);
  const candidate = candidates.find((c) => c.id === candidateId);
  if (!candidate) throw new Error(`ReviewCandidate not found: ${candidateId}`);
  if (candidate.kind !== 'revision') throw new Error('not a revision candidate');

  const paper = paperId ? (papers.find((p) => p.id === paperId) ?? null) : findMatchingPaper(candidate, papers);
  if (!paper) throw new Error('No matching paper found — pick one');

  const decision = decideRevisionAccept(candidate, paper);

  const now = new Date().toISOString();
  const submissions =
    decision.submissionIndex === null
      ? [{ journal: candidate.journal ?? '(저널 미상)', submittedAt: null, decision: decision.decision, decidedAt: now }]
      : paper.submissions.map((s, i) =>
          i === decision.submissionIndex ? { ...s, decision: decision.decision, decidedAt: now } : s
        );
  // The journal now handling the paper shows on its card (board "AI · <journal>").
  await repo.updatePaper(paper.id, {
    submissions,
    stage: 'revision',
    ...(candidate.journal && !paper.journal ? { journal: candidate.journal } : {}),
  });
  if (candidate.dueDate) {
    await repo.createDeadline({
      title: decision.deadlineTitle,
      kind: 'paper',
      paperId: paper.id,
      dueDate: candidate.dueDate,
    });
  }
  await repo.updateReviewCandidate(candidateId, { status: 'accepted' });
  revalidateAll();
}
