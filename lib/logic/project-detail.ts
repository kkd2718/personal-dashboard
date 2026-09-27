import { relTime } from '@/lib/logic/dates';
import type { CcStatus } from '@/lib/types';

/** Meta key a project's detail blob (open items + CcStatus) is stored under — see
 * app/api/ingest/route.ts (write) and app/(main)/projects/[slug]/page.tsx (read). */
export function projectDetailMetaKey(projectId: string): string {
  return `project:detail:${projectId}`;
}

/** "3시간 전 기록", or null when the status has no updatedAt to date it by. */
export function statusAgeLabel(status: CcStatus | null, now: string): string | null {
  if (!status?.updatedAt) return null;
  return `${relTime(status.updatedAt, now)} 기록`;
}

/** True when the status is missing an updatedAt, or it's older than `days` (default 7). */
export function isStatusStale(status: CcStatus | null, nowMs: number, days = 7): boolean {
  if (!status?.updatedAt) return true;
  const updatedMs = new Date(status.updatedAt).getTime();
  if (!Number.isFinite(updatedMs)) return true;
  return nowMs - updatedMs > days * 24 * 60 * 60 * 1000;
}
