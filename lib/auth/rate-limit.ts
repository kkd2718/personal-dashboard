// In-memory login rate limiter (single-user app, single Node process — no need
// for a shared store). Max MAX_ATTEMPTS failures per WINDOW_MS per key (IP).
const WINDOW_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;

interface Bucket {
  count: number;
  windowStart: number;
}

const buckets = new Map<string, Bucket>();

function currentBucket(key: string, now: number): Bucket | undefined {
  const bucket = buckets.get(key);
  if (!bucket || now - bucket.windowStart > WINDOW_MS) return undefined;
  return bucket;
}

export function isRateLimited(key: string, now = Date.now()): boolean {
  const bucket = currentBucket(key, now);
  return (bucket?.count ?? 0) >= MAX_ATTEMPTS;
}

export function recordFailure(key: string, now = Date.now()): void {
  const bucket = currentBucket(key, now);
  if (bucket) bucket.count += 1;
  else buckets.set(key, { count: 1, windowStart: now });
}

export function recordSuccess(key: string): void {
  buckets.delete(key);
}
