import { describe, expect, it } from 'vitest';
import type { StatusItem } from '@/lib/status/types';
import { planStatusAlerts, revertPlan, type AlertState } from './status-alerts';

const item = (id: string, over: Partial<StatusItem> = {}): StatusItem => ({
  id,
  severity: 'critical',
  source: 'trading',
  projectId: 'p1',
  title: id,
  detail: null,
  href: null,
  ...over,
});
const T0 = '2026-10-21T00:00:00.000Z';
const at = (h: number) => new Date(Date.parse(T0) + h * 3_600_000).toISOString();

describe('planStatusAlerts', () => {
  it('first sight alerts and records the episode', () => {
    const p = planStatusAlerts({}, [], [item('a')], T0);
    expect(p.alert.map((i) => i.id)).toEqual(['a']);
    expect(p.task).toEqual([]);
    expect(p.next.a).toEqual({ firstAt: T0, alertedAt: T0, lastSeenAt: T0 });
  });

  it('a persisting issue is silent hourly and makes no task before 24 h', () => {
    let state = planStatusAlerts({}, [], [item('a')], T0).next;
    for (const h of [1, 2, 12, 23]) {
      const p = planStatusAlerts(state, ['a'], [item('a')], at(h));
      expect(p.alert).toEqual([]);
      expect(p.task).toEqual([]);
      state = p.next;
    }
  });

  it('persisting 24 h creates exactly one task, then nothing more while it persists', () => {
    const state = planStatusAlerts({}, [], [item('a')], T0).next;
    const p24 = planStatusAlerts(state, ['a'], [item('a')], at(24));
    expect(p24.alert).toEqual([]);
    expect(p24.task.map((i) => i.id)).toEqual(['a']);
    expect(p24.next.a.taskAt).toBe(at(24));
    const p25 = planStatusAlerts(p24.next, ['a'], [item('a')], at(25));
    expect(p25.task).toEqual([]);
    expect(p25.alert).toEqual([]);
    const p72 = planStatusAlerts(p25.next, ['a'], [item('a')], at(72));
    expect(p72.task).toEqual([]);
    expect(p72.alert).toEqual([]);
  });

  it('a flap (cleared then back) within 24 h stays silent', () => {
    const state = planStatusAlerts({}, [], [item('a')], T0).next;
    const cleared = planStatusAlerts(state, ['a'], [], at(2));
    expect(cleared.next.a).toBeDefined(); // kept for the cooldown
    const back = planStatusAlerts(cleared.next, [], [item('a')], at(5));
    expect(back.alert).toEqual([]);
    expect(back.task).toEqual([]);
  });

  it('absent for 24 h or more, then back: a new episode (alert again, no taskAt, task allowed again later)', () => {
    let state = planStatusAlerts({}, [], [item('a')], T0).next;
    state = planStatusAlerts(state, ['a'], [item('a')], at(24)).next; // task made
    expect(state.a.taskAt).toBeDefined();
    state = planStatusAlerts(state, ['a'], [], at(30)).next; // cleared (last seen h24)
    const back = planStatusAlerts(state, [], [item('a')], at(60));
    expect(back.alert.map((i) => i.id)).toEqual(['a']);
    expect(back.next.a).toEqual({ firstAt: at(60), alertedAt: at(60), lastSeenAt: at(60) });
    const later = planStatusAlerts(back.next, ['a'], [item('a')], at(84));
    expect(later.task.map((i) => i.id)).toEqual(['a']);
  });

  it('absent under 24 h (measured from when it was last seen): same episode, silent, no second task', () => {
    let state = planStatusAlerts({}, [], [item('a')], T0).next;
    state = planStatusAlerts(state, ['a'], [item('a')], at(24)).next; // task made, lastSeen h24
    state = planStatusAlerts(state, ['a'], [], at(26)).next; // cleared
    const back = planStatusAlerts(state, [], [item('a')], at(40)); // 16 h absent
    expect(back.alert).toEqual([]);
    expect(back.next.a.taskAt).toBe(at(24));
    expect(planStatusAlerts(back.next, ['a'], [item('a')], at(41)).task).toEqual([]);
  });

  it('different ids are independent; non-critical never reaches the planner', () => {
    const state = planStatusAlerts({}, [], [item('a')], T0).next;
    const p = planStatusAlerts(state, ['a'], [item('a'), item('b')], at(1));
    expect(p.alert.map((i) => i.id)).toEqual(['b']);
  });

  it('prunes cleared entries a week after they were last seen', () => {
    const state: AlertState = { old: { firstAt: T0, alertedAt: T0, lastSeenAt: T0 } };
    expect(planStatusAlerts(state, [], [], at(6 * 24)).next.old).toBeDefined();
    expect(planStatusAlerts(state, [], [], at(7 * 24 + 1)).next.old).toBeUndefined();
  });
});

describe('revertPlan', () => {
  it('a failed alert for an existing entry flags it pending; the next collect alerts again as a new episode', () => {
    let state: AlertState = { a: { firstAt: T0, alertedAt: T0, lastSeenAt: at(24), taskAt: at(24) } };
    const plan = planStatusAlerts(state, [], [item('a')], at(60));
    expect(plan.alert.map((i) => i.id)).toEqual(['a']);
    state = revertPlan(plan, state, { alert: true });
    expect(state.a).toMatchObject({ pendingAlert: true, taskAt: at(24), lastSeenAt: at(60) });
    const retry = planStatusAlerts(state, ['a'], [item('a')], at(61));
    expect(retry.alert.map((i) => i.id)).toEqual(['a']);
    expect(retry.next.a).toEqual({ firstAt: at(61), alertedAt: at(61), lastSeenAt: at(61) }); // flag and taskAt cleared
  });

  it('a failed send forgets the new entries so the next collect alerts again; existing ones stay', () => {
    const state: AlertState = { a: { firstAt: T0, alertedAt: T0, lastSeenAt: T0 } };
    const plan = planStatusAlerts(state, ['a'], [item('a'), item('b')], at(1));
    const out = revertPlan(plan, state, { alert: true });
    expect(out.b).toBeUndefined();
    expect(out.a).toBeDefined();
    expect(planStatusAlerts(out, ['a', 'b'], [item('a'), item('b')], at(2)).alert.map((i) => i.id)).toEqual(['b']);
  });

  it('a failed task creation is retried on the next collect', () => {
    const state = planStatusAlerts({}, [], [item('a')], T0).next;
    const plan = planStatusAlerts(state, ['a'], [item('a')], at(24));
    const out = revertPlan(plan, state, { taskIds: ['a'] });
    expect(out.a.taskAt).toBeUndefined();
    expect(planStatusAlerts(out, ['a'], [item('a')], at(25)).task.map((i) => i.id)).toEqual(['a']);
  });
});
