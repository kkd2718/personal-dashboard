// Server-only: shells out to git on the user's PC. Never import from a client component.
if (typeof window !== 'undefined') {
  throw new Error('lib/status/git.ts is server-only');
}

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';
import type { Project, ProjectActivity } from '@/lib/types';
import { getRepo } from '@/lib/repo';
import { todayKST } from '@/lib/logic/dates';
import { staleness } from '@/lib/logic/staleness';
import type { StatusItem } from '@/lib/status/types';

const execFileAsync = promisify(execFile);
const TIMEOUT_MS = 3000;

/** Resolves a Project.paths entry to an existing Windows directory, or null (not a local Windows path). */
function resolveWindowsPath(p: string): string | null {
  if (p.startsWith('/') || p.startsWith('~')) return null; // WSL path — skip in 1c
  if (!/^[A-Za-z]:[\\/]/.test(p)) return null; // absolute Windows paths only
  return existsSync(p) ? p : null;
}

function isWslOnly(project: Project): boolean {
  return (
    project.paths.length > 0 &&
    project.paths.every((p) => p.startsWith('/') || p.startsWith('~'))
  );
}

async function readGit(dir: string): Promise<{ commitAt: string | null; msg: string | null; dirty: boolean }> {
  try {
    const [log, status] = await Promise.all([
      execFileAsync('git', ['-C', dir, 'log', '-1', '--format=%cI%x09%s'], { timeout: TIMEOUT_MS }),
      execFileAsync('git', ['-C', dir, 'status', '--porcelain'], { timeout: TIMEOUT_MS }),
    ]);
    const [commitAt, msg] = log.stdout.trim().split('\t');
    return { commitAt: commitAt || null, msg: msg ?? null, dirty: status.stdout.trim().length > 0 };
  } catch {
    return { commitAt: null, msg: null, dirty: false };
  }
}

/** For each project with a resolvable Windows path, run `git log`/`git status` and upsert ProjectActivity. */
export async function gitStatus(projects: Project[]): Promise<StatusItem[]> {
  const repo = getRepo();
  const items: StatusItem[] = [];
  const dirtyNames: string[] = [];
  const today = todayKST();

  await Promise.all(
    projects.map(async (project) => {
      const winPath = project.paths.map(resolveWindowsPath).find((p): p is string => p != null);
      if (!winPath) {
        if (isWslOnly(project)) {
          // WSL repos are covered by the phase-2 collector; no status noise until then.
          await repo.upsertProjectActivity({
            projectId: project.id,
            branch: null,
            lastCommitAt: null,
            lastCommitMsg: null,
            dirty: null,
            lastSessionAt: null,
            memoryDigest: null,
            metrics: { wsl: '1' },
            collectedAt: new Date().toISOString(),
          });
        }
        return;
      }

      const { commitAt, msg, dirty } = await readGit(winPath);
      if (commitAt === null) return; // not a git repo, or git failed — never throw, just skip

      const activity: ProjectActivity = {
        projectId: project.id,
        branch: null,
        lastCommitAt: commitAt,
        lastCommitMsg: msg,
        dirty,
        lastSessionAt: null,
        memoryDigest: null,
        metrics: {},
        collectedAt: new Date().toISOString(),
      };
      await repo.upsertProjectActivity(activity);

      if (staleness(commitAt, today) === 'stale') {
        items.push({
          id: `git:stale:${project.id}`,
          severity: 'warn',
          source: 'git',
          projectId: project.id,
          title: `${project.name}: 오래 조용함`,
          detail: `마지막 커밋 ${commitAt.slice(0, 10)}`,
          href: null,
        });
      }
      if (dirty) dirtyNames.push(project.name);
    })
  );

  // One summary line instead of one row per dirty repo.
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
  return items;
}
