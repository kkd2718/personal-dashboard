// Pure decision logic for accepting a detected review-mail candidate into the
// ReviewJob pipeline, or (Addendum A) a revision letter into the Paper pipeline.
// No repo access — app/actions/reviews.ts calls repo methods based on these decisions.
import type { Paper, ReviewCandidate, ReviewJob, ReviewStatus, SubmissionDecision } from '@/lib/types';

export type AcceptDecision =
  | {
      mode: 'create';
      status: ReviewStatus;
      journal: string;
      manuscriptId: string | null;
      title: string | null;
      dueDate: string | null;
    }
  | { mode: 'update'; reviewId: string; status: ReviewStatus; dueDate: string | null };

// 'revision' never reaches decideAccept (it has its own decideRevisionAccept flow,
// dispatched by kind in app/actions/reviews.ts) — included only for exhaustiveness.
const KIND_TO_STATUS: Record<ReviewCandidate['kind'], ReviewStatus> = {
  invitation: 'invited',
  confirmation: 'accepted',
  reminder: 'accepted',
  revision: 'invited',
  other: 'invited',
};

/** Finds an existing ReviewJob sharing the candidate's manuscriptId (never matches
 * when manuscriptId is null on either side — different manuscripts could share "null"). */
export function findExistingReview(candidate: ReviewCandidate, reviews: ReviewJob[]): ReviewJob | null {
  if (!candidate.manuscriptId) return null;
  return reviews.find((r) => r.manuscriptId === candidate.manuscriptId) ?? null;
}

/** Decides whether accepting a candidate creates a new ReviewJob or updates an
 * existing one (reminder candidates specifically look for a same-manuscriptId job
 * to update; if none exists they fall back to creating one as 'accepted'). */
export function decideAccept(candidate: ReviewCandidate, reviews: ReviewJob[]): AcceptDecision {
  const existing = findExistingReview(candidate, reviews);
  if (existing) {
    return {
      mode: 'update',
      reviewId: existing.id,
      status: candidate.kind === 'invitation' ? existing.status : KIND_TO_STATUS[candidate.kind],
      dueDate: candidate.dueDate ?? existing.dueDate,
    };
  }
  return {
    mode: 'create',
    status: KIND_TO_STATUS[candidate.kind],
    journal: candidate.journal ?? '(저널 미상)',
    manuscriptId: candidate.manuscriptId,
    title: candidate.title,
    dueDate: candidate.dueDate,
  };
}

/** Button label shown in the reviews panel: '기존 리뷰 갱신' when a ReviewJob with
 * the same manuscriptId already exists, else '추가'. */
export function acceptButtonLabel(candidate: ReviewCandidate, reviews: ReviewJob[]): '추가' | '기존 리뷰 갱신' {
  return findExistingReview(candidate, reviews) ? '기존 리뷰 갱신' : '추가';
}

// --- revision candidates (Addendum A): the amc account forwards editorial decision
// letters on the user's own papers — accepting one sets that Paper's latest
// submission decision and creates a matching Deadline, instead of touching ReviewJob. ---

function norm(s: string): string {
  return s.trim().toLowerCase();
}

/** Finds the Paper a revision candidate is about, matching by journal (case-
 * insensitive contains, against any of the paper's submissions) first, then by
 * title (case-insensitive contains, either direction). Null if neither matches —
 * the panel then requires the user to pick one manually. */
export function findMatchingPaper(candidate: ReviewCandidate, papers: Paper[]): Paper | null {
  const journal = candidate.journal ? norm(candidate.journal) : null;
  if (journal) {
    const byJournal = papers.find((p) =>
      p.submissions.some((s) => norm(s.journal).includes(journal) || journal.includes(norm(s.journal)))
    );
    if (byJournal) return byJournal;
  }
  const title = candidate.title ? norm(candidate.title) : null;
  if (title) {
    const byTitle = papers.find((p) => norm(p.title).includes(title) || title.includes(norm(p.title)));
    if (byTitle) return byTitle;
  }
  return null;
}

export interface RevisionAcceptDecision {
  paperId: string;
  submissionIndex: number; // the paper's latest submission
  decision: SubmissionDecision;
  deadlineTitle: string;
}

/** Decides how accepting a revision candidate updates `paper`: the latest
 * submission's decision becomes 'major'/'minor' (revisionType null defaults to
 * 'major', the safer/more conservative assumption), and a Deadline title is
 * derived from the paper's short name. Null when the paper has no submissions
 * yet to attach a decision to. */
export function decideRevisionAccept(candidate: ReviewCandidate, paper: Paper): RevisionAcceptDecision | null {
  if (paper.submissions.length === 0) return null;
  const decision: SubmissionDecision = candidate.revisionType === 'minor' ? 'minor' : 'major';
  return {
    paperId: paper.id,
    submissionIndex: paper.submissions.length - 1,
    decision,
    deadlineTitle: `${paper.shortName} 리비전 제출`,
  };
}
