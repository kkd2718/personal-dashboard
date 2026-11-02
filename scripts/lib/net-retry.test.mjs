import { describe, expect, it, vi } from 'vitest';
import { fetchWithRetry, isRetryableNetworkError } from './net-retry.mjs';

const res = (status) => ({ status, ok: status < 400 });

describe('fetchWithRetry', () => {
  it('retries network errors with the default delays', async () => {
    const sleep = vi.fn(async () => {});
    const doFetch = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(res(200));
    const out = await fetchWithRetry(doFetch, { sleep });
    expect(out.attempts).toBe(3);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([5000, 15000]);
  });

  it('rethrows a non-retryable error at once', async () => {
    const sleep = vi.fn(async () => {});
    const doFetch = vi.fn().mockRejectedValue(new Error('boom'));
    await expect(fetchWithRetry(doFetch, { sleep })).rejects.toThrow('boom');
    expect(doFetch).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('returns the last retryable status after 3 attempts; other statuses at once', async () => {
    const sleep = vi.fn(async () => {});
    const out = await fetchWithRetry(vi.fn().mockResolvedValue(res(503)), { sleep });
    expect(out).toMatchObject({ attempts: 3, res: { status: 503 } });
    const nf = await fetchWithRetry(vi.fn().mockResolvedValue(res(404)), { sleep });
    expect(nf.attempts).toBe(1);
  });

  it('rethrows the last retryable error when attempts run out', async () => {
    const sleep = vi.fn(async () => {});
    await expect(fetchWithRetry(vi.fn().mockRejectedValue(new TypeError('fetch failed')), { sleep })).rejects.toThrow('fetch failed');
    expect(sleep).toHaveBeenCalledTimes(2);
  });
});

describe('isRetryableNetworkError', () => {
  it('knows causes and timeouts', () => {
    expect(isRetryableNetworkError(Object.assign(new Error('x'), { cause: { code: 'ENOTFOUND' } }))).toBe(true);
    expect(isRetryableNetworkError(Object.assign(new Error('x'), { name: 'TimeoutError' }))).toBe(true);
    expect(isRetryableNetworkError(new Error('x'))).toBe(false);
    expect(isRetryableNetworkError(null)).toBe(false);
  });
});
