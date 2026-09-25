'use client';

import { useState, useTransition } from 'react';
import { updateProjectAction } from '@/app/actions/projects';
import type { Project } from '@/lib/types';

const STATUS_LABEL: Record<Project['status'], string> = {
  active: '진행중',
  paused: '일시중지',
  done: '완료',
  archived: '보관됨',
};

export function ProjectEditForm({ project }: { project: Project }) {
  const [status, setStatus] = useState(project.status);
  const [summary, setSummary] = useState(project.summary);
  const [nextAction, setNextAction] = useState(project.nextAction ?? '');
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);

  function save() {
    startTransition(async () => {
      await updateProjectAction({ id: project.id, status, summary, nextAction: nextAction || null });
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    });
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
      <label className="flex flex-col gap-1 text-sm">
        상태
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as Project['status'])}
          className="rounded-md border border-border bg-transparent px-2 py-1.5"
        >
          {Object.entries(STATUS_LABEL).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        요약
        <textarea
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          rows={2}
          className="rounded-md border border-border bg-transparent px-2 py-1.5"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        다음 액션
        <input
          value={nextAction}
          onChange={(e) => setNextAction(e.target.value)}
          className="rounded-md border border-border bg-transparent px-2 py-1.5"
        />
      </label>
      <button
        type="button"
        onClick={save}
        disabled={pending}
        className="self-start rounded-md bg-blue-600 px-4 py-1.5 text-sm text-white disabled:opacity-40"
      >
        {saved ? '저장됨' : '저장'}
      </button>
    </div>
  );
}
