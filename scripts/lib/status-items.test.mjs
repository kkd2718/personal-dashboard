import { describe, expect, it } from 'vitest';
import { buildStatusItems, staleness } from './status-items.mjs';

const projects = [{ id: 'p1', name: 'Proj One', status: 'active' }];

describe('staleness', () => {
  it('is fresh within 7 days, quiet within 21, stale beyond', () => {
    expect(staleness('2026-09-20', '2026-09-25')).toBe('fresh');
    expect(staleness('2026-09-10', '2026-09-25')).toBe('quiet');
    expect(staleness('2026-08-01', '2026-09-25')).toBe('stale');
    expect(staleness(null, '2026-09-25')).toBe('stale');
  });
});

describe('buildStatusItems', () => {
  it('emits a stale warning for a project with an old commit', () => {
    const activities = [{ projectId: 'p1', lastCommitAt: '2026-08-01T00:00:00Z', dirty: false }];
    const items = buildStatusItems(projects, activities, [], '2026-09-25');
    expect(items.some((i) => i.id === 'git:stale:p1')).toBe(true);
  });

  it('emits one dirty summary line for all dirty projects', () => {
    const activities = [{ projectId: 'p1', lastCommitAt: '2026-09-24T00:00:00Z', dirty: true }];
    const items = buildStatusItems(projects, activities, [], '2026-09-25');
    const summary = items.find((i) => i.id === 'git:dirty');
    expect(summary.detail).toBe('Proj One');
  });

  it('sorts by severity: critical/warn before info/ok', () => {
    const trading = [{ id: 't1', severity: 'ok', source: 'trading', projectId: null, title: 'ok', detail: null, href: null }];
    const activities = [{ projectId: 'p1', lastCommitAt: '2026-08-01T00:00:00Z', dirty: false }];
    const items = buildStatusItems(projects, activities, trading, '2026-09-25');
    expect(items[0].severity).toBe('warn');
  });
});
