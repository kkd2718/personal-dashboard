// Server-only aggregator for lib/status/*. Never import from a client component.
if (typeof window !== 'undefined') {
  throw new Error('lib/status/index.ts is server-only');
}

import type { Project } from '@/lib/types';
import { sortStatusItems, withTimeout, type StatusItem } from '@/lib/status/types';
import { tradingStatus } from '@/lib/status/trading';
import { gitStatus } from '@/lib/status/git';

const PROBE_BUDGET_MS = 3500;

/** Runs all local status probes with a shared time budget. Disabled by LOCAL_PROBES=0. */
export async function runStatusProbes(projects: Project[]): Promise<StatusItem[]> {
  if (process.env.LOCAL_PROBES === '0') return [];

  const [trading, git] = await Promise.all([
    withTimeout(tradingStatus, PROBE_BUDGET_MS, [] as StatusItem[]),
    withTimeout(() => gitStatus(projects.filter((p) => p.status === 'active')), PROBE_BUDGET_MS, [] as StatusItem[]),
  ]);

  return sortStatusItems([...trading, ...git]);
}

export type { StatusItem };
