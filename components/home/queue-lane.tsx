import Link from 'next/link';
import { Bot, Plus } from 'lucide-react';
import { LaneCard } from '@/components/home/lane-card';
import { EmptyState } from '@/components/ui/empty-state';
import { DdayChip } from '@/components/dday-chip';
import { buildQueueLaneCards } from '@/lib/logic/home';
import { backlogLabel, labeledBarText, progressLabel } from '@/lib/logic/progress';
import { dday, todayKST } from '@/lib/logic/dates';
import { projectColorClasses } from '@/lib/project-colors';
import type { Milestone, Paper, Project, ProjectActivity, ProjectDetail, Task } from '@/lib/types';

/** Home 개발 큐 lane (PLAN_HOME2.md §Lanes 1). */
export function QueueLane({
  projects,
  milestones,
  tasks,
  activityList,
  papers,
  details = {},
}: {
  projects: Project[];
  milestones: Milestone[];
  tasks: Task[];
  activityList: ProjectActivity[];
  papers: Paper[];
  details?: Record<string, ProjectDetail>;
}) {
  const today = todayKST();
  const cards = buildQueueLaneCards(projects, milestones, tasks, activityList, papers, details, today);

  return (
    <LaneCard title="개발 큐" count={cards.length} href="/projects">
      {cards.length === 0 ? (
        <EmptyState
          action={
            <Link
              href="/projects"
              className="flex items-center gap-1 rounded-lg border border-dashed border-border px-2.5 py-1.5 text-xs text-foreground/50 hover:bg-foreground/5"
            >
              <Plus size={12} /> 큐
            </Link>
          }
        >
          진행 중인 큐가 없어요
        </EmptyState>
      ) : (
        <ul className="flex flex-col gap-2">
          {cards.map((card) => {
            const colors = projectColorClasses(card.project.color);
            const key = card.kind === 'queue' ? `queue-${card.milestone.id}` : `${card.kind}-${card.project.id}`;
            return (
              <li key={key}>
                <Link
                  href={`/projects/${card.project.slug}`}
                  className="flex flex-col gap-1 rounded-lg border border-border p-2 text-xs hover:bg-foreground/5"
                >
                  <span className="flex min-w-0 items-center gap-1.5 font-medium">
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${colors.dot}`} />
                    <span className="truncate">{card.project.name}</span>
                  </span>


                  {card.kind === 'queue' && (
                    <>
                      <span className="truncate text-foreground/70">{card.milestone.title}</span>
                      {card.progress.total > 0 && (
                        <div className="flex items-center gap-2">
                          {card.progress.total >= 3 && (
                            <div className="h-1.5 w-full overflow-hidden rounded-full bg-foreground/10">
                              <div
                                className={`h-full rounded-full ${colors.dot}`}
                                style={{ width: `${card.progress.pct ?? 0}%` }}
                              />
                            </div>
                          )}
                          <span className="shrink-0 text-foreground/50">{progressLabel(card.progress)}</span>
                        </div>
                      )}
                      {(card.nextTaskTitle || card.agentOpenCount > 0 || card.milestone.endDate) && (
                        <div className="flex flex-wrap items-center gap-1.5 text-foreground/40">
                          {card.nextTaskTitle && <span className="min-w-0 truncate">다음: {card.nextTaskTitle}</span>}
                          {card.agentOpenCount > 0 && (
                            <span className="flex shrink-0 items-center gap-0.5">
                              <Bot size={11} /> {card.agentOpenCount}
                            </span>
                          )}
                          {card.milestone.endDate && <DdayChip n={dday(card.milestone.endDate, today)} />}
                        </div>
                      )}
                    </>
                  )}

                  {card.kind === 'backlog' && (
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-foreground/10">
                        <div className="h-full rounded-full bg-foreground/30" style={{ width: `${card.backlog.pct ?? 0}%` }} />
                      </div>
                      <span className="shrink-0 text-foreground/50">{backlogLabel(card.backlog)}</span>
                    </div>
                  )}

                  {card.kind === 'bars' &&
                    card.bars.map((b) => (
                      <div key={b.label} className="flex items-center gap-2" title={`${b.label} ${b.done}/${b.total}`}>
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-foreground/10">
                          <div className="h-full rounded-full bg-foreground/30" style={{ width: `${b.pct ?? 0}%` }} />
                        </div>
                        <span className="tnum w-16 shrink-0 text-right text-foreground/50">{labeledBarText(b)}</span>
                      </div>
                    ))}

                  {card.kind === 'nextAction' && <span className="truncate text-foreground/50">다음: {card.nextAction}</span>}

                  {card.kind === 'checklist' && <span className="min-w-0 truncate text-foreground/50">{card.line}</span>}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </LaneCard>
  );
}
