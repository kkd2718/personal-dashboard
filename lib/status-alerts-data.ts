// Applies the alert-once policy (lib/logic/status-alerts.ts) for one ingest: Telegram alert, follow-up tasks, state.
import { isAlertable, planStatusAlerts, revertPlan, seedFromPrevious, STATUS_ALERTS_META_KEY, type AlertState } from '@/lib/logic/status-alerts';
import type { StatusItem } from '@/lib/status/types';
import type { Repo } from '@/lib/repo';

export type AlertRepo = Pick<Repo, 'getMeta' | 'setMeta' | 'createTask'>;

export interface AlertRun {
  alerted: number;
  tasks: number;
}

/** `send` returns true when Telegram accepted the message; a failed send (or no Telegram at all) leaves the state
 * untouched so the next collect retries. Never throws. */
export async function runStatusAlerts(
  repo: AlertRepo,
  prevItems: StatusItem[],
  nextItems: StatusItem[],
  nowIso: string,
  today: string,
  send: ((items: StatusItem[]) => Promise<boolean>) | null
): Promise<AlertRun> {
  try {
    const stored = await repo.getMeta<AlertState>(STATUS_ALERTS_META_KEY);
    const critical = nextItems.filter(isAlertable);
    const prevCritical = prevItems.filter(isAlertable);
    // First run with no store: what the previous snapshot already reported counts as alerted (no duplicate on deploy).
    const state = stored ?? seedFromPrevious(prevCritical, critical, nowIso);
    const prevIds = prevCritical.map((i) => i.id);
    if (!stored) for (const id of Object.keys(state)) prevIds.push(id);
    const plan = planStatusAlerts(state, prevIds, critical, nowIso);

    const sent = plan.alert.length > 0 && send ? await send(plan.alert).catch(() => false) : false;
    const failedTasks: string[] = [];
    let tasks = 0;
    for (const item of plan.task) {
      try {
        await repo.createTask({ projectId: item.projectId, title: item.title, dueDate: today, assignee: 'me' });
        tasks++;
      } catch {
        failedTasks.push(item.id);
      }
    }
    // Without a sender nothing was alerted, so alert entries are not recorded either.
    const next = revertPlan(plan, state, { alert: plan.alert.length > 0 && !sent, taskIds: failedTasks });
    await repo.setMeta(STATUS_ALERTS_META_KEY, next);
    return { alerted: sent ? plan.alert.length : 0, tasks };
  } catch {
    return { alerted: 0, tasks: 0 };
  }
}
