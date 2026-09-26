import { describe, expect, it } from 'vitest';
import { isRateLimited, recordFailure, recordSuccess } from '@/lib/auth/rate-limit';

describe('rate-limit', () => {
  it('not limited before any failures', () => {
    expect(isRateLimited('key-a')).toBe(false);
  });

  it('limited after 5 failures within the window', () => {
    for (let i = 0; i < 5; i++) recordFailure('key-b');
    expect(isRateLimited('key-b')).toBe(true);
  });

  it('recordSuccess clears the bucket', () => {
    for (let i = 0; i < 5; i++) recordFailure('key-c');
    expect(isRateLimited('key-c')).toBe(true);
    recordSuccess('key-c');
    expect(isRateLimited('key-c')).toBe(false);
  });

  it('resets after the window elapses', () => {
    const now = Date.now();
    for (let i = 0; i < 5; i++) recordFailure('key-d', now);
    expect(isRateLimited('key-d', now)).toBe(true);
    expect(isRateLimited('key-d', now + 11 * 60 * 1000)).toBe(false);
  });

  it('keys are independent', () => {
    for (let i = 0; i < 5; i++) recordFailure('key-e');
    expect(isRateLimited('key-f')).toBe(false);
  });
});
