import { isStatusStale, statusAgeLabel } from '@/lib/logic/project-detail';
import { CcChecklist } from '@/components/projects/cc-checklist';
import type { ProjectDetail } from '@/lib/types';

function doneLabel(d: { date: string | null; text: string }): string {
  if (!d.date) return d.text;
  const [, m, day] = d.date.split('-');
  return `${Number(m)}/${Number(day)} ${d.text}`;
}

/** "현황" card: a project's own Claude session's docs/cc-status.json, plus the
 * automatically-collected open backlog item titles by label. No server-only imports,
 * so it can also render inside a client component (e.g. the paper detail sheet). */
export function ProjectStatusCard({
  detail,
  now,
  hideTitle = false,
}: {
  detail: ProjectDetail | null;
  now: string;
  /** Drop the own "현황" heading when the caller already renders one. */
  hideTitle?: boolean;
}) {
  const status = detail?.status ?? null;
  const openItems = detail?.openItems ?? {};
  const ageLabel = statusAgeLabel(status, now);
  const stale = isStatusStale(status, new Date(now).getTime());

  return (
    <section className="flex flex-col gap-2">
      {!hideTitle && <h2 className="text-sm font-medium text-foreground/60">현황</h2>}
      <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-3 text-sm">
        {status ? (
          <div className="flex min-w-0 flex-col gap-2">
            {status.focus && <p className="min-w-0 break-words font-medium">{status.focus}</p>}
            {status.next.length > 0 && (
              <div className="min-w-0">
                <p className="text-xs text-foreground/50">다음</p>
                <ul className="list-disc pl-4">
                  {status.next.map((t, i) => (
                    <li key={i} className="min-w-0 break-words">{t}</li>
                  ))}
                </ul>
              </div>
            )}
            {status.blockers.length > 0 && (
              <div className="min-w-0">
                <p className="text-xs text-amber-600 dark:text-amber-400">막힘</p>
                <ul className="list-disc pl-4 text-amber-700 dark:text-amber-300">
                  {status.blockers.map((t, i) => (
                    <li key={i} className="min-w-0 break-words">{t}</li>
                  ))}
                </ul>
              </div>
            )}
            {status.done.length > 0 && (
              <div className="min-w-0">
                <p className="text-xs text-foreground/50">최근 완료</p>
                <ul className="list-disc pl-4 text-foreground/70">
                  {status.done.slice(0, 5).map((d, i) => (
                    <li key={i} className="min-w-0 break-words">{doneLabel(d)}</li>
                  ))}
                </ul>
              </div>
            )}
            {status.checklist.length > 0 && <CcChecklist items={status.checklist} />}
            {ageLabel && (
              <p className="text-xs text-foreground/40">
                {ageLabel}
                {stale && <span className="ml-1 text-amber-600 dark:text-amber-400">오래됨</span>}
              </p>
            )}
          </div>
        ) : (
          <p className="text-foreground/40">
            이 프로젝트의 Claude 세션이 docs/cc-status.json 을 쓰면 여기에 표시돼요.
          </p>
        )}

        {Object.entries(openItems)
          .filter(([, items]) => items.length > 0)
          .map(([label, items]) => (
            <details key={label} className="min-w-0">
              <summary className="cursor-pointer text-xs text-foreground/50">
                남은 {label} {items.length}개
              </summary>
              <ul className="list-disc pl-4 pt-1 text-foreground/70">
                {items.map((item, i) => (
                  <li key={i} className="min-w-0 break-words">{item}</li>
                ))}
              </ul>
            </details>
          ))}
      </div>
    </section>
  );
}
