'use client';

import { useState, useTransition } from 'react';
import { Plus } from 'lucide-react';
import { createReviewAction, updateReviewAction } from '@/app/actions/reviews';
import { dday, todayKST } from '@/lib/logic/dates';
import { DdayChip } from '@/components/dday-chip';
import type { ReviewJob } from '@/lib/types';

const STATUS_LABEL: Record<ReviewJob['status'], string> = {
  invited: '초대됨',
  accepted: '수락',
  submitted: '제출완료',
  declined: '거절',
};

export function ReviewList({ reviews }: { reviews: ReviewJob[] }) {
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
          className="flex items-center gap-1 rounded-md bg-blue-600 px-3 py-1.5 text-sm text-white disabled:opacity-40"
        >
          <Plus size={14} />
          추가
        </button>
      </form>

      <ul className="flex flex-col gap-2">
        {reviews.length === 0 && <li className="text-sm text-foreground/50">등록된 리뷰가 없습니다.</li>}
        {reviews.map((r) => (
          <li
            key={r.id}
            className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface p-3 text-sm"
          >
            <span className="font-medium">{r.journal}</span>
            {r.manuscriptId && <span className="text-xs text-foreground/50">{r.manuscriptId}</span>}
            <span className="rounded-full bg-foreground/5 px-2 py-0.5 text-[11px]">
              {STATUS_LABEL[r.status]}
            </span>
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
