'use client';

import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Popover } from '@/components/ui/popover';
import { Sheet } from '@/components/ui/sheet';
import { StatusPanel, urgentOnly } from '@/components/status-panel';
import { ProjectProgressList } from '@/components/project-progress-list';
import type { Project, ProjectActivity, Task } from '@/lib/types';
import type { StatusItem } from '@/lib/status/types';

/**
 * Home header "⚠ 확인 필요 n" chip (PLAN_HOME2.md §Header): opens a Popover on
 * desktop / Sheet on phone with StatusPanel's full content plus the project
 * activity list (both without their old standalone card chrome). Hidden entirely
 * in favor of a neutral "모두 정상" chip when there's nothing urgent.
 */
export function StatusWarnChip({
  items,
  checkedAt,
  remote,
  projects,
  tasks,
  activityList,
}: {
  items: StatusItem[];
  checkedAt: string;
  remote: boolean;
  projects: Project[];
  tasks: Task[];
  activityList: ProjectActivity[];
}) {
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const n = urgentOnly(items).length;
  const label = n > 0 ? `⚠ 확인 필요 ${n}` : '모두 정상';
  const tone =
    n > 0
      ? 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300'
      : 'border-border text-foreground/50';

  const body = (
    <div className="flex flex-col gap-3">
      <StatusPanel initialItems={items} checkedAt={checkedAt} remote={remote} projects={projects} />
      <ProjectProgressList projects={projects} tasks={tasks} activityList={activityList} />
    </div>
  );

  return (
    <>
      <div className="hidden md:block">
        <Popover
          open={popoverOpen}
          onClose={() => setPopoverOpen(false)}
          align="end"
          className="w-[340px] max-h-[70vh] overflow-y-auto"
          trigger={
            <button
              type="button"
              onClick={() => setPopoverOpen((o) => !o)}
              className={`flex items-center gap-1 rounded-full border px-3 py-1 text-xs ${tone} hover:opacity-80`}
            >
              {label}
            </button>
          }
        >
          {body}
        </Popover>
      </div>
      <div className="md:hidden">
        <button
          type="button"
          onClick={() => setSheetOpen(true)}
          className={`flex items-center gap-1 rounded-full border px-3 py-1 text-xs ${tone} hover:opacity-80`}
        >
          {n > 0 ? (
            <>
              <AlertTriangle size={12} /> {n}
            </>
          ) : (
            '정상'
          )}
        </button>
        <Sheet open={sheetOpen} onClose={() => setSheetOpen(false)} title="상황">
          {body}
        </Sheet>
      </div>
    </>
  );
}
