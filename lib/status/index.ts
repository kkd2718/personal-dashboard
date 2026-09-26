// Server-only aggregator for lib/status/*. Never import from a client component.
if (typeof window !== 'undefined') {
  throw new Error('lib/status/index.ts is server-only');
}

import type { Project, StatusSnapshot } from '@/lib/types';
import type { Repo } from '@/lib/repo';
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

export interface StatusPanelData {
  items: StatusItem[];
  checkedAt: string;
  /** True when running on the cloud deploy (LOCAL_PROBES=0): items come from the
   * last POST /api/ingest snapshot, not a live probe run on this machine. */
  remote: boolean;
}

/**
 * Status panel data source: live local probes normally, or the last cloud
 * ingest snapshot when LOCAL_PROBES=0 (see docs/PLAN_1b.md §4).
 */
export async function getStatusPanelData(repo: Repo, projects: Project[]): Promise<StatusPanelData> {
  if (process.env.LOCAL_PROBES === '0') {
    const snapshot: StatusSnapshot | null = await repo.getStatusSnapshot();
    return {
      items: snapshot?.items ?? [],
      checkedAt: snapshot?.collectedAt ?? new Date().toISOString(),
      remote: true,
    };
  }
  const items = await runStatusProbes(projects);
  return { items, checkedAt: new Date().toISOString(), remote: false };
}

export type { StatusItem };
