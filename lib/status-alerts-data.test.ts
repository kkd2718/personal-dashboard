import { describe, expect, it, vi } from 'vitest';
import { fakeRepo } from '@/lib/ask/fixtures';
import type { StatusItem } from '@/lib/status/types';
import { runStatusAlerts, type AlertRepo } from './status-alerts-data';

const item = (id: string, over: Partial<StatusItem> = {}): StatusItem => ({ id, severity: 'critical', source: 'trading', projectId: 'p-trading-system', title: `제목 ${id}`, detail: null, href: null, ...over });
const T0 = '2026-10-21T00:00:00.000Z';
const at = (h: number) => new Date(Date.parse(T0) + h * 3_600_000).toISOString();
const TODAY = '2026-10-21';

function setup() {
  const { repo, meta } = fakeRepo();
  const createTask = vi.fn(async (_input: unknown) => ({}) as never);
  const r = { getMeta: repo.getMeta.bind(repo), setMeta: repo.setMeta.bind(repo), createTask } as unknown as AlertRepo;
  return { r, meta, createTask };
}

describe('runStatusAlerts', () => {
  it('alerts once, stays silent hourly, then creates one task after 24 h', async () => {
    const s = setup();
    const send = vi.fn(async () => true);
    const crit = [item('a')];
    expect(await runStatusAlerts(s.r, [], crit, T0, TODAY, send)).toEqual({ alerted: 1, tasks: 0 });
    expect(await runStatusAlerts(s.r, crit, crit, at(1), TODAY, send)).toEqual({ alerted: 0, tasks: 0 });
    expect(send).toHaveBeenCalledTimes(1);
    expect(await runStatusAlerts(s.r, crit, crit, at(24), TODAY, send)).toEqual({ alerted: 0, tasks: 1 });
    expect(s.createTask).toHaveBeenCalledWith({ projectId: 'p-trading-system', title: '제목 a', dueDate: TODAY, assignee: 'me' });
    await runStatusAlerts(s.r, crit, crit, at(48), TODAY, send);
    expect(s.createTask).toHaveBeenCalledTimes(1);
  });

  it('a failed Telegram send retries on the next collect; no Telegram config records nothing', async () => {
    const s = setup();
    const crit = [item('a')];
    expect((await runStatusAlerts(s.r, [], crit, T0, TODAY, async () => false)).alerted).toBe(0);
    expect((await runStatusAlerts(s.r, crit, crit, at(1), TODAY, async () => true)).alerted).toBe(1);
    const none = setup();
    await runStatusAlerts(none.r, [], crit, T0, TODAY, null);
    expect((await runStatusAlerts(none.r, crit, crit, at(1), TODAY, async () => true)).alerted).toBe(1);
  });

  it('a failing task creation retries; only critical items are considered', async () => {
    const s = setup();
    const crit = [item('a'), item('w', { severity: 'warn' })];
    const send = vi.fn(async () => true);
    await runStatusAlerts(s.r, [], crit, T0, TODAY, send);
    expect(send).toHaveBeenCalledWith([expect.objectContaining({ id: 'a' })]);
    s.createTask.mockRejectedValueOnce(new Error('db'));
    expect((await runStatusAlerts(s.r, crit, crit, at(24), TODAY, send)).tasks).toBe(0);
    expect((await runStatusAlerts(s.r, crit, crit, at(25), TODAY, send)).tasks).toBe(1);
  });

  it('first deploy (no store): issues the previous snapshot already had do not alert again, even under the old id format', async () => {
    const s = setup();
    const send = vi.fn(async () => true);
    const old = [
      item('trading:alert:마지막 동기화 1.8시간 전 -- STALE (기준 54시간)', { title: '마지막 동기화 1.8시간 전 -- STALE (기준 54시간)' }),
      item('git:stale:p1', { source: 'git', title: 'Proj 오래됨' }),
    ];
    const now = [item('trading:alert:sync_stale', { title: '트레이딩 동기화 실패 (VM 접속)' }), item('git:stale:p1', { source: 'git', title: 'Proj 오래됨' }), item('brand:new')];
    expect(await runStatusAlerts(s.r, old, now, T0, TODAY, send)).toEqual({ alerted: 1, tasks: 0 });
    expect(send).toHaveBeenCalledWith([expect.objectContaining({ id: 'brand:new' })]);
    expect(await runStatusAlerts(s.r, now, now, at(1), TODAY, send)).toEqual({ alerted: 0, tasks: 0 });
    expect(send).toHaveBeenCalledTimes(1);
    expect((await runStatusAlerts(s.r, now, now, at(24), TODAY, send)).tasks).toBe(3); // seeded episodes still get their one task
  });

  it('the warn-level trading sync_failed follows the same alert-once / next-day-task policy; other warns do not', async () => {
    const s = setup();
    const send = vi.fn(async () => true);
    const failed = item('trading:alert:sync_failed', { severity: 'warn', title: '동기화 실패' });
    const now = [failed, item('trading:alert:other_warn', { severity: 'warn' })];
    expect(await runStatusAlerts(s.r, [], now, T0, TODAY, send)).toEqual({ alerted: 1, tasks: 0 });
    expect(send).toHaveBeenCalledWith([expect.objectContaining({ id: 'trading:alert:sync_failed' })]);
    expect(await runStatusAlerts(s.r, now, now, at(1), TODAY, send)).toEqual({ alerted: 0, tasks: 0 });
    expect(await runStatusAlerts(s.r, now, now, at(24), TODAY, send)).toEqual({ alerted: 0, tasks: 1 });
    expect(s.createTask).toHaveBeenCalledWith(expect.objectContaining({ title: '동기화 실패' }));
  });

  it('first deploy: a warn sync_failed already in the previous snapshot is seeded, not re-alerted', async () => {
    const s = setup();
    const send = vi.fn(async () => true);
    const failed = [item('trading:alert:sync_failed', { severity: 'warn' })];
    expect(await runStatusAlerts(s.r, failed, failed, T0, TODAY, send)).toEqual({ alerted: 0, tasks: 0 });
    expect(send).not.toHaveBeenCalled();
  });

  it('episode with a failed re-alert: alert h0, task h25, clear h26, return h60 (send fails), retry h61, task h85', async () => {
    const s = setup();
    const crit = [item('a')];
    const ok = vi.fn(async () => true);
    expect((await runStatusAlerts(s.r, [], crit, at(0), TODAY, ok)).alerted).toBe(1);
    expect((await runStatusAlerts(s.r, crit, crit, at(25), TODAY, ok)).tasks).toBe(1);
    await runStatusAlerts(s.r, crit, [], at(26), TODAY, ok);
    expect((await runStatusAlerts(s.r, [], crit, at(60), TODAY, async () => false)).alerted).toBe(0);
    expect((await runStatusAlerts(s.r, crit, crit, at(61), TODAY, ok)).alerted).toBe(1);
    expect((await runStatusAlerts(s.r, crit, crit, at(84), TODAY, ok)).tasks).toBe(0);
    expect((await runStatusAlerts(s.r, crit, crit, at(85), TODAY, ok)).tasks).toBe(1);
    expect(s.createTask).toHaveBeenCalledTimes(2);
  });
});
