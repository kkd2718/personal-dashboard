import { timingSafeEqual } from 'node:crypto';

/** Constant-time string comparison (via crypto.timingSafeEqual; length differs -> false fast,
 * which leaks length but never the content — acceptable for fixed-length bearer tokens). */
export function constantTimeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export type BearerResult = 'missing-config' | 'unauthorized' | 'ok';

/**
 * Checks `Authorization: Bearer <token>` against `expected`. If `expected` is
 * unset, returns 'missing-config' — callers must respond 503, never treat a
 * missing server-side token as "open" (rubric item 5, docs/PLAN_1b.md).
 */
export function checkBearer(request: Request, expected: string | undefined): BearerResult {
  if (!expected) return 'missing-config';
  const header = request.headers.get('authorization') ?? '';
  const match = /^Bearer (.+)$/.exec(header);
  if (!match) return 'unauthorized';
  return constantTimeEqual(match[1], expected) ? 'ok' : 'unauthorized';
}
