'use client';

import { useState, useTransition } from 'react';
import { Plus } from 'lucide-react';
import { createDeadlineAction, toggleDeadlineDoneAction } from '@/app/actions/deadlines';
import { dday, todayKST } from '@/lib/logic/dates';
import { DdayChip } from '@/components/dday-chip';
import type { Deadline, DeadlineKind } from '@/lib/types';

const KIND_LABEL: Record<DeadlineKind, string> = {
  paper: '논문',
  review: '리뷰',
  grant: '과제',
  thesis: '학위',
  interview: '면접',
  date: '일정',
  personal: '개인',
  other: '기타',
};

type Bucket = '지남' | '오늘' | '이번 주' | '이후';

function bucketOf(n: number): Bucket {
  if (n < 0) return '지남';
  if (n === 0) return '오늘';
  if (n <= 7) return '이번 주';
  return '이후';
}

export function DeadlineList({ deadlines }: { deadlines: Deadline[] }) {
  const today = todayKST();
  const [title, setTitle] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [kind, setKind] = useState<DeadlineKind>('other');
  const [pending, startTransition] = useTransition();

  function addDeadline(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !dueDate) return;
    startTransition(async () => {
      await createDeadlineAction({ title: title.trim(), kind, dueDate });
      setTitle('');
      setDueDate('');
      setKind('other');
    });
  }

  const buckets: Record<Bucket, Deadline[]> = { 지남: [], 오늘: [], '이번 주': [], 이후: [] };
  for (const d of deadlines) {
    if (d.done) continue;
    buckets[bucketOf(dday(d.dueDate, today))].push(d);
  }
  for (const list of Object.values(buckets)) list.sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1));

  const done = deadlines.filter((d) => d.done);

  return (
    <div className="flex flex-col gap-5">
      <form onSubmit={addDeadline} className="flex flex-wrap gap-2 rounded-xl border border-border p-3">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="마감 제목"
          className="min-w-0 flex-1 rounded-md border border-border bg-transparent px-2 py-1.5 text-sm"
        />
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as DeadlineKind)}
          className="rounded-md border border-border bg-transparent px-2 py-1.5 text-sm"
        >
          {Object.entries(KIND_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <input
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
          className="rounded-md border border-border bg-transparent px-2 py-1.5 text-sm"
        />
        <button
          type="submit"
          disabled={pending || !title.trim() || !dueDate}
          className="flex items-center gap-1 rounded-md bg-blue-600 px-3 py-1.5 text-sm text-white disabled:opacity-40"
        >
          <Plus size={14} />
          추가
        </button>
      </form>

      {(['지남', '오늘', '이번 주', '이후'] as const).map((bucket) =>
        buckets[bucket].length > 0 ? (
          <section key={bucket} className="flex flex-col gap-2">
            <h3 className="text-sm font-medium text-foreground/60">{bucket}</h3>
            <ul className="flex flex-col gap-2">
              {buckets[bucket].map((d) => (
                <li
                  key={d.id}
                  className="flex items-center gap-2 rounded-xl border border-border bg-surface p-3 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={d.done}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      startTransition(async () => {
                        await toggleDeadlineDoneAction(d.id, checked);
                      });
                    }}
                  />
                  <span className="flex-1">{d.title}</span>
                  <span className="rounded-full bg-foreground/5 px-2 py-0.5 text-[11px]">
                    {KIND_LABEL[d.kind]}
                  </span>
                  <DdayChip n={dday(d.dueDate, today)} />
                </li>
              ))}
            </ul>
          </section>
        ) : null
      )}

      {done.length > 0 && (
        <details className="text-sm text-foreground/50">
          <summary className="cursor-pointer">완료됨 ({done.length})</summary>
          <ul className="mt-2 flex flex-col gap-1">
            {done.map((d) => (
              <li key={d.id} className="flex items-center gap-2 line-through">
                <input
                  type="checkbox"
                  checked
                  onChange={(e) => {
                    const checked = e.target.checked;
                    startTransition(async () => {
                      await toggleDeadlineDoneAction(d.id, checked);
                    });
                  }}
                />
                {d.title}
              </li>
            ))}
          </ul>
        </details>
      )}

      {deadlines.length === 0 && <p className="text-sm text-foreground/50">등록된 마감이 없습니다.</p>}
    </div>
  );
}
