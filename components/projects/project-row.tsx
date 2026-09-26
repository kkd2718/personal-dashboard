import Link from 'next/link';
import { Folder, GitBranch, Laptop, Link2, Pin, Radio } from 'lucide-react';
import type { Milestone, Project, ProjectActivity, Task } from '@/lib/types';
import { relTime } from '@/lib/logic/dates';
import { progressLabel, projectProgress } from '@/lib/logic/progress';
import { Chip } from '@/components/ui/chip';
import { projectColorClasses } from '@/lib/project-colors';

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

const LINK_ICON = { public: Link2, repo: GitBranch, local: Laptop, tailscale: Radio, folder: Folder };

/** Activity sentence: "방금 세션 · 커밋 3일 전" style, empty parts omitted. */
function activitySentence(activity: ProjectActivity | undefined, now: string): string | null {
  if (!activity) return null;
  const parts: string[] = [];
  if (activity.lastSessionAt) parts.push(`세션 ${relTime(activity.lastSessionAt, now)}`);
  if (activity.lastCommitAt) {
    parts.push(`커밋 ${relTime(activity.lastCommitAt, now)}`);
    if (activity.dirty) parts.push('미커밋 변경 있음');
  } else if (activity.metrics.wsl === '1') {
    parts.push('WSL · 아직 수집 전');
  } else if (parts.length === 0) {
    parts.push('오래 조용함');
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}

/** Desktop row (ux-advice.md §5.3): dot + name/subgroup · status pill · activity ·
 * queue/next action · link icons. No per-subgroup grid. */
export function ProjectRow({
  project,
  activity,
  tasks = [],
  milestones = [],
  now,
}: {
  project: Project;
  activity?: ProjectActivity;
  tasks?: Task[];
  milestones?: Milestone[];
  now: string;
}) {
  const colors = projectColorClasses(project.color);
  const progress = projectProgress(project.id, tasks);
  const activeQueue = milestones.find((m) => m.projectId === project.id && m.status === 'active');
  const sentence = activitySentence(activity, now);
  const secondary = activeQueue ? `큐: ${activeQueue.title}` : project.nextAction ? `다음: ${project.nextAction}` : null;

  return (
    <div className="group flex min-h-9 items-center gap-3 rounded-[var(--r-md)] border border-border bg-surface px-3 py-2 text-sm hover:bg-foreground/[0.03]">
      <span className={`h-2 w-2 shrink-0 rounded-full ${colors.dot}`} aria-hidden />
      <Link href={`/projects/${project.slug}`} className="flex min-w-0 shrink-0 basis-48 flex-col hover:underline">
        <span className="flex items-center gap-1 truncate font-medium">
          {project.pinned && <Pin size={12} className="shrink-0 text-amber-500" />}
          <span className="truncate">{project.name}</span>
        </span>
        {project.subgroup && <span className="truncate text-[11px] text-foreground/40 no-underline">{project.subgroup}</span>}
      </Link>
      <Chip tone={STATUS_TONE[project.status]} className="shrink-0">
        {STATUS_LABEL[project.status]}
      </Chip>
      <span className="min-w-0 flex-1 truncate text-xs text-foreground/50">{sentence ?? ' '}</span>
      <span className="hidden min-w-0 shrink-0 basis-52 truncate text-xs text-foreground/60 md:block">
        {secondary}
        {progress.total > 0 && (secondary ? ' · ' : '') + progressLabel(progress)}
      </span>
      <span className="hidden shrink-0 items-center gap-1 lg:flex">
        {project.links.slice(0, 3).map((link) => {
          const Icon = LINK_ICON[link.kind];
          return (
            <a
              key={link.url}
              href={link.kind === 'local' ? undefined : link.url}
              target="_blank"
              rel="noreferrer"
              title={link.label}
              className="rounded-md p-1.5 text-foreground/40 hover:bg-foreground/5 hover:text-foreground/70"
            >
              <Icon size={14} />
            </a>
          );
        })}
      </span>
    </div>
  );
}
