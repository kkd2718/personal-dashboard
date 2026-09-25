import type { Group, Project } from '@/lib/types';

/** Group projects by Group then subgroup ('기타' when null), sorted by `sort`. Archived excluded unless includeArchived. */
export function groupProjects(
  projects: Project[],
  includeArchived = false
): Record<Group, Record<string, Project[]>> {
  const result: Record<Group, Record<string, Project[]>> = {
    app: {},
    research: {},
    personal: {},
  };

  for (const p of projects) {
    if (p.status === 'archived' && !includeArchived) continue;
    const sub = p.subgroup ?? '기타';
    (result[p.group][sub] ??= []).push(p);
  }

  for (const bySubgroup of Object.values(result)) {
    for (const list of Object.values(bySubgroup)) {
      list.sort((a, b) => a.sort - b.sort);
    }
  }

  return result;
}
