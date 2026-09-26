import { describe, expect, it } from 'vitest';
import { newCriticalItems } from './status-diff';
import type { StatusItem } from '@/lib/status/types';

function item(overrides: Partial<StatusItem>): StatusItem {
  return {
    id: 'i1',
    severity: 'critical',
    source: 'git',
    projectId: null,
    title: 'test item',
    detail: null,
    href: null,
    ...overrides,
  };
}

describe('newCriticalItems', () => {
  it('returns critical items in next that were not critical in prev', () => {
    const prev = [item({ id: 'a', severity: 'warn' })];
    const next = [item({ id: 'a', severity: 'critical' }), item({ id: 'b', severity: 'critical' })];

    const result = newCriticalItems(prev, next);

    expect(result.map((i) => i.id).sort()).toEqual(['a', 'b']);
  });

  it('excludes items that were already critical in prev (no repeats)', () => {
    const prev = [item({ id: 'a', severity: 'critical' })];
    const next = [item({ id: 'a', severity: 'critical' })];

    expect(newCriticalItems(prev, next)).toEqual([]);
  });

  it('excludes non-critical items in next', () => {
    const prev: StatusItem[] = [];
    const next = [item({ id: 'a', severity: 'warn' }), item({ id: 'b', severity: 'ok' })];

    expect(newCriticalItems(prev, next)).toEqual([]);
  });
});
