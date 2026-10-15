import { describe, expect, it, vi } from 'vitest';
import { deadline, task } from '@/lib/logic/ax-fixtures';
import { applyProposal, type ApplyRepo } from './apply';

function repo(over: Partial<ApplyRepo> = {}) {
  const r = {
    listTasks: vi.fn(async () => [task({ id: '1', title: 't', dueDate: '2026-10-10' })]),
    updateTask: vi.fn(async () => task({ id: '1', title: 't' })),
    listDeadlines: vi.fn(async () => [deadline({ id: '1', title: 'd', dueTime: '09:00' })]),
    updateDeadline: vi.fn(async () => deadline({ id: '1', title: 'd' })),
    listCalendarEvents: vi.fn(async () => []),
    upsertCalendarEvent: vi.fn(async () => {}),
    ...over,
  };
  return r as typeof r & ApplyRepo;
}
const deps = { today: '2026-10-15', calendarCfg: null };

describe('applyProposal', () => {
  it('task_done / task_reschedule patches', async () => {
    const r = repo();
    await applyProposal(r, deps, { kind: 'task_done', taskId: '1', title: 't' });
    expect(r.updateTask).toHaveBeenLastCalledWith('1', { status: 'done' });
    await applyProposal(r, deps, { kind: 'task_reschedule', taskId: '1', title: 't', from: null, to: '2026-10-29' });
    expect(r.updateTask).toHaveBeenLastCalledWith('1', { dueDate: '2026-10-29' });
  });

  it('missing target: message, no throw, no write', async () => {
    const r = repo({ listTasks: vi.fn(async () => []) });
    expect(await applyProposal(r, deps, { kind: 'task_done', taskId: '9', title: 't' })).toContain('찾을 수 없어요');
    expect(r.updateTask).not.toHaveBeenCalled();
  });

  it('already done', async () => {
    const r = repo({ listTasks: vi.fn(async () => [task({ id: '1', title: 't', status: 'done' })]) });
    expect(await applyProposal(r, deps, { kind: 'task_done', taskId: '1', title: 't' })).toBe('이미 완료돼 있어요');
    expect(r.updateTask).not.toHaveBeenCalled();
  });

  it('deadline reschedule without dueTime leaves dueTime out of the patch', async () => {
    const r = repo();
    await applyProposal(r, deps, { kind: 'deadline_reschedule', deadlineId: '1', title: 'd', from: '2026-10-20', to: '2026-10-22' });
    expect(r.updateDeadline).toHaveBeenLastCalledWith('1', { dueDate: '2026-10-22' });
    await applyProposal(r, deps, {
      kind: 'deadline_reschedule',
      deadlineId: '1',
      title: 'd',
      from: '2026-10-20',
      to: '2026-10-22',
      dueTime: '17:00',
    });
    expect(r.updateDeadline).toHaveBeenLastCalledWith('1', { dueDate: '2026-10-22', dueTime: '17:00' });
  });

  it('deadline_done', async () => {
    const r = repo();
    await applyProposal(r, deps, { kind: 'deadline_done', deadlineId: '1', title: 'd' });
    expect(r.updateDeadline).toHaveBeenCalledWith('1', { done: true });
  });

  it('calendar_event without config does nothing', async () => {
    const r = repo();
    const out = await applyProposal(r, deps, {
      kind: 'calendar_event',
      events: [{ title: 'x', date: '2026-10-16', startTime: null, endTime: null }],
    });
    expect(out).toContain('미설정');
  });
});
