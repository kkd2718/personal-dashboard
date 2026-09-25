'use client';

import { useState, useTransition } from 'react';
import { Plus } from 'lucide-react';
import { updatePaperAction } from '@/app/actions/papers';
import type { Paper, SubmissionDecision } from '@/lib/types';

const DECISION_LABEL: Record<SubmissionDecision, string> = {
  pending: '심사중',
  desk_reject: '데스크 리젝',
  reject: '리젝',
  major: '메이저 수정',
  minor: '마이너 수정',
  accept: '게재확정',
};

/** Simple submission history list + add row. No polish — phase 1a scope. */
export function PaperSubmissions({ paper }: { paper: Paper }) {
  const [journal, setJournal] = useState('');
  const [pending, startTransition] = useTransition();

  function addSubmission() {
    if (!journal.trim()) return;
    const submissions = [
      ...paper.submissions,
      { journal: journal.trim(), submittedAt: null, decision: 'pending' as const, decidedAt: null },
    ];
    startTransition(async () => {
      await updatePaperAction({ id: paper.id, submissions });
    });
    setJournal('');
  }

  function setDecision(index: number, decision: SubmissionDecision) {
    const submissions = paper.submissions.map((s, i) => (i === index ? { ...s, decision } : s));
    startTransition(async () => {
      await updatePaperAction({ id: paper.id, submissions });
    });
  }

  return (
    <div className="flex flex-col gap-2">
      {paper.submissions.length > 0 && (
        <ul className="flex flex-col gap-1">
          {paper.submissions.map((s, i) => (
            <li key={`${s.journal}-${i}`} className="flex items-center gap-2 text-xs">
              <span className="font-medium">{s.journal}</span>
              <select
                value={s.decision ?? 'pending'}
                onChange={(e) => setDecision(i, e.target.value as SubmissionDecision)}
                disabled={pending}
                className="rounded-md border border-border bg-transparent px-1.5 py-0.5"
              >
                {Object.entries(DECISION_LABEL).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-1.5">
        <input
          value={journal}
          onChange={(e) => setJournal(e.target.value)}
          placeholder="투고 저널 추가"
          className="min-w-0 flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-xs"
        />
        <button
          type="button"
          onClick={addSubmission}
          disabled={pending || !journal.trim()}
          className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs disabled:opacity-40"
        >
          <Plus size={12} />
          추가
        </button>
      </div>
    </div>
  );
}
