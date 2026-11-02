import { NextResponse } from 'next/server';
import { z } from 'zod';
import { checkBearer } from '@/lib/auth/bearer';
import { getRepo } from '@/lib/repo';
import { matchProjectByPath } from '@/lib/logic/path-match';
import { ccStatusSchema } from '@/lib/logic/cc-status-schema';
import { checklistBarMetrics, mergePushedStatus, projectDetailMetaKey } from '@/lib/logic/project-detail';
import type { ProjectDetail } from '@/lib/types';

export const dynamic = 'force-dynamic';

const MAX_BYTES = 128 * 1024;

const bodySchema = z.object({ path: z.string().min(1).max(500), status: ccStatusSchema });

/**
 * For scripts/cc-inbox.mjs (Stop/SessionStart hooks): pushes a project's freshly written
 * docs/cc-status.json so the dashboard doesn't wait for the hourly collector. Matches the
 * project by path, replaces only `status` in its detail blob and patches its 체크리스트 bar.
 * Bearer-token auth (AGENT_TOKEN). The body is never logged.
 */
export async function POST(request: Request) {
  const auth = checkBearer(request, process.env.AGENT_TOKEN);
  if (auth === 'missing-config') {
    return NextResponse.json({ ok: false, error: 'AGENT_TOKEN not configured' }, { status: 503 });
  }
  if (auth === 'unauthorized') {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const raw = await request.text();
  if (Buffer.byteLength(raw) > MAX_BYTES) {
    return NextResponse.json({ ok: false, error: 'payload too large' }, { status: 413 });
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid JSON' }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: parsed.error.message }, { status: 400 });
  }
  const { path, status } = parsed.data;

  const repo = getRepo();
  const project = matchProjectByPath(await repo.listProjects(), path);
  if (!project) return NextResponse.json({ ok: true, project: null });

  const key = projectDetailMetaKey(project.id);
  const [existing, activityList] = await Promise.all([repo.getMeta<ProjectDetail>(key), repo.listProjectActivity()]);
  await repo.setMeta(key, mergePushedStatus(existing, project.id, status, new Date().toISOString()));

  const bar = checklistBarMetrics(status, project.backlogGlobs);
  const activity = activityList.find((a) => a.projectId === project.id);
  if (bar && activity) {
    await repo.upsertProjectActivity({ ...activity, metrics: { ...activity.metrics, ...bar } });
  }
  return NextResponse.json({ ok: true, projectId: project.id, bar: !!(bar && activity) });
}
