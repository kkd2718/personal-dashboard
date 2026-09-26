'use client';

import { useState, useTransition } from 'react';
import { Plus, Mail } from 'lucide-react';
import {
  createReviewAction,
  updateReviewAction,
  acceptReviewCandidateAction,
  acceptRevisionCandidateAction,
  dismissReviewCandidateAction,
  undoDismissReviewCandidateAction,
  updateReviewCandidateDueDateAction,
} from '@/app/actions/reviews';
import { dday, todayKST } from '@/lib/logic/dates';
import { DdayChip } from '@/components/dday-chip';
import { Chip } from '@/components/ui/chip';
import { EmptyState } from '@/components/ui/empty-state';
import { useToast } from '@/components/ui/toast';
import { acceptButtonLabel, candidateHeadline, findMatchingPaper } from '@/lib/logic/review-candidates';
import { relTime } from '@/lib/logic/dates';
import type { Paper, ReviewCandidate, ReviewJob } from '@/lib/types';

const STATUS_LABEL: Record<ReviewJob['status'], string> = {
  invited: '초대됨',
  accepted: '수락',
  submitted: '제출완료',
  declined: '거절',
};

function CandidateCard({ candidate: c, reviews, papers }: { candidate: ReviewCandidate; reviews: ReviewJob[]; papers: Paper[] }) {
  const [pending, startTransition] = useTransition();
  const [paperId, setPaperId] = useState('');
  const [dueDateOpen, setDueDateOpen] = useState(false);
  const { show } = useToast();
  const today = todayKST();
  const now = new Date().toISOString();
  const primaryAccount = c.account === 'main';
  const mailLink = primaryAccount ? `https://mail.google.com/mail/#all/${c.messageId}` : null;

  const isRevision = c.kind === 'revision';
  const matchedPaper = isRevision ? findMatchingPaper(c, papers) : null;
  const needsPaperSelect = isRevision && !matchedPaper;
  const canAccept = !needsPaperSelect || paperId !== '';
  const headline = candidateHeadline(c, matchedPaper ?? (paperId ? papers.find((p) => p.id === paperId) ?? null : null), today);

  function accept() {
    startTransition(async () => {
      if (isRevision) {
        await acceptRevisionCandidateAction({ candidateId: c.id, paperId: matchedPaper ? undefined : paperId });
      } else {
        await acceptReviewCandidateAction(c.id);
      }
    });
  }

  function dismiss() {
    startTransition(async () => {
      await dismissReviewCandidateAction(c.id);
    });
    show('무시했어요', {
      action: { label: '실행 취소', onClick: () => undoDismissReviewCandidateAction(c.id) },
    });
  }

  return (
    <li className="flex flex-col gap-1.5 rounded-xl border border-border bg-surface p-3 text-sm">
      <div className="flex items-start gap-2">
        <Mail size={14} className="mt-0.5 shrink-0 text-foreground/40" />
        <p className="min-w-0 flex-1">{headline}</p>
      </div>
      <p className="pl-[22px] text-xs text-foreground/50">
        {mailLink ? (
          <a href={mailLink} target="_blank" rel="noreferrer" className="min-w-0 truncate text-accent hover:underline">
            {c.subject}
          </a>
        ) : (
          <span className="truncate">{c.subject}</span>
        )}
        {' · 수신 '}
        {relTime(c.receivedAt, now)} · {c.account}
      </p>

      {needsPaperSelect && (
        <div className="pl-[22px]">
          <select
            value={paperId}
            onChange={(e) => setPaperId(e.target.value)}
            className="rounded-md border border-border bg-transparent px-1.5 py-1 text-xs"
          >
            <option value="">어느 논문인가요?</option>
            {papers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.shortName}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="flex items-center gap-2 pl-[22px]">
        {dueDateOpen || c.dueDate ? (
          <input
            type="date"
            value={c.dueDate ?? ''}
            autoFocus={dueDateOpen && !c.dueDate}
            onChange={(e) => {
              startTransition(async () => {
                await updateReviewCandidateDueDateAction({ id: c.id, dueDate: e.target.value || null });
              });
            }}
            className="rounded-md border border-border bg-transparent px-1.5 py-0.5 text-xs"
          />
        ) : (
          <button type="button" onClick={() => setDueDateOpen(true)} className="text-xs text-foreground/40 hover:underline">
            마감일 지정
          </button>
        )}
        <div className="ml-auto flex gap-1.5">
          <button
            type="button"
            disabled={pending || !canAccept}
            onClick={accept}
            className="rounded-[var(--r-sm)] bg-accent px-2.5 py-1 text-xs text-white disabled:opacity-40"
          >
            {isRevision ? '적용' : acceptButtonLabel(c, reviews)}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={dismiss}
            className="rounded-[var(--r-sm)] border border-border px-2.5 py-1 text-xs text-foreground/70 hover:bg-foreground/5 disabled:opacity-40"
          >
            무시
          </button>
        </div>
      </div>
    </li>
  );
}

function CandidatePanel({ candidates, reviews, papers }: { candidates: ReviewCandidate[]; reviews: ReviewJob[]; papers: Paper[] }) {
  if (candidates.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium">메일에서 감지됨 — 확인 필요 ({candidates.length})</p>
      <ul className="flex flex-col gap-2">
        {candidates.map((c) => (
          <CandidateCard key={c.id} candidate={c} reviews={reviews} papers={papers} />
        ))}
      </ul>
    </div>
  );
}

export function ReviewList({
  reviews,
  candidates = [],
  papers = [],
}: {
  reviews: ReviewJob[];
  candidates?: ReviewCandidate[];
  papers?: Paper[];
}) {
  const today = todayKST();
  const [journal, setJournal] = useState('');
  const [manuscriptId, setManuscriptId] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [pending, startTransition] = useTransition();

  function addReview(e: React.FormEvent) {
    e.preventDefault();
    if (!journal.trim()) return;
    startTransition(async () => {
      await createReviewAction({
        journal: journal.trim(),
        manuscriptId: manuscriptId.trim() || null,
        dueDate: dueDate || null,
      });
      setJournal('');
      setManuscriptId('');
      setDueDate('');
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <CandidatePanel candidates={candidates} reviews={reviews} papers={papers} />

      <form onSubmit={addReview} className="flex flex-wrap gap-2 rounded-xl border border-border p-3">
        <input
          value={journal}
          onChange={(e) => setJournal(e.target.value)}
          placeholder="저널명"
          className="min-w-0 flex-1 rounded-md border border-border bg-transparent px-2 py-1.5 text-sm"
        />
        <input
          value={manuscriptId}
          onChange={(e) => setManuscriptId(e.target.value)}
          placeholder="원고 ID"
          className="w-32 rounded-md border border-border bg-transparent px-2 py-1.5 text-sm"
        />
        <input
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
          className="rounded-md border border-border bg-transparent px-2 py-1.5 text-sm"
        />
        <button
          type="submit"
          disabled={pending || !journal.trim()}
          className="flex items-center gap-1 rounded-[var(--r-sm)] bg-accent px-3 py-1.5 text-sm text-white disabled:opacity-40"
        >
          <Plus size={14} />
          추가
        </button>
      </form>

      <ul className="flex flex-col gap-2">
        {reviews.length === 0 && <EmptyState>등록된 리뷰가 없어요.</EmptyState>}
        {reviews.map((r) => (
          <li
            key={r.id}
            className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface p-3 text-sm"
          >
            <span className="font-medium">{r.journal}</span>
            {r.manuscriptId && <span className="text-xs text-foreground/50">{r.manuscriptId}</span>}
            <Chip>{STATUS_LABEL[r.status]}</Chip>
            {r.dueDate && <DdayChip n={dday(r.dueDate, today)} />}
            <select
              value={r.status}
              onChange={(e) => {
                const status = e.target.value as ReviewJob['status'];
                startTransition(async () => {
                  await updateReviewAction({ id: r.id, status });
                });
              }}
              className="ml-auto rounded-md border border-border bg-transparent px-2 py-1 text-xs"
            >
              {Object.entries(STATUS_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </li>
        ))}
      </ul>
    </div>
  );
}
