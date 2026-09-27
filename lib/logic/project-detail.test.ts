import { describe, expect, it } from 'vitest';
import { isStatusStale, projectDetailMetaKey, statusAgeLabel } from './project-detail';
import type { CcStatus } from '@/lib/types';

const status = (updatedAt: string | null): CcStatus => ({ updatedAt, focus: null, next: [], blockers: [], done: [], checklist: [] });

describe('projectDetailMetaKey', () => {
  it('namespaces by project id', () => {
    expect(projectDetailMetaKey('amgi')).toBe('project:detail:amgi');
  });
});

describe('statusAgeLabel', () => {
  it('renders a relative label when updatedAt is present', () => {
    expect(statusAgeLabel(status('2026-09-27T09:00:00.000Z'), '2026-09-27T12:00:00.000Z')).toBe('3시간 전 기록');
  });

  it('returns null when status or updatedAt is missing', () => {
    expect(statusAgeLabel(null, '2026-09-27T12:00:00.000Z')).toBeNull();
    expect(statusAgeLabel(status(null), '2026-09-27T12:00:00.000Z')).toBeNull();
  });
});

describe('isStatusStale', () => {
  const now = new Date('2026-09-27T12:00:00.000Z').getTime();

  it('is false within the window', () => {
    expect(isStatusStale(status('2026-09-25T12:00:00.000Z'), now)).toBe(false);
  });

  it('is true beyond the window (default 7 days)', () => {
    expect(isStatusStale(status('2026-09-01T12:00:00.000Z'), now)).toBe(true);
  });

  it('respects a custom days threshold', () => {
    const status5DaysOld = status('2026-09-22T12:00:00.000Z');
    expect(isStatusStale(status5DaysOld, now, 3)).toBe(true);
    expect(isStatusStale(status5DaysOld, now, 7)).toBe(false);
  });

  it('is true when status or updatedAt is missing', () => {
    expect(isStatusStale(null, now)).toBe(true);
    expect(isStatusStale(status(null), now)).toBe(true);
  });
});
