import Link from 'next/link';
import { Folder, GitBranch, Laptop, Link2, Pin, Radio } from 'lucide-react';
import type { Milestone, Project, ProjectActivity, ProjectDetail, Task } from '@/lib/types';
import { dday, relTime, todayKST } from '@/lib/logic/dates';
import {
  backlogLabel,
  backlogProgress,
  labeledBars,
  labeledBarText,
  progressLabel,
  projectProgress,
  shouldShowBacklogBar,
} from '@/lib/logic/progress';
import { staleness } from '@/lib/logic/staleness';
import { checklistLine, checklistSummary } from '@/lib/logic/project-detail';
import { projectColorClasses } from '@/lib/project-colors';

const STATUS_LABEL: Record<Project['status'], string> = {
  active: '진행중',
  paused: '일시중지',
  done: '완료',
  archived: '보관됨',
};

// Dark mode never fills a solid color slab (ux-advice.md §3): a 3px left border +
// tinted text on the surface color instead, light mode keeps the soft filled pill.
const STATUS_COLOR: Record<Project['status'], string> = {
  active: 'bg-emerald-100 text-emerald-700 dark:rounded-md dark:border-l-[3px] dark:border-success dark:bg-success-soft dark:text-success',
  paused: 'bg-amber-100 text-amber-700 dark:rounded-md dark:border-l-[3px] dark:border-warn dark:bg-warn-soft dark:text-warn',
  done: 'bg-blue-100 text-blue-700 dark:rounded-md dark:border-l-[3px] dark:border-accent dark:bg-accent-soft dark:text-accent',
  archived: 'bg-slate-100 text-slate-500 dark:bg-surface-2 dark:text-fg-3',
};

const LINK_ICON = { public: Link2, repo: GitBranch, local: Laptop, tailscale: Radio, folder: Folder };

const STALENESS_LABEL = { fresh: '최근', quiet: '조용함', stale: '오래 조용함' } as const;
const STALENESS_COLOR = {
  fresh: 'bg-emerald-100 text-emerald-700 dark:rounded-md dark:border-l-[3px] dark:border-success dark:bg-success-soft dark:text-success',
  quiet: 'bg-amber-100 text-amber-700 dark:rounded-md dark:border-l-[3px] dark:border-warn dark:bg-warn-soft dark:text-warn',
  stale: 'bg-slate-100 text-slate-500 dark:bg-surface-2 dark:text-fg-3',
} as const;

export function ProjectCard({
  project,
  activity,
  tasks = [],
  milestones = [],
  now,
  details = {},
}: {
  project: Project;
  activity?: ProjectActivity;
  tasks?: Task[];
  milestones?: Milestone[];
  /** ISO timestamp for "n시간 전" — passed by the (server) caller so this stays a pure render. */
  now?: string;
  details?: Record<string, ProjectDetail>;
}) {
  const today = todayKST();
  const summary = checklistSummary(details[project.id]?.status ?? null, today);
  const commitDaysAgo =
    activity?.lastCommitAt != null ? dday(today, activity.lastCommitAt.slice(0, 10)) : null;
  const sessionRelTime =
    activity?.lastSessionAt != null && now != null ? relTime(activity.lastSessionAt, now) : null;
  const progress = projectProgress(project.id, tasks);
  const backlog = backlogProgress(activity);
  const bars = labeledBars(activity);
  const showBacklog = bars.length === 0 && shouldShowBacklogBar(project, tasks, backlog);
  const activeQueue = milestones.find((m) => m.projectId === project.id && m.status === 'active');
  const colors = projectColorClasses(project.color);
  const wsl = activity?.metrics?.wsl === '1';

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-2">
        <Link
          href={`/projects/${project.slug}`}
          className="flex min-w-0 items-center gap-1.5 truncate font-medium hover:underline"
        >
          <span className={`h-2 w-2 shrink-0 rounded-full ${colors.dot}`} />
          <span className="truncate">{project.name}</span>
        </Link>
        <div className="flex shrink-0 items-center gap-1.5">
          {project.pinned && <Pin size={13} className="text-amber-500" />}
          <span className={`rounded-full px-2 py-0.5 text-[11px] ${STATUS_COLOR[project.status]}`}>
            {STATUS_LABEL[project.status]}
          </span>
        </div>
      </div>
      {project.summary && <p className="text-sm text-foreground/70">{project.summary}</p>}
      {activeQueue && (
        <p className="text-xs text-foreground/50">
          큐: <span className="text-foreground/70">{activeQueue.title}</span>
        </p>
      )}
      {summary ? (
        <p className="min-w-0 truncate text-xs text-foreground/50">{checklistLine(summary)}</p>
      ) : (
        project.nextAction && (
          <p className="text-xs text-foreground/50">
            다음: <span className="text-foreground/70">{project.nextAction}</span>
          </p>
        )
      )}
      {progress.total > 0 &&
        (progress.total >= 3 ? (
          <div className="flex items-center gap-2">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-foreground/10">
              <div className={`h-full rounded-full ${colors.dot}`} style={{ width: `${progress.pct ?? 0}%` }} />
            </div>
            <span className="tnum shrink-0 text-[11px] text-foreground/50">{progressLabel(progress)}</span>
          </div>
        ) : (
          <p className="tnum text-[11px] text-foreground/50">{progressLabel(progress)}</p>
        ))}
      {bars.map((b) => (
        <div key={b.label} className="flex items-center gap-2" title={`${b.label} ${b.done}/${b.total}`}>
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-foreground/10">
            <div className="h-full rounded-full bg-foreground/30" style={{ width: `${b.pct ?? 0}%` }} />
          </div>
          <span className="tnum w-16 shrink-0 text-right text-[11px] text-foreground/50">{labeledBarText(b)}</span>
        </div>
      ))}
      {showBacklog && backlog && (
        <div className="flex items-center gap-2">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-foreground/10">
            <div className="h-full rounded-full bg-foreground/30" style={{ width: `${backlog.pct ?? 0}%` }} />
          </div>
          <span className="tnum shrink-0 text-[11px] text-foreground/50">{backlogLabel(backlog)}</span>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
        {wsl ? (
          <span className="rounded-full bg-foreground/5 px-2 py-0.5 text-[11px] text-foreground/40">
            WSL · 아직 수집 전
          </span>
        ) : (
          activity?.lastCommitAt != null && (
            <span className={`rounded-full px-2 py-0.5 text-[11px] ${STALENESS_COLOR[staleness(activity.lastCommitAt, today)]}`}>
              {STALENESS_LABEL[staleness(activity.lastCommitAt, today)]}
            </span>
          )
        )}
        {commitDaysAgo !== null && (
          <p className="tnum text-[11px] text-foreground/40">
            커밋 {now != null && activity?.lastCommitAt != null ? relTime(activity.lastCommitAt, now) : commitDaysAgo <= 0 ? '오늘' : `${commitDaysAgo}일 전`}
            {activity?.dirty ? ' · 미커밋 변경 있음' : ''}
          </p>
        )}
        {sessionRelTime !== null && (
          <p className="text-[11px] text-foreground/40">마지막 세션 {sessionRelTime}</p>
        )}
      </div>
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
