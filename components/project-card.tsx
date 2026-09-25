import Link from 'next/link';
import { Folder, GitBranch, Laptop, Link2, Pin, Radio } from 'lucide-react';
import type { Project, ProjectActivity } from '@/lib/types';
import { dday, todayKST } from '@/lib/logic/dates';

const STATUS_LABEL: Record<Project['status'], string> = {
  active: '진행중',
  paused: '일시중지',
  done: '완료',
  archived: '보관됨',
};

const STATUS_COLOR: Record<Project['status'], string> = {
  active: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
  paused: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
  done: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300',
  archived: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400',
};

const LINK_ICON = { public: Link2, repo: GitBranch, local: Laptop, tailscale: Radio, folder: Folder };

export function ProjectCard({ project, activity }: { project: Project; activity?: ProjectActivity }) {
  const commitDaysAgo =
    activity?.lastCommitAt != null ? dday(todayKST(), activity.lastCommitAt.slice(0, 10)) : null;

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-2">
        <Link href={`/projects/${project.slug}`} className="font-medium hover:underline">
          {project.name}
        </Link>
        <div className="flex items-center gap-1.5">
          {project.pinned && <Pin size={13} className="text-amber-500" />}
          <span className={`rounded-full px-2 py-0.5 text-[11px] ${STATUS_COLOR[project.status]}`}>
            {STATUS_LABEL[project.status]}
          </span>
        </div>
      </div>
      {project.summary && <p className="text-sm text-foreground/70">{project.summary}</p>}
      {project.nextAction && (
        <p className="text-xs text-foreground/50">
          다음: <span className="text-foreground/70">{project.nextAction}</span>
        </p>
      )}
      {commitDaysAgo !== null && (
        <p className="text-[11px] text-foreground/40">
          마지막 커밋 {commitDaysAgo <= 0 ? '오늘' : `${commitDaysAgo}일 전`}
          {activity?.dirty ? ' · 미커밋 변경 있음' : ''}
        </p>
      )}
      {project.links.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {project.links.map((link) => {
            const Icon = LINK_ICON[link.kind];
            const needsPc = link.kind === 'local' || link.kind === 'tailscale';
            return (
              <a
                key={link.url}
                href={link.kind === 'local' ? undefined : link.url}
                target="_blank"
                rel="noreferrer"
                title={needsPc ? 'PC 필요' : link.url}
                className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-foreground/70 hover:bg-foreground/5"
              >
                <Icon size={12} />
                {link.label}
                {needsPc && <span className="text-foreground/40">(PC 필요)</span>}
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}
