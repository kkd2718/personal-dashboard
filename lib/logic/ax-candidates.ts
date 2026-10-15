// Cheap deterministic prefilter: which open tasks/deadlines could a free-text message
// be talking about? Keeps the single Jev request small (docs/PLAN_AX.md §6).
import { normalize } from '@/lib/logic/capture';
import type { Deadline, Project, Task } from '@/lib/types';

export interface Candidate {
  key: string; // 't:<id>' | 'd:<id>'
  kind: 'task' | 'deadline';
  id: string;
  title: string;
  projectName: string | null;
  dueDate: string | null;
}

const squash = (s: string) => normalize(s).replace(/[^\p{L}\p{N}]/gu, '');

function bigrams(s: string): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i + 1 < s.length; i++) out.add(s.slice(i, i + 2));
  return out;
}

export function prefilterCandidates(
  text: string,
  tasks: Task[],
  deadlines: Deadline[],
  projects: Project[],
  limit = 50
): Candidate[] {
  const textNorm = squash(text);
  const textGrams = bigrams(textNorm);
  const projectById = new Map(projects.map((p) => [p.id, p]));

  const named = (projectId: string | null): boolean => {
    const p = projectId ? projectById.get(projectId) : undefined;
    if (!p) return false;
    return [p.slug, p.name, ...p.aliases].map(squash).some((n) => n.length >= 2 && textNorm.includes(n));
  };

  const scored: Array<{ score: number; c: Candidate }> = [];
  const consider = (c: Candidate, projectId: string | null) => {
    let score = 0;
    for (const g of bigrams(squash(c.title))) if (textGrams.has(g)) score++;
    if (score === 0) return; // a project name alone is not enough to propose a target
    if (named(projectId)) score += 3;
    scored.push({ score, c });
  };

  for (const t of tasks) {
    if (t.status === 'done') continue;
    consider(
      {
        key: `t:${t.id}`,
        kind: 'task',
        id: t.id,
        title: t.title,
        projectName: (t.projectId && projectById.get(t.projectId)?.name) || null,
        dueDate: t.dueDate,
      },
      t.projectId
    );
  }
  for (const d of deadlines) {
    if (d.done) continue;
    consider(
      {
        key: `d:${d.id}`,
        kind: 'deadline',
        id: d.id,
        title: d.title,
        projectName: (d.projectId && projectById.get(d.projectId)?.name) || null,
        dueDate: d.dueDate,
      },
      d.projectId
    );
  }

  scored.sort(
    (a, b) =>
      b.score - a.score ||
      (a.c.dueDate ?? '9999').localeCompare(b.c.dueDate ?? '9999') ||
      a.c.title.localeCompare(b.c.title)
  );
  return scored.slice(0, limit).map((s) => s.c);
}
