import { NextResponse } from 'next/server';
import { checkBearer } from '@/lib/auth/bearer';
import { getRepo } from '@/lib/repo';
import { matchProjectByPath } from '@/lib/logic/path-match';

export const dynamic = 'force-dynamic';

/**
 * For scripts/cc-inbox.mjs (SessionStart hook): given the session's cwd, returns
 * that project's open agent tasks + memos sent to it. Marks returned items
 * deliveredAt=now on first delivery only. Bearer-token auth (AGENT_TOKEN).
 */
export async function GET(request: Request) {
  const auth = checkBearer(request, process.env.AGENT_TOKEN);
  if (auth === 'missing-config') {
    return NextResponse.json({ ok: false, error: 'AGENT_TOKEN not configured' }, { status: 503 });
  }
  if (auth === 'unauthorized') {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const cwd = new URL(request.url).searchParams.get('path');
  if (!cwd) {
    return NextResponse.json({ ok: false, error: 'missing path query param' }, { status: 400 });
  }

  const repo = getRepo();
  const [projects, tasks, notes, milestones] = await Promise.all([
    repo.listProjects(),
    repo.listTasks(),
    repo.listNotes(),
    repo.listMilestones(),
  ]);
  const project = matchProjectByPath(projects, cwd);
  if (!project) {
    return NextResponse.json({ project: null, tasks: [], memos: [] });
  }

  const openTasks = tasks.filter((t) => t.projectId === project.id && t.assignee === 'agent' && t.status !== 'done');
  const sentMemos = notes.filter((n) => n.projectId === project.id && n.status === 'sent');

  const now = new Date().toISOString();
  await Promise.all([
    ...openTasks.filter((t) => t.deliveredAt == null).map((t) => repo.updateTask(t.id, { deliveredAt: now })),
    ...sentMemos.filter((n) => n.deliveredAt == null).map((n) => repo.updateNote(n.id, { deliveredAt: now })),
  ]);

  const milestoneTitleById = new Map(milestones.map((m) => [m.id, m.title]));
  return NextResponse.json({
    project: { id: project.id, name: project.name },
    tasks: openTasks.map((t) => ({
      id: t.id,
      title: t.title,
      description: t.description,
      dueDate: t.dueDate,
      milestone: t.milestoneId ? (milestoneTitleById.get(t.milestoneId) ?? null) : null,
    })),
    memos: sentMemos.map((n) => ({ id: n.id, body: n.body, tags: n.tags })),
  });
}
