import { describe, expect, it } from 'vitest';
import { staleness } from './staleness';

describe('staleness', () => {
  const today = '2026-09-25';

  it('boundaries at 7/8/21/22 days', () => {
    expect(staleness('2026-09-18', today)).toBe('fresh'); // 7 days
    expect(staleness('2026-09-17', today)).toBe('quiet'); // 8 days
    expect(staleness('2026-09-04', today)).toBe('quiet'); // 21 days
    expect(staleness('2026-09-03', today)).toBe('stale'); // 22 days
  });

  it('no commit is stale', () => {
    expect(staleness(null, today)).toBe('stale');
  });
});
