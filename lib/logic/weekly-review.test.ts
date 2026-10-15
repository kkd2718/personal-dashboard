import { describe, expect, it } from 'vitest';
import { deadline, project, task } from './ax-fixtures';
import {
  buildWeeklyReview,
  deadlineClusters,
  formatWeekly,
  isSunday,
  weeklyKeyboard,
  type WeeklyItem,
} from './weekly-review';

const TODAY = '2026-10-18'; // Sunday
const NO_PROJECT_DUE = { overdue: [], today: [], tomorrow: [] };
const review = (o: Partial<Parameters<typeof buildWeeklyReview>[0]> = {}) =>
  buildWeeklyReview({ today: TODAY, tasks: [], deadlines: [], projectDue: NO_PROJECT_DUE, projects: [], ...o });

describe('isSunday', () => {
  it('detects Sunday', () => {
    expect(isSunday('2026-10-18')).toBe(true);
    expect(isSunday('2026-10-15')).toBe(false);
  });
});

describe('buildWeeklyReview', () => {
  it('overdue open task in; done and agent tasks out', () => {
    const r = review({
      tasks: [
        task({ id: 'a', title: 'late', dueDate: '2026-10-10' }),
        task({ id: 'b', title: 'done', dueDate: '2026-10-10', status: 'done' }),
        task({ id: 'c', title: 'agent', dueDate: '2026-10-10', assignee: 'agent' }),
      ],
    });
    expect(r.items.map((i) => i.title)).toEqual(['late']);
    expect(r.items[0]).toMatchObject({ section: 'overdue', state: 'open' });
  });

  it('stale at 14 days, not at 13; an overdue task is never also stale', () => {
    const r = review({
      tasks: [
        task({ id: 'old', title: 'old', updatedAt: '2026-10-03T00:00:00Z' }),
        task({ id: 'new', title: 'new', updatedAt: '2026-10-05T00:00:00Z' }),
        task({ id: 'late', title: 'late', dueDate: '2026-10-01', updatedAt: '2026-09-01T00:00:00Z' }),
      ],
    });
    expect(r.items.map((i) => [i.title, i.section])).toEqual([
      ['late', 'overdue'],
      ['old', 'stale'],
    ]);
  });

  it('project items count; deadlines come before tasks', () => {
    const r = review({
      tasks: [task({ id: 't', title: 'task', dueDate: '2026-10-10' })],
      deadlines: [deadline({ id: 'd', title: 'deadline', dueDate: '2026-10-12', projectId: 'p' })],
      projects: [project({ id: 'p', slug: 'p', name: 'Proj' })],
      projectDue: { ...NO_PROJECT_DUE, overdue: [{ projectId: 'p', project: 'Proj', text: 'pi', due: '2026-10-11', blocked: false }] },
    });
    expect(r.items.map((i) => i.ref.kind)).toEqual(['deadline', 'task', 'project']);
    expect(r.items[0].project).toBe('Proj');
  });

  it('caps at 10 and reports the rest', () => {
    const tasks = Array.from({ length: 12 }, (_, i) => task({ id: String(i), title: `t${i}`, dueDate: '2026-10-10' }));
    const r = review({ tasks });
    expect(r.items).toHaveLength(10);
    expect(r.more).toBe(2);
  });
});

describe('deadlineClusters', () => {
  const dl = (id: string, due: string, done = false) => deadline({ id, title: id, dueDate: due, done });
  it('chains same/consecutive days, needs >= 2', () => {
    expect(deadlineClusters([dl('a', '2026-10-20'), dl('b', '2026-10-21'), dl('c', '2026-10-24')], TODAY)).toEqual([
      { from: '2026-10-20', to: '2026-10-21', titles: ['a', 'b'] },
    ]);
    expect(deadlineClusters([dl('a', '2026-10-20'), dl('b', '2026-10-20')], TODAY)).toHaveLength(1);
    expect(deadlineClusters([dl('a', '2026-10-20'), dl('b', '2026-10-22')], TODAY)).toEqual([]);
  });
  it('ignores beyond a week and done', () => {
    expect(deadlineClusters([dl('a', '2026-10-26'), dl('b', '2026-10-26')], TODAY)).toEqual([]);
    expect(deadlineClusters([dl('a', '2026-10-20', true), dl('b', '2026-10-20')], TODAY)).toEqual([]);
  });
});

describe('format and keyboard', () => {
  const item = (state: WeeklyItem['state'], hint?: WeeklyItem['hint']): WeeklyItem => ({
    ref: { kind: 'task', id: 'x' }, section: 'overdue', title: 'a<b', project: null, due: '2026-10-10', state, hint,
  });
  it('marks state and hints, escapes', () => {
    const text = formatWeekly({ items: [item('open', 'drop'), item('done')], more: 3, clusters: [] }, TODAY);
    expect(text).toContain('1. a&lt;b · 마감 10/10 (8일 지남) 🗑?');
    expect(text).toContain('2. ✅ a&lt;b');
    expect(text).toContain('…외 3건');
  });
  it('clips long titles before escaping, never cutting an entity', () => {
    const long = { ...item('open'), title: `${'&'.repeat(200)}` };
    const line = formatWeekly({ items: [long], more: 0, clusters: [] }, TODAY).split('\n')[1];
    expect(line).not.toMatch(/&(?!amp;)/);
    expect(line.length).toBeLessThan(500);
  });
  it('keyboard rows only for open items, callback data fits Telegram', () => {
    const kb = weeklyKeyboard('abc1234567', [item('open'), item('done'), item('open')]);
    expect(kb.inline_keyboard).toHaveLength(2);
    expect(kb.inline_keyboard[1][0].callback_data).toBe('w:abc1234567:2:d');
    for (const b of kb.inline_keyboard.flat()) expect(Buffer.byteLength(b.callback_data)).toBeLessThanOrEqual(64);
    expect(weeklyKeyboard('x', [item('done')]).inline_keyboard).toEqual([]);
  });
});
