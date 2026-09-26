// Plain JS, Node >=18. Mirrors lib/status/{types,git}.ts's rules for the collector
// (which can't import .ts files without a stripping loader). Pure functions.

const SEVERITY_RANK = { critical: 0, warn: 1, info: 2, ok: 3 };

/** Same ordering as lib/status/types.ts sortStatusItems. */
export function sortStatusItems(items) {
  return [...items].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
}

/** Days between two 'YYYY-MM-DD' (or ISO) date strings, b - a, in whole days. */
function daysBetween(aIso, bDateStr) {
  const a = new Date(`${aIso.slice(0, 10)}T00:00:00Z`);
  const b = new Date(`${bDateStr}T00:00:00Z`);
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

/** fresh <= 7 days since last commit, quiet <= 21 days, stale beyond that (or no commit). */
export function staleness(lastCommitAt, today) {
  if (!lastCommitAt) return 'stale';
  const daysAgo = daysBetween(lastCommitAt, today);
  if (daysAgo <= 7) return 'fresh';
  if (daysAgo <= 21) return 'quiet';
  return 'stale';
}

/**
 * Builds git-derived status items (stale warnings + one dirty summary line) from
 * already-collected ProjectActivity rows, plus whatever trading items the caller
 * already computed. Returns the combined list, sorted by severity.
 * @param {Array<{id:string,name:string,status:string}>} projects
 * @param {Array<{projectId:string,lastCommitAt:string|null,dirty:boolean|null}>} activities
 * @param {Array<object>} tradingItems
 * @param {string} today 'YYYY-MM-DD'
 */
export function buildStatusItems(projects, activities, tradingItems, today) {
  const nameById = new Map(projects.map((p) => [p.id, p.name]));
  const items = [];
  const dirtyNames = [];

  for (const a of activities) {
    if (a.lastCommitAt == null) continue;
    const name = nameById.get(a.projectId) ?? a.projectId;
    if (staleness(a.lastCommitAt, today) === 'stale') {
      items.push({
        id: `git:stale:${a.projectId}`,
        severity: 'warn',
        source: 'git',
        projectId: a.projectId,
        title: `${name}: 오래 조용함`,
        detail: `마지막 커밋 ${a.lastCommitAt.slice(0, 10)}`,
        href: null,
      });
    }
    if (a.dirty) dirtyNames.push(name);
  }

  if (dirtyNames.length > 0) {
    items.push({
      id: 'git:dirty',
      severity: 'info',
      source: 'git',
      projectId: null,
      title: `미커밋 변경 ${dirtyNames.length}개 프로젝트`,
      detail: dirtyNames.sort().join(', '),
      href: null,
    });
  }

  return sortStatusItems([...tradingItems, ...items]);
}
