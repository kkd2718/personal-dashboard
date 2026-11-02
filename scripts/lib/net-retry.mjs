// Plain JS, Node >=18. Bounded retry for the collector's network calls: only transient
// network errors and 502/503/504 are retried (total wait <= 20 s with the default delays).

export const RETRY_STATUSES = [502, 503, 504];

const RETRY_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ETIMEDOUT',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
]);

/** True for timeouts/aborts and connection-level failures (undici's "fetch failed"). */
export function isRetryableNetworkError(err) {
  if (!err || typeof err !== 'object') return false;
  if (err.name === 'AbortError' || err.name === 'TimeoutError') return true;
  if (err instanceof TypeError && /fetch failed/i.test(err.message)) return true;
  return RETRY_CODES.has(err.cause?.code);
}

/**
 * Runs `doFetch()` up to `delays.length + 1` times. Returns `{ res, attempts }`; rethrows a
 * non-retryable error at once, and the last error / last retryable-status response when
 * attempts run out.
 */
export async function fetchWithRetry(doFetch, { delays = [5000, 15000], sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  for (let i = 0; ; i++) {
    const last = i >= delays.length;
    let res;
    try {
      res = await doFetch();
    } catch (err) {
      if (last || !isRetryableNetworkError(err)) throw err;
      await sleep(delays[i]);
      continue;
    }
    if (last || !RETRY_STATUSES.includes(res.status)) return { res, attempts: i + 1 };
    await sleep(delays[i]);
  }
}
