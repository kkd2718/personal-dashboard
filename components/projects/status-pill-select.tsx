'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { updateProjectAction } from '@/app/actions/projects';
import { Chip } from '@/components/ui/chip';
import type { Project } from '@/lib/types';

const STATUS_LABEL: Record<Project['status'], string> = {
  active: '진행중',
  paused: '일시중지',
  done: '완료',
  archived: '보관됨',
};

const STATUS_TONE: Record<Project['status'], 'success' | 'warn' | 'accent' | 'neutral'> = {
  active: 'success',
  paused: 'warn',
  done: 'accent',
  archived: 'neutral',
};

/** Header status pill that's also an inline `<select>` (ux-advice.md §5.4 wireframe). */
export function StatusPillSelect({ project }: { project: Project }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <div className="relative inline-flex">
      <Chip tone={STATUS_TONE[project.status]} className={pending ? 'opacity-50' : ''}>
        {STATUS_LABEL[project.status]} ▾
      </Chip>
      <select
        aria-label="프로젝트 상태"
        value={project.status}
        disabled={pending}
        onChange={(e) => {
          const status = e.target.value as Project['status'];
          startTransition(async () => {
            await updateProjectAction({ id: project.id, status });
            router.refresh();
          });
        }}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
      >
        {Object.entries(STATUS_LABEL).map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </div>
  );
}
