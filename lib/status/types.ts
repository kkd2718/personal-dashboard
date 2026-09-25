export type StatusSeverity = 'critical' | 'warn' | 'info' | 'ok';

export interface StatusItem {
  id: string;
  severity: StatusSeverity;
  source: 'trading' | 'git';
  projectId: string | null;
  title: string;
  detail: string | null;
  href: string | null;
}

const SEVERITY_RANK: Record<StatusSeverity, number> = { critical: 0, warn: 1, info: 2, ok: 3 };

export function sortStatusItems(items: StatusItem[]): StatusItem[] {
  return [...items].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
}

/** Runs fn with a hard timeout; never throws — resolves to the fallback on error/timeout. */
export async function withTimeout<T>(fn: () => Promise<T>, ms: number, fallback: T): Promise<T> {
  try {
    return await Promise.race([
      fn(),
      new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
    ]);
  } catch {
    return fallback;
  }
}

/** Simple in-memory TTL cache, one entry per key. Module-scoped (per server process). */
export function memoize<T>(ttlMs: number, shouldCache: (value: T) => boolean = () => true) {
  const cache = new Map<string, { value: T; at: number }>();
  return async (key: string, compute: () => Promise<T>): Promise<T> => {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < ttlMs) return hit.value;
    const value = await compute();
    if (shouldCache(value)) cache.set(key, { value, at: Date.now() });
    return value;
  };
}
