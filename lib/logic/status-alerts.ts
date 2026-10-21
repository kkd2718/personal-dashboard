// Alert-once policy for critical status items (the ingest path). An item id is one "issue": the first sighting
// alerts, a flap (clear -> back) within the cooldown stays silent, an issue still present after 24 h of its first
// alert yields exactly one task per episode, and an issue absent for 24 h or more that returns is a new episode.
import type { StatusItem } from '@/lib/status/types';

export const STATUS_ALERTS_META_KEY = 'status:alerts';
export const ALERT_COOLDOWN_HOURS = 24;
const PRUNE_AFTER_DAYS = 7;

export interface AlertEntry {
  /** First alert of the current episode (ISO). */
  firstAt: string;
  /** Latest alert sent for it (ISO). */
  alertedAt: string;
  /** Last collect that still reported it (ISO). */
  lastSeenAt: string;
  /** Set once the follow-up task exists for this episode (ISO). */
  taskAt?: string;
  /** The last alert for it failed to send: alert again on the next collect as a new episode. */
  pendingAlert?: boolean;
}
export type AlertState = Record<string, AlertEntry>;

export interface AlertPlan {
  /** Items to send as a Telegram alert now. */
  alert: StatusItem[];
  /** Items whose issue has persisted past 24 h: create one task each. */
  task: StatusItem[];
  /** State to store, assuming the alert was sent and the tasks were created. */
  next: AlertState;
}

/** Critical items, plus the trading app's warn-level `sync_failed` (it only emits it after >= 2 consecutive failures). */
export const isAlertable = (i: StatusItem): boolean => i.severity === 'critical' || i.id.startsWith('trading:alert:sync_failed');

const hours = (fromIso: string, nowIso: string): number => (Date.parse(nowIso) - Date.parse(fromIso)) / 3_600_000;

/** `prevCriticalIds` = ids that were critical in the previous snapshot (continuity); `critical` = critical items now. */
export function planStatusAlerts(state: AlertState, prevCriticalIds: Iterable<string>, critical: StatusItem[], nowIso: string): AlertPlan {
  const prev = new Set(prevCriticalIds);
  const next: AlertState = {};
  const alert: StatusItem[] = [];
  const task: StatusItem[] = [];
  const present = new Set(critical.map((i) => i.id));

  for (const item of critical) {
    const e = state[item.id];
    if (!e || e.pendingAlert || (!prev.has(item.id) && hours(e.lastSeenAt, nowIso) >= ALERT_COOLDOWN_HOURS)) {
      // First sighting, a failed earlier alert, or back after being absent for 24 h or more: a new episode.
      // (Back within 24 h of the last time it was seen is the same episode: silent, its taskAt is kept.)
      alert.push(item);
      next[item.id] = { firstAt: nowIso, alertedAt: nowIso, lastSeenAt: nowIso };
      continue;
    }
    next[item.id] = { ...e, lastSeenAt: nowIso };
    // Still reported since the previous collect and 24 h past the first alert: one task per episode.
    if (prev.has(item.id) && !e.taskAt && hours(e.firstAt, nowIso) >= ALERT_COOLDOWN_HOURS) {
      task.push(item);
      next[item.id].taskAt = nowIso;
    }
  }
  // Cleared items stay in the state (for the cooldown) until a week has passed since they were last seen.
  for (const [id, e] of Object.entries(state)) {
    if (!present.has(id) && hours(e.lastSeenAt, nowIso) < PRUNE_AFTER_DAYS * 24) next[id] = e;
  }
  return { alert, task, next };
}

const NUMBER = /\d+(?:[.,]\d+)*/g;

/** One-time migration (the alert store did not exist yet): current critical items the previous snapshot already
 * reported, matched by id, by number-stripped title, or - because the trading alert ids changed shape and the sync
 * title was reworded - any `trading:alert:*` item when the previous snapshot had one. They are recorded as already
 * alerted instead of firing a duplicate Telegram alert. */
export function seedFromPrevious(prevCritical: StatusItem[], critical: StatusItem[], nowIso: string): AlertState {
  const ids = new Set(prevCritical.map((i) => i.id));
  const titles = new Set(prevCritical.map((i) => i.title.replace(NUMBER, '#')));
  const prevHadTradingAlert = prevCritical.some((i) => i.id.startsWith('trading:alert:'));
  const state: AlertState = {};
  for (const i of critical) {
    if (ids.has(i.id) || titles.has(i.title.replace(NUMBER, '#')) || (prevHadTradingAlert && i.id.startsWith('trading:alert:'))) {
      state[i.id] = { firstAt: nowIso, alertedAt: nowIso, lastSeenAt: nowIso };
    }
  }
  return state;
}

/** `next` with the effects that did not happen undone (the alert failed to send / the task failed to create). */
export function revertPlan(plan: AlertPlan, state: AlertState, failed: { alert?: boolean; taskIds?: string[] }): AlertState {
  const out = { ...plan.next };
  if (failed.alert) {
    for (const i of plan.alert) {
      // An existing entry is flagged so the next collect alerts again (as a new episode); a new one is simply forgotten.
      if (state[i.id]) out[i.id] = { ...state[i.id], lastSeenAt: plan.next[i.id].lastSeenAt, pendingAlert: true };
      else delete out[i.id];
    }
  }
  for (const id of failed.taskIds ?? []) {
    if (out[id]) out[id] = { ...out[id], taskAt: state[id]?.taskAt };
    if (out[id] && out[id].taskAt === undefined) delete out[id].taskAt;
  }
  return out;
}
