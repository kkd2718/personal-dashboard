// Path normalization + longest-prefix project matching for GET /api/agent-inbox.
// A cwd sent by the SessionStart hook (Windows or WSL, either /mnt/c/... or
// /home/... form) must match a Project.paths entry stored in either form.
import type { Project } from '@/lib/types';

/**
 * Canonical form for comparison: backslashes -> slashes, lowercased (Windows
 * paths are case-insensitive; this also makes /home matching forgiving), a
 * leading '/mnt/<drive>/' rewritten to '<drive>:/', trailing slash stripped.
 */
export function normalizePath(p: string): string {
  let s = p.trim().replace(/\\/g, '/').toLowerCase();
  const mnt = /^\/mnt\/([a-z])\/(.*)$/.exec(s);
  if (mnt) s = `${mnt[1]}:/${mnt[2]}`;
  if (s.length > 1 && s.endsWith('/')) s = s.slice(0, -1);
  return s;
}

/**
 * Finds the project whose Project.paths has the longest prefix match against cwd
 * (normalized). Returns null if no project path is a prefix of cwd.
 */
export function matchProjectByPath(projects: Project[], cwd: string): Project | null {
  const target = normalizePath(cwd);
  let best: Project | null = null;
  let bestLen = -1;
  for (const project of projects) {
    for (const raw of project.paths) {
      const candidate = normalizePath(raw);
      if (!candidate) continue;
      const isMatch = target === candidate || target.startsWith(`${candidate}/`);
      if (isMatch && candidate.length > bestLen) {
        best = project;
        bestLen = candidate.length;
      }
    }
  }
  return best;
}
